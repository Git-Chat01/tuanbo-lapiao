# DeepSeek 推理强度实测与选择

本文保留首次档位对照及当时发布记录。后续全部辅助步骤切换 high、事实保真修复和补测见 [全部 high 与保真回归](all-high-fidelity-results.md)；下文“未修复”“辅助步骤不变”仅描述首次测试时的状态。

测试日期：2026-10-17；配置调整日期：2026-10-18。

结论：核心判稿与完整稿独立复核采用 `high`。依据是本批样本中可重复观察到的“减少多余修改任务”收益，不是整体通过率提升，也不是提速。`max` 未显示值得额外等待的优势。评分规则、模型、token 上限、时限和恢复逻辑保持原样。

## 方法

- 基准代码：`49a3df0e17b77629aaebef0fecadfb312cabb33a`。
- 模型：DeepSeek 官方 `deepseek-flash`，使用现行生产 Worker 请求、校验、修复、恢复与交付路径。
- 12 条既有虚构话术，各在 low/high/max 下重复 2 次，共 72 次判稿。覆盖 4 条可用稿、7 条实际缺口稿、1 条应等待回应的稿。
- 保持相同规则、16000 token 上限、原稿 90 秒总预算、主报告约 63 秒预算。只改开启思考请求的 effort；关闭思考的生成、示范复核、保真与恢复调用不变。
- 每次使用独立入口码、内存 KV 和模拟持久对象，排除已交付报告缓存；没有读取线上案例、学员稿或本地密钥文件。经隔离的 Cloudflare remote preview 使用既有模型密钥，未返回密钥或推理文本。
- 三路并发，按样本及轮次轮换 low/high/max 的先后顺序。上游提示词缓存仍可能影响时延；这些是受控样本耗时，不是线上平均耗时。
- 分开评估最终判定、核心细项、反馈完整度、改法质量、等待时间。所有 72 份最终报告均另经人工语义审查；HTTP 200 和“通过/不通过正确”不能代表改法完全正确。

## 第一轮完整对照（每档 24 次）

| 指标 | low | high | max |
| --- | ---: | ---: | ---: |
| 返回可判定结果 | 24/24 | 24/24 | 24/24 |
| 最终通过/不通过/等待类别符合预期 | 24/24 | 24/24 | 24/24 |
| 上述类别及预设核心细项均符合预期 | 23/24 | 24/24 | 24/24 |
| 未进入简版恢复的完整报告 | 24/24 | 23/24 | 21/24 |
| 平均判稿耗时 | 24.903 秒 | 30.034 秒 | 39.557 秒 |
| 中位数 | 25.466 秒 | 25.208 秒 | 36.028 秒 |
| P95 | 37.533 秒 | 50.806 秒 | 66.850 秒 |
| 超过 60 秒 | 0 | 0 | 3 |
| 模型请求数（含复核、修正、恢复） | 49 | 49 | 48 |

恢复报告由同一个关闭思考的独立恢复器完成，不能算作 high/max 本身独有的判断能力。类别稳定只指“可用/需改/等回应”，不代表所有分项、严重程度或建议措辞完全相同。

## 针对实际差异的复测

对“已有机械舞和左右选择，只缺邀票动作”和“不会唱跳、慢语气、喜欢讲小糗事”两条稿，各用 low/high 再重复 3 次，共增加 12 次判稿（每档 6 次，双路并发）。

| 指标 | low | high |
| --- | ---: | ---: |
| 返回结果且最终类别正确 | 6/6 | 6/6 |
| 类别与预设核心细项正确 | 5/6 | 6/6 |
| 未进入简版恢复的完整报告 | 5/6 | 6/6 |
| 平均判稿耗时 | 36.455 秒 | 38.148 秒 |

合并同一“只缺动作”稿的 2 次基准和 3 次复测：

- low **2/5 次**把已成立的参与理由也列为缺口，实际生成了额外修改任务；其中一次连主修改点都选成参与理由。
- high **0/5 次**出现该问题，均保留理由成立，只要求补动作。

因此选择 high，优先减少已观察到的无效改稿成本。这个样本量不构成总体准确率的统计保证，high 在个别解释中仍有过度断言或措辞偏移。本批全部 84 次独立判稿未出现无结果或最终类别误判；不能由此宣称线上不会失败。

## 6 组完整改稿流程

两条针对性样本，各在三档运行一次：原稿判断 → 完整稿生成 → 同标准独立复核与保真检查 → 全新缓存下重判交付稿。

