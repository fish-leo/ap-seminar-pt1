# AP Seminar PT1 团队工作台

小组成员共用的项目推进站点：逐步指引 + 分步上传 + AI 核查 + 全组统计。
**线上：https://quiet-beijinho-315692.netlify.app**

## 结构

- 前端：`docs/`（纯 HTML/CSS/JS，无构建产物）
- 后端：`netlify/functions/api.mjs`（Functions v2，路由 `/api/*`）
- 存储：Netlify Blobs（`ap-seminar`，键 `state` 与 `files/<id>`）

## 更新

```sh
git add -A && git commit -m "update" && git push origin main
```
Netlify 自动重建（Build command `npm run build`，Publish `docs`，Functions `netlify/functions`）。

## 开启 AI 核查（关键一步）

Netlify → Project configuration → **Environment variables** → 添加：

| 变量 | 必填 | 说明 |
|---|---|---|
| `AI_API_KEY` | 是 | 任意 OpenAI 兼容服务的 key |
| `AI_MODEL` | 否 | 默认 `gpt-4o-mini`；DeepSeek 用 `deepseek-chat` |
| `AI_BASE_URL` | 否 | 默认 `https://api.openai.com/v1`；DeepSeek 用 `https://api.deepseek.com/v1` |

加完 → Deploys → Trigger deploy。未配置时按钮不会请求任何接口、不消耗 token，只显示配置提示。

**省 token 的设计**：只发当前这一步的文字（超过 3000 字自动截断），`max_tokens=520`，输出固定四段（事实核查 / 逻辑漏洞 / 两个追问 / 一句改写示范），单次约 1–2 分钱级别。

## 账号系统

- 只输名字，第一次进入即注册；同名再进 = 登录本人。
- 归一化：全角转半角、忽略大小写与所有空格（`Yu` = `yu ` = `ＹＵ`）。
- token 存浏览器 `localStorage`（`apsem_token_v3`），换设备用同一名字再进即可。
- 已知限制：无密码，理论上可冒用他名。

## 防重复

| 对象 | 规则 |
|---|---|
| 成员 | 名字归一化后唯一 |
| lens | 一人一个，被占返回 409 + 占用者名字 |
| 来源 | 标题+年份归一化指纹去重，重复 409 |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 全量状态 + 本人（`x-token`） |
| GET | `/api/ai-status` | AI 是否已配置、当前模型 |
| POST | `/api/login` | `{name}` → `{token, created}` |
| POST | `/api/team` | 话题 / D-day / RQ |
| POST | `/api/member` | 认领或更新本人（lens 冲突 409） |
| DELETE | `/api/member?id=` | 只能删自己 |
| POST | `/api/source` | 登记来源（重复 409） |
| DELETE | `/api/source?id=` | 只能删自己登记的 |
| POST | `/api/fx` | 反证记录 |
| POST | `/api/save` | 个人进度 / 自评分 |
| POST | `/api/upload` | multipart：`file` `step` `title` `note`，≤3.5MB |
| GET | `/api/file?id=` | 下载附件（随机 id，可直接 `<a href>`） |
| DELETE | `/api/upload?id=` | 只能删自己的 |
| POST | `/api/check` | `{step, text, deliverableId?}` → AI 核查 |

## 页面

概览（仪表盘 + 时间线）· 1 分工 · 2 侦察 · 3 RQ · 4 反证 · 5 来源 · 6 IRR · 7 TMP · 8 答辩 · 工具与链接。
每个步骤页底部都有同一个「交付与核查」面板：选文件 → 上传；贴关键段落 → AI 核查；下面列出该步骤全部上传（可下载、可查看历史核查）。

## 备注

- GitHub Pages 纯静态镜像（无后端）：https://fish-leo.github.io/ap-seminar-pt1/
- `worker.mjs` + `wrangler.toml` 为 Cloudflare Workers 同构版本，留作迁移备用。
- 评分细则引文来自 2017-18 版官方 IRR Scoring Guidelines，分值以课程当年度版本为准。
