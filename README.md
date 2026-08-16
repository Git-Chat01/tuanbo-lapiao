# 团播拉票话术教练

针对娱乐团播新人主播的"拉票"环节训练工具：主播自己写话术 → AI 教练按"场的认知"批改（指问题、讲为什么、给方向）→ 主播自己改 → 线下真实环境模拟练习。

> 核心原则：**授渔不授鱼**。话术必须是主播自己的东西，AI 是教练，不是代写。

## 目录结构

```
site/     # 前端站点（GitHub Pages 只发布这个目录）
worker/   # Cloudflare Worker（DeepSeek 代理 + 入口码鉴权）
tests/    # 自测案例与冒烟脚本
```

## 密钥清单（只写名字，值永远不在这里）

| Secret | 存放位置 | 说明 |
|--------|---------|------|
| `DEEPSEEK_API_KEY` | Cloudflare Worker secret / 本地 `.dev.vars` | DeepSeek API key（本项目的专用 key） |
| `ACCESS_CODE` | 同上 | 学员入口码 |

## 🚨 Key 泄露应急手册

如果怀疑 key 泄露到公开仓库（或任何地方）：

1. **立即**到 DeepSeek 后台吊销该 key 并重新创建
2. 更新 Cloudflare Worker 的 `DEEPSEEK_API_KEY` secret（`wrangler secret put`）
3. 更新本地 `.dev.vars`
4. **改任何代码都无效**——key 一旦公开，必须吊销重发
5. 检查：`git log -p | grep "sk-"` 确认历史中无 key 字符串

## 部署

- 前端：push 到 `master` → GitHub Actions 自动发布 `site/` 到 gh-pages 分支
- Worker：`wrangler secret put DEEPSEEK_API_KEY` / `ACCESS_CODE` 后 `wrangler deploy worker/index.js`

## Prompt 迁移路径

当前 prompt 在 `worker/prompt.js`（随公开仓库可见，换取迭代速度）。当 prompt 打磨成壁垒后：将内容迁至 Worker 环境变量 `SYSTEM_PROMPT`，并删除仓库中的 `worker/prompt.js`（Worker 侧约 5 行改动）。
