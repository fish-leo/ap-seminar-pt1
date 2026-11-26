/* AP Seminar PT1 工作台 — 前端 */
(() => {
"use strict";
const TOK = "apsem_token_v3";
let state = { team:{topic:"",deadline:"",rq:""}, members:[], sources:[], fx:[], deliverables:[], me:null };
let token = localStorage.getItem(TOK) || "";
let cloud = true, aiReady = false, aiModel = "";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const uid = p => p + "_" + Math.random().toString(36).slice(2, 9);
const fmt = t => t ? new Date(t).toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";

let tt;
function toast(m){ const el = $("#toast"); el.textContent = m; el.classList.add("on"); clearTimeout(tt); tt = setTimeout(()=>el.classList.remove("on"), 2200); }

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
async function refresh(){
  if (!cloud) return;
  try { const r = await req("/api/state"); state = Object.assign(state, r.state); state.me = r.me || null; renderAll(); } catch(e){}
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
  if (cloud) { const r = await req("/api/team", { method:"POST", body:p }); state = Object.assign(state, r.state); state.me = r.me; }
  else Object.assign(state.team, p);
  localSave(); renderAll();
}
async function claim(p){
  if (!isMe()) return mustLogin();
  try {
    const r = await req("/api/member", { method:"POST", body:p });
    state = Object.assign(state, r.state); state.me = r.me; localSave(); renderAll(); return true;
  } catch(e){
    toast(e.status === 409 && e.data.holder ? "该 lens 已被 " + e.data.holder + " 认领" : (e.message || "失败"));
    return false;
  }
}
async function addSource(p){
  if (!isMe()) return mustLogin();
  try { const r = await req("/api/source", { method:"POST", body:p }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); return true; }
  catch(e){ toast(e.status === 409 ? "已存在（由 " + (e.data.dupe || "他人") + " 登记）" : (e.message || "失败")); return false; }
}
async function addFx(p){
  if (!isMe()) return mustLogin();
  const r = await req("/api/fx", { method:"POST", body:p }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); return true;
}
async function delSource(id){ const r = await req("/api/source?id=" + encodeURIComponent(id), { method:"DELETE" }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); }
async function delMember(id){ const r = await req("/api/member?id=" + encodeURIComponent(id), { method:"DELETE" }); state = Object.assign(state, r.state); state.me = r.me; renderAll(); }
async function saveMine(){
  if (!isMe()) return;
  if (cloud) { try { const r = await req("/api/save", { method:"POST", body:{ progress: state.me.progress || {}, rubric: state.me.rubric || {} } }); state.me = r.me; } catch(e){} }
  localSave();
}
async function upload(step){
  if (!isMe()) return mustLogin();
  if (!cloud) return toast("离线模式不能上传，先登录云端");
  const inp = $("#file-" + step);
  const f = inp.files && inp.files[0];
  if (!f) return toast("先选文件（点击上面的虚线框）");
  const fd = new FormData();
  fd.append("file", f);
  fd.append("step", step);
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
  if (!aiReady) {
    out.className = "ai-out warn";
    out.textContent = "AI 未配置：在 Netlify → Project configuration → Environment variables 添加 AI_API_KEY（可选 AI_MODEL、AI_BASE_URL），然后重新部署。配置前该按钮不消耗任何 token。";
    return;
  }
  const btn = $("#check-" + step); btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>核查中';
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

/* ---------- static content ---------- */
const LENSES = [
  { k:"Education 教育", b:`AND ("media literacy" OR "school-based program" OR curriculum OR "health education"\n     OR "teacher training" OR "school policy" OR "prevention program")`,
    f:"学校能做什么、做到哪一步。证据是干预研究与课程评估。",
    w:"干预研究效应量普遍偏小（d≈0.08–0.20）。找到小效应并论证为何仍值得做，才是高分写法。" },
  { k:"Technology 技术", b:`AND ("recommendation algorithm" OR "beauty filter" OR "facial retouching"\n     OR "photo editing app" OR "platform design" OR "content moderation" OR "influencer marketing")`,
    f:"平台机制是放大器还是镜子；治理责任在谁。",
    w:"多数论文写的是「曝光到修图内容」，不是「算法做了什么」。把前者当后者用，Row 2 会掉分。" },
  { k:"History 历史", b:`AND ("history of beauty" OR "beauty ideals" OR "body ideals" OR "foot binding"\n     OR "cosmetic surgery" OR "advertising history" OR "media history")`,
    f:"当下这套审美如何形成；社媒是延续还是断裂。",
    w:"必须自改问成「当下审美在多大程度上是更早身体观的延续」，否则写的不是同一话题；可信度标准换成一手史料。" },
  { k:"Psychology 心理", b:`AND ("body dysmorphia" OR "body dysmorphic disorder" OR "social comparison"\n     OR "thin-ideal internalization" OR "objectification" OR "appearance anxiety")`,
    f:"机制层：从「看到」到「内化」；临床阈值与亚临床的分界。",
    w:"最容易与「问题存在」重复。先回答：这个主张和引言那句有什么不同？答不出就换视角。" },
  { k:"Law 法律 / 政策", b:`AND ("regulation" OR "platform liability" OR "advertising law" OR "minor protection"\n     OR "consumer protection" OR "content governance" OR "self-regulation")`,
    f:"谁有法定责任、执行缺口在哪。",
    w:"不要只列法条。必须写：条款说了什么 → 为什么没执行 → 缺口在标准、罚则还是监管主体。" }
];
const RQ_CHECKS = [
  "有可测量的<b>结果变量</b>（具体指标，不是「影响」）",
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
  { d:-42, t:"RQ 锁定", s:"八项体检全过；全员共用同一结果变量。" },
  { d:-35, t:"反证扫描", s:"方向 / 人群 / 干预三类反证各≥1 条并改 RQ。" },
  { d:-28, t:"来源池闭池", s:"全组 ≥16 条，每人 ≥4 条，含 1 篇综述。" },
  { d:-21, t:"IRR Draft 1", s:"只写证据与推理，按字数配额。" },
  { d:-14, t:"IRR Draft 2", s:"补归属、可信度框架、过渡句；OWL 统一格式。" },
  { d:-7, t:"IRR Draft 3", s:"按细则自评，目标 ≥24/30。" },
  { d:-3, t:"TMP 首排", s:"八页骨架 + 时间配比，结构轮彩排。" },
  { d:-1, t:"录像 + 答辩自测", s:"锁时长 8–10 min；每人 10 题自测。" },
  { d:0, t:"提交", s:"IRR 定稿 + TMP 录像 + 答辩准备。" }
];
const STEP_ORDER = ["team","recon","rq","falsify","source","irr","tmp","defense"];

function buildStatic(){
  $("#lensCards").innerHTML = LENSES.map((l,i)=>`
    <div class="lens">
      <header><b>${l.k}</b><button class="mini" data-copy="kw${i}">复制</button></header>
      <pre id="kw${i}">${esc(l.b)}</pre>
      <p class="hint" style="margin-top:6px">${l.f}</p>
      <div class="warn">${l.w}</div>
    </div>`).join("");

  $("#rqChecks").innerHTML = RQ_CHECKS.map((t,i)=>`<label class="chk"><input type="checkbox" data-rqcheck="${i}"><span>${t}</span></label>`).join("");

  $("#rqFixes").innerHTML = RQ_FIXES.map(f=>`
    <div class="q"><b>${f.t}</b><span>${f.e}</span><div class="hint">改法：${f.f}</div></div>`).join("");

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
  <textarea id="text-${step}" placeholder="把这一小步的核心内容贴进来：RQ + 证据句、或某段 claim + commentary"></textarea>
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
    await saveTeam({ topic: $("#topicInput").value.trim(), deadline: $("#deadlineInput").value, rq: state.team.rq || "" });
    $("#teamSaved").textContent = "已保存"; renderTimeline(); toast("已保存");
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
  $("#saveSrc").addEventListener("click", async ()=>{
    const title = $("#sTitle").value.trim(); if (!title) return toast("填标题");
    const p = { auth:$("#sAuth").value.trim(), year:$("#sYear").value.trim(), lens:$("#sLens").value, title,
      type:$("#sType").value, grade:$("#sGrade").value, use:$("#sUse").value, cred:$("#sCred").value.trim() };
    if (await addSource(p)) { ["sAuth","sYear","sTitle","sCred"].forEach(k=>$("#"+k).value=""); $("#srcHint").textContent="已登记"; toast("已登记"); }
  });
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
  ["wbP","wbIntro","wbSyn","wbCounter","wbConcl","wbMax"].forEach(id=>$("#"+id).addEventListener("input", renderWordBudget));

  STEP_ORDER.forEach(step=>{
    const drop = $("#drop-" + step), file = $("#file-" + step);
    if (!drop) return;
    drop.addEventListener("click", ()=>file.click());
    drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("hot"); });
    drop.addEventListener("dragleave", ()=>drop.classList.remove("hot"));
    drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove("hot"); if (e.dataTransfer.files[0]) { file.files = e.dataTransfer.files; drop.innerHTML = "<b>" + esc(e.dataTransfer.files[0].name) + "</b><br>已选择，点下方「上传文件」"; } });
    file.addEventListener("change", ()=>{ if (file.files[0]) drop.innerHTML = "<b>" + esc(file.files[0].name) + "</b><br>已选择，点下方「上传文件」"; });
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
  renderWho(); renderDash(); renderInputs(); renderMembers(); renderSources(); renderFx();
  renderRubric(); renderRq(); renderWordBudget(); renderTimeline();
  STEP_ORDER.forEach(renderFiles);
  renderProgress();
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
   "#sAuth","#sYear","#sTitle","#sCred","#saveSrc","#saveFx","#fxSrc","#fxTarget","#fxWhat"].forEach(s=>{ const el = $(s); if (el) el.disabled = dis; });
  $$("input[type=checkbox][data-p]").forEach(c=>c.disabled = dis);
  if (state.me && state.me.lens) { $("#mLens").value = state.me.lens; $("#mCount").value = state.me.count || "4"; $("#mStage").value = state.me.stage || "0 · 还没开始"; if (document.activeElement !== $("#mRq")) $("#mRq").value = state.me.rq || ""; }
}
function renderDash(){
  $("#tMembers").textContent = state.members.length;
  $("#tLens").textContent = new Set(state.members.map(m=>m.lens).filter(Boolean)).size;
  $("#tSrc").textContent = state.sources.length;
  $("#tFiles").textContent = state.deliverables.length;

  const prog = (state.me && state.me.progress) || {};
  const next = STEP_ORDER.find(s => !Object.keys(prog).some(k => k.startsWith(s) && prog[k])) || "defense";
  const names = { team:"分工 · Lens", recon:"侦察检索", rq:"RQ 收窄", falsify:"反证扫描", source:"来源池", irr:"IRR 撰写", tmp:"TMP 演示", defense:"口头答辩" };
  $("#nextStep").innerHTML = state.me
    ? `下一步：<b>${names[next]}</b> · <a href="#${next}">去这一页</a>`
    : "<b>先输入名字进入</b>，再按左侧步骤推进。";

  // 时间线
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
function renderSources(){
  $("#srcTotal").textContent = state.sources.length;
  $("#srcTable").innerHTML = state.sources.length ? `<table><tbody>
    ${state.sources.slice().reverse().map(s=>`<tr><td><b>${esc(s.auth||"")}</b> ${esc(s.year||"")}
      <div class="small">${esc((s.title||"").slice(0,72))}</div>
      ${s.cred ? `<div class="small" style="color:var(--dim2)">${esc(s.cred.slice(0,110))}</div>` : ""}</td>
      <td class="small">${esc(s.lens||"")}<br>${esc(s.grade||"")}</td>
      <td class="small">${esc(s.by||"")}${state.me && s.by===state.me.name ? `<br><button class="mini ghost" data-delsrc="${s.id}">删</button>` : ""}</td></tr>`).join("")}
    </tbody></table>` : `<p class="hint">空。目标全组 ≥16 条。</p>`;
  $$("[data-delsrc]").forEach(b=>b.addEventListener("click", async ()=>{ await delSource(b.dataset.delsrc); toast("已删除"); }));

  const c = {}; state.sources.forEach(s=>{ c[s.lens||"未标"] = (c[s.lens||"未标"]||0)+1; });
  const max = Math.max(1, ...Object.values(c));
  $("#srcBars").innerHTML = Object.entries(c).map(([k,v])=>`<div class="hbar"><span>${esc(k)}</span><span class="bar"><i style="width:${v/max*100}%"></i></span><span>${v}</span></div>`).join("");
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
