# 团播拉票话术教练

面向娱乐团播新人主播的训练工具。它不替主播写一篇能照念的稿子，而是把新人带过一条完整链路：

`看现场 → 自己写 → 文字教练只改一个关键点 → 文字过关 → 真实开口录音 → 现场老师考核`

核心原则是“授渔不授鱼”：主播要学会读场、判断观众当轮信号、接住主持递球，并用自己的语言给观众一个愿意参与的理由。

## 当前产品形态（v3）

主播端默认给一轮可控现场，而不是空白表单：倒计时、票差、最近礼物、目标用户、用户当轮信号和主持递球会一起出现。自由话术仍保留为次入口；没有现场信息时，AI 会明确不猜用户偏好或主持行为。

新人文字稿的五项毕业结构是：

1. 有内容的自我介绍，不只是报名字
2. 接住并感谢刚才支持过的具体用户或行为
3. Q 到一个具体榜单用户或可识别对象
4. 从用户角度给出参与、上票的理由
5. 说清票数缺口并给出可执行指令

复盘页采用轻量“话术闯关”：五项结构变成个人能力地图，每次明确显示第几次挑战、已经拿下几项、当前唯一关卡、原话里的真实卡点、过关标准和一个可执行的解题方法。主播始终在自己的原话上修改，未改动时不能原样重复提交；同一关试到第二次仍未通过，系统会自动展开与当前关一致的两个小动作，避免一直盲改。五项结构齐全但仍有红线、AI 腔或整体方向问题时显示为“加练关”，不会伪装成完整通关。

闯关进度只在当前训练会话里累计：网络失败不增加挑战次数，重复打开同一份报告不重复庆祝，换一轮训练后清零。最终通过页会告诉主播本轮最后掌握了什么，并留下“五件事”自检口诀，再进入开口练。

文字过关后进入“开口练”：

- 首次点击才请求麦克风
- 3 秒倒计时，最长 60 秒
- 真实录制、本地回放、重录和二次确认删除
- 切后台或麦克风中断时安全停止并尽量保留
- 当前只基于真实波形判断录音证据是否足够、静音是否过多、是否接近数字过载
- 证据不足时明确“不评价”，不伪造语速、语调、情绪或表现力分数

语速起伏、重音、情绪变化、动作表情和主持配合最终仍由现场老师结合真实表现考核。

## 自成长机制

系统有两条经验入口：

- 仓库外的 `coaching-notes.md`：教练一手经验入口，与公开仓库物理隔离
- Cloudflare KV 案例库：具体优秀话术及其“为什么好”

自动学习采用受控生命周期，防止“AI 教 AI”污染：

`主播过关稿 → candidate 候选（不参与检索） → 老师发布 → published（可参与检索）`

老师可以在隐藏后台发布或拒绝候选。手动投喂的案例直接是 `published`，权威度最高；被拒绝或删除的案例写为 `rejected`，同稿不会被后续自动吸收重新复活。旧 auto 无状态数据按 candidate 兼容，旧 manual 无状态数据按 published 兼容。

自动候选会连同目标用户、用户信号、主持递球和票差等现场上下文一起保存，供老师审核。这类经验只会在同一 `scenario.id` 的现场中被检索；没有场景的自由话术不会借用它。若提供了具体场景却没有稳定 `id`，系统不会自动吸收或跨场检索；修改一个场景的核心事实时也必须升级 `id`。老师手动投喂的通用经验仍可跨场景参考。

## 技术架构

```text
site/                     GitHub Pages 静态前端，无构建工具
  index.html              主播排练台
  coach.html              教练后台（隐藏路径）
  js/form.js              场景带练、自由话术、草稿
  js/report.js            五项结构复盘与改稿循环
  js/voice.js             本地录音、回放和客观质量门槛
worker/
  index.js                Worker 路由、鉴权、契约和硬闸门
  prompt.js               场景认知、五项结构和批改规则
  cases.js                KV 候选/发布/拒绝生命周期与检索
  redlines.js             红线词表纯规则检测
tests/
  worker-safety.mjs       无网络安全闸门与案例生命周期测试
  mock-api.mjs            前端本地完整流程假接口
  static-server.js        零依赖静态文件服务器
  smoke.sh                真实 Worker 冒烟
```

