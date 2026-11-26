/**
 * Netlify Function: /api/*
 * 存储：Netlify Blobs，单键 state + files/<id> 附件
 * 并发安全：读（ETag）→ 改 → 条件写 onlyIfMatch，冲突自动重试，避免两个成员同时提交时互相覆盖
 * AI 核查：AI_API_KEY / AI_BASE_URL / AI_MODEL（未配置时返回 needsSetup）
 */
import { getBlobStore } from "../lib/store.mjs";

const H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const MAX_FILE = 3.5 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "doc", "docx", "txt", "md", "png", "jpg", "jpeg", "webp"];

const blank = () => ({ team: { topic: "", deadline: "", rq: "" }, members: [], sources: [], fx: [], deliverables: [] });
const normName = r => String(r == null ? "" : r).normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 40);
const slugOf = n => normName(n).toLowerCase().replace(/\s+/g, "");
const srcKey = (t, y) => String(t || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 160) + "|" + String(y || "").replace(/\D/g, "").slice(0, 4);

const SEED = {
  team: {
    topic: "Social media, beauty standards and adolescent body image in China (recent five years)",
    deadline: "",
    rq: "To what extent does the spread of social media amplify harmful beauty standards and body dysmorphia among adolescent girls in China in the recent five years?"
  },
  sources: [{
    id: "seed_liu2025", auth: "Liu et al.", year: "2025", lens: "Psychology",
    title: "What was causing what? Adolescents' social networking site use and body dissatisfaction",
    type: "同行评议实证研究", grade: "强 · 直接支撑", use: "引言 / 背景",
    cred: "Social Behavior and Personality, 53(6)；两波交叉滞后（间隔 8 个月）；605 名中国青少年（辽宁+江苏，整班抽样，平均 16.9 岁，男 56.4%）。仅控制年龄与 BMI，未控 SES，性别比较为探索性（Δχ²(4)=5.58, p=.23）。支撑「关联真实且双向」，不支撑「女生专属」或「干预有效」。",
    by: "初始资料", updated: 0
  }],
  fx: [{
    id: "seed_fx1", src: "Liu et al. (2025)",
    target: "amplify（单向）与 adolescent girls（女生专属）",
    what: "双向交叉滞后均显著；性别差异不显著，样本 56.4% 为男生。",
    how: "改 RQ", by: "初始资料", updated: 0
  }],
  deliverables: []
};

const envGet = k => (typeof Netlify !== "undefined" && Netlify.env ? Netlify.env.get(k) : process.env[k]);

class StorageError extends Error {
  constructor(msg) { super(msg); this.storage = true; }
}

async function readCurrent(store) {
  let r;
  try {
    r = await store.getWithMetadata("state", { type: "json" });
  } catch (e) {
    // 读失败绝不能回退成种子（否则会把整份真实数据覆盖掉）
    throw new StorageError("存储读取失败：" + (e && e.message ? e.message : e));
  }
  const val = r && (r.data !== undefined ? r.data : r.value);
  if (val) return { state: Object.assign(blank(), val), etag: (r && r.etag) || null, fresh: false };
  const seeded = Object.assign(blank(), JSON.parse(JSON.stringify(SEED)));
  try { await store.setJSON("state", seeded, { onlyIfNew: true }); } catch (e) { /* 别处已创建，忽略 */ }
  return { state: seeded, etag: null, fresh: true };
}

const pub = m => ({ id: m.id, name: m.name, lens: m.lens, count: m.count, rq: m.rq, stage: m.stage, updated: m.updated });
const meView = m => ({ ...pub(m), progress: m.progress || {}, rubric: m.rubric || {} });

function snapshot(state, viewer) {
  return {
    state: {
      team: state.team,
      members: state.members.map(pub),
      sources: state.sources,
      fx: state.fx,
      deliverables: (state.deliverables || []).map(d => ({ ...d }))
    },
    me: viewer ? meView(viewer) : null
  };
}

/* ---------------- AI 核查 ---------------- */
const STEP_LABEL = {
  recon: "Step 1 侦察检索（门槛判定与候选文献清单）",
  rq: "Step 2 研究问题（RQ）定稿",
  falsify: "Step 3 反证扫描",
  source: "Step 4 来源登记与可信度评价",
  irr: "Step 5 IRR 正文段落",
  tmp: "Step 6 团队演示论证骨架",
  defense: "Step 7 口头答辩准备",
  team: "Step 0 团队话题与分工"
};

