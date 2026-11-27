/* AP Seminar PT1 工作台 — 前端 */
(() => {
"use strict";
const TOK = "apsem_token_v3";
const TARGET = 8; // 每人配额
let state = { team:{topic:"",deadline:"",rq:""}, members:[], sources:[], fx:[], deliverables:[], me:null };
let token = localStorage.getItem(TOK) || "";
let cloud = true, aiReady = false, aiModel = "";
let editingPaper = null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const uid = p => p + "_" + Math.random().toString(36).slice(2, 9);
const fmt = t => t ? new Date(t).toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";

let tt;
function toast(m){ const el = $("#toast"); el.textContent = m; el.classList.add("on"); clearTimeout(tt); tt = setTimeout(()=>el.classList.remove("on"), 2400); }

async function req(path, { method = "GET", body, form } = {}) {
  const opt = { method, headers: {} };
  if (token) opt.headers["x-token"] = token;
  if (body) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  if (form) opt.body = form;
  const r = await fetch(path, opt);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json().catch(() => ({})) : {};
  if (!r.ok) { const e = new Error(data.error || ("HTTP " + r.status)); e.status = r.status; e.data = data; throw e; }
  return data;
}
function localSave(){ try { localStorage.setItem("apsem_local_v3", JSON.stringify(state)); } catch(e){} }

/* ---------- boot ---------- */
async function boot(){
  try {
    const res = await req("/api/state");
    cloud = true; state = Object.assign(state, res.state); state.me = res.me || null;
    if (!state.me && token) { token = ""; localStorage.removeItem(TOK); }
    $("#modeStatus").textContent = "云端已连接"; $("#modeDot").classList.add("on");
    try { const s = await req("/api/ai-status"); aiReady = !!s.configured; aiModel = s.model || ""; } catch(e){}
  } catch (e) {
    cloud = false;
    try { const raw = localStorage.getItem("apsem_local_v3"); if (raw) state = Object.assign(state, JSON.parse(raw)); } catch(_){}
    $("#modeStatus").textContent = "离线模式";
  }
  buildStatic(); renderAll(); wire();
  show((location.hash || "#dash").slice(1));
  if (cloud && !state.me) openLogin();
}

/* ---------- auth ---------- */
function openLogin(){ $("#loginModal").classList.remove("hidden"); $("#loginErr").textContent = ""; setTimeout(()=>$("#loginName").focus(), 60); }
async function doLogin(){
  const name = $("#loginName").value.trim();
  if (!name) return;
  if (cloud) {
    try {
      const r = await req("/api/login", { method:"POST", body:{ name } });
      token = r.token; localStorage.setItem(TOK, token);
      state = Object.assign(state, r.state); state.me = r.user;
      $("#loginModal").classList.add("hidden"); renderAll();
      toast(r.created ? "已注册：" + r.user.name : "欢迎回来：" + r.user.name);
    } catch(e){ $("#loginErr").textContent = e.message; }
  } else {
    let m = state.members.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!m) { m = { id:uid("m"), name, lens:"", count:"4", rq:"", stage:"0 · 还没开始", progress:{}, rubric:{} }; state.members.push(m); }
    state.me = m; localSave(); $("#loginModal").classList.add("hidden"); renderAll(); toast("离线模式：" + name);
  }
}
function logout(){ token = ""; localStorage.removeItem(TOK); state.me = null; renderAll(); cloud ? openLogin() : toast("已退出"); }
const isMe = () => !!state.me;
function mustLogin(){ toast("先输入名字进入"); openLogin(); return false; }

/* ---------- writes ---------- */
async function saveTeam(p){
  if (!isMe()) return mustLogin();
  const r = await req("/api/team", { method:"POST", body:p });
  state = Object.assign(state, r.state); state.me = r.me; localSave(); renderAll();
}
async function claim(p){
  if (!isMe()) return mustLogin();
  try { const r = await req("/api/member", { method:"POST", body:p }); state = Object.assign(state, r.state); state.me = r.me; localSave(); renderAll(); return true; }
  catch(e){ toast(e.status === 409 && e.data.holder ? "该 lens 已被 " + e.data.holder + " 认领" : (e.message || "失败")); return false; }
}
async function addFx(p){
  if (!isMe()) return mustLogin();
  const r = await req("/api/fx", { method:"POST", body:p }); state = Object.assign(state, r.state); state.me = r.me; renderAll();
}
async function delMember(id){ const r = await req("/api/member?id=" + encodeURIComponent(id), { method:"DELETE" }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); }
async function saveMine(){
  if (!isMe()) return;
  if (cloud) { try { const r = await req("/api/save", { method:"POST", body:{ progress: state.me.progress || {}, rubric: state.me.rubric || {} } }); state.me = r.me; } catch(e){} }
  localSave();
}
async function upload(step){
  if (!isMe()) return mustLogin();
  const inp = $("#file-" + step);
  const f = inp.files && inp.files[0];
  if (!f) return toast("先选文件");
  const fd = new FormData();
  fd.append("file", f); fd.append("step", step);
  fd.append("title", $("#title-" + step).value.trim());
  fd.append("note", $("#note-" + step).value.trim());
  const btn = $("#up-" + step); const old = btn.textContent; btn.disabled = true; btn.textContent = "上传中…";
  try {
    const r = await req("/api/upload", { method:"POST", form: fd });
    state = Object.assign(state, r.state); state.me = r.me;
    inp.value = ""; $("#title-" + step).value = ""; $("#note-" + step).value = "";
    renderAll(); toast("已上传");
  } catch(e){ toast(e.message || "上传失败"); }
  btn.disabled = false; btn.textContent = old;
}
async function aiCheck(step){
  if (!isMe()) return mustLogin();
  const text = $("#text-" + step).value.trim();
  if (text.length < 40) return toast("至少 40 字才值得花 token");
  const out = $("#ai-" + step);
  const btn = $("#check-" + step); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>核查中';
  out.className = "ai-out"; out.textContent = "…";
  try {
    const mine = state.deliverables.filter(d => d.step === step && state.me && d.byId === state.me.id).sort((a,b)=>b.updated-a.updated)[0];
    const r = await req("/api/check", { method:"POST", body:{ step, text, deliverableId: mine ? mine.id : null } });
    out.textContent = r.analysis;
    if (r.deliverables) { state.deliverables = r.deliverables; renderFiles(step); }
    toast("核查完成 · " + (r.model || ""));
  } catch(e){
    out.className = "ai-out warn";
    out.textContent = e.status === 501 ? (e.message || "AI 未配置") : ("核查失败：" + (e.message || ""));
  }
  btn.disabled = false; btn.textContent = "AI 核查";
}
async function delFile(step, id){
  if (!confirm("删除这条上传？")) return;
  try { const r = await req("/api/upload?id=" + encodeURIComponent(id), { method:"DELETE" }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); }
  catch(e){ toast(e.message || "删除失败"); }
}

/* ---------- 文章池 ---------- */
function paperFields(){
  return {
    title: $("#pTitle").value.trim(), auth: $("#pAuth").value.trim(), year: $("#pYear").value.trim(),
    lens: $("#pLens").value, quota: $("#pQuota").value,
    country: $("#pCountry").value.trim(), sample: $("#pSample").value.trim(),
    design: $("#pDesign").value.trim(), finding: $("#pFinding").value.trim(),
    cred: $("#pCred").value.trim(), url: $("#pUrl").value.trim()
  };
}
function clearPaperForm(){
  ["pTitle","pAuth","pYear","pCountry","pSample","pDesign","pFinding","pCred","pUrl"].forEach(k=>$("#"+k).value="");
  $("#file-paper").value = "";
  $("#drop-paper").innerHTML = "<b>点击或拖入 PDF / DOCX / TXT</b><br>≤3.5MB；也可以只贴链接";
  editingPaper = null;
  $("#paperFormTitle").textContent = "上传一篇";
  $("#savePaper").textContent = "上传";
  $("#cancelEditPaper").classList.add("hidden");
}
async function savePaper(){
  if (!isMe()) return mustLogin();
  const f = paperFields();
  if (!f.title) return toast("标题必填");
  const btn = $("#savePaper"); btn.disabled = true;
  try {
    if (editingPaper) {
      const r = await req("/api/paper?id=" + encodeURIComponent(editingPaper), { method:"PATCH", body: f });
      state = Object.assign(state, r.state); state.me = r.me;
      clearPaperForm(); renderAll(); toast("已保存修改");
    } else {
      const file = $("#file-paper").files && $("#file-paper").files[0];
      let r;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        Object.entries(f).forEach(([k,v]) => fd.append(k, v));
        r = await req("/api/paper", { method:"POST", form: fd });
      } else {
        r = await req("/api/paper", { method:"POST", body: f });
      }
      state = Object.assign(state, r.state); state.me = r.me;
      clearPaperForm(); renderAll(); toast("已加入文章池");
    }
  } catch(e){
    if (e.status === 409) toast("这篇已在池子里（" + (e.data.dupe || "他人") + " 上传）");
    else toast(e.message || "保存失败");
  }
  btn.disabled = false;
}
function editPaper(id){
  const s = state.sources.find(x => x.id === id);
  if (!s) return;
  editingPaper = id;
  $("#pTitle").value = s.title || ""; $("#pAuth").value = s.auth || ""; $("#pYear").value = s.year || "";
  $("#pLens").value = s.lens || "Education"; $("#pQuota").value = s.quota || "其他";
  $("#pCountry").value = s.country || ""; $("#pSample").value = s.sample || "";
  $("#pDesign").value = s.design || ""; $("#pFinding").value = s.finding || "";
  $("#pCred").value = s.cred || ""; $("#pUrl").value = s.url || "";
  $("#paperFormTitle").textContent = "修改这篇（只有你能改）";
  $("#savePaper").textContent = "保存修改";
  $("#cancelEditPaper").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function delPaper(id){
  if (!confirm("从文章池删除这篇？")) return;
  try { const r = await req("/api/paper?id=" + encodeURIComponent(id), { method:"DELETE" }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); toast("已删除"); }
  catch(e){ toast(e.message || "删除失败"); }
}
const isOwner = s => state.me && (s.byId ? s.byId === state.me.id : s.by === state.me.name);

/* ---------- 静态内容（源自老师「四人检索卡」） ---------- */
const LENS_CARDS = [
  {
    key: "Education 教育", actor: "学校、老师、课程",
    core: "school, curriculum, teacher, school-based program",
    ban: "algorithm, coping, content analysis",
    rq: "To what extent does school-based media literacy education reduce body dissatisfaction among adolescents in Chinese secondary schools?",
    quota: [["3","校本干预 / 媒介素养课，含 ≥1 篇元分析或系统综述","核心证据（有多大用）"],
            ["2","中国情境：青少年身体不满意、学校健康教育现状","落地性"],
            ["2","学校现实约束：课时、师资、课程空间、家长期待","可行性（别人写不出来）"],
            ["1","反证：作用很小、甚至反效果","反驳段"]],
    note: "Liu et al. (2025)（605 人两波追踪）放引言当地基，不占配额。",
    blocks: [
      { id:"E1", n:"元分析（最高优先，1 篇顶 3 篇）",
        q:`("body image" OR "body dissatisfaction" OR "eating disorder")
AND ("meta-analysis" OR "systematic review")
AND (intervention OR prevention OR "school-based" OR "media literacy" OR curriculum)`,
        chk:"验收：必须报出整体 effect size。若结论是「平均作用小且各研究差异大」——完美，这就是争议源。" },
      { id:"E2", n:"具体的课堂干预研究",
        q:`("body image" OR "body dissatisfaction")
AND ("media literacy" OR "media education" OR "critical media literacy" OR "advertising literacy")
AND (school* OR classroom OR curriculum OR "secondary school" OR adolescen*)`,
        chk:"验收：有没有对照组、多少课时、前后测、效果数字。" },
      { id:"E3", n:"保险版（E1/E2 命中太少时用）",
        q:`"media literacy"
AND (intervention OR evaluation OR program OR trial OR effect*)
AND (adolescen* OR youth OR student*)`, chk:"命中少时用它扩池，之后回 E1/E2 定位。" },
      { id:"E4", n:"中国青少年身体不满意",
        q:`("body image" OR "body dissatisfaction" OR "appearance anxiety" OR "weight concern")
AND (China OR Chinese)
AND (adolescen* OR student* OR youth)`, chk:"要国别是中国、样本是青少年，别用成人样本凑数。" },
      { id:"E5", n:"中国学校健康教育现状",
        q:`(China OR Chinese)
AND (school* OR "secondary school" OR curriculum)
AND ("health education" OR "mental health education" OR "media literacy education" OR "information literacy education")`,
        chk:"政策文件也算证据，但要标类型为「官方政策 / 统计数据」。" },
      { id:"E6", n:"学校实施障碍",
        q:`("school-based" OR implementation OR "teacher training" OR "program delivery")
AND ("body image" OR "mental health" OR "health education" OR "media literacy")
AND (barrier* OR challenge* OR "time constraint*" OR feasibility OR workload)`,
        chk:"这段是你的独占区：别人写不出「做不动」的原因。" },
      { id:"E7", n:"课时与课程空间之争",
        q:`(curriculum OR "curriculum time" OR timetable OR "competing priorities" OR accountability)
AND ("health education" OR "mental health" OR "media literacy")
AND (school* OR teacher* OR principal* OR administrator*)`, chk:"找的是「学校为什么不排课」，不是「课有没有用」。" },
      { id:"E8", n:"反证：没用",
        q:`("media literacy" OR "media education" OR "school-based" OR curriculum)
AND ("body image" OR "eating disorder" OR appearance)
AND (ineffective OR "no effect" OR "small effect" OR critique OR limitation*)`,
        chk:"至少 1 篇进正文反证段，并说明论点为何仍成立。" },
      { id:"E9", n:"反证加强版：可能有害（强烈建议试）",
        q:`("body image" OR "eating disorder" OR appearance)
AND (intervention OR program OR curriculum OR education)
AND (iatrogenic OR "boomerang effect" OR "unintended effect*" OR worsen* OR harm)`,
        chk:"饮食失调预防项目确有「越讲越糟」的记录。找到就是杀手级证据。" }
    ]
  },
  {
    key: "Technology 技术", actor: "平台、产品、算法",
    core: "algorithm, recommendation, filter, platform design",
    ban: "intervention, curriculum, coping",
    rq: "平台设计、算法推荐、滤镜与修图工具如何改变青少年对身体的评价标准？",
    quota: [["3","算法推荐、滤镜修图对身体形象的影响","核心"],
            ["2","中国平台的技术特征（抖音 / 小红书）","本土"],
            ["2","平台设计责任、治理、伦理","责任与治理"],
            ["1","反证：技术决定论站不住或效果很弱","反驳段"]],
    note: "",
    blocks: [
      { id:"T1", n:"算法（主力）",
        q:`("recommendation algorithm" OR "algorithmic curation" OR algorithm OR feed)
AND ("body image" OR "body dissatisfaction" OR appearance)
AND ("social media" OR "short video" OR TikTok OR Instagram)`,
        chk:"要能说明「推荐机制」而不是「用得久」。" },
      { id:"T2", n:"滤镜与修图（最有辨识度）",
        q:`("beauty filter" OR "facial retouching" OR "photo editing" OR "selfie editing" OR "image enhancement" OR "augmented reality")
AND ("body image" OR "body dissatisfaction" OR appearance)
AND (adolescen* OR youth OR user*)`,
        chk:"验收：要测「用了滤镜之后身体不满意变了吗」。只讲「滤镜很流行」不算。" },
      { id:"T3", n:"中国平台技术特征",
        q:`(Douyin OR TikTok OR Xiaohongshu OR Weibo OR Kuaishou)
AND (algorithm OR "recommendation system" OR "content moderation" OR filter OR "user behavior")`,
        chk:"中文去 CNKI 补，但引用要以可核查的为准。" },
      { id:"T4", n:"平台责任与设计伦理（兼作反证）",
        q:`("platform design" OR "persuasive design" OR "attention economy" OR "algorithmic harm" OR "dark pattern*")
AND (ethic* OR regulation OR responsib* OR harm)
AND (adolescen* OR minor* OR youth)`, chk:"这段直接对接 TMP 的「谁该负责」。" }
    ]
  },
  {
    key: "Psychology 心理", actor: "个体内部心理过程",
    core: "social comparison, internalization, self-esteem, coping",
    ban: "algorithm, curriculum, content analysis",
    rq: "从「看到」到「内化」之间发生了什么；谁更容易受影响？",
    quota: [["3","机制：社会比较、外貌理想内化、自我物化","核心"],
            ["2","易感因素：自尊、完美主义、BMI、家庭","人群"],
            ["2","心理干预或应对方式（CBT、正念、韧性）","干预"],
            ["1","反证：效应量极小 / 相关不等于因果","反驳段"]],
    note: "与 education 划清：psychology 的 intervention 是心理师做的临床干预；education 的是老师上的课。写时各自点明执行者。",
    blocks: [
      { id:"P1", n:"机制（主力）",
        q:`("social comparison" OR "appearance comparison" OR internalization OR "self-objectification" OR objectification)
AND ("social media" OR "social networking" OR "short video")
AND ("body image" OR "body dissatisfaction" OR body shame)`, chk:"机制类证据要能画出「刺激 → 中介 → 结果」。" },
      { id:"P2", n:"谁更容易受影响",
        q:`("self-esteem" OR perfectionism OR "body mass index" OR "thin ideal" OR "risk factor*" OR vulnerability)
AND ("body dissatisfaction" OR "body image")
AND (adolescen* OR girl* OR female)`, chk:"注意性别结论的样本代表性。" },
      { id:"P3", n:"心理干预",
        q:`("cognitive behavioral" OR CBT OR mindfulness OR "acceptance and commitment" OR resilience OR coping)
AND ("body image" OR "body dissatisfaction")
AND (intervention OR therapy OR program OR treatment)`, chk:"执行者是心理师，不是学校课程。" },
      { id:"P4", n:"反证（全组最救命的一篇）",
        q:`("screen time" OR "digital technology use" OR "social media use")
AND ("well-being" OR wellbeing OR "mental health" OR "body image")
AND (adolescen* OR teen*)
AND ("effect size" OR association OR "small effect" OR debate OR controvers*)`,
        chk:"必须有一个人站出来说影响没那么大，否则全组像在编造恐慌。" }
    ]
  },
  {
    key: "Media 传播", actor: "内容、传播、网红",
    core: "content analysis, framing, representation, influencer",
    ban: "school, curriculum, intervention, media literacy",
    rq: "短视频里在讲什么、长什么样、谁在推、怎么被解读？",
    quota: [["3","中国平台内容分析","独家地盘"],
            ["2","媒介效果理论 + 实证","理论支撑"],
            ["1","网红、广告、商业内容","商业面"],
            ["1","反证：内容分析方法的局限 / 效果被夸大","反驳段"],
            ["1","平台内容生态或审美趋势","背景"]],
    note: "",
    blocks: [
      { id:"M1", n:"内容分析（主力）",
        q:`("content analysis" OR framing OR representation OR portray* OR "visual analysis" OR discourse)
AND ("body image" OR "body ideal*" OR "beauty standard*" OR appearance)
AND ("social media" OR "short video" OR Douyin OR Xiaohongshu OR advertising OR influencer)
AND (China OR Chinese)`,
        chk:"验收：有没有报告编码者一致性（intercoder reliability / Cohen's kappa）。有 = 可信；没有 = 现成的可信度批评素材。" },
      { id:"M2", n:"媒介效果理论",
        q:`("cultivation theory" OR "media effects" OR "third-person effect" OR "agenda setting" OR "social comparison theory")
AND ("body image" OR "body dissatisfaction" OR appearance)
AND ("social media" OR "short video" OR "visual media" OR Instagram OR TikTok)`, chk:"理论篇用来搭框架，不能当实证证据用。" },
      { id:"M3", n:"网红与商业内容",
        q:`(influencer OR "micro-celebrity" OR "beauty vlog*" OR "sponsored content" OR advertising OR commercial)
AND ("body image" OR "beauty standard*" OR appearance)
AND ("social media" OR Douyin OR Xiaohongshu OR TikTok OR Instagram)`, chk:"有商业化分析才能谈利益驱动。" },
      { id:"M4", n:"中国平台专搜",
        q:`(Douyin OR TikTok OR Xiaohongshu OR Kuaishou OR Weibo)
AND (beauty OR body OR appearance OR filter OR "beauty ideal")
AND (content OR representation OR trend* OR discourse)`,
        chk:"中文 CNKI：抖音 / 小红书 / 短视频 + 身体意象 / 外貌焦虑 / 审美 + 内容分析 / 话语分析。" }
    ]
  }
];

const HITS = [
  { k:"core", label:"核心干预 / 机制（≥4 篇候选）", min:4 },
  { k:"meta", label:"含 1 篇元分析（≥1）", min:1 },
  { k:"cn", label:"中国本土（≥3 篇候选）", min:3 },
  { k:"feas", label:"可行性 / 实施（≥3 篇候选）", min:3 },
  { k:"counter", label:"反证（≥1）", min:1 }
];

const RQ_CHECKS = [
  "有可测量的<b>结果变量</b>（body dissatisfaction）",
  "有<b>人群边界</b>（学段 + 年龄 + 地区）",
  "有<b>时间窗</b>并落到具体年份",
  "to what extent 后面接的是<b>可排序的宾语</b>",
  "至少<b>两方</b>能用真实数据得出相反结论",
  "动词不是单向因果（amplify / cause）",
  "与成员 RQ 共用同一结果变量但互不覆盖",
  "一句话说完，≤25 词"
];
const RQ_FIXES = [
  { t:"amplify（单向）", e:"Liu et al. 2025：两波交叉滞后，双向均显著", f:"① reciprocal reinforce ② interact with ③ 限定为「内容曝光强度」" },
  { t:"adolescent girls", e:"样本 56.4% 男，性别差异 p=.23（作者称探索性）", f:"① 改 adolescents ② 论「基线更高 ≠ 关联更强」 ③ 按行为划分人群" },
  { t:"recent five years", e:"跨 2022 封锁期与 2023 放开期，混淆未讨论", f:"① 写 2020–2025 并讨论疫情 ② 限定校园场景 ③ 改问「短视频兴起之后」" }
];
const RUBRIC = [
  { id:"r1", n:"Row 1 · Context", max:6, hi:"Situates the investigation in research drawing on a wide variety of appropriate sources; makes clear the significance to a larger context.", lo:"Overly broad or simplistic area of investigation; little evidence of research." },
  { id:"r2", n:"Row 2 · Argument", max:6, hi:"Demonstrates understanding of the reasoning and validity of the sources' arguments.", lo:"Restates or misstates sources; doesn't address reasoning." },
  { id:"r3", n:"Row 3 · Sources & Evidence", max:6, hi:"Evaluation of credibility of the sources and selection of relevant evidence.", lo:"Identifies evidence with no real reference to credibility." },
  { id:"r4", n:"Row 4 · Perspective", max:6, hi:"Discusses a range of perspectives and draws explicit, relevant connections.", lo:"Few and/or oversimplified perspectives." },
  { id:"r5", n:"Row 5 · Attribution & Citation", max:3, hi:"Accurately cites sources; bibliography consistent in style.", lo:"Many citation errors; inconsistent bibliography." },
  { id:"r6", n:"Row 6 · Grammar & Style", max:3, hi:"Communicates clearly; style consistently academic.", lo:"Flaws interfere with communication." }
];
const DEFENSE = [
  ["RQ 写 amplify，但你引的研究是双向的，为什么不改？","答是否已改；若保留，须把 amplify 限定到「内容曝光强度」，并说明双向不等于对称。"],
  ["样本男生更多，凭什么说是「女生的问题」？","承认性别差异不显著（p=.23）→ 区分「关联强度相同」与「基线水平不同」→ 说明它如何改变方案设计。"],
  ["媒介素养课的效应量多大？值得占课时吗？","给具体效应量 → 承认偏小 → 论证「唯一可控 + 低成本」的杠杆价值，与平台治理互补。"],
  ["怎么排除家庭条件（SES）的影响？","承认真实缺口 → 这反而使「学校是可控变量」成为理由 → 指出需要多校分层样本。"],
  ["四个 perspective 里哪两个真冲突？冲突在哪一行？","必须指到一句具体价值排序（保护优先 vs 自主优先），不能答「看法不同」。"],
  ["平台已自行治理，团队方案还有必要吗？","用治理执行数据回应；平台激励与公共健康目标不一致 = 市场失灵。"],
  ["历史视角与「最近五年」怎么统一？","历史视角回答「审美从何而来」，是解释项不是时间范围；或承认并改写 RQ。"],
  ["这段证据是相关还是因果？","区分横断相关 / 纵向交叉滞后 / 实验，说明据此支撑哪一档强度的主张。"],
  ["若有人用同样证据主张「禁止中学生用短视频」，你怎么回应？","「单纯时长禁令抓错变量」：研究测的是强度，可变的是内容与批判能力。"],
  ["团队方案里最贵的一条是什么？谁付成本？","说清课时、师资培训、公平性 → 给分阶段落地路径。"]
];
const STEPS = [
  { d:-56, t:"团队粒度", s:"只对现象/政策达成一致，不写论点；lens 认领完成。" },
  { d:-49, t:"侦察检索", s:"读四段，过 G1 有实证 / G2 有四方 / G3 是价值冲突。" },
  { d:-42, t:"RQ 锁定", s:"八项体检全过；全员共用 body dissatisfaction。" },
  { d:-35, t:"反证扫描", s:"方向 / 人群 / 干预三类反证各≥1 条并改 RQ。" },
  { d:-28, t:"文章池闭池", s:"每人 8 篇，全组 32 篇，含 ≥1 篇元分析。" },
  { d:-21, t:"IRR Draft 1", s:"只写证据与推理，按字数配额。" },
  { d:-14, t:"IRR Draft 2", s:"补归属、可信度框架、过渡句；OWL 统一格式。" },
  { d:-7, t:"IRR Draft 3", s:"按细则自评，目标 ≥24/30。" },
  { d:-3, t:"TMP 首排", s:"八页骨架 + 时间配比，结构轮彩排。" },
  { d:-1, t:"录像 + 答辩自测", s:"锁时长 8–10 min；每人 10 题自测。" },
  { d:0, t:"提交", s:"IRR 定稿 + TMP 录像 + 答辩准备。" }
];
const STEP_ORDER = ["team","recon","rq","falsify","source","irr","tmp","defense"];

function buildStatic(){
  $("#lensCards").innerHTML = LENS_CARDS.map((l, i) => `
    <details class="card">
      <summary><b>${l.key}</b> · 负责「${l.actor}」</summary>
      <p class="hint" style="margin-top:0">核心词：${l.core}<br>禁用词：<span style="color:#ffb3b3">${l.ban}</span></p>
      ${l.rq ? `<p class="tight"><b>问句方向：</b>${esc(l.rq)}</p>` : ""}
      <div class="scroll"><table><thead><tr><th>数量</th><th>找什么</th><th>用途</th></tr></thead><tbody>
        ${l.quota.map(q=>`<tr><td><b>${q[0]}</b></td><td>${q[1]}</td><td class="small">${q[2]}</td></tr>`).join("")}
      </tbody></table></div>
      ${l.note ? `<p class="hint">${l.note}</p>` : ""}
      ${l.blocks.map((b, j) => `
        <div class="blk">
          <div class="blk-h"><b>${b.id} · ${b.n}</b><button class="mini" data-copy="kw${i}_${j}">复制</button></div>
          <pre id="kw${i}_${j}">${esc(b.q)}</pre>
          <p class="hint" style="margin:4px 0 0">${b.chk}</p>
        </div>`).join("")}
    </details>`).join("");

  $("#hitCheck").innerHTML = `<div class="scroll"><table><thead><tr><th>配额</th><th>通过线</th><th>我搜到</th><th>结论</th></tr></thead><tbody>
    ${HITS.map(h=>`<tr><td>${h.label}</td><td class="small">≥ ${h.min}</td>
      <td><input type="number" min="0" class="hitin" data-hit="${h.k}" style="width:70px"/></td>
      <td class="hitres small" data-res="${h.k}">—</td></tr>`).join("")}
  </tbody></table></div><p class="hint">任何一格挂零先换检索词；连换两轮还挂零，就改问句范围（不是改话题）。</p>`;

  $("#rqChecks").innerHTML = RQ_CHECKS.map((t,i)=>`<label class="chk"><input type="checkbox" data-rqcheck="${i}"><span>${t}</span></label>`).join("");
  $("#rqFixes").innerHTML = RQ_FIXES.map(f=>`<div class="q"><b>${f.t}</b><span>${f.e}</span><div class="hint">改法：${f.f}</div></div>`).join("");
  $("#rubricRows").innerHTML = RUBRIC.map(r=>`
    <div class="q"><b>${r.n} <span class="pill">${r.max}</span></b>
      <span><b style="color:#8bf0c8">High</b> ${r.hi}</span>
      <div class="hint"><b style="color:#ffb3b3">Low</b> ${r.lo}</div>
      <select data-rubric="${r.id}" style="margin-top:6px">${scoreOpts(r.max)}</select></div>`).join("");
  $("#defenseQs").innerHTML = DEFENSE.map((d,i)=>`<div class="q"><b>Q${i+1} · ${d[0]}</b><span>${d[1]}</span></div>`).join("");
  $$(".submit").forEach(el => el.innerHTML = submitHTML(el.dataset.step));
}
function scoreOpts(max){
  const o = [{v:0,l:"0 · 没做到"}];
  if (max === 6) o.push({v:2,l:"2 · Low"},{v:4,l:"4 · Medium"},{v:6,l:"6 · High"});
  else o.push({v:1,l:"1 · Low"},{v:2,l:"2 · Medium"},{v:3,l:"3 · High"});
  return o.map(x=>`<option value="${x.v}">${x.l}</option>`).join("");
}
function submitHTML(step){
  return `
  <header><h3>交付与核查</h3><span class="small">${aiReady ? "AI 就绪 · " + aiModel : "AI 未配置"}</span></header>
  <div class="drop" id="drop-${step}"><b>点击选择或拖入文件</b><br>pdf · docx · txt · md · 图片，≤3.5MB</div>
  <input type="file" id="file-${step}" class="hidden" accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp">
  <div class="row">
    <div style="flex:1"><label class="f">标题</label><input type="text" id="title-${step}" placeholder="例：候选文献清单 v1"></div>
    <div style="flex:1"><label class="f">一句话说明</label><input type="text" id="note-${step}" placeholder="给组员看的"></div>
  </div>
  <label class="f">要 AI 核查的文字（≤3000 字，贴关键段落，不必整篇）</label>
  <textarea id="text-${step}" placeholder="把这一小步的核心内容贴进来"></textarea>
  <div class="row"><button class="primary" id="check-${step}">AI 核查</button><button class="ghost" id="up-${step}">上传文件</button></div>
  <div id="ai-${step}"></div>
  <div class="files" id="files-${step}"></div>`;
}

/* ---------- wire ---------- */
function wire(){
  $$("#nav a").forEach(a=>a.addEventListener("click", e=>{
    e.preventDefault(); history.replaceState(null,"",a.getAttribute("href")); show(a.dataset.s);
  }));
  window.addEventListener("hashchange", ()=>show(location.hash.slice(1)));
  $$("[data-copy]").forEach(b=>b.addEventListener("click", async ()=>{
    const el = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); toast("已复制"); }
    catch(e){ const r=document.createRange(); r.selectNode(el); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast("已选中，按 ⌘C"); }
  }));

  $("#openLogin").addEventListener("click", openLogin);
  $("#doLogin").addEventListener("click", doLogin);
  $("#loginName").addEventListener("keydown", e=>{ if (e.key === "Enter") doLogin(); });
  $("#cancelLogin").addEventListener("click", ()=>$("#loginModal").classList.add("hidden"));
  $("#logoutBtn").addEventListener("click", logout);

  $("#btnBackup").addEventListener("click", async ()=>{
    try {
      const data = await req("/api/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "ap-seminar-pt1-backup-" + new Date().toISOString().slice(0,10) + ".json";
      link.click(); setTimeout(()=>URL.revokeObjectURL(link.href), 1500);
      toast("已导出备份");
    } catch(e){ toast("导出失败：" + e.message); }
  });

  $("#saveTeam").addEventListener("click", async ()=>{
    try { await saveTeam({ topic: $("#topicInput").value.trim(), deadline: $("#deadlineInput").value, rq: state.team.rq || "" });
      $("#teamSaved").textContent = "已保存"; renderTimeline(); toast("已保存"); }
    catch(e){ toast(e.message || "保存失败"); }
  });
  $("#saveMember").addEventListener("click", async ()=>{
    const lens = $("#mLens").value; if (!lens) return toast("选择 lens");
    if (await claim({ lens, count:$("#mCount").value, rq:$("#mRq").value.trim(), stage:$("#mStage").value })) toast("已认领 " + lens);
  });
  $("#saveFx").addEventListener("click", async ()=>{
    const p = { src:$("#fxSrc").value.trim(), target:$("#fxTarget").value.trim(), what:$("#fxWhat").value.trim(), how:$("#fxHow").value };
    if (!p.src && !p.what) return toast("至少填来源或结论");
    await addFx(p); ["fxSrc","fxTarget","fxWhat"].forEach(k=>$("#"+k).value=""); toast("已记录");
  });

  $("#savePaper").addEventListener("click", savePaper);
  $("#cancelEditPaper").addEventListener("click", ()=>{ clearPaperForm(); toast("已取消"); });
  $("#paperFilter").addEventListener("change", renderPapers);
  const dp = $("#drop-paper"), fp = $("#file-paper");
  dp.addEventListener("click", ()=>fp.click());
  dp.addEventListener("dragover", e=>{ e.preventDefault(); dp.classList.add("hot"); });
  dp.addEventListener("dragleave", ()=>dp.classList.remove("hot"));
  dp.addEventListener("drop", e=>{ e.preventDefault(); dp.classList.remove("hot"); if (e.dataTransfer.files[0]) { fp.files = e.dataTransfer.files; dp.innerHTML = "<b>" + esc(e.dataTransfer.files[0].name) + "</b><br>已选择"; } });
  fp.addEventListener("change", ()=>{ if (fp.files[0]) dp.innerHTML = "<b>" + esc(fp.files[0].name) + "</b><br>已选择"; });

  $("#rqText").addEventListener("input", ()=>{ state.team.rq = $("#rqText").value; localSave(); });
  $("#rqText").addEventListener("blur", async ()=>{ if (!isMe()) return; try { await saveTeam({ topic: state.team.topic||"", deadline: state.team.deadline||"", rq: $("#rqText").value }); } catch(e){} });

  $$("[data-rqcheck]").forEach(c=>c.addEventListener("change", renderRq));
  $$("[data-rubric]").forEach(sel=>sel.addEventListener("change", async ()=>{
    if (!isMe()) return mustLogin();
    state.me.rubric = state.me.rubric || {}; state.me.rubric[sel.dataset.rubric] = Number(sel.value);
    renderRubric(); await saveMine();
  }));
  $$("input[type=checkbox][data-p]").forEach(c=>c.addEventListener("change", async ()=>{
    if (!isMe()) { c.checked = false; return mustLogin(); }
    state.me.progress = state.me.progress || {}; state.me.progress[c.dataset.p] = c.checked;
    renderProgress(); await saveMine();
  }));
  $$(".hitin").forEach(inp=>{
    const saved = localStorage.getItem("apsem_hits_" + inp.dataset.hit);
    if (saved != null && saved !== "") inp.value = saved;
    inp.addEventListener("input", ()=>{ localStorage.setItem("apsem_hits_" + inp.dataset.hit, inp.value); renderHits(); });
  });
  renderHits();

  ["wbP","wbIntro","wbSyn","wbCounter","wbConcl","wbMax"].forEach(id=>$("#"+id).addEventListener("input", renderWordBudget));

  STEP_ORDER.forEach(step=>{
    const drop = $("#drop-" + step), file = $("#file-" + step);
    if (!drop) return;
    drop.addEventListener("click", ()=>file.click());
    drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("hot"); });
    drop.addEventListener("dragleave", ()=>drop.classList.remove("hot"));
    drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove("hot"); if (e.dataTransfer.files[0]) { file.files = e.dataTransfer.files; drop.innerHTML = "<b>" + esc(e.dataTransfer.files[0].name) + "</b><br>已选择"; } });
    file.addEventListener("change", ()=>{ if (file.files[0]) drop.innerHTML = "<b>" + esc(file.files[0].name) + "</b><br>已选择"; });
    $("#up-" + step).addEventListener("click", ()=>upload(step));
    $("#check-" + step).addEventListener("click", ()=>aiCheck(step));
  });
}

