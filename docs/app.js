/* AP Seminar PT1 团队工作台 — 前端 */
(() => {
"use strict";

const TOK_KEY = "apsem_token_v2";
let state = blank();
let cloud = true;
let token = localStorage.getItem(TOK_KEY) || "";

function blank(){ return { team:{topic:"",deadline:"",rq:""}, members:[], sources:[], fx:[], me:null }; }
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function uid(p){ return p + "_" + Math.random().toString(36).slice(2,10); }

let toastTimer;
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("on"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("on"),2000); }

/* ---------------- 后端抽象 ---------------- */
async function req(path, body, method){
  const opt = { method: method || (body ? "POST" : "GET"), headers: {} };
  if (token) opt.headers["x-token"] = token;
  if (body) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || ("HTTP " + r.status)); e.status = r.status; e.data = data; throw e; }
  return data;
}
function localSave(){ try { localStorage.setItem("apsem_local_v2", JSON.stringify(state)); } catch(e){} }

async function boot(){
  try {
    const res = await req("/api/state");
    cloud = true;
    state = Object.assign(blank(), res.state);
    state.me = res.me || null;
    if (!state.me && token) { token = ""; localStorage.removeItem(TOK_KEY); }
    const st = $("#modeStatus"); st.textContent = "云端已连接 · 全员实时共享"; st.classList.add("on");
  } catch (err) {
    cloud = false;
    try { const raw = localStorage.getItem("apsem_local_v2"); if (raw) state = Object.assign(blank(), JSON.parse(raw)); } catch(e){}
    const st = $("#modeStatus"); st.textContent = "离线本地模式（未连上服务器）"; st.classList.remove("on");
  }
  buildStatic(); renderAll(); wire();
  showSection((location.hash || "#overview").slice(1));
  if (cloud && !state.me) openLogin();
}

async function refresh(){
  if (!cloud) return;
  try {
    const res = await req("/api/state");
    state = Object.assign(blank(), res.state);
    state.me = res.me || null;
    renderAll();
  } catch(e){ toast("刷新失败：" + e.message); }
}

/* ---------------- 身份 ---------------- */
function openLogin(){
  $("#loginModal").classList.remove("hidden");
  $("#loginErr").textContent = "";
  setTimeout(()=>$("#loginName").focus(), 50);
}
async function doLogin(){
  const name = $("#loginName").value.trim();
  if (!name) { $("#loginErr").textContent = "请输入名字"; return; }
  if (cloud) {
    try {
      const res = await req("/api/login", { name });
      token = res.token; localStorage.setItem(TOK_KEY, token);
      state = Object.assign(blank(), res.state);
      state.me = res.user;
      $("#loginModal").classList.add("hidden");
      renderAll();
      toast(res.created ? "已注册：" + res.user.name : "欢迎回来：" + res.user.name);
    } catch(e){ $("#loginErr").textContent = e.message || "登录失败"; }
  } else {
    if (!state.members.some(m => m.name === name)) state.members.push({ id:uid("m"), name, lens:"", count:"4", rq:"", stage:"0 · 还没开始", progress:{}, rubric:{}, updated:Date.now() });
    state.me = state.members.find(m => m.name === name);
    localStorage.setItem("apsem_name_v2", name); localSave();
    $("#loginModal").classList.add("hidden"); renderAll(); toast("本地模式：" + name);
  }
}
function logout(){
  token = ""; localStorage.removeItem(TOK_KEY); state.me = null; renderAll();
  if (cloud) openLogin(); else toast("已退出");
}
function needsLogin(){ toast("先输入名字进入"); openLogin(); return false; }
const isMe = () => !!state.me;