const SYSTEM = [
  "你是 AP Seminar 学科导师，只核查学生提交的这一小步，不评价整篇论文。",
  "硬规则：不夸奖；不替学生写正文；不建议换话题；每条批评必须落在具体那一句或那个缺失的数字上。",
  "直接从 1) 开始输出，不要任何开场白或总结收尾，总长 ≤260 字，中文表达、学术术语保留 English：",
  "1) 事实核查：≤3 条，写出缺的具体数字/样本/效应量/来源归属；若全是观点无证据，直说「无证据支撑」。",
  "2) 逻辑漏洞：≤2 条，指出推理断在哪一步（相关当因果、样本代表性、定义不可操作）。",
  "3) 追问：2 个问题，不给答案，必须迫使学生回去查数据或重新界定概念。",
  "4) 改写示范：只重写一句，必须改实质内容（变量、边界、动词），禁止同义词替换式「改写」。",
  "若内容与该步骤无关或过于空泛，只输出一句「无法核查：需要补 __」，然后跳到 3) 的两个追问。"
].join("\n");

async function aiCheck(text, step) {
  const key = envGet("AI_API_KEY") || envGet("OPENAI_API_KEY");
  const base = (envGet("AI_BASE_URL") || envGet("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = envGet("AI_MODEL") || "gpt-4o-mini";
  if (!key) return { ok: false, needsSetup: true, error: "服务端未配置 AI_API_KEY（Netlify → Environment variables 添加后重新部署即可）" };
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({
      model, temperature: 0.3, max_tokens: 520,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `步骤：${STEP_LABEL[step] || step}\n\n提交内容：\n"""\n${text.slice(0, 3000)}\n"""` }
      ]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data.error && data.error.message) || ("AI 接口 " + res.status) };
  const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) return { ok: false, error: "AI 返回为空" };
  return { ok: true, model, analysis: out.trim() };
}

