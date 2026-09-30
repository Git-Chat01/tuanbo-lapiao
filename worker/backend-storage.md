# 后端限流和案例库维护

批改入口使用 `COACH_LIMITER` Durable Object，而非 Workers KV 计数。每个入口码和 IP 的 SHA-256 指纹对应一个 SQLite 对象，事务保存当前分钟桶，每个维度最多 60 次。对象重启不重置额度；绑定缺失、存储故障或异常返回时批改返回 503，不调用模型。配置与首次迁移已包含在 `wrangler.jsonc`，上线须通过这份配置部署 Worker。

Cloudflare [SQLite 存储与事务说明](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)和 [Durable Object 迁移配置](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)是这一配置的依据。原有 `CASES` KV 仅继续用于案例与报告缓存。

## 案例分页与检索规模

后台清单每次仅列出一个真实 KV 页（默认 50，最多 200），读当前页后再按来源/删除状态筛选。`items`、`hasMore`、`nextCursor` 字段保留；`nextCursor` 是不透明游标，不能按数字递增。筛选后为空的页也可能有下一页。`total` 为 `null`，`totalIsExact:false`，不会为显示总数先扫描全库。顺序是存储 key 顺序，而非全库按创建时间倒序。

批改最多扫描最近 200 条已发布索引元数据，加前 120 个 `case:` key 中未回填记录的旧库兼容窗口；最多额外直读 16 条索引案例，选取其中最合适的 3 条。正常检索不超过 138 次 KV 操作，与全库大小无关。候选不写发布索引，删除/拒绝同步移除索引；索引命中后还会再次读取案例检查发布状态和场景，以免残留索引将候选或拒绝稿注入模型。

这是有界检索，不保证每次搜索全部历史案例。回填后超过最近 200 条的旧经验可能不再参与当轮评分；后台仍可完整逐页查看。词汇打分、同票况优先、manual 权威优先与 auto 同场景隔离保持原规则。需更大规模的全库语义检索时，应另建搜索服务，不增加单次全库 KV 读取。

## 旧库回填

新投喂/发布会建立发布索引，新 manual 同稿写入去重指纹。手工投喂 key 由票况、归一化稿和理由生成，重试可补齐先前失败的指纹/索引，不生成重复案例；重复发布也只补缺失索引。相同内容和理由已被拒绝时返回 409，修改理由属于新的手工投喂。自动候选保留确定性 key，已拒绝案例不会重新吸收。未回填旧库仅在 120-key 兼容窗口内检查 manual 同稿；窗口外可能出现待审核重复候选，仍不直接参与检索。要覆盖全库旧 manual 的去重以及已发布旧经验，管理员需显式分批回填。

接口为 `POST /api/admin/cases/reindex`，仍需 `X-Admin-Code`。正文 `{ "cursor": null, "limit": 100 }`；响应返回本页 `indexed/scanned`、`hasMore` 和 `nextCursor`。每页最多 100 条、601 次 KV 操作，保持原案例状态，仅补元数据/索引。坏 JSON 会被跳过，KV 服务故障会报错而不推进本页。失败时用原游标重试；不要并行执行回填或与编辑同一记录交错执行，KV 同键写入仍有每秒一次的限制。

可使用 `node scripts/reindex-cases.mjs --execute --max-pages=1`，默认 API 是 `https://lapiao.aivar.cc`。管理密码从 `ADMIN_CODE` 环境变量读取；脚本不读 `.dev.vars`、不打印密码或案例正文。游标保存在被 Git 忽略的 `tests/tmp_results/case-index-v1.json`，再次运行会继续，可用 `--max-pages=100` 多页处理。失败会保留本页游标；完成后需要 `--restart` 才重新扫描。回填幂等，不新增业务案例。

此工具没有随测试运行，也没有自动访问生产库。部署后由管理员执行回填。