function show(id){
  if (!document.getElementById("s-" + id)) id = "dash";
  $$("section").forEach(s=>s.classList.toggle("on", s.id === "s-" + id));
  $$("#nav a").forEach(a=>a.classList.toggle("active", a.dataset.s === id));
  window.scrollTo(0,0);
}

/* ---------- render ---------- */
function renderAll(){
  renderWho(); renderDash(); renderInputs(); renderMembers(); renderPapers();
  renderFx(); renderRubric(); renderRq(); renderWordBudget(); renderTimeline();
  STEP_ORDER.forEach(renderFiles); renderProgress();
}
function renderWho(){
  const on = !!state.me;
  $("#whoIn").classList.toggle("hidden", !on);
  $("#openLogin").classList.toggle("hidden", on);
  if (on) $("#whoName").textContent = state.me.name;
}
function renderInputs(){
  if (document.activeElement !== $("#topicInput")) $("#topicInput").value = state.team.topic || "";
  if (document.activeElement !== $("#deadlineInput")) $("#deadlineInput").value = state.team.deadline || "";
  if (document.activeElement !== $("#rqText")) $("#rqText").value = state.team.rq || "";
  const dis = !state.me;
  ["#topicInput","#deadlineInput","#saveTeam","#mLens","#mCount","#mRq","#mStage","#saveMember",
   "#fxSrc","#fxTarget","#fxWhat","#saveFx","#pTitle","#pAuth","#pYear","#pLens","#pQuota","#pCountry",
   "#pSample","#pDesign","#pFinding","#pCred","#pUrl","#savePaper"].forEach(s=>{ const el = $(s); if (el) el.disabled = dis; });
  $$("input[type=checkbox][data-p]").forEach(c=>c.disabled = dis);
  if (state.me && state.me.lens) { $("#mLens").value = state.me.lens; $("#mCount").value = state.me.count || "4"; $("#mStage").value = state.me.stage || "0 · 还没开始"; if (document.activeElement !== $("#mRq")) $("#mRq").value = state.me.rq || ""; }
}
function countByMember(){
  const c = {};
  state.members.forEach(m => c[m.id] = 0);
  state.sources.forEach(s => { if (s.byId && c[s.byId] != null) c[s.byId]++; });
  return c;
}
function renderDash(){
  $("#tMembers").textContent = state.members.length;
  $("#tLens").textContent = new Set(state.members.map(m=>m.lens).filter(Boolean)).size;
  $("#tSrc").textContent = state.sources.length;
  $("#tFiles").textContent = state.deliverables.length;

  const prog = (state.me && state.me.progress) || {};
  const names = { team:"分工 · Lens", recon:"侦察检索", rq:"RQ 收窄", falsify:"反证扫描", source:"文章池", irr:"IRR 撰写", tmp:"TMP 演示", defense:"口头答辩" };
  const next = STEP_ORDER.find(s => !Object.keys(prog).some(k => k.startsWith(s) && prog[k])) || "defense";
  $("#nextStep").innerHTML = state.me
    ? `下一步：<b>${names[next]}</b> · <a href="#${next}">去这一页</a>`
    : "<b>先输入名字进入</b>，再按左侧步骤推进。";
  renderTimeline();
}
function renderTimeline(){
  const dl = state.team.deadline ? new Date(state.team.deadline + "T23:59:00") : null;
  const today = new Date(); today.setHours(0,0,0,0);
  $("#timeline").innerHTML = STEPS.map(st=>{
    let d = "D" + st.d, badge = "";
    if (dl) {
      const x = new Date(dl.getTime() + st.d * 86400000);
      d = x.toLocaleDateString("zh-CN", { month:"2-digit", day:"2-digit" });
      const left = Math.round((x - today) / 86400000);
      badge = left < 0 ? `<span class="pill" style="color:#ffb3b3">已过</span>` : `<span class="pill">${left} 天</span>`;
    }
    return `<li><span class="t">${d}</span> ${badge}<b>${st.t}</b><span class="s">${st.s}</span></li>`;
  }).join("");
}
function renderMembers(){
  const ms = state.members.slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
  $("#memberTable").innerHTML = ms.length ? `<table><thead><tr><th>成员</th><th>Lens</th><th>进度</th><th></th></tr></thead><tbody>
    ${ms.map(m=>`<tr><td><b>${esc(m.name)}</b>${state.me && m.name===state.me.name ? ' <span class="pill">我</span>' : ''}</td>
      <td>${m.lens ? esc(m.lens) : '<span class="small">未认领</span>'}</td>
      <td class="small">${esc(m.stage||"—")}</td>
      <td>${(state.me && m.name===state.me.name) || !/[\p{L}\p{N}]/u.test(m.name) ? `<button class="mini ghost" data-delmember="${m.id}">移除</button>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<p class="hint">还没有人认领。</p>`;
  $$("[data-delmember]").forEach(b=>b.addEventListener("click", async ()=>{ if (confirm("移除本人登记？")) { await delMember(b.dataset.delmember); toast("已移除"); } }));

  const c = {}; ms.forEach(m=>{ if (m.lens) c[m.lens] = (c[m.lens]||0)+1; });
  const max = Math.max(1, ...Object.values(c));
  $("#lensBars").innerHTML = Object.entries(c).map(([k,v])=>`<div class="hbar"><span>${esc(k)}</span><span class="bar"><i style="width:${v/max*100}%"></i></span><span>${v}</span></div>`).join("");
}
function renderPapers(){
  $("#paperTotal").textContent = state.sources.length + " 篇";

  // 每人进度条
  const counts = countByMember();
  const rows = state.members.map(m => {
    const n = counts[m.id] || 0;
    const pct = Math.min(100, n / TARGET * 100);
    const color = n >= TARGET ? "linear-gradient(90deg,#34d399,#4ea1ff)" : "linear-gradient(90deg,#4ea1ff,#7c5cff)";
    return `<div class="hbar"><span>${esc(m.name)}${m.lens ? " · " + esc(m.lens.replace(/\\s*\\S*$/, "")) : ""}</span>
      <span class="bar"><i style="width:${pct}%;background:${color}"></i></span><span>${n}/${TARGET}</span></div>`;
  }).join("");
  $("#paperProgress").innerHTML = rows || `<p class="hint">还没有成员。</p>`;

  // 配额覆盖
  const q = {};
  state.sources.forEach(s => { const k = s.quota || "其他"; q[k] = (q[k]||0)+1; });
  const need = [["核心证据",4],["元分析 / 综述",1],["中国本土",3],["可行性 / 实施",3],["反证",1]];
  $("#quotaCover").innerHTML = need.map(([k,min])=>{
    const n = q[k]||0;
    const ok = n >= min;
    return `<div class="hbar"><span>${k}</span><span class="bar"><i style="width:${Math.min(100,n/min*100)}%;background:${ok?"linear-gradient(90deg,#34d399,#4ea1ff)":"linear-gradient(90deg,#fbbf24,#f87171)"}"></i></span><span style="color:${ok?"#8bf0c8":"#ffd98a"}">${n}/${min}</span></div>`;
  }).join("");

  // 列表
  const filter = $("#paperFilter").value;
  const list = state.sources.filter(s => !filter || s.lens === filter).slice().reverse();
  $("#srcTable").innerHTML = list.length ? `<div class="scroll"><table>
    <thead><tr><th>文章</th><th>国家 / 样本 / 设计</th><th>结论</th><th>Lens / 配额</th><th>上传者</th><th></th></tr></thead><tbody>
    ${list.map(s=>`<tr>
      <td><b>${esc(s.auth||"")}</b> ${esc(s.year||"")}
        <div class="small">${esc((s.title||"").slice(0,90))}</div>
        <div class="small" style="color:var(--dim2)">
          ${s.fileId ? `<a href="/api/file?id=${s.fileId}" target="_blank" rel="noopener">下载 ${esc(s.filename||"文件")}</a>` : ""}
          ${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">链接</a>` : ""}
        </div>
        ${s.cred ? `<div class="small" style="color:var(--dim2)">${esc(s.cred.slice(0,110))}</div>` : ""}</td>
      <td class="small">${esc(s.country||"—")}<br>${esc(s.sample||"—")}<br>${esc((s.design||"").slice(0,40))}</td>
      <td class="small">${esc((s.finding||"").slice(0,90))}</td>
      <td class="small">${esc(s.lens||"")}<br>${esc(s.quota||"")}</td>
      <td class="small">${esc(s.by||"")}</td>
      <td>${isOwner(s) ? `<button class="mini ghost" data-editpaper="${s.id}">改</button> <button class="mini ghost" data-delpaper="${s.id}">删</button>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>`
    : `<p class="hint">这个筛选下还没有文章。</p>`;

  $$("[data-editpaper]").forEach(b=>b.addEventListener("click", ()=>editPaper(b.dataset.editpaper)));
  $$("[data-delpaper]").forEach(b=>b.addEventListener("click", ()=>delPaper(b.dataset.delpaper)));
}
function renderHits(){
  HITS.forEach(h=>{
    const el = document.querySelector(`[data-hit="${h.k}"]`);
    const res = document.querySelector(`[data-res="${h.k}"]`);
    if (!el || !res) return;
    const n = Number(el.value || 0);
    if (el.value === "") { res.textContent = "—"; res.style.color = "var(--dim2)"; return; }
    res.textContent = n >= h.min ? "通过" : "缺 " + (h.min - n) + " 篇";
    res.style.color = n >= h.min ? "#8bf0c8" : "#ffd98a";
  });
}
function renderFx(){
  $("#fxList").innerHTML = state.fx.length ? state.fx.slice().reverse().map(f=>`
    <div class="q"><b>${esc(f.src||"—")}</b><span>${esc(f.what||"")}</span>
      <div class="hint">反驳：${esc(f.target||"")} · ${esc(f.how||"")} · ${esc(f.by||"")}</div></div>`).join("")
    : `<p class="hint">还没有记录。目标 ≥2 条。</p>`;
}
function renderRq(){
  const n = $$("[data-rqcheck]").filter(c=>c.checked).length;
  $("#rqScore").textContent = n + " / 8";
  $("#rqBar").style.width = (n/8*100) + "%";
  $("#rqVerdict").innerHTML = n <= 3 ? "未锁定：先补人群边界与结果变量，别动笔。"
    : n <= 6 ? "半开：还缺「为什么值得研究」那一项，Row 1 会停在中档。"
    : "可锁定：交给全员确认每人的 RQ 都能被别人反驳。";
}
function renderWordBudget(){
  const p = Math.max(2, Math.min(6, +$("#wbP").value || 4));
  const fixed = (+$("#wbIntro").value||0) + (+$("#wbSyn").value||0) + (+$("#wbCounter").value||0) + (+$("#wbConcl").value||0);
  const max = +$("#wbMax").value || 1200;
  const per = Math.floor((max - fixed) / p);
  $("#wbOut").innerHTML = `
    <div class="tile"><b>${per}</b><span>每段词数</span></div>
    <div class="tile"><b>${fixed + per*p}</b><span>合计 / ${max}</span></div>
    <div class="tile"><b>${Math.round(fixed/max*100)}%</b><span>固定段占比</span></div>`;
}
function renderRubric(){
  const mine = (state.me && state.me.rubric) || {};
  let tot = 0, max = 0;
  RUBRIC.forEach(r=>{
    const sel = document.querySelector(`[data-rubric="${r.id}"]`); if (!sel) return;
    if (mine[r.id] != null) sel.value = String(mine[r.id]);
    sel.disabled = !state.me;
    tot += +sel.value || 0; max += r.max;
  });
  $("#rubricTotal").textContent = tot + "/" + max;
  $("#rubricBar").style.width = (tot/max*100) + "%";
  $("#rubricBand").textContent = tot >= 26 ? "High band" : tot >= 21 ? "卡在 Row 3/4" : tot >= 16 ? "结构有缺口" : "先修 RQ 与视角";
}
function renderProgress(){
  const prog = (state.me && state.me.progress) || {};
  $$("input[type=checkbox][data-p]").forEach(c=>{
    c.checked = !!prog[c.dataset.p];
    const sp = c.parentElement.querySelector("span"); if (sp) sp.classList.toggle("done", c.checked);
  });
  renderDash();
}
function renderFiles(step){
  const box = $("#files-" + step); if (!box) return;
  const list = state.deliverables.filter(d=>d.step === step).sort((a,b)=>b.updated-a.updated);
  box.innerHTML = list.length ? list.map(d=>`
    <div class="file">
      <div><a href="/api/file?id=${d.id}" target="_blank" rel="noopener">${esc(d.title || d.filename)}</a>
        <div class="meta">${esc(d.by)} · ${fmt(d.updated)} · ${(d.size/1024).toFixed(0)}KB${d.note ? " · " + esc(d.note) : ""}${d.ai ? " · 已核查" : ""}</div>
        ${d.ai ? `<div class="meta" style="cursor:pointer" data-ai-toggle="${d.id}">▸ 查看 AI 核查</div><div class="ai-out hidden" id="aiout-${d.id}"></div>` : ""}</div>
      <div>${state.me && d.byId === state.me.id ? `<button class="mini ghost" data-delfile="${d.id}" data-step="${step}">删</button>` : ""}</div>
    </div>`).join("") : `<p class="hint">这一小步还没有上传。</p>`;

  $$("#files-" + step + " [data-delfile]").forEach(b=>b.addEventListener("click", ()=>delFile(b.dataset.step, b.dataset.delfile)));
  $$("#files-" + step + " [data-ai-toggle]").forEach(b=>b.addEventListener("click", ()=>{
    const d = state.deliverables.find(x=>x.id === b.dataset.aiToggle);
    const box2 = document.getElementById("aiout-" + b.dataset.aiToggle);
    if (!d || !box2) return;
    if (box2.classList.contains("hidden")) { box2.textContent = d.ai && d.ai.text ? d.ai.text : "（未保存正文，请重新核查）"; box2.classList.remove("hidden"); b.textContent = "▾ 收起 AI 核查"; }
    else { box2.classList.add("hidden"); b.textContent = "▸ 查看 AI 核查"; }
  }));
}

window.addEventListener("DOMContentLoaded", boot);
})();