/* ---------------- 主入口 ---------------- */
async function handleApi(request) {
  const url = new URL(request.url);
  const i = url.pathname.indexOf("/api/");
  const path = i >= 0 ? url.pathname.slice(i) : "/api/state";
  const method = request.method;
  const ct = request.headers.get("content-type") || "";
  const token = request.headers.get("x-token") || "";
  const { store, kind } = await getBlobStore();
  const memory = kind !== "blobs";

  // 请求体只读一次
  let body = {}, form = null, uploadFile = null;
  if (method === "POST" || method === "DELETE") {
    if (ct.includes("multipart/form-data")) {
      form = await request.formData();
      uploadFile = form.get("file");
    } else if (ct.includes("application/json")) {
      const raw = await request.text();
      if (raw.length > 400000) return json({ ok: false, error: "内容过大" }, 413);
      try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "格式错误" }, 400); }
    }
  }

  // 上传的文件先落盘一次（唯一键，不参与 CAS）
  let uploaded = null;
  if (path === "/api/upload" && uploadFile && typeof uploadFile !== "string") {
    const ext = (uploadFile.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return json({ ok: false, error: "只支持 pdf / doc / docx / txt / md / 图片" }, 415);
    if (uploadFile.size > MAX_FILE) return json({ ok: false, error: "文件超过 3.5MB，请压缩或只传截图" }, 413);
    const id = crypto.randomUUID();
    try { await store.set("files/" + id, await uploadFile.arrayBuffer()); }
    catch (e) { return json({ ok: false, error: "文件写入失败：" + (e.message || "") }, 500); }
    uploaded = {
      id, step: String(form.get("step") || "irr").slice(0, 20),
      title: String(form.get("title") || "").slice(0, 160),
      note: String(form.get("note") || "").slice(0, 600),
      filename: uploadFile.name.slice(0, 120), size: uploadFile.size,
      type: uploadFile.type || "application/octet-stream", updated: Date.now(), ai: null
    };
  }

  // AI 只调用一次（冲突重试时不重复烧 token）
  let aiCache = null;
  if (path === "/api/check" && method === "POST") {
    const text = String(body.text || "").trim();
    if (text.length < 40) return json({ ok: false, error: "内容太短（至少 40 字）才值得花 token" }, 400);
    aiCache = await aiCheck(text, String(body.step || "irr").slice(0, 20));
    if (!aiCache.ok) return json(aiCache, aiCache.needsSetup ? 501 : 502);
  }

  // 文件下载：不参与 CAS，随机 id 公开可读
  if (path === "/api/file" && method === "GET") {
    const id = url.searchParams.get("id");
    const { state } = await readCurrent(store);
    const meta = (state.deliverables || []).find(d => d.id === id);
    if (!meta) return json({ ok: false, error: "找不到文件" }, 404);
    const buf = await store.get("files/" + id, { type: "arrayBuffer" });
    if (!buf) return json({ ok: false, error: "文件已丢失" }, 404);
    return new Response(buf, {
      headers: {
        "content-type": meta.type || "application/octet-stream",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.filename || "file")}`,
        "cache-control": "private, max-age=60"
      }
    });
  }

  if (path === "/api/ai-status" && method === "GET") {
    const b = envGet("AI_BASE_URL") || envGet("OPENAI_BASE_URL") || "https://api.openai.com/v1";
    let host = b; try { host = new URL(b).host; } catch {}
    return json({
      ok: true,
      configured: !!(envGet("AI_API_KEY") || envGet("OPENAI_API_KEY")),
      baseHost: host, model: envGet("AI_MODEL") || "gpt-4o-mini"
    });
  }

  if (path === "/api/state" && method === "GET") {
    const { state } = await readCurrent(store);
    const viewer = token ? state.members.find(m => m.token === token) : null;
    return json({ ok: true, memory, ...snapshot(state, viewer) });
  }

  /* 其余接口：读 → 改 → 条件写，冲突重试 */
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag, fresh } = await readCurrent(store);
    const viewer = token ? state.members.find(m => m.token === token) : null;
    let dirty = false;
    let res = null;

    const done = (payload, status) => { res = json(payload, status); return res; };

    if (path === "/api/login" && method === "POST") {
      const name = normName(body.name), slug = slugOf(name);
      if (!slug) return done({ ok: false, error: "请输入真实姓名（不能用符号）" }, 400);
      if (!/[\p{L}\p{N}]/u.test(name)) return done({ ok: false, error: "请输入真实姓名（不能用符号）" }, 400);
      let member = state.members.find(m => m.slug === slug);
      let created = false;
      if (!member) {
        if (state.members.length >= 60) return done({ ok: false, error: "成员已达上限" }, 429);
        member = {
          id: crypto.randomUUID(), name, slug, token: crypto.randomUUID(),
          lens: "", count: "4", rq: "", stage: "0 · 还没开始",
          progress: {}, rubric: {}, createdAt: Date.now(), updated: Date.now()
        };
        state.members.push(member); dirty = true; created = true;
      }
      if (!dirty) return done({ ok: true, created, memory, token: member.token, user: meView(member), state: snapshot(state, member).state });
      res = done({ ok: true, created, memory, token: member.token, user: meView(member), state: snapshot(state, member).state });
    } else if (!viewer) {
      return done({ ok: false, error: "请先输入名字登录" }, 401);

    } else if (path === "/api/team" && method === "POST") {
      state.team = { topic: String(body.topic || "").slice(0, 300), deadline: String(body.deadline || "").slice(0, 30), rq: String(body.rq || "").slice(0, 600) };
      dirty = true; res = done({ ok: true, ...snapshot(state, viewer) });

    } else if (path === "/api/member" && method === "POST") {
      const lens = String(body.lens || "").trim().slice(0, 40);
      if (!lens) return done({ ok: false, error: "请选择 lens" }, 400);
      const holder = state.members.find(m => m.slug !== viewer.slug && m.lens === lens);
      if (holder) return done({ ok: false, error: "lens 已被认领", holder: holder.name }, 409);
      Object.assign(viewer, {
        lens, count: String(body.count || "4").slice(0, 4), rq: String(body.rq || "").slice(0, 600),
        stage: String(body.stage || "0 · 还没开始").slice(0, 30), updated: Date.now()
      });
      dirty = true; res = done({ ok: true, ...snapshot(state, viewer) });

    } else if (path === "/api/member" && method === "DELETE") {
      if (url.searchParams.get("id") !== viewer.id) return done({ ok: false, error: "只能移除自己" }, 403);
      state.members = state.members.filter(m => m.id !== viewer.id);
      dirty = true; res = done({ ok: true, ...snapshot(state, null) });

    } else if (path === "/api/source" && method === "POST") {
      const title = String(body.title || "").trim();
      if (!title) return done({ ok: false, error: "请填标题" }, 400);
      if (state.sources.length >= 300) return done({ ok: false, error: "来源已达上限" }, 429);
      const k = srcKey(title, body.year);
      const dupe = state.sources.find(s => srcKey(s.title, s.year) === k);
      if (dupe) return done({ ok: false, error: "来源已存在", dupe: dupe.by, title: dupe.title }, 409);
      state.sources.push({
        id: crypto.randomUUID(), auth: String(body.auth || "").slice(0, 120), year: String(body.year || "").slice(0, 8),
        lens: String(body.lens || "").slice(0, 40), title: title.slice(0, 300), type: String(body.type || "").slice(0, 60),
        grade: String(body.grade || "").slice(0, 60), use: String(body.use || "").slice(0, 40),
        cred: String(body.cred || "").slice(0, 1200), by: viewer.name, updated: Date.now()
      });
      dirty = true; res = done({ ok: true, ...snapshot(state, viewer) });

    } else if (path === "/api/source" && method === "DELETE") {
      const id = url.searchParams.get("id");
      const t = state.sources.find(s => s.id === id);
      if (!t) return done({ ok: false, error: "找不到" }, 404);
      if (t.by !== viewer.name) return done({ ok: false, error: "只能删自己登记的" }, 403);
      state.sources = state.sources.filter(s => s.id !== id);
      dirty = true; res = done({ ok: true, ...snapshot(state, viewer) });

    } else if (path === "/api/fx" && method === "POST") {
      if (state.fx.length >= 200) return done({ ok: false, error: "已达上限" }, 429);
      state.fx.push({
        id: crypto.randomUUID(), src: String(body.src || "").slice(0, 200), target: String(body.target || "").slice(0, 200),
        what: String(body.what || "").slice(0, 800), how: String(body.how || "").slice(0, 40), by: viewer.name, updated: Date.now()
      });
      dirty = true; res = done({ ok: true, ...snapshot(state, viewer) });

    } else if (path === "/api/save" && method === "POST") {
      const clean = o => { const r = {}; if (!o || typeof o !== "object") return r; for (const [k, v] of Object.entries(o)) { if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue; r[k] = (typeof v === "boolean" || typeof v === "number") ? v : String(v).slice(0, 40); } return r; };
      viewer.progress = { ...(viewer.progress || {}), ...clean(body.progress) };
      viewer.rubric = { ...(viewer.rubric || {}), ...clean(body.rubric) };
      viewer.updated = Date.now();
      dirty = true; res = done({ ok: true, me: meView(viewer) });

    } else if (path === "/api/upload" && method === "POST") {
      if (!uploaded) return done({ ok: false, error: "没有收到文件" }, 400);
      if ((state.deliverables || []).length >= 200) return done({ ok: false, error: "附件数量已达上限" }, 429);
      state.deliverables.push({ ...uploaded, by: viewer.name, byId: viewer.id });
      dirty = true; res = done({ ok: true, id: uploaded.id, ...snapshot(state, viewer) });

    } else if (path === "/api/upload" && method === "DELETE") {
      const id = url.searchParams.get("id");
      const rec = (state.deliverables || []).find(d => d.id === id);
      if (!rec) return done({ ok: false, error: "找不到" }, 404);
      if (rec.byId !== viewer.id) return done({ ok: false, error: "只能删自己的上传" }, 403);
      state.deliverables = state.deliverables.filter(d => d.id !== id);
      dirty = true; res = done({ ok: true, ...snapshot(state, viewer) });
      try { await store.delete("files/" + id); } catch {}

    } else if (path === "/api/check" && method === "POST") {
      const target = body.deliverableId ? (state.deliverables || []).find(d => d.id === body.deliverableId) : null;
      if (target) {
        target.ai = { at: Date.now(), model: aiCache.model, text: aiCache.analysis };
        dirty = true;
        res = done({ ok: true, model: aiCache.model, analysis: aiCache.analysis, deliverables: snapshot(state, viewer).state.deliverables });
      } else {
        return done({ ok: true, model: aiCache.model, analysis: aiCache.analysis });
      }

    } else {
      return done({ ok: false, error: "未知接口" }, 404);
    }

    if (!res) return json({ ok: false, error: "空响应" }, 500);
    if (!dirty) return res;

    try {
      await store.setJSON("state", state, fresh ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return res;
    } catch (e) {
      const conflict = e && (e.status === 412 || /precondition|etag|match/i.test(String(e.message || "")));
      if (!conflict) return json({ ok: false, error: "写入失败：" + (e.message || "") }, 500);
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
    }
  }
  return json({ ok: false, error: "提交冲突，请再点一次" }, 409);
}

export default async function handler(request) {
  try {
    return await handleApi(request);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const status = e && e.storage ? 503 : 500;
    return json({ ok: false, error: status === 503 ? msg + "（请稍后重试，未写入任何数据）" : msg }, status);
  }
}

export const config = { path: "/api/*" };
