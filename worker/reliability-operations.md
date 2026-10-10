# 批改可靠性：有界等待与任务统计

本轮服务版本为 `2026-10-10-display-receipt-1`，评分版本仍为 `2026-10-09-judgment-evidence-1`。展示回执不会改变评分标准或清空评分缓存。本地修复和测试不等于线上已经启用；必须发布 Worker 后核对 `/health` 与远端日志设置。

## 已完成评分不再被附属服务无限拖住

| 环节 | 单次等待上限 | 超时处理 |
| --- | ---: | --- |
| 已发布案例检索 | 1500 ms | 优先找同稿历史缓存，否则按当前稿继续判断 |
| 评分缓存读取 / 写入 | 750 / 500 ms | 不阻止当前批改；保留本地已验证结果 |
| 旧回执读取 / 新回执保存 | 1200 ms | 当前稿独立判断；保存失败时交付报告并标注历史不可用 |
| 进度状态更新 | 200 ms | 继续批改，不等待可选进度写入 |
| 准入限流检查（含正文） | 1500 ms | 保持拒绝放行，不在保护不可用时调用模型 |

上述附属步骤还受当前批改统一预算约束，不会为了补缓存延长模型预算。旧回执与原稿/场景绑定不匹配仍拒绝；不能借故障认可伪造历史。回执迟到不会更改已交付的报告编号。本地同键缓存写入串行，避免先前慢写入覆盖后来修正；这不提供跨地区 KV 强一致性。

这是对挂起和长尾的修复，不是新平均耗时的测量，也没有把150秒任务保护上限当作正常等待时间。上游模型不可用且无法可靠判断时，不生成虚假分数。

## 日志与统计口径

`wrangler.jsonc` 开启持久应用日志，采样率为1，关闭常规 invocation logs 和 traces，并去掉查询字符串。新增事件只输出白名单字段，不记录稿件、报告正文、入口码、IP 指纹或原始异常消息。记录留存时长及配额由 Cloudflare 当前账户配置决定。

`coach_job` 的 `lifecycle`：

- `admitted`：任务创建事务已提交；同 UUID 重复提交不增加新任务。
- `started`：任务开始执行的状态已提交。
- `terminal`：成功或失败的终态已保存。只有 `state=done` 才是后台批改成功；`failed` 查询也可能是 HTTP 200。
- `persistence_failed`：创建、开始或结果保存出错；不伪装成成功终态。

每条记录包含随机任务编号、服务版本、固定阶段/原因枚举、状态码及排队/执行/总耗时。无法恢复的时间为 null，不写0。轮询不额外写诊断数据，也不持续刷日志。附属步骤超时另有 `coach_dependency_degraded`（固定操作名、原因、耗时）。

发布后只读查询：

```powershell
node scripts/coach-reliability.mjs --hours 24 --service-version 2026-10-10-display-receipt-1
```

配置读取仍使用已有 Wrangler 登录；日志查询由固定版本的官方 `cf` CLI 使用独立 `lapiao-observability` 配置执行，不提取或打印该配置的令牌。当前 Wrangler 登录入口不支持所需日志权限，单纯重新登录不能补齐。脚本不保存原始日志或密钥，不读取线上案例库，不调用模型。多账号时显式设置本项目 `CLOUDFLARE_ACCOUNT_ID`。

统计按任务编号和服务版本去重，输出已观察终态成功比例、失败阶段、成功耗时中位数/P95/最大值、超过60秒的成功任务数、无终态和矛盾终态数量。空数据为 `no_data`；未开启留存为 `unavailable`；分页不完整为 `incomplete`。这些状态不能解释成零故障或100%成功。

后台终态指标只证明后台处理结果；页面展示需结合下文的 displayed 回执，二者都不是严格审计账本。窗口边界、日志延迟、平台丢失/配额、用户尚未发到后端的网络故障会影响覆盖。上线后先确认真实任务日志能查到，再积累数据；不能只用健康检查、HTTP 200 或少数合成用例向学员承诺稳定。

## 验证与发布核对

1. 全部 CI 回归通过，新增三组覆盖永不返回/迟到的依赖、真实业务终态、日志去重和空数据处理。
2. `node tests/coach-jobs-runtime.mjs` 在真实 workerd/SQLite 上验证断线后完成、同任务恢复、不可变回执和失败终态，不消耗模型额度。
3. `wrangler deploy --dry-run` 确认构建与配置；它不代表已经发布。
4. 发布后核对 `serviceVersion`、日志 `enabled/persist/head_sampling_rate`，再查询本版本的真实日志。初始没有样本时如实保留“尚无数据”。
5. 如果上游仍慢，按真实成功耗时和质量样本评估精简输出；不能仅为缩短耗时更改通过标准。

官方参考：[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)。

## 独立日志授权与已确认状态（2026-10-10）

已完成 Cloudflare 官方 OAuth 设备授权，并以现有生产版本实际查询成功，此前 403 已解除。首次查询过去24小时返回 no_data；这既不代表零故障，也不能证明已收到真实任务日志。

安装项目开发依赖后，首次在本机创建独立配置（需要账户本人在浏览器确认）：

```powershell
node node_modules/cf/bin/cf auth create lapiao-observability --scopes account:read user:read workers:read workers_observability:write
node scripts/coach-reliability.mjs --hours 24 --service-version 2026-10-10-display-receipt-1
```

该 CLI 的凭据由官方工具保管；没有替换 Wrangler 发布登录。查询接口虽然用于读取，官方要求 Workers Observability Write；请求固定 dry=true，不保存查询结果。可用 --cf-profile 指定另一个独立配置。

## 学员端展示回执

- 后端明确支持回执时，前端只在对应报告完成渲染、页面可见且报告视图仍匹配后记录展示；隐藏页、错稿、渲染异常均不确认。
- 本地队列只包含随机任务/报告编号、入口码哈希和时间；不增加稿件或明文入口码存储。最多50条，最长随原任务保留24小时。
- 离线或回报超时保留队列，在恢复联网、页面重开或再次可见时重试；每页自动重试有上限，每次等待3秒，完全独立于批改交付。关闭页面且不再回来、存储不可用等情况仍可能缺少回执。
- 服务端校验入口码、任务归属、报告编号和任务完成状态。事务内首次保存展示时间，事务提交后才记 displayed 事件；重试和多标签页只计一次，不新增模型调用，也不改变原报告。
- 任务保留创建时的服务版本，避免跨版本继续执行/补报被拆成两次任务；已有旧任务缺少版本时只能按处理版本记录。

统计区分：

1. observedTerminalSuccessRate：日志中已观察到终态的后台完成比例，未终结任务单列。
2. admissionCohort：仅以本查询窗口观察到 admitted 的任务为分母，分别报告已成功、失败、未终结、展示确认和未确认。displayConfirmationRate 的未确认部分不能解释为失败；新任务还在处理中时比例会暂时偏低。
3. clientTiming：浏览器报告的首次提交至可见展示耗时，中位数、P95和超过60秒数量。包含断网/重开等待，依赖客户端时钟；不等于模型推理时长。

不能覆盖完全没有到达服务器且从未补报的提交，也不能证明学员认真阅读、判断质量或训练效果。发布后要用一笔已知任务核对实际 admitted → terminal → displayed 日志，再积累真实样本。旧前端尚无回执的阶段不应与新版混算。
