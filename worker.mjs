/**
 * AP Seminar PT1 团队工作台 — Cloudflare Worker
 * 静态资源走 env.ASSETS，/api/* 走单例 Durable Object（强一致，避免并发写丢数据）。
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const blank = () => ({ team: { topic: "", deadline: "", rq: "" }, members: [], sources: [], fx: [] });

/** 名字归一化：全角转半角、去首尾空白、压缩内部空白 */
function normName(raw) {
  return String(raw == null ? "" : raw).normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 40);
}
/** 登录唯一键：忽略大小写与所有空白，防止同一个人重复建号 */
function slugOf(name) {
  return normName(name).toLowerCase().replace(/\s+/g, "");
}

const SEED = {
  team: {
    topic: "Social media, beauty standards and adolescent body image in China (recent five years)",
    deadline: "",
    rq: "To what extent does the spread of social media amplify harmful beauty standards and body dysmorphia among adolescent girls in China in the recent five years?"
  },
  sources: [{
    id: "seed_liu2025",
    auth: "Liu et al.", year: "2025", lens: "Psychology",
    title: "What was causing what? Adolescents' social networking site use and body dissatisfaction",
    type: "同行评议实证研究", grade: "强 · 直接支撑", use: "引言 / 背景",
    cred: "Social Behavior and Personality, 53(6)；两波交叉滞后设计，间隔 8 个月；605 名中国青少年（辽宁+江苏，整班抽样，平均 16.9 岁，男 56.4%）。方法可靠度高；但仅控制年龄与 BMI，未控制家庭 SES，性别比较为探索性（Δχ²(4)=5.58, p=.23），时间窗跨疫情。可支撑「关联在中国青少年中真实存在且双向」，不能支撑「女生专属」或「干预有效」。",
    by: "初始资料", updated: 0
  }],
  fx: [{
    id: "seed_fx1",
    src: "Liu et al. (2025)",
    target: "RQ 中的 amplify（单向）与 adolescent girls（女生专属）",
    what: "双向交叉滞后均显著（社媒→身体不满意更强）；性别差异不显著，样本 56.4% 为男生，作者声明性别分析为探索性。",
    how: "改 RQ", by: "初始资料", updated: 0
  }]
};

function seed() {
  const s = blank();
  s.team = { ...SEED.team };
  s.sources = SEED.sources.map(x => ({ ...x }));
  s.fx = SEED.fx.map(x => ({ ...x }));
  return s;
}

export class Room {
  constructor(state) {
    this.storage = state.storage;
    this.data = null;
  }

  async load() {
    if (!this.data) {
      const stored = await this.storage.get("state");
      this.data = stored ? Object.assign(blank(), stored) : seed();
      if (!stored) await this.persist();
    }
    return this.data;
  }
  async persist() {
    await this.storage.put("state", this.data);
  }

