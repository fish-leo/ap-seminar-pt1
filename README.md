# AP Seminar PT1 团队工作台

一个小组共用的项目推进站点：全部步骤指引、lens 认领、来源池、IRR 自评、TMP 彩排、口头答辩准备。
**线上地址：https://quiet-beijinho-315692.netlify.app**

## 技术结构

- 静态站点：`docs/`（纯 HTML/CSS/JS，无构建产物）
- 后端：`netlify/functions/api.mjs`（Netlify Functions v2，路径 `/api/*`）
- 存储：Netlify Blobs（`ap-seminar` store，单键 `state`，强一致读）

## 更新线上内容

```sh
git add -A && git commit -m "update" && git push origin main
```

Netlify 会自动重新构建（Build command = `npm run build`，Publish = `docs`，Functions = `netlify/functions`）。

## 本地预览

```sh
npm install
node .ekko-tmp/test-api.mjs   # 或直接看 docs/index.html：会退回本地离线模式
```

## 账号系统

- **只输名字**，第一次进入即注册；同名再进 = 登录本人。
- 归一化：全角转半角、忽略大小写、忽略所有空格，所以 `Yu` / `yu ` / `ＹＵ` 是同一个人。
- 服务端签发 token，浏览器存 `localStorage`（键 `apsem_token_v2`），换设备用同一名字再进即可恢复。
- **已知限制**：没有密码，理论上可冒用他名；课堂场景可接受。

## 防重复机制

| 对象 | 规则 |
|---|---|
| 成员 | 名字归一化后唯一，同名只更新自己那一行 |
| lens | 一个 lens 只能一人认领，被占时 409 并返回占用者名字 |
| 来源 | 标题 + 年份归一化指纹（忽略标点、大小写、空格），重复 409 |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 全量状态 + 当前用户（按 `x-token`） |
| POST | `/api/login` | `{name}` → `{token, created, user, state}` |
| POST | `/api/team` | 团队话题 / D-day / RQ 草稿 |
| POST | `/api/member` | 认领或更新本人记录（lens 冲突 409） |
| DELETE | `/api/member?id=` | 只能删自己 |
| POST | `/api/source` | 登记来源（重复 409） |
| DELETE | `/api/source?id=` | 只能删自己登记的 |
| POST | `/api/fx` | 反证记录 |
| POST | `/api/save` | 个人进度 / 自评分数 |

## 页面结构

| 导航 | 内容 |
|---|---|
| 0 项目总览 | 团队话题、D-day、PT1 三组件、自动排期时间线、纪律红线 |
| ✦ 工具与链接 | 讲义三条链接各自干什么、什么时候用、推荐顺序 |
| 1 分工 & Lens 认领 | 认领表单 + 看板（重复 lens 会被拦） |
| 2 侦察检索 | G1/G2/G3 门槛、共用检索块、5 张 lens 检索卡（可复制） |
| 3 RQ 收窄 | 8 项体检器、好 RQ 的四个机械特征、本组 v1 三处硬伤 |
| 4 反证扫描 | 三类反证 + 记录表 |
| 5 来源池 | 登记（类型/等级/用途/可信度三句）、按 lens 统计、CSV 导出 |
| 6 IRR | 字数分配器、六段结构、三稿纪律、30 分细则自评 |
| 7 TMP | 八页骨架带分钟数、录像检查、三轮彩排 |
| 8 口头答辩 | 10 题答题骨架、三句式 |
| 9 协作 | 账号规则、导出、组内清单、个人进度 |

## 备注

- GitHub Pages 上的纯静态镜像：https://fish-leo.github.io/ap-seminar-pt1/ （无后端，只作备份演示用）
- `worker.mjs` + `wrangler.toml` 是同一套逻辑的 Cloudflare Workers 版本，留作迁移备用。
- 评分细则引文来自 2017-18 版官方 IRR Scoring Guidelines，分值以课程当年度版本为准。
