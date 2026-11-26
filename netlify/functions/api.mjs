/**
 * Netlify Function: /api/*   静态站同域调用
 * 存储：Netlify Blobs（ap-seminar store）—— state 单键 + files/<id> 附件
 * AI 核查：AI_API_KEY / AI_BASE_URL / AI_MODEL 环境变量，未配置时明确返回 needsSetup
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

async function load() {
  const { store, kind } = await getBlobStore();
  let stored = null;
  try { stored = await store.get("state", { type: "json" }); } catch { stored = null; }
  const state = Object.assign(blank(), stored || JSON.parse(JSON.stringify(SEED)));
  if (!stored) { try { await store.setJSON("state", state); } catch {} }
  return { state, store, memory: kind !== "blobs", save: async () => { try { await store.setJSON("state", state); } catch {} } };
}

const pub = m => ({ id: m.id, name: m.name, lens: m.lens, count: m.count, rq: m.rq, stage: m.stage, updated: m.updated });
const meView = m => ({ ...pub(m), progress: m.progress || {}, rubric: m.rubric || {}, files: (m.progress && m.progress.__files) || 0 });

function snapshot(state, viewer) {
  return {
    state: {
      team: state.team, members: state.members.map(pub), sources: state.sources,
      fx: state.fx, deliverables: (state.deliverables || []).map(d => ({ ...d, ai: d.ai ? { at: d.ai.at, model: d.ai.model, text: d.ai.text } : null }))
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
  "你是 AP Seminar 的学科导师，只核查学生提交的这一小步，不评价整篇论文。",
  "硬规则：不夸奖、不替学生写正文、不建议换话题；只指出可被验证的事实缺口与逻辑断裂；每条批评都要落到具体那一句或那个数字。",
  "输出固定四段，中文，学术术语保留 English，总长不超过 260 字：",
  "1) 事实核查：最多 3 条，写出缺失的具体数字/样本/来源归属/效应量；若无证据支撑就直说。",
  "2) 逻辑漏洞：最多 2 条，指出推理链断在哪一步（因果/相关/代表性问题）。",
  "3) 两个追问：只提问，不给答案，问题要让学生必须回去查数据或重新界定概念。",
  "4) 一句改写示范：只改一句，保留原意，让学生看到\"同一意思更硬的写法\"。",
  "若提交内容与该步骤无关或过于空泛，第一段直接说明\"无法核查\"并指出需要补什么。"
].join("\n");

async function aiCheck(text, step) {
  const env = (typeof Netlify !== "undefined" && Netlify.env) || { get: k => process.env[k] };
  const key = env.get("AI_API_KEY") || env.get("OPENAI_API_KEY");
  const base = (env.get("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.get("AI_MODEL") || "gpt-4o-mini";
  if (!key) return { ok: false, needsSetup: true, error: "服务端未配置 AI_API_KEY（Netlify → Environment variables 添加后重新部署即可）" };

  const body = {
    model,
    temperature: 0.3,
    max_tokens: 520,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `步骤：${STEP_LABEL[step] || step}\n\n提交内容：\n"""\n${text.slice(0, 3000)}\n"""` }
    ]
  };
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data.error && data.error.message) || ("AI 接口 " + res.status) };
  const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) return { ok: false, error: "AI 返回为空" };
  return { ok: true, model, analysis: out.trim() };
}

/* ---------------- 路由 ---------------- */
export default async function handler(request) {
  const url = new URL(request.url);
  const i = url.pathname.indexOf("/api/");
  const path = i >= 0 ? url.pathname.slice(i) : "/api/state";
  const method = request.method;
  const { state, store, memory, save } = await load();
  const token = request.headers.get("x-token") || "";
  const viewer = token ? state.members.find(m => m.token === token) : null;

  let body = {};
  if (method === "POST" && (request.headers.get("content-type") || "").includes("application/json")) {
    const raw = await request.text();
    if (raw.length > 400000) return json({ ok: false, error: "内容过大" }, 413);
    try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "格式错误" }, 400); }
  }

  try {
    if (path === "/api/state" && method === "GET") return json({ ok: true, memory, ...snapshot(state, viewer) });
    if (path === "/api/ai-status" && method === "GET") {
      const env = (typeof Netlify !== "undefined" && Netlify.env) || { get: k => process.env[k] };
      return json({ ok: true, configured: !!(env.get("AI_API_KEY") || env.get("OPENAI_API_KEY")), model: env.get("AI_MODEL") || "gpt-4o-mini" });
    }

    if (path === "/api/login" && method === "POST") {
      const name = normName(body.name), slug = slugOf(name);
      if (!slug) return json({ ok: false, error: "请输入名字" }, 400);
      let member = state.members.find(m => m.slug === slug), created = false;
      if (!member) {
        if (state.members.length >= 60) return json({ ok: false, error: "成员已达上限" }, 429);
        member = { id: crypto.randomUUID(), name, slug, token: crypto.randomUUID(), lens: "", count: "4", rq: "", stage: "0 · 还没开始", progress: {}, rubric: {}, createdAt: Date.now(), updated: Date.now() };
        state.members.push(member); await save(); created = true;
      }
      return json({ ok: true, created, memory, token: member.token, user: meView(member), state: snapshot(state, member).state });
    }

    /* 文件下载（无需登录，靠随机 id） */
    if (path === "/api/file" && method === "GET") {
      const id = url.searchParams.get("id");
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

    if (!viewer) return json({ ok: false, error: "请先输入名字登录" }, 401);

    if (path === "/api/team" && method === "POST") {
      state.team = { topic: String(body.topic || "").slice(0, 300), deadline: String(body.deadline || "").slice(0, 30), rq: String(body.rq || "").slice(0, 600) };
      await save(); return json({ ok: true, ...snapshot(state, viewer) });
    }

    if (path === "/api/member" && method === "POST") {
      const lens = String(body.lens || "").trim().slice(0, 40);
      if (!lens) return json({ ok: false, error: "请选择 lens" }, 400);
      const holder = state.members.find(m => m.slug !== viewer.slug && m.lens === lens);
      if (holder) return json({ ok: false, error: "lens 已被认领", holder: holder.name }, 409);
      Object.assign(viewer, {
        lens, count: String(body.count || "4").slice(0, 4), rq: String(body.rq || "").slice(0, 600),
        stage: String(body.stage || "0 · 还没开始").slice(0, 30), updated: Date.now()
      });
      await save(); return json({ ok: true, ...snapshot(state, viewer) });
    }

    if (path === "/api/member" && method === "DELETE") {
      if (url.searchParams.get("id") !== viewer.id) return json({ ok: false, error: "只能移除自己" }, 403);
      state.members = state.members.filter(m => m.id !== viewer.id);
      await save(); return json({ ok: true, ...snapshot(state, null) });
    }

    if (path === "/api/source" && method === "POST") {
      const title = String(body.title || "").trim();
      if (!title) return json({ ok: false, error: "请填标题" }, 400);
      if (state.sources.length >= 300) return json({ ok: false, error: "来源已达上限" }, 429);
      const k = srcKey(title, body.year);
      const dupe = state.sources.find(s => srcKey(s.title, s.year) === k);
      if (dupe) return json({ ok: false, error: "来源已存在", dupe: dupe.by, title: dupe.title }, 409);
      state.sources.push({
        id: crypto.randomUUID(), auth: String(body.auth || "").slice(0, 120), year: String(body.year || "").slice(0, 8),
        lens: String(body.lens || "").slice(0, 40), title: title.slice(0, 300), type: String(body.type || "").slice(0, 60),
        grade: String(body.grade || "").slice(0, 60), use: String(body.use || "").slice(0, 40),
        cred: String(body.cred || "").slice(0, 1200), by: viewer.name, updated: Date.now()
      });
      await save(); return json({ ok: true, ...snapshot(state, viewer) });
    }

    if (path === "/api/source" && method === "DELETE") {
      const id = url.searchParams.get("id");
      const t = state.sources.find(s => s.id === id);
      if (!t) return json({ ok: false, error: "找不到" }, 404);
      if (t.by !== viewer.name) return json({ ok: false, error: "只能删自己登记的" }, 403);
      state.sources = state.sources.filter(s => s.id !== id);
      await save(); return json({ ok: true, ...snapshot(state, viewer) });
    }

    if (path === "/api/fx" && method === "POST") {
      if (state.fx.length >= 200) return json({ ok: false, error: "已达上限" }, 429);
      state.fx.push({
        id: crypto.randomUUID(), src: String(body.src || "").slice(0, 200), target: String(body.target || "").slice(0, 200),
        what: String(body.what || "").slice(0, 800), how: String(body.how || "").slice(0, 40), by: viewer.name, updated: Date.now()
      });
      await save(); return json({ ok: true, ...snapshot(state, viewer) });
    }

    if (path === "/api/save" && method === "POST") {
      const clean = o => { const r = {}; if (!o || typeof o !== "object") return r; for (const [k, v] of Object.entries(o)) { if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue; r[k] = (typeof v === "boolean" || typeof v === "number") ? v : String(v).slice(0, 40); } return r; };
      viewer.progress = { ...(viewer.progress || {}), ...clean(body.progress) };
      viewer.rubric = { ...(viewer.rubric || {}), ...clean(body.rubric) };
      viewer.updated = Date.now();
      await save(); return json({ ok: true, me: meView(viewer) });
    }

    /* 上传：multipart，字段 file / step / note / text */
    if (path === "/api/upload" && method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return json({ ok: false, error: "没有收到文件" }, 400);
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) return json({ ok: false, error: "只支持 pdf / doc / docx / txt / md / 图片" }, 415);
      if (file.size > MAX_FILE) return json({ ok: false, error: "文件超过 3.5MB，请压缩或只上传截图" }, 413);
      if ((state.deliverables || []).length >= 200) return json({ ok: false, error: "附件数量已达上限" }, 429);
      const id = crypto.randomUUID();
      const buf = await file.arrayBuffer();
      await store.set("files/" + id, buf);
      const rec = {
        id, step: String(form.get("step") || "irr").slice(0, 20),
        title: String(form.get("title") || "").slice(0, 160),
        note: String(form.get("note") || "").slice(0, 600),
        filename: file.name.slice(0, 120), size: file.size, type: file.type || "application/octet-stream",
        by: viewer.name, byId: viewer.id, updated: Date.now(), ai: null
      };
      state.deliverables.push(rec);
      await save();
      return json({ ok: true, id, ...snapshot(state, viewer) });
    }

    if (path === "/api/upload" && method === "DELETE") {
      const id = url.searchParams.get("id");
      const rec = (state.deliverables || []).find(d => d.id === id);
      if (!rec) return json({ ok: false, error: "找不到" }, 404);
      if (rec.byId !== viewer.id) return json({ ok: false, error: "只能删自己的上传" }, 403);
      state.deliverables = state.deliverables.filter(d => d.id !== id);
      await save();
      try { await store.delete("files/" + id); } catch {}
      return json({ ok: true, ...snapshot(state, viewer) });
    }

    /* AI 核查：只发这一步的文字，控制 token */
    if (path === "/api/check" && method === "POST") {
      const text = String(body.text || "").trim();
      const step = String(body.step || "irr").slice(0, 20);
      if (text.length < 40) return json({ ok: false, error: "内容太短（至少 40 字）才值得花 token" }, 400);
      const r = await aiCheck(text, step);
      if (!r.ok) return json(r, r.needsSetup ? 501 : 502);
      const target = body.deliverableId ? (state.deliverables || []).find(d => d.id === body.deliverableId) : null;
      if (target) { target.ai = { at: Date.now(), model: r.model, text: r.analysis }; await save(); }
      return json({ ok: true, model: r.model, analysis: r.analysis, ...(target ? { deliverables: snapshot(state, viewer).state.deliverables } : {}) });
    }

    return json({ ok: false, error: "未知接口" }, 404);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export const config = { path: "/api/*" };