后端是 Cloudflare Worker，模型为 DeepSeek `deepseek-chat`，使用 JSON mode、`temperature: 0`、45 秒超时。前端保持原生 HTML/CSS/JS，方便在微信和手机浏览器中直接打开。

## API 契约

`POST /api/coach` 的基础请求保持兼容：

```json
{
  "accessCode": "...",
  "voteGap": "far|close|secured",
  "script": "20~500 字",
  "scenario": {
    "id": "可选",
    "secondsLeft": 38,
    "votesNeeded": 320,
    "hostCue": "可选",
    "targetUser": "可选",
    "userSignal": "可选",
    "recentGift": "可选",
    "trainingGoal": "可选"
  }
}
```

`scenario` 整体可省略。Worker 只接受白名单字段并限制类型、数值和长度，未知字段丢弃；清洗后的现场事实才会进入 prompt。

报告新增固定五项 `structure_checks`：

```json
{
  "key": "self_intro|gratitude|target_user|user_reason|vote_instruction",
  "status": "met|partial|missing",
  "evidence": "短证据"
}
```

`passed` 是后端硬门槛：五项全部 `met` 且每项有非空证据、`line_reviews.original` 按顺序合起来覆盖完整原稿、逐句没有 `wrong`、没有 persona/AI 味、没有任何红线。模型判错或证据契约不完整都会被 Worker 降级；红线始终一票否决。

### 路由表

| 方法 | 路径 | 鉴权 | 功能 |
|---|---|---|---|
| GET | `/health` | 无 | 健康检查 |
| POST | `/api/coach` | body `ACCESS_CODE` | 场景化话术批改 |
| POST | `/api/admin/cases` | `X-Admin-Code` | 老师手动投喂已发布案例 |
| GET | `/api/admin/cases` | `X-Admin-Code` | 按来源查看候选/发布案例 |
| POST | `/api/admin/cases/{id}/publish` | `X-Admin-Code` | 将自动候选发布为经验 |
| DELETE | `/api/admin/cases/{id}` | `X-Admin-Code` | 软删除并写为 rejected |

## 安全与隐私

- `DEEPSEEK_API_KEY`、`ACCESS_CODE`、`ADMIN_CODE` 只放 Worker secrets 或本地 `.dev.vars`，绝不进仓库
- 鉴权 fail-closed：secret 未配置或过短时不放行
- 模型输出全部按不可信文本渲染，前端使用 `textContent`
- 线上页面不接受 `?api=` 覆盖；只有 loopback 页面能连 loopback API，教练后台另有 CSP 限制
- 教练管理码只保留在当前 tab 会话，关闭后失效，不与同域其他页面长期共享
- 日志不记录入口码或话术全文
- 自动录音不上传，只存在当前页面的 Blob URL；刷新或离开后释放
- prompt 中的案例只用于校准标准，禁止复制成示范句

## 本地运行与测试

```powershell
node tests/static-server.js
node tests/mock-api.mjs
```

浏览器打开：

`http://127.0.0.1:8080/?api=http://127.0.0.1:8787`

假接口入口码为 `demo-access`，仅用于本地界面测试。

本地自动测试：

```powershell
node tests/worker-safety.mjs
node tests/frontend-safety.mjs
wrangler deploy worker/index.js --dry-run
```

## 当前边界

- 录音质量检查只评估时长、静音和接近数字过载的真实波形证据；语速起伏、重音、情绪和表现力尚未自动判分，仍由现场老师考核。
- 案例生命周期当前基于 Cloudflare KV，适合单教练后台。不要在多个 tab 或多台设备上同时审核同一候选；如果后续要多老师并发审核，需把状态机迁到 Durable Object 或支持事务的数据库。

真实 Worker 冒烟需要本地 secrets：

```bash
BASE=http://127.0.0.1:8787 CODE=... ADMIN=... bash tests/smoke.sh
```

## 部署

- 前端：push 到 `master` 后由 GitHub Actions 发布 `site/` 到 GitHub Pages
- Worker：配置三个 secrets 和 `CASES` KV binding 后运行 `wrangler deploy worker/index.js`
- 线上入口：`https://git-chat01.github.io/tuanbo-lapiao/`
- 教练后台：`https://git-chat01.github.io/tuanbo-lapiao/coach.html`
- API：`https://lapiao.aivar.cc`
