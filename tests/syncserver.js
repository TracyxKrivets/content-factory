const path = require("path");
const APP = require("url").pathToFileURL(path.join(__dirname, "../web/dist/content-factory.html")).href;
const FIX = (f) => path.join(__dirname, "fixtures", f);
const OUT = (f) => path.join(__dirname, "out", f);
// Stand-in for Supabase: same behaviour the app relies on (accounts, rows with server timestamps,
// live change feed, broadcast, private file storage), over plain HTTP + server-sent events.
const http = require("http");
const users = new Map(); // email -> {id, pw}
const rows = new Map(); // user|kind|id -> row
const files = new Map(); // user/path -> {buf, type}
const clients = new Set(); // {user, res}
let last = 0;
const stampNow = () => { let t = Date.now(); if (t <= last) t = last + 1; last = t; return new Date(t).toISOString(); };
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" };
const send = (res, code, body) => { res.writeHead(code, { ...H, "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const emit = (user, ev, data) => { for (const c of clients) if (c.user === user) c.res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, H); return res.end(); }
  const u = new URL(req.url, "http://x"); const q = Object.fromEntries(u.searchParams);
  if (u.pathname === "/stats") return send(res, 200, { rows: rows.size, files: [...files.keys()], users: users.size });
  if (u.pathname === "/auth/signup") { const { email, pw } = JSON.parse(await body(req)); if (users.has(email)) return send(res, 400, { error: "User already registered" }); const id = "u-" + Math.random().toString(36).slice(2, 10); users.set(email, { id, pw }); return send(res, 200, { id, email }); }
  if (u.pathname === "/auth/signin") { const { email, pw } = JSON.parse(await body(req)); const x = users.get(email); if (!x || x.pw !== pw) return send(res, 400, { error: "Invalid login credentials" }); return send(res, 200, { id: x.id, email }); }
  if (u.pathname === "/upsert") {
    const { user, rows: rs } = JSON.parse(await body(req));
    for (const r of rs) { const row = { ...r, user_id: user, updated_at: stampNow() }; rows.set(`${user}|${r.kind}|${r.id}`, row); emit(user, "row", row); }
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/pull") return send(res, 200, [...rows.values()].filter((r) => r.user_id === q.user && r.updated_at > (q.since || "")).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)));
  if (u.pathname === "/events") {
    res.writeHead(200, { ...H, "content-type": "text/event-stream", "cache-control": "no-cache" }); res.write(": hi\n\n");
    const c = { user: q.user, res }; clients.add(c); req.on("close", () => clients.delete(c)); return;
  }
  if (u.pathname === "/live") { const { user, payload } = JSON.parse(await body(req)); emit(user, "live", payload); return send(res, 200, { ok: true }); }
  if (u.pathname === "/blob" && req.method === "PUT") { files.set(q.user + "/" + q.path, { buf: await body(req), type: req.headers["content-type"] }); return send(res, 200, { ok: true }); }
  if (u.pathname === "/blob") { const f = files.get(q.user + "/" + q.path); if (!f) return send(res, 404, { error: "not found" }); res.writeHead(200, { ...H, "content-type": f.type || "video/mp4" }); return res.end(f.buf); }
  send(res, 404, { error: "?" });
}).listen(8787, "127.0.0.1", () => console.log("sync server on 8787"));
