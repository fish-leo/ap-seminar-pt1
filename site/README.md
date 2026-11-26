# AP Seminar PT1 作战室（Team Project · IRR · TMP）

给一个 3–5 人小组共用的项目推进网页：认领 lens、登记来源、按步骤推进、自评 IRR、彩排 TMP、准备答辩。

纯静态（HTML/CSS/JS，零依赖），附一个可选的 Node 服务器用于局域网内自动汇总提交。

## 方式 A：局域网共享（推荐，自动统计）

```sh
cd site
PORT=8787 node server.mjs
```

终端会打印：

- 你自己：`http://localhost:8787`
- 发给组员：`http://<你的内网 IP>:8787`

组员用同一 WiFi 打开上面那个地址，提交的 name / lens / RQ / 来源会写进 `site/data/state.json`，你刷新页面就能在看板上看到汇总。

- 只给同一 WiFi 用，**不要**做公网端口转发。
- 停止：终端里 `Ctrl+C`。
- 备份：直接拷 `site/data/state.json`，或用页面上的「导出全组 JSON」。

## 方式 B：不需要服务器

直接双击 `index.html` 打开即可（数据存在浏览器 localStorage）。
每人填完后点「导出我的数据」→ 把 json 发给负责人 → 负责人点「导入 / 合并」。

## 页面结构

| 导航 | 内容 |
|---|---|
| 0 项目总览 | 团队话题、D-day、PT1 三组件（IRR / TMP / 答辩）、自动排期时间线 |
| 1 分工 & Lens 认领 | 认领表单 + 全组看板（重复 lens 会报警） |
| 2 Step 1 侦察检索 | 三道门槛 G1/G2/G3、共用检索块、5 张 lens 检索卡（可一键复制）、交付物清单 |
| 3 Step 2 RQ 收窄 | 8 项 RQ 体检器（自动判未锁定 / 半开 / 可锁定）+ 三处必改点 |
| 4 Step 3 反证扫描 | 三类反证、反证记录表（记录「改 RQ 还是加限定」） |
| 5 Step 4 来源池 | 来源登记（类型 / 证据等级 / 用途 / 可信度三句）、按 lens 统计、导出 CSV |
| 6 Step 5 IRR | 字数分配器、老师 outline 的六段结构、三稿纪律、30 分评分细则自评 |
| 7 Step 6 TMP | 八页骨架 + 分钟配比、录像检查 8 条、三轮彩排 |
| 8 Step 7 口头答辩 | 10 道最可能被问的题 + 答题骨架、答题三句式 |
| 9 提交 · 统计 · 导出 | 数据导出/合并、组内推进清单、整站进度条 |

## 数据

`site/data/state.json` 结构：

```
team{topic,deadline,rq}
members[{id,name,lens,count,rq,stage,updated}]
sources[{id,auth,year,lens,title,type,grade,use,cred,by,updated}]
falsify[{id,src,target,what,how,by}]
progress{checkKey:true}
rubric{r1..r6}
```

## 已知边界

- 没有账号系统：认领靠「名字」，同名视为同一人（可更新）。
- 没做并发锁：几个人**同时**点提交时，以最后一次写入为准；课上逐个提交不会出问题。
- 评分细则用的是 2017-18 版 IRR 官方 Scoring Guidelines 措辞，分值请以老师发的当年版本为准。