| 样本 | 档位 | 原稿＋完整稿就绪 | 再次判稿 | 自动流程 |
| --- | --- | ---: | --- | --- |
| 只缺动作 | low | 56.462 秒 | passed | ready |
| 只缺动作 | high | 67.545 秒 | passed | ready |
| 只缺动作 | max | 92.051 秒 | passed | ready |
| 能力边界 | low | 57.209 秒 | passed | ready，但人工保真不合格 |
| 能力边界 | high | 50.356 秒 | passed | ready |
| 能力边界 | max | 70.068 秒 | passed | ready，有轻微口语问题 |

“就绪”耗时不包含仅供测试的最后一次重新判稿。high 的一组、max 的两组在完整稿独立复核中使用了恢复流程。

### 必须单独跟进的保真缺口（本次未修复）

low 分组的能力边界完整稿编造了“今天上台前我把水杯当话筒举了半天，自己还没发现”，并添加“后面更糗的”。原稿未提供这些经历，不能让新人直接照念。保真检查却以“新增糗事细节属于可自述日常小事”放行。

该稿的生成和保真调用均为 **thinking disabled**；这三档测试都保持这两步相同。不能归因为 low 核心判稿，也不能声称换成 high 已修复。6 组自动流程均 ready、重判均 passed，但人工检查只有 **5/6 份内容可用**，必须将这一失败独立记录。

其他措辞问题包括：把慢语气强行改成“讲得热闹”、泛祝福被当成内容、反馈中“没有回应却接住已有回应”、把“不会唱跳”弱化成“不太会”。三档均有个别发生，不把这些差异包装成 high 全面更优。

## 配置与验收

- `worker/index.js`：新增 `DEEPSEEK_CONFIG.reasoningEffort = "high"`，实际判稿请求引用该值。原稿、报告修正和完整稿独立复核使用同档位。
- 推理档位进入现有评分缓存指纹，避免将旧 low 结果作为新 high 缓存复用；已交付的不可变报告凭证仍保留。
- 服务版本：`2026-10-18-reasoning-high-1`。健康检查返回公开的模型名与判稿思考强度，便于确认真实上线配置。
- 核心判稿文件 `worker/current-review.js` 未修改；LF 归一化 SHA-256 保持 `bb1762c0735637e4ca511d70bf0f8d011165234f2f8cf638db293a13227085e5`。
- 未改变完整稿生成、保真、示范检查或恢复判定的思考设置；未延长超时、未提高 token 上限、未放宽合格标准。
- `.github/workflows/deploy.yml` 中的 31 项本地回归全部通过；生产配置 dry-run 打包通过。
- 2026-10-18 已部署 Worker 版本 `537b153e-0106-47c9-96f3-dd6897deee3e`；生产 `https://lapiao.aivar.cc/health` 返回 HTTP 200、`deepseek-flash` / `high`、上述服务版本，前端 CORS 正常。
- 本轮后端配置已生效；源码与测试记录尚未提交 Git。测试预览进程已结束。

## 重跑

需要现有 Cloudflare 授权和该 Worker 已配置的模型密钥；测试使用模型额度。

```powershell
node tests/reasoning-effort-prepare.mjs
# 仅远程预览；绝不能 deploy 这个测试配置
.\node_modules\.bin\wrangler.cmd dev --remote --config tests/tmp_results/reasoning-effort/wrangler.json --ip 127.0.0.1 --port 8793 --log-level warn
```

另一个终端依次运行，测试时不要修改 Worker 或导入的样本文件：

```powershell
node tests/reasoning-effort-live.mjs --live --rounds=2 --concurrency=3 --label=abc
node tests/reasoning-effort-analysis.mjs --label=abc --save
node tests/reasoning-effort-live.mjs --live --rounds=3 --concurrency=2 --efforts=low,high --only=specific-content-no-action,preserve-capability-boundary --label=targeted
node tests/reasoning-effort-analysis.mjs --label=targeted --save
node tests/reasoning-effort-live.mjs --live --rounds=1 --concurrency=2 --mode=flow --only=specific-content-no-action,preserve-capability-boundary --label=flow
```

原始结果、请求计时、最终答案、汇总与基准哈希保存在忽略目录 `tests/tmp_results/reasoning-effort/`。其中不保存凭据、请求头或模型推理文本。重跑应换用新的 label，避免覆盖本轮证据。完整稿内容必须人工复核，`flowAccepted` 仅表示自动流程放行。