/* ---------------- 写入 ---------------- */
async function saveTeam(payload){
  if (!isMe()) return needsLogin();
  if (cloud) { const r = await req("/api/team", payload); state = Object.assign(blank(), r.state); state.me = r.me; }
  else Object.assign(state.team, payload);
  localSave(); renderAll();
}
async function claim(payload){
  if (!isMe()) { needsLogin(); return false; }
  if (cloud) {
    try {
      const r = await req("/api/member", payload);
      state = Object.assign(blank(), r.state); state.me = r.me; localSave(); renderAll();
      return true;
    } catch(e){
      if (e.status === 409 && e.data && e.data.holder) toast("这个 lens 已被 " + e.data.holder + " 认领，请换一个");
      else toast(e.message || "提交失败");
      return false;
    }
  }
  Object.assign(state.me, payload, { updated: Date.now() }); localSave(); renderAll(); return true;
}
async function addSource(p){
  if (!isMe()) { needsLogin(); return false; }
  if (cloud) {
    try { const r = await req("/api/source", p); state = Object.assign(blank(), r.state); state.me = r.me; renderAll(); return true; }
    catch(e){
      if (e.status === 409 && e.data && e.data.dupe) toast("这条来源已存在（由 " + e.data.dupe + " 登记）");
      else toast(e.message || "提交失败");
      return false;
    }
  }
  state.sources.push(Object.assign({ id:uid("s"), by:state.me.name, updated:Date.now() }, p)); localSave(); renderAll(); return true;
}
async function addFx(p){
  if (!isMe()) { needsLogin(); return false; }
  if (cloud) { const r = await req("/api/fx", p); state = Object.assign(blank(), r.state); state.me = r.me; renderAll(); }
  else { state.fx.push(Object.assign({ id:uid("fx"), by:state.me.name, updated:Date.now() }, p)); localSave(); renderAll(); }
  return true;
}
async function delSource(id){
  if (!isMe()) return needsLogin();
  if (cloud) { const r = await req("/api/source?id=" + encodeURIComponent(id), null, "DELETE"); state = Object.assign(blank(), r.state); state.me = r.me; renderAll(); }
  else { state.sources = state.sources.filter(s => s.id !== id); localSave(); renderAll(); }
}
async function delMember(id){
  if (!isMe()) return needsLogin();
  if (cloud) { const r = await req("/api/member?id=" + encodeURIComponent(id), null, "DELETE"); state = Object.assign(blank(), r.state); state.me = r.me; renderAll(); }
  else { state.members = state.members.filter(m => m.id !== id); localSave(); renderAll(); }
}
async function saveMine(){
  if (!isMe()) return;
  const payload = { progress: state.me.progress || {}, rubric: state.me.rubric || {} };
  if (cloud) {
    try { const r = await req("/api/save", payload); state.me = r.me; }
    catch(e){ /* 静默，不打断打字 */ }
  }
  localSave();
}

/* ---------------- 导航 ---------------- */
function showSection(id){
  if (!document.getElementById("s-"+id)) id = "overview";
  $$("section").forEach(s => s.classList.toggle("on", s.id === "s-"+id));
  $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.s === id));
  window.scrollTo({ top:0, behavior:"instant" });
}

function wire(){
  $$("#nav a").forEach(a => a.addEventListener("click", e => {
    e.preventDefault(); history.replaceState(null, "", a.getAttribute("href")); showSection(a.dataset.s);
  }));
  window.addEventListener("hashchange", () => showSection(location.hash.slice(1)));

  $$("[data-copy]").forEach(b => b.addEventListener("click", async () => {
    const el = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); toast("已复制"); }
    catch(e){ const r=document.createRange(); r.selectNode(el); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast("已选中，按 ⌘C"); }
  }));

  $("#openLogin").addEventListener("click", openLogin);
  $("#doLogin").addEventListener("click", doLogin);
  $("#loginName").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  $("#cancelLogin").addEventListener("click", () => $("#loginModal").classList.add("hidden"));
  $("#logoutBtn").addEventListener("click", logout);

  $("#saveTeam").addEventListener("click", async () => {
    try {
      await saveTeam({ topic: $("#topicInput").value.trim(), deadline: $("#deadlineInput").value, rq: state.team.rq || "" });
      $("#teamSaved").textContent = "已保存 " + new Date().toLocaleTimeString();
      buildTimeline(); toast("团队信息已保存");
    } catch(e){ toast(e.message || "保存失败"); }
  });

  $("#saveMember").addEventListener("click", async () => {
    const lens = $("#mLens").value;
    if (!lens) return toast("选择 lens");
    const ok = await claim({ lens, count:$("#mCount").value, rq:$("#mRq").value.trim(), stage:$("#mStage").value });
    if (ok) toast("已提交：由 " + state.me.name + " 认领 " + lens);
  });

  $("#saveFx").addEventListener("click", async () => {
    const item = { src:$("#fxSrc").value.trim(), target:$("#fxTarget").value.trim(), what:$("#fxWhat").value.trim(), how:$("#fxHow").value };
    if (!item.src && !item.what) return toast("至少填来源或结论");
    await addFx(item);
    $("#fxSrc").value=""; $("#fxTarget").value=""; $("#fxWhat").value=""; toast("反证已记录");
  });

  $("#saveSrc").addEventListener("click", async () => {
    const title = $("#sTitle").value.trim();
    if (!title) return toast("填标题");
    const item = { auth:$("#sAuth").value.trim(), year:$("#sYear").value.trim(), lens:$("#sLens").value,
      title, type:$("#sType").value, grade:$("#sGrade").value, use:$("#sUse").value, cred:$("#sCred").value.trim() };
    if (await addSource(item)) {
      ["sAuth","sYear","sTitle","sCred"].forEach(k => $("#"+k).value = "");
      $("#srcHint").textContent = "已登记 " + new Date().toLocaleTimeString();
      toast("来源已登记");
    }
  });

  $$("[data-rubric]").forEach(sel => sel.addEventListener("change", async () => {
    if (!isMe()) return needsLogin();
    state.me.rubric = state.me.rubric || {};
    state.me.rubric[sel.dataset.rubric] = Number(sel.value);
    renderRubric(); await saveMine();
  }));

  $$("[data-rqcheck]").forEach(c => c.addEventListener("change", renderRq));
  $("#rqText").addEventListener("blur", async () => {
    if (!isMe()) return;
    state.team.rq = $("#rqText").value;
    try { await saveTeam({ topic: state.team.topic || "", deadline: state.team.deadline || "", rq: state.team.rq }); } catch(e){}
  });

  $$("input[type=checkbox][data-p]").forEach(c => c.addEventListener("change", async () => {
    if (!isMe()) { c.checked = false; return needsLogin(); }
    state.me.progress = state.me.progress || {};
    state.me.progress[c.dataset.p] = c.checked;
    renderProgress(); await saveMine();
  }));

  ["wbP","wbIntro","wbSyn","wbCounter","wbConcl","wbMax"].forEach(id => $("#"+id).addEventListener("input", renderWordBudget));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#exportCsv2").addEventListener("click", exportCsv);
  $("#btnExport").addEventListener("click", () => download("ap-seminar-pt1-all.json", JSON.stringify(state, null, 2), "application/json"));
}

