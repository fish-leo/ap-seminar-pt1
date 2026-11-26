# AP Seminar PT1 团队工作台

一个小组共用的项目推进站点：认领 lens、登记来源、按步骤推进、自评 IRR、彩排 TMP、准备答辩。
运行在 Cloudflare Workers（静态资源 + 单个 Durable Object 存状态），**零第三方依赖**。

## 线上地址

部署后由 wrangler 输出，形如 `https://ap-seminar-pt1.<你的子域>.workers.dev`。

## 部署 / 更新

```sh
npx wrangler login        # 只需一次
npx wrangler deploy       # 每次改完再跑
```

本地预览（不联网、不需要账号）：

```sh
npx wrangler dev --port 8788
```

## 账号系统

- **只输名字**，第一次进入即注册；同名再进 = 登录本人。
- 归一化规则：全角转半角、忽略大小写、忽略所有空格，所以 `Yu` / `yu ` / `ＹＵ` 是同一个人，不会重复建号。
- 每次登录服务端签发 token，浏览器存在 `localStorage`，换设备用同一名字再进即可恢复。
- **已知限制**：没有密码，理论上可冒用他名。课堂场景可接受；要更强保证需由老师分配名单 + 口令。

## 防重复的三道机制

| 对象 | 规则 |
|---|---|
| 成员 | 名字归一化后唯一，同名只更新自己那一行 |
| lens | 一个 lens 只能被一人认领，被占时返回 409 并显示占用者 |
| 来源 | 标题 + 年份做归一化指纹（忽略标点、大小写、空格），重复登记返回 409 |

## 数据结构（Durable Object 内单个 `state` 键）

```
team{ topic, deadline, rq }
members[{ id, name, slug, token, lens, count, rq, stage, progress{}, rubric{}, updated }]
sources[{ id, auth, year, lens, title, type, grade, use, cred, by, updated }]
fx[{ id, src, target, what, how, by }]
```

## 文件

```
worker.mjs        Worker 入口 + Durable Object（/api/login /api/state /api/member /api/source /api/fx /api/save /api/team）
wrangler.toml     Worker 配置：assets 目录、DO 绑定与迁移
site/
  index.html      全部内容，一个 section 一个步骤
  styles.css      主题与布局
  theme-v2.css    登录弹窗、禁用态等增量样式
  app.js          登录、表单、聚合看板、字数/自评计算、导出
```

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

## 说明

- 评分细则引文来自 2017-18 版官方 IRR Scoring Guidelines，分值以课程当年度版本为准。
- 打印样式已适配：浏览器「打印 → 存为 PDF」会去掉侧栏。
