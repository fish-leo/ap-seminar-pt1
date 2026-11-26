/**
 * 存储封装：优先 Netlify Blobs（强一致 + ETag 条件写）；不可用时退回进程内存（仅本地自测）。
 * 关键：用 Promise 缓存初始化，避免并发请求拿到 null store（曾导致整份状态被种子覆盖）。
 */
let storePromise = null;

async function build() {
  try {
    const mod = await import("@netlify/blobs");
    const store = mod.getStore({ name: "ap-seminar", consistency: "strong" });
    return { store, kind: "blobs" };
  } catch (e) {
    console.warn("[store] Netlify Blobs unavailable, using memory:", e && e.message);
    const mem = {};
    let ver = 0;
    const etags = {};
    const memoryStore = {
      async get(key, opts) {
        const v = mem[key];
        if (v == null) return null;
        if (opts && opts.type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        if (opts && opts.type === "arrayBuffer") {
          if (v instanceof ArrayBuffer) return v;
          if (ArrayBuffer.isView(v)) return v.buffer;
          return new TextEncoder().encode(String(v)).buffer;
        }
        return v;
      },
      async getWithMetadata(key, opts) {
        const data = await this.get(key, opts);
        if (data == null) return null;
        return { data, etag: etags[key] || null };
      },
      async set(key, value) { mem[key] = value; etags[key] = String(++ver); },
      async setJSON(key, val, opts) {
        if (opts && opts.onlyIfNew && mem[key] != null) { const e = new Error("precondition failed"); e.status = 412; throw e; }
        if (opts && opts.onlyIfMatch && opts.onlyIfMatch !== etags[key]) { const e = new Error("precondition failed"); e.status = 412; throw e; }
        mem[key] = JSON.parse(JSON.stringify(val));
        etags[key] = String(++ver);
      },
      async delete(key) { delete mem[key]; delete etags[key]; }
    };
    return { store: memoryStore, kind: "memory" };
  }
}

export async function getBlobStore() {
  if (!storePromise) storePromise = build();
  return storePromise;
}