function exportCsv(){
  const rows = [["author","year","lens","title","type","grade","use","credibility","by"]];
  state.sources.forEach(s => rows.push([s.auth,s.year,s.lens,s.title,s.type,s.grade,s.use,(s.cred||"").replace(/\n/g," "),s.by]));
  const csv = rows.map(r => r.map(v => '"' + String(v==null?"":v).replace(/"/g,'""') + '"').join(",")).join("\n");
  download("sources.csv", "\ufeff" + csv, "text/csv");
}
function download(name, text, type){
  const b = new Blob([text], {type: type + ";charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

/* ---------------- 静态内容 ---------------- */
const LENSES = [
  { key:"Education 教育",
    block:`AND ("media literacy" OR "school-based program" OR curriculum OR "health education"
     OR "teacher training" OR "school policy" OR "body image education" OR "prevention program")`,
    cn:"媒介素养 / 校本课程 / 健康教育 / 教师培训 / 学校政策 / 预防项目",
    focus:"学校能做什么、该不该做、做到哪一步。证据类型是干预研究与课程评估。",
    warn:"教育干预研究的效应量普遍偏小（meta 分析常在 d≈0.08–0.20）。不要期待「上了课，身体不满意降四成」这类论文；找到小效应并论证它为何仍然值得做，才是高分写法。" },
  { key:"Technology 技术",
    block:`AND ("recommendation algorithm" OR "algorithmic curation" OR "beauty filter"
     OR "facial retouching" OR "photo editing app" OR "selfie editing" OR "content moderation"
     OR "platform design" OR "engagement metrics" OR "influencer marketing")`,
    cn:"算法推荐 / 美颜滤镜 / 修图瘦脸 / 内容推荐机制 / 平台治理 / 网红营销 / 短视频推荐",
    focus:"平台机制是主动放大器还是一面镜子；治理责任在谁。",
    warn:"找「技术机制」证据比找「技术效果」难。很多论文写的是「青少年曝光到修图内容」，不是「算法做了什么」。把前者当后者用，是 Row 2 最容易掉分的地方。" },
  { key:"History 历史",
    block:`AND ("history of beauty" OR "beauty ideals" OR "body ideals" OR "foot binding"
     OR "cosmetic surgery" OR "advertising history" OR "media history" OR "cultural history")`,
    cn:"审美变迁 / 女性身体史 / 缠足 / 月份牌 / 医美史 / 消费文化与审美 / 近代女性形象",
    focus:"当下这套审美如何形成；社媒是延续还是断裂。",
    warn:"两个坑：① 团队话题写的是「近五年」，历史 lens 必须自改问成「当下的社媒审美在多大程度上是更早身体观的延续」，否则写的不是同一话题；② 证据类型是专著/档案/史料，可信度标准要换成「一手史料 + 本领域学者 + 被同行引用」，不能套 RCT 标准。" },
  { key:"Psychology 心理",
    block:`AND ("body dysmorphia" OR "body dysmorphic disorder" OR "self-esteem" OR "social comparison"
     OR "thin-ideal internalization" OR "objectification" OR "appearance anxiety")`,
    cn:"躯体变形障碍 / 自尊 / 社会比较 / 瘦理想内化 / 客体化 / 外貌焦虑",
    focus:"机制层：从「看到」到「内化」发生了什么；临床阈值与亚临床普遍化的分界。",
    warn:"心理 lens 最容易与「问题存在」重复，导致视角段只是引言的加长版。写之前先回答：这个视角的主张与引言那句「问题真实存在」有何不同？答不出来就换视角。" },
  { key:"Law 法律 / 政策",
    block:`AND ("regulation" OR "platform liability" OR "advertising law" OR "minor protection"
     OR "minors" OR "consumer protection" OR "content governance" OR "self-regulation")`,
    cn:"监管 / 平台责任 / 广告法 / 未成年人保护 / 消费者保护 / 内容治理 / 行业自律",
    focus:"谁有法定责任、执行缺口在哪、可执行的杠杆是什么。",
    warn:"法律 lens 最容易变成「列法条」。高分写法必须回答：条款写了什么 → 现实里为什么没被执行 → 缺口在哪一层（标准、罚则、举证、监管主体）。" }
];

const RQ_CHECKS = [
  "有可测量的<b>结果变量</b>（不是「影响」「问题」，而是具体指标：身体不满意得分、课时数、退学率）",
  "有明确的<b>人群边界</b>（学段 + 年龄段 + 地区，而不是「中国青少年」四个字）",
  "有<b>时间窗</b>并落到具体年份（不是 recent five years，而是 2020–2025）",
  "「to what extent」后面接的是<b>可排序的宾语</b>（谁比谁更有效 / 到哪一步为止）",
  "至少<b>两方</b>能用真实数据得出相反结论（价值冲突，不是事实争议）",
  "动词不是单向因果断言（amplify / cause），除非有实验或纵向证据",
  "与成员 RQ <b>共用同一个结果变量</b>，但互不覆盖",
  "能一句话说完，≤25 词，不需要额外解释"
];

const RUBRIC = [
  { id:"r1", name:"Row 1 · Understand and Analyze Context", max:6,
    high:"The report situates the student's investigation of the complexities of a problem or issue in research that draws upon a wide variety of appropriate sources. It makes clear the significance to a larger context.",
    low:"overly broad or simplistic area of investigation and/or little evidence of research; little or no connection to the overall problem.",
    tip:"稿子里有没有一句「为什么这件事重要」是<b>接在更大背景上</b>的，而不是「因为很多青少年玩手机」。" },
  { id:"r2", name:"Row 2 · Understand and Analyze Argument", max:6,
    high:"demonstrates an understanding of the reasoning and validity of the sources' arguments; evidenced by direct explanation or through purposeful use of the reasoning and conclusions.",
    low:"restates or misstates information from sources; doesn't address reasoning, or does so simplistically.",
    tip:"从句子能看出作者<b>理解了推理链</b>，而不是抄了结论。" },
  { id:"r3", name:"Row 3 · Evaluate Sources and Evidence", max:6,
    high:"demonstrates evaluation of credibility of the sources and selection of relevant evidence from the sources.",
    low:"identifies evidence but makes simplistic, illogical, or no reference to credibility and relevance.",
    tip:"每条关键来源都要有「谁 / 资质 / 利益倾向 / 这份证据只能支撑到哪」。" },
  { id:"r4", name:"Row 4 · Understand and Analyze Perspective", max:6,
    high:"discusses a range of perspectives and draws explicit and relevant connections among those perspectives.",
    low:"few and/or oversimplified perspectives.",
    tip:"perspective 的定义是 <i>a point of view conveyed through an argument</i>：四个子话题不算四个视角。" },
  { id:"r5", name:"Row 5 · Apply Conventions (attribution & citation)", max:3,
    high:"attributes and accurately cites the sources used. The bibliography accurately references sources using a consistent style.",
    low:"many errors in attribution/citation, or inconsistent and incomplete bibliography.",
    tip:"APA 全篇一致；in-text 与 References 一一对应。规则查 Purdue OWL，条目可用 Scribbr 生成后人工核对。" },
  { id:"r6", name:"Row 6 · Apply Conventions (grammar & style)", max:3,
    high:"communicates clearly to the reader (may not be free of errors); written style consistently appropriate for an academic audience.",
    low:"many flaws in grammar that often interfere with communication; style not appropriate.",
    tip:"不要求零错误，要求<b>不挡读</b>且语气统一。" }
];

const DEFENSE = [
  { q:"RQ 写的是 amplify（放大），但引用的 Liu et al. (2025) 显示是双向的。为什么不改？",
    a:"直接回答是否已改；若保留，必须把 amplify 限定到「内容曝光强度」这一维度，并说明双向不等于对称（社媒→不满意更强）。<b>不要答「但我认为社交媒体影响更大」。</b>" },
  { q:"样本里男生比女生多，凭什么说这是「女生的问题」？",
    a:"承认性别差异不显著（Δχ²(4)=5.58, p=.23，作者声明为探索性）→ 区分「关联强度相同」与「基线水平不同」→ 说明该区分会改变方案设计（全校 vs 女生小组）。" },
  { q:"学校媒介素养课的效应量有多大？值得占课时吗？",
    a:"给出具体效应量 → 承认偏小 → 论证「唯一可控 + 低成本 + 不伤害」的杠杆价值，且与平台治理互补而非替代。" },
  { q:"怎么排除家庭条件（SES）的影响？",
    a:"承认真实缺口（该研究只控制年龄与 BMI）→ 说明这反而使「学校是可控变量」成为切入理由 → 指出需要多校分层样本才能排除。" },
  { q:"四个 perspective 里哪两个真正冲突？冲突在哪一行？",
    a:"必须指到一句具体的价值排序（如保护优先 vs 自主与表达自由优先），不能答「他们看法不同」。" },
  { q:"如果平台已自行治理内容，团队方案还有必要吗？",
    a:"用治理执行数据回应；指出平台激励结构与公共健康目标不一致，属市场失灵论点。" },
  { q:"历史视角与「最近五年」如何统一？",
    a:"说明历史视角回答的是「这套审美从何而来」，是解释项不是时间范围；或承认并改写 RQ。" },
  { q:"这段证据是相关还是因果？",
    a:"区分横断相关、纵向交叉滞后、实验；说明据此支撑的是哪一档强度的主张。" },
  { q:"若有人用同样证据得出「应禁止中学生使用短视频」，如何回应？",
    a:"给出「单纯时长禁令抓错变量」的论证：研究测的是强度，可变的是内容与批判能力。" },
  { q:"团队方案里最贵的一条是什么？谁付这个成本？",
    a:"说清课时、师资培训、公平性（资源弱的学校如何）→ 给出分阶段落地路径。" }
];

function buildStatic(){
  $("#lensCards").innerHTML = LENSES.map((l,i) => `
    <div class="card">
      <div class="spread"><h3 style="margin:0">${l.key}</h3><button class="mini" data-copy="kw${i}">复制检索块</button></div>
      <div class="copy" style="margin-top:10px"><pre id="kw${i}">${esc(l.block)}</pre></div>
      <p class="small" style="margin:8px 0 2px"><b>中文对照：</b>${l.cn}</p>
      <p class="small" style="margin:2px 0"><b>这个 lens 该回答：</b>${l.focus}</p>
      <div class="warnbox" style="margin:10px 0 0">${l.warn}</div>
    </div>`).join("");

  $("#rqChecks").innerHTML = RQ_CHECKS.map((t,i) =>
    `<label class="chk"><input type="checkbox" data-rqcheck="${i}"><span>${t}</span></label>`).join("");

  $("#rubricRows").innerHTML = RUBRIC.map(r => `
    <div class="card">
      <div class="spread"><h3 style="margin:0">${r.name}</h3><span class="pill">${r.max} 分</span></div>
      <p class="small" style="margin:8px 0 4px"><b class="tag ok">High</b>${r.high}</p>
      <p class="small" style="margin:0 0 6px"><b class="tag bad">Low</b>${r.low}</p>
      <p class="small" style="margin:0"><b>自查：</b>${r.tip}</p>
      <div class="row" style="margin-top:10px">
        <select data-rubric="${r.id}">${scoreOptions(r.max).map(o => `<option value="${o.v}">${o.label}</option>`).join("")}</select>
      </div>
    </div>`).join("");

  $("#defenseQs").innerHTML = DEFENSE.map((d,i) => `
    <div class="card"><h3 style="margin-top:0">Q${i+1} · ${d.q}</h3>
      <p class="small" style="margin-bottom:0"><b>答题骨架：</b>${d.a}</p></div>`).join("");
}
function scoreOptions(max){
  const o = [{v:0,label:"0 · 未写 / 完全没做到"}];
  if (max === 6) { o.push({v:2,label:"2 · Low：宽泛或简单化，几乎没做到"}); o.push({v:4,label:"4 · Medium：做了但不一致"}); o.push({v:6,label:"6 · High：稳定做到"}); }
  else { o.push({v:1,label:"1 · Low：错误多到影响阅读"}); o.push({v:2,label:"2 · Medium：大体清楚但有干扰"}); o.push({v:3,label:"3 · High：清楚且语气统一"}); }
  return o;
}

/* ---------------- 渲染 ---------------- */
function renderAll(){
  renderWho(); renderTeamInputs(); renderMembers(); renderSources(); renderFx();
  renderRubric(); renderRq(); renderWordBudget(); buildTimeline(); renderProgress();
}

function renderWho(){
  const on = !!state.me;
  $("#whoEmpty").classList.toggle("hidden", on);
  $("#whoIn").classList.toggle("hidden", !on);
  if (on) $("#whoName").textContent = state.me.name;
}

function renderTeamInputs(){
  if (document.activeElement !== $("#topicInput")) $("#topicInput").value = state.team.topic || "";
  if (document.activeElement !== $("#deadlineInput")) $("#deadlineInput").value = state.team.deadline || "";
  if (document.activeElement !== $("#rqText")) $("#rqText").value = state.team.rq || "";
  $("#topicInput").placeholder = "例：Social media, beauty standards and adolescent body image in China";
  const dis = !state.me;
  ["#topicInput","#deadlineInput","#saveTeam","#mLens","#mCount","#mRq","#mStage","#saveMember",
   "#sAuth","#sYear","#sTitle","#sCred","#saveSrc","#saveFx","#fxSrc","#fxTarget","#fxWhat"].forEach(sel => {
    const el = $(sel); if (el) el.disabled = dis;
  });
  $$("input[type=checkbox][data-p]").forEach(c => c.disabled = dis);
}

function renderMembers(){
  const ms = state.members.slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
  $("#statMembers").textContent = ms.length;
  $("#statLens").textContent = new Set(ms.map(m=>m.lens).filter(Boolean)).size;
  $("#statSrc").textContent = state.sources.length;

  if (!ms.length){
    $("#memberTable").innerHTML = `<div class="small">还没有人登记。左侧输入名字进入后，在上方认领 lens 即会出现在这里。</div>`;
  } else {
    $("#memberTable").innerHTML = `<table><thead><tr><th>成员</th><th>Lens</th><th>Perspective</th><th>进度</th><th>RQ 草稿</th><th>更新</th><th></th></tr></thead><tbody>
      ${ms.map(m => `<tr>
        <td><b>${esc(m.name)}</b>${state.me && m.name === state.me.name ? ' <span class="tag ok">我</span>' : ''}</td>
        <td>${m.lens ? `<span class="tag acc">${esc(m.lens)}</span>` : '<span class="small">未认领</span>'}</td>
        <td>${esc(m.count||"—")}</td>
        <td><span class="tag ${m.stage && m.stage[0]==="5" ? "ok":""}">${esc(m.stage||"—")}</span></td>
        <td class="small">${esc((m.rq||"").slice(0,70))}${(m.rq||"").length>70?"…":""}</td>
        <td class="small">${m.updated ? new Date(m.updated).toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}) : "—"}</td>
        <td>${state.me && m.name === state.me.name ? `<button class="mini ghost" data-delmember="${m.id}">移除</button>` : ""}</td>
      </tr>`).join("")}</tbody></table>`;
    $$("[data-delmember]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("移除本人这条登记？")) return;
      await delMember(b.dataset.delmember); toast("已移除");
    }));
  }

  const counts = {};
  ms.forEach(m => { if (m.lens) counts[m.lens] = (counts[m.lens]||0)+1; });
  const max = Math.max(1, ...Object.values(counts));
  $("#lensBars").innerHTML = Object.keys(counts).length
    ? Object.entries(counts).map(([k,v]) => `<div class="hbar"><span class="small">${esc(k)}</span><span class="bar"><i style="width:${v/max*100}%"></i></span><span class="small">${v} 人</span></div>`).join("")
      + (Object.values(counts).some(v=>v>1) ? `<div class="badbox" style="margin-top:10px">重复认领：${Object.entries(counts).filter(([,v])=>v>1).map(([k,v])=>k+" ("+v+")").join("、")}</div>` : "")
    : "";
}

function renderSources(){
  $("#srcTotal").textContent = state.sources.length;
  if (!state.sources.length){
    $("#srcTable").innerHTML = `<div class="small">空。目标：全组 ≥16 条、每人 ≥4 条，其中 ≥1 条同行评议实证研究。同一条来源重复登记会被拦下。</div>`;
  } else {
    $("#srcTable").innerHTML = `<table><thead><tr><th>来源</th><th>Lens</th><th>类型</th><th>等级</th><th>用途</th><th>登记人</th><th></th></tr></thead><tbody>
      ${state.sources.slice().reverse().map(s => `<tr>
        <td><b>${esc(s.auth||"")}</b> ${esc(s.year||"")} · <span class="small">${esc((s.title||"").slice(0,78))}</span>
          ${s.cred ? `<div class="small" style="color:var(--dim2)">${esc(s.cred.slice(0,130))}${s.cred.length>130?"…":""}</div>` : ""}</td>
        <td><span class="tag acc">${esc(s.lens||"")}</span></td>
        <td class="small">${esc(s.type||"")}</td>
        <td class="small">${esc(s.grade||"")}</td>
        <td class="small">${esc(s.use||"")}</td>
        <td class="small">${esc(s.by||"")}</td>
        <td>${state.me && s.by === state.me.name ? `<button class="mini ghost" data-delsrc="${s.id}">删</button>` : ""}</td>
      </tr>`).join("")}</tbody></table>`;
    $$("[data-delsrc]").forEach(b => b.addEventListener("click", async () => { await delSource(b.dataset.delsrc); toast("已删除"); }));
  }
  const byLens = {};
  state.sources.forEach(s => { const k = s.lens || "未标"; byLens[k] = (byLens[k]||0)+1; });
  const max = Math.max(1, ...Object.values(byLens));
  $("#srcBars").innerHTML = Object.entries(byLens).map(([k,v]) =>
    `<div class="hbar"><span class="small">${esc(k)}</span><span class="bar"><i style="width:${v/max*100}%"></i></span><span class="small">${v}</span></div>`).join("");
}

function renderFx(){
  if (!state.fx.length){ $("#fxList").innerHTML = `<div class="small">还没有记录。目标：≥2 条，且每条都导致 RQ 或论点的修改。</div>`; return; }
  $("#fxList").innerHTML = `<table><thead><tr><th>反证来源</th><th>反驳哪一句</th><th>结论</th><th>处理方式</th><th>记录人</th></tr></thead><tbody>
    ${state.fx.slice().reverse().map(f => `<tr>
      <td class="small"><b>${esc(f.src||"—")}</b></td><td class="small">${esc(f.target||"")}</td>
      <td class="small">${esc(f.what||"")}</td><td><span class="tag warn">${esc(f.how||"")}</span></td>
      <td class="small">${esc(f.by||"")}</td></tr>`).join("")}</tbody></table>`;
}

function renderRq(){
  const score = $$("[data-rqcheck]").filter(b => b.checked).length;
  $("#rqScore").textContent = score + " / 8";
  $("#rqBar").style.width = (score/8*100) + "%";
  const v = $("#rqVerdict"); v.style.display = "block";
  if (score <= 3) v.innerHTML = `<b class="tag bad">未锁定</b>此 RQ 大概率把 Row 1 压在 Low。先补人群边界与结果变量，别开始写正文。`;
  else if (score <= 6) v.innerHTML = `<b class="tag warn">半开</b>骨架有了，但还缺让评委看出「为什么值得研究」的那一项，Row 1 大概停在 Medium。`;
  else v.innerHTML = `<b class="tag ok">可锁定</b>八项全过。交给全员确认：每人的 RQ 都还能被别人 lens 反驳。`;
}

function renderWordBudget(){
  const p = Math.max(2, Math.min(6, Number($("#wbP").value)||4));
  const intro = Number($("#wbIntro").value)||0, syn = Number($("#wbSyn").value)||0;
  const counter = Number($("#wbCounter").value)||0, concl = Number($("#wbConcl").value)||0;
  const max = Number($("#wbMax").value)||1200;
  const fixed = intro + syn + counter + concl;
  const per = Math.floor((max - fixed)/p);
  $("#wbOut").innerHTML = `
    <div class="grid3">
      <div class="card tight center"><div class="scorebig" style="font-size:26px">${per}</div><div class="small">每个视角段字数</div></div>
      <div class="card tight center"><div class="scorebig" style="font-size:26px">${fixed + per*p}</div><div class="small">合计 / 上限 ${max}</div></div>
      <div class="card tight center"><div class="scorebig" style="font-size:26px">${Math.round(fixed/max*100)}%</div><div class="small">固定段落占比</div></div>
    </div>
    ${per < 120 ? `<div class="badbox">每个视角只有 ${per} 词，写不下「证据 + commentary」。要么减视角数，要么压固定段。</div>`
                : `<div class="okbox">每段 ${per} 词 ≈ 1 条证据（35 词）+ 2 句 commentary（70 词）+ 1 句过渡（20 词）。按此配额写，第三个视角不会崩。</div>`}`;
}

function renderRubric(){
  const mine = (state.me && state.me.rubric) || {};
  let total = 0, max = 0;
  RUBRIC.forEach(r => {
    const sel = document.querySelector(`[data-rubric="${r.id}"]`);
    if (!sel) return;
    if (mine[r.id] != null) sel.value = String(mine[r.id]);
    sel.disabled = !state.me;
    total += Number(sel.value)||0; max += r.max;
  });
  $("#rubricTotal").textContent = total + " / " + max;
  $("#rubricBar").style.width = (total/max*100) + "%";
  $("#rubricBand").textContent = total >= 26 ? "High band：论证层稳，只剩语言细节"
    : total >= 21 ? "Medium-High：通常卡在 Row 4（视角连接）或 Row 3（可信度评价）"
    : total >= 16 ? "Medium：论证结构有缺口，先补推理链，别润色"
    : "Low–Medium：先修 RQ 与视角，句子再漂亮也救不回来";
}

function renderProgress(){
  const prog = (state.me && state.me.progress) || {};
  const all = $$("input[type=checkbox][data-p]");
  all.forEach(c => {
    c.checked = !!prog[c.dataset.p];
    const sp = c.parentElement.querySelector("span");
    if (sp) sp.classList.toggle("done", c.checked);
  });
  const done = all.filter(c => c.checked).length;
  const pct = all.length ? done/all.length : 0;
  $("#globalBar").style.width = (pct*100).toFixed(0) + "%";
  $("#globalTxt").textContent = state.me
    ? `${state.me.name}：已完成 ${done} / ${all.length} 项（${(pct*100).toFixed(0)}%）`
    : "输入名字进入后可保存个人进度";
}

/* ---------------- 时间线 ---------------- */
const STAGES = [
  { d:-56, t:"Stage 0 · 团队粒度", s:"全组只对「现象/政策/做法」达成一致，不写论点。产出：一句话话题 + lens 认领完成。" },
  { d:-49, t:"Step 1 · 侦察检索（2–3 小时）", s:"只读 Abstract / Conclusion / Limitations / Practical Implications；过 G1 有实证、G2 有四方、G3 是价值冲突。" },
  { d:-42, t:"Step 2 · RQ 收窄并锁定", s:"八项体检全过；全员 RQ 共用同一结果变量。冻结 RQ，之后仅因反证修改。" },
  { d:-35, t:"Step 3 · 反证扫描 → 改 RQ", s:"方向反证、人群反证、干预反证各至少 1 条，并写出改法。" },
  { d:-28, t:"Step 4 · 来源池闭池", s:"全组 ≥16 条、每人 ≥4 条，含 ≥1 篇同行评议实证 + ≥1 篇系统综述/meta；每条都有可信度三句。" },
  { d:-21, t:"Step 5 · IRR Draft 1", s:"只写证据与推理，句子丑没关系；按字数配额写，不边写边润色。" },
  { d:-14, t:"Step 5 · IRR Draft 2", s:"补归属、可信度框架、过渡句；加入综合段与反证段。格式按 Purdue OWL 统一。" },
  { d:-7, t:"Step 5 · IRR Draft 3 + 自评", s:"按当年度评分细则逐行打分，目标 ≥24/30；只改扣分的行。" },
  { d:-3, t:"Step 6 · TMP 设计与首排", s:"八页骨架 + 时间配比；R1 结构轮彩排（不掐表）。" },
  { d:-1, t:"Step 6 · TMP 录像 + Step 7 答辩自测", s:"时长锁在 8–10 min；每人完成 10 题自测；核对引用页。" },
  { d:0, t:"D-day · 提交", s:"IRR 定稿 + TMP 录像 + 答辩准备；导出全组 JSON 存档。" }
];
function buildTimeline(){
  const dl = state.team.deadline ? new Date(state.team.deadline + "T23:59:00") : null;
  const today = new Date(); today.setHours(0,0,0,0);
  $("#timeline").innerHTML = STAGES.map(st => {
    let dateTxt = "D" + st.d, badge = "";
    if (dl) {
      const d = new Date(dl.getTime() + st.d*86400000);
      dateTxt = d.toLocaleDateString("zh-CN", { month:"2-digit", day:"2-digit" });
      const left = Math.round((d - today)/86400000);
      badge = left < 0 ? `<span class="tag bad">已过 ${-left} 天</span>`
            : left <= 3 ? `<span class="tag warn">还剩 ${left} 天</span>` : `<span class="tag">还剩 ${left} 天</span>`;
    }
    return `<li><span class="t">${dateTxt}</span> ${badge}<b>${st.t}</b><span class="small">${st.s}</span></li>`;
  }).join("");
}

window.addEventListener("DOMContentLoaded", boot);
})();
