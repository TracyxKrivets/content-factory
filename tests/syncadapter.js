// Injected into test pages: the same shape as the app's Supabase adapter, talking to syncserver.js.
window.__cfTestSyncAdapter = (url) => {
  let user = JSON.parse(localStorage.getItem("cf-test-session") || "null");
  const j = async (path, b) => {
    const r = await fetch(url + path, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
    const x = await r.json();
    if (!r.ok) throw new Error(x.error || "server error");
    return x;
  };
  return {
    async init() { return user; },
    async signUp(email, pw) { user = await j("/auth/signup", { email, pw }); localStorage.setItem("cf-test-session", JSON.stringify(user)); return { user, needsConfirm: false }; },
    async signIn(email, pw) { try { user = await j("/auth/signin", { email, pw }); } catch (e) { throw new Error(/Invalid login/.test(e.message) ? "Wrong email or password." : e.message); } localStorage.setItem("cf-test-session", JSON.stringify(user)); return user; },
    async signOut() { user = null; localStorage.removeItem("cf-test-session"); },
    async upsert(rows) { await j("/upsert", { user: user.id, rows }); },
    async pull(since) { return (await fetch(`${url}/pull?user=${user.id}&since=${encodeURIComponent(since || "")}`)).json(); },
    subscribe(onRow, onLive, onStatus) {
      const es = new EventSource(`${url}/events?user=${user.id}`);
      es.onopen = () => onStatus("online");
      es.onerror = () => onStatus("offline");
      es.addEventListener("row", (e) => onRow(JSON.parse(e.data)));
      es.addEventListener("live", (e) => onLive(JSON.parse(e.data)));
      return () => es.close();
    },
    live(payload) { j("/live", { user: user.id, payload }).catch(() => {}); },
    async upload(path, blob) { await fetch(`${url}/blob?user=${user.id}&path=${encodeURIComponent(path)}`, { method: "PUT", body: blob, headers: { "content-type": blob.type || "video/mp4" } }); },
    async download(path) { const r = await fetch(`${url}/blob?user=${user.id}&path=${encodeURIComponent(path)}`); if (!r.ok) throw new Error("not found"); return r.blob(); },
    async remove() {},
  };
};
