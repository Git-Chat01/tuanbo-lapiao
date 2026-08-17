# 团播拉票话术教练

针对娱乐团播新人主播的"拉票"环节训练工具：主播自己写话术 → AI 教练按"场的认知"批改（指问题、讲为什么、给方向）→ 主播自己改 → 直到话术稿过关 → 线下真实环境模拟练习。

> 核心原则：**授渔不授鱼**。话术必须是主播自己的东西，AI 是教练，不是代写。

## 产品形态（v2）

```
主播(手机)：点票况(3 chip) → 写话术 → 交 → 报告 → 改 → 再交 → …… → 过关页
报告结构：verdict 大字卡 → 诊断卡(卡点+对谁喊话) → [红线横幅] → echo → one_thing → 逐句点评(折叠) → direction(折叠)
系统层：批改时检索案例注入 prompt → verdict=passed 且过两道关 → 自动吸收进 KV
教练(电脑)：coach.html（隐藏路径）→ 喂话术 / 吸收清单+软删 / 改判
```

- **主播端铁律**：手机 100%、零思考、只干三件事——点、写、交。报告 10 秒看得懂。
- **卡点诊断**：logic（逻辑）/ expression（表达）/ mentality（心态）/ persona（人设）四类，每轮 1 个主卡点，不同卡点不同教法。
- **verdict 判定**：passed（方向对，发过关页）/ almost（还差一口气）/ off（方向不对）。判定规则：0 个 wrong + 全稿有支点 → passed，没有例外。
- **自成长案例库**（Cloudflare KV）：过关稿自动吸收（0 ❌ + 有支点 + 无人设卡 + 无红线）+ 教练手动投喂（权威最高）→ 批改新稿时检索注入参照。坏稿永不进库。

## 目录结构

```
site/     # 前端站点（GitHub Pages 只发布这个目录；coach.html 是教练后台，隐藏路径）
worker/   # Cloudflare Worker（DeepSeek 代理 + 鉴权 + KV 检索/吸收）
tests/    # 冒烟脚本 smoke.sh（12 用例）+ 批改质量清单 cases.md
```

## 密钥清单（只写名字，值永远不在这里）

| Secret | 存放位置 | 说明 |
|--------|---------|------|
| `DEEPSEEK_API_KEY` | Cloudflare Worker secret / 本地 `.dev.vars` | DeepSeek API key（本项目的专用 key） |
| `ACCESS_CODE` | 同上 | 学员入口码（POST /api/coach body 里带） |
| `ADMIN_CODE` | 同上 | 教练后台密码（header `X-Admin-Code`，fail-closed） |

## 路由表

| 方法 | 路径 | 鉴权 | 功能 |
|---|---|---|---|
| GET | /health | 无 | 健康检查 |
| POST | /api/coach | ACCESS_CODE（body） | 批改 v2 流程（红线检测→KV 检索→DeepSeek→硬校验→吸收闸门） |
| POST | /api/admin/cases | X-Admin-Code | 教练投喂案例 |
| GET | /api/admin/cases | 同上 | 案例清单（source 筛选 + 游标分页 + includeDeleted） |
| DELETE | /api/admin/cases/{id} | 同上 | 软删除（覆写 deleted:true，可溯源可反悔） |

三重闸门（不信任模型，Worker 硬规则兜底）：红线命中 → 强制 verdict=off + 永不进库；吸收闸门 → passed 且无红线且非 persona 才进库。

## 🚨 Key 泄露应急手册

如果怀疑 key 泄露到公开仓库（或任何地方）：

1. **立即**到 DeepSeek 后台吊销该 key 并重新创建
2. 更新 Cloudflare Worker 的 `DEEPSEEK_API_KEY` secret（`wrangler secret put`）
3. 更新本地 `.dev.vars`
4. **改任何代码都无效**——key 一旦公开，必须吊销重发
5. 检查：`git log -p | grep "sk-"` 确认历史中无 key 字符串

## 部署

- 前端：push 到 `master` → GitHub Actions 自动发布 `site/` 到 gh-pages 分支
- Worker：`wrangler secret put DEEPSEEK_API_KEY` / `ACCESS_CODE` / `ADMIN_CODE` 后 `wrangler deploy worker/index.js`

## 测试

- **smoke.sh**：接口契约冒烟（12 用例 20 断言）。`BASE=http://127.0.0.1:8787 CODE=... ADMIN=... bash tests/smoke.sh`
- **cases.md**：批改质量清单（5 案例 + 防代写通查）。⚠️ 跑批必须用 `curl --data-binary @req.json` 文件方式——Git Bash 命令行传中文参数会被编码损坏（详见 cases.md 顶部说明）。

## Prompt 迁移路径

当前 prompt 在 `worker/prompt.js`（随公开仓库可见，换取迭代速度）。当 prompt 打磨成壁垒后：将内容迁至 Worker 环境变量 `SYSTEM_PROMPT`，并删除仓库中的 `worker/prompt.js`（Worker 侧约 5 行改动）。