  async fetch(request) {
    try {
      await this.load();
      return await this.route(request);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500);
    }
  }

  viewer(request) {
    const token = request.headers.get("x-token") || "";
    if (!token) return null;
    return this.data.members.find(m => m.token === token) || null;
  }
  publicMember(m) {
    return {
      id: m.id, name: m.name, lens: m.lens, count: m.count,
      rq: m.rq, stage: m.stage, updated: m.updated, createdAt: m.createdAt
    };
  }
  meView(m) {
    return { ...this.publicMember(m), progress: m.progress || {}, rubric: m.rubric || {} };
  }
  snapshot(viewer) {
    return {
      state: {
        team: this.data.team,
        members: this.data.members.map(m => this.publicMember(m)),
        sources: this.data.sources,
        fx: this.data.fx
      },
      me: viewer ? this.meView(viewer) : null
    };
  }

  async route(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const viewer = this.viewer(request);
    let body = {};
    if (method === "POST" || method === "DELETE") {
      const raw = await request.text();
      if (raw) {
        if (raw.length > 30000) return json({ ok: false, error: "提交内容过大" }, 413);
        try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "格式错误" }, 400); }
      }
    }

    if (path === "/api/state" && method === "GET") {
      return json({ ok: true, ...this.snapshot(viewer) });
    }

    if (path === "/api/login" && method === "POST") {
      const name = normName(body.name);
      if (!name) return json({ ok: false, error: "请输入名字" }, 400);
      const slug = slugOf(name);
      if (!slug) return json({ ok: false, error: "名字无效" }, 400);
      let member = this.data.members.find(m => m.slug === slug);
      let created = false;
      if (!member) {
        if (this.data.members.length >= 60) return json({ ok: false, error: "成员数量已达上限" }, 429);
        member = {
          id: crypto.randomUUID(), name, slug, token: crypto.randomUUID(),
          lens: "", count: "4", rq: "", stage: "0 · 还没开始",
          progress: {}, rubric: {}, createdAt: Date.now(), updated: Date.now()
        };
        this.data.members.push(member);
        await this.persist();
        created = true;
      }
      return json({ ok: true, created, token: member.token, user: this.meView(member), state: this.snapshot(member).state });
    }

    if (!viewer) return json({ ok: false, error: "请先输入名字登录" }, 401);

    if (path === "/api/team" && method === "POST") {
      this.data.team = {
        topic: String(body.topic || "").slice(0, 300),
        deadline: String(body.deadline || "").slice(0, 30),
        rq: String(body.rq || "").slice(0, 600)
      };
      await this.persist();
      return json({ ok: true, ...this.snapshot(viewer) });
    }

    if (path === "/api/member" && method === "POST") {
      const lens = String(body.lens || "").trim().slice(0, 40);
      if (!lens) return json({ ok: false, error: "请选择 lens" }, 400);
      const holder = this.data.members.find(m => m.slug !== viewer.slug && m.lens === lens);
      if (holder) return json({ ok: false, error: "lens 已被认领", holder: holder.name }, 409);
      viewer.lens = lens;
      viewer.count = String(body.count || "4").slice(0, 4);
      viewer.rq = String(body.rq || "").slice(0, 600);
      viewer.stage = String(body.stage || "0 · 还没开始").slice(0, 30);
      viewer.name = normName(viewer.name);
      viewer.updated = Date.now();
      await this.persist();
      return json({ ok: true, ...this.snapshot(viewer) });
    }

    if (path === "/api/member" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (id !== viewer.id) return json({ ok: false, error: "只能移除自己的登记" }, 403);
      this.data.members = this.data.members.filter(m => m.id !== id);
      await this.persist();
      return json({ ok: true, ...this.snapshot(null) });
    }

    if (path === "/api/source" && method === "POST") {
      const title = String(body.title || "").trim();
      if (!title) return json({ ok: false, error: "请填写标题" }, 400);
      if (this.data.sources.length >= 300) return json({ ok: false, error: "来源池已达上限" }, 429);
      const key = srcKey(title, body.year);
      const dupe = this.data.sources.find(s => srcKey(s.title, s.year) === key);
      if (dupe) return json({ ok: false, error: "来源已存在", dupe: dupe.by, title: dupe.title }, 409);
      this.data.sources.push({
        id: crypto.randomUUID(),
        auth: String(body.auth || "").slice(0, 120),
        year: String(body.year || "").slice(0, 8),
        lens: String(body.lens || "").slice(0, 40),
        title: title.slice(0, 300),
        type: String(body.type || "").slice(0, 60),
        grade: String(body.grade || "").slice(0, 60),
        use: String(body.use || "").slice(0, 40),
        cred: String(body.cred || "").slice(0, 1200),
        by: viewer.name,
        updated: Date.now()
      });
      await this.persist();
      return json({ ok: true, ...this.snapshot(viewer) });
    }

    if (path === "/api/source" && method === "DELETE") {
      const id = url.searchParams.get("id");
      const target = this.data.sources.find(s => s.id === id);
      if (!target) return json({ ok: false, error: "找不到该条" }, 404);
      if (target.by !== viewer.name) return json({ ok: false, error: "只能删除自己登记的来源" }, 403);
      this.data.sources = this.data.sources.filter(s => s.id !== id);
      await this.persist();
      return json({ ok: true, ...this.snapshot(viewer) });
    }

    if (path === "/api/fx" && method === "POST") {
      if (this.data.fx.length >= 200) return json({ ok: false, error: "记录已达上限" }, 429);
      this.data.fx.push({
        id: crypto.randomUUID(),
        src: String(body.src || "").slice(0, 200),
        target: String(body.target || "").slice(0, 200),
        what: String(body.what || "").slice(0, 800),
        how: String(body.how || "").slice(0, 40),
        by: viewer.name,
        updated: Date.now()
      });
      await this.persist();
      return json({ ok: true, ...this.snapshot(viewer) });
    }

    if (path === "/api/save" && method === "POST") {
      viewer.progress = Object.assign({}, viewer.progress || {}, sanitizeMap(body.progress));
      viewer.rubric = Object.assign({}, viewer.rubric || {}, sanitizeMap(body.rubric));
      viewer.updated = Date.now();
      await this.persist();
      return json({ ok: true, me: this.meView(viewer) });
    }

    return json({ ok: false, error: "未知接口" }, 404);
  }
}

/** 去重键：忽略标点、大小写、空格差异，只比字母数字与汉字 + 年份 */
function srcKey(title, year) {
  const t = String(title || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 160);
  const y = String(year || "").replace(/\D/g, "").slice(0, 4);
  return t + "|" + y;
}

function sanitizeMap(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue;
    out[k] = (typeof v === "boolean" || typeof v === "number") ? v : String(v).slice(0, 40);
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const id = env.ROOM.idFromName("main");
      return env.ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
