/**
 * 存储封装：优先 Netlify Blobs（强一致读）；不可用时退回进程内存（仅本地自测，重启即丢）。
 */
let store = null;
let kind = null;
let tried = false;
const mem = {};

export async function getBlobStore() {
  if (!tried) {
    tried = true;
    try {
      const mod = await import("@netlify/blobs");
      store = mod.getStore({ name: "ap-seminar", consistency: "strong" });
      kind = "blobs";
    } catch (e) {
      console.warn("[store] Netlify Blobs unavailable:", e && e.message);
      kind = "memory";
      store = {
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
        async set(key, value) { mem[key] = value; },
        async setJSON(key, val) { mem[key] = JSON.parse(JSON.stringify(val)); },
        async delete(key) { delete mem[key]; }
      };
    }
  }
  return { store, kind };
}
