// ---------------------------------------------------------------- sync between devices (PC, phone, anywhere)
// One small online database (your own free Supabase project) keeps every device up to date, live:
// projects, videos and their progress, edits, settings, spending, and the finished video files.
// Only one device makes each video: by default the PC does the work and phones watch, edit and download.
// Off by default; nothing leaves this device until you set it up.

const SYNC_SQL = `-- Content Factory: run this once in your Supabase project (SQL Editor → New query → Run)
create table if not exists public.cf_items (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  device text,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
create index if not exists cf_items_updated on public.cf_items (user_id, updated_at);
alter table public.cf_items enable row level security;
drop policy if exists "cf own rows" on public.cf_items;
create policy "cf own rows" on public.cf_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- the server stamps the time, so devices with wrong clocks still sync in order
create or replace function public.cf_touch() returns trigger language plpgsql as $$
begin new.updated_at = clock_timestamp(); return new; end $$;
drop trigger if exists cf_touch on public.cf_items;
create trigger cf_touch before insert or update on public.cf_items for each row execute function public.cf_touch();
do $$ begin
  alter publication supabase_realtime add table public.cf_items;
exception when duplicate_object then null; end $$;
-- finished videos (private: only you can read them)
insert into storage.buckets (id, name, public) values ('cf-videos', 'cf-videos', false) on conflict (id) do nothing;
drop policy if exists "cf videos select" on storage.objects;
drop policy if exists "cf videos insert" on storage.objects;
drop policy if exists "cf videos update" on storage.objects;
drop policy if exists "cf videos delete" on storage.objects;
create policy "cf videos select" on storage.objects for select to authenticated using (bucket_id = 'cf-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cf videos insert" on storage.objects for insert to authenticated with check (bucket_id = 'cf-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cf videos update" on storage.objects for update to authenticated using (bucket_id = 'cf-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cf videos delete" on storage.objects for delete to authenticated using (bucket_id = 'cf-videos' and (storage.foldername(name))[1] = auth.uid()::text);
`;

/** The real connection: your Supabase project. (Tests swap in a stand-in with the same shape.) */
function supabaseAdapter(url, anon) {
  const sb = window.supabase.createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "cf-sync-auth" },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  let uidv = null, ch = null;
  const fail = (error, what) => {
    if (!error) return;
    const m = String(error.message || error);
    if (/relation .*cf_items.* does not exist|Could not find the table/i.test(m)) throw new Error("The database isn't set up yet: run the setup SQL (step 2) in your Supabase project.");
    if (/Invalid API key|No API key/i.test(m)) throw new Error("Supabase didn't accept the project key. Copy the anon / publishable key again.");
    throw new Error(`${what}: ${m}`);
  };
  return {
    async init() {
      const { data } = await sb.auth.getSession();
      uidv = data.session?.user?.id || null;
      return data.session?.user || null;
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      fail(error, "Couldn't make the account");
      uidv = data.session?.user?.id || null;
      return { user: data.session ? data.user : null, needsConfirm: !data.session };
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error && /confirm/i.test(error.message)) throw new Error("Confirm your email first: open the link Supabase sent you, then sign in.");
      if (error && /invalid login/i.test(error.message)) throw new Error("Wrong email or password.");
      fail(error, "Couldn't sign in");
      uidv = data.user.id;
      return data.user;
    },
    async signOut() {
      await sb.auth.signOut();
      uidv = null;
    },
    async upsert(rows) {
      const { error } = await sb.from("cf_items").upsert(rows.map((r) => ({ ...r, user_id: uidv })), { onConflict: "user_id,kind,id" });
      fail(error, "Couldn't save to the cloud");
    },
    async pull(since) {
      const out = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await sb.from("cf_items").select("*").gt("updated_at", since || "1970-01-01T00:00:00Z").order("updated_at").range(from, from + 499);
        fail(error, "Couldn't read from the cloud");
        out.push(...data);
        if (data.length < 500) return out;
      }
    },
    subscribe(onRow, onLive, onStatus) {
      ch = sb
        .channel("cf-" + uidv, { config: { broadcast: { self: false } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "cf_items", filter: `user_id=eq.${uidv}` }, (p) => p.new && p.new.kind && onRow(p.new))
        .on("broadcast", { event: "live" }, ({ payload }) => onLive(payload))
        .subscribe((status) => onStatus(status === "SUBSCRIBED" ? "online" : status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "offline" : "connecting"));
      return () => sb.removeChannel(ch);
    },
    live(payload) {
      ch?.send({ type: "broadcast", event: "live", payload }).catch?.(() => {});
    },
    async upload(path, blob) {
      const { error } = await sb.storage.from("cf-videos").upload(`${uidv}/${path}`, blob, { upsert: true, contentType: blob.type || "video/mp4" });
      fail(error, "Couldn't upload the video");
    },
    async download(path) {
      const { data, error } = await sb.storage.from("cf-videos").download(`${uidv}/${path}`);
      fail(error, "Couldn't download the video");
      return data;
    },
    async remove(path) {
      await sb.storage.from("cf-videos").remove([`${uidv}/${path}`]);
    },
  };
}

const SYNCED_SETTINGS = new Set(["cf-roles", "cf-models", "cf-budget", "cf-sora", "cf-gemini", "cf-types"]);
const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const Sync = (() => {
  const me = (() => {
    let d = loadSetting("cf-device", null);
    if (!d?.id) {
      d = { id: uid(), name: isPhone() ? "Phone" : window.cfNet ? "PC" : "Computer" };
      saveSettingRaw("cf-device", d);
    }
    return d;
  })();
  const cfg = () => ({ url: "", anon: "", enabled: false, worker: !isPhone(), syncKeys: false, videos: true, ...loadSetting("cf-sync", {}) });
  const st = { status: "off", user: null, error: "", devices: {}, pending: 0, lastSync: null };
  let api = null, unsub = null, flushTimer = null, beatTimer = null, liveAt = {};
  const outbox = new Map(); // kind:id -> row
  const note = () => bus.dispatchEvent(new Event("sync"));
  const set = (patch) => {
    Object.assign(st, patch);
    note();
  };
  const on = () => !!api && !!st.user;

  // ---------- local → cloud
  function local(kind, id, data, deleted = false) {
    if (!on() && !cfg().enabled) return;
    outbox.set(kind + ":" + id, { kind, id: String(id), data: deleted ? {} : strip(kind, data), deleted, device: me.id });
    st.pending = outbox.size;
    saveOutbox();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, kind === "video" ? 600 : 300);
  }
  const strip = (kind, d) => (kind === "video" || kind === "project" ? JSON.parse(JSON.stringify(d)) : d);
  let outboxLoaded = false;
  const saveOutbox = () => outboxLoaded && kv.set("sync-outbox", [...outbox.values()]).catch(() => {});
  let flushing = false;
  async function flush() {
    if (!on() || flushing || !outbox.size) return;
    if (navigator.onLine === false) return;
    flushing = true;
    const rows = [...outbox.values()];
    try {
      for (let i = 0; i < rows.length; i += 50) await api.upsert(rows.slice(i, i + 50));
      for (const r of rows) if (outbox.get(r.kind + ":" + r.id) === r) outbox.delete(r.kind + ":" + r.id);
      set({ pending: outbox.size, lastSync: now(), error: "" });
      saveOutbox();
    } catch (e) {
      set({ error: e.message });
      setTimeout(flush, 8000);
    } finally {
      flushing = false;
      if (outbox.size) setTimeout(flush, 300);
    }
  }

  // ---------- cloud → local
  const rawPut = db.put.bind(db), rawDel = db.del.bind(db);
  const stamp = (x) => x?.updatedAt || x?.createdAt || "";
  async function lockedApply(store, id, fn) {
    const prev = locks.get(store + id) || Promise.resolve();
    let release;
    const p = new Promise((r) => (release = r));
    locks.set(store + id, prev.then(() => p));
    await prev;
    try {
      await fn();
    } finally {
      release();
    }
  }
  async function apply(row) {
    if (row.updated_at && (!st.cursor || row.updated_at > st.cursor)) {
      st.cursor = row.updated_at;
      kv.set("sync-cursor", st.cursor).catch(() => {});
    }
    if (row.device === me.id) return; // our own change coming back
    const d = row.data || {};
    if (row.kind === "project" || row.kind === "video") {
      const store = row.kind + "s";
      await lockedApply(store, row.id, async () => {
        const cur = await db.get(store, row.id);
        if (row.deleted) {
          if (cur) {
            if (store === "videos") for (const k of videoBlobKeys(cur)) await rawDel("blobs", k).catch(() => {});
            await rawDel(store, row.id);
          }
          return;
        }
        // a deliberate change (edit, retry, delete: higher rev) wins; otherwise the newer write wins
        if (cur && ((cur.rev || 0) > (d.rev || 0) || ((cur.rev || 0) === (d.rev || 0) && stamp(cur) >= stamp(d)))) return;
        await rawPut(store, d);
      });
      if (row.kind === "video") {
        if (d.status === "done" || d.status === "needs_attention") delete live[row.id];
        // a video someone queued (made, edited, retried) on another device: pick it up if this device makes videos
        if (cfg().worker && (d.status === "queued" || (d.status === "working" && staleWorker(d)))) enqueue(row.id);
      }
      if (row.kind === "project" && cfg().worker && d.status === "planning" && !d.deletedAt && !d.ideaError && staleWorker(d)) planProject(row.id);
    } else if (row.kind === "setting") {
      if (row.id === "cf-keys") {
        if (!cfg().syncKeys) return;
        const mine = keys.all();
        const merged = { ...d.value, ...Object.fromEntries(Object.entries(mine).filter(([k]) => !(k in (d.value || {})))) };
        LS.setItem("cf-keys", JSON.stringify(merged));
      } else if ((loadSetting(row.id + "@", "") || "") < (d.at || "")) {
        saveSettingRaw(row.id, d.value);
        saveSettingRaw(row.id + "@", d.at);
      }
    } else if (row.kind === "spend") {
      const [month, dev] = row.id.split("|");
      const all = (await kv.get("spendx:" + month, {})) || {};
      all[dev] = d;
      await kv.set("spendx:" + month, all);
    } else if (row.kind === "device") {
      st.devices[row.id] = d;
    }
    changed();
  }
  const staleWorker = (d) => !d.worker || d.worker.device === me.id || Date.now() - Date.parse(d.worker.at || 0) > 75000;

  // ---------- connect
  let ready = Promise.resolve();
  function connect() {
    ready = doConnect();
    return ready;
  }
  async function doConnect() {
    if (!outboxLoaded) {
      for (const r of (await kv.get("sync-outbox", [])) || []) if (!outbox.has(r.kind + ":" + r.id)) outbox.set(r.kind + ":" + r.id, r);
      outboxLoaded = true;
      saveOutbox();
    }
    const c = cfg();
    if (!c.enabled || !c.url || !c.anon || !canFetch()) return set({ status: "off" });
    try {
      set({ status: "connecting", error: "" });
      api = window.__cfTestSyncAdapter ? window.__cfTestSyncAdapter(c.url, c.anon) : supabaseAdapter(c.url, c.anon);
      const user = await api.init();
      if (!user) return set({ status: "signed-out", user: null });
      set({ user: { id: user.id, email: user.email } });
      st.cursor = await kv.get("sync-cursor", null);
      unsub?.();
      unsub = api.subscribe(
        (row) => apply(row).catch((e) => console.warn("sync apply", e)),
        (msg) => {
          if (msg?.device === me.id || !msg?.videoId) return;
          live[msg.videoId] = msg.live;
          bus.dispatchEvent(new Event("live"));
        },
        async (s) => {
          set({ status: s });
          if (s === "online") await catchUp();
        },
      );
      await catchUp();
      announce();
      clearInterval(beatTimer);
      beatTimer = setInterval(announce, 60000);
    } catch (e) {
      set({ status: "error", error: e.message });
    }
  }
  let catching = null;
  async function catchUp() {
    if (catching) return catching;
    catching = (async () => {
      try {
        const first = !st.cursor;
        const rows = await api.pull(st.cursor ? new Date(Date.parse(st.cursor) - 5000).toISOString() : null);
        const remote = new Map(rows.map((r) => [r.kind + ":" + r.id, r]));
        for (const r of rows) await apply(r);
        // send up anything here that the cloud doesn't have yet (first time: everything)
        if (first) {
          for (const p of await db.all("projects")) if (!remote.has("project:" + p.id)) local("project", p.id, p);
          for (const v of await db.all("videos")) if (!remote.has("video:" + v.id)) local("video", v.id, v);
          for (const k of SYNCED_SETTINGS) {
            const v = loadSetting(k, undefined);
            if (v !== undefined && !remote.has("setting:" + k)) local("setting", k, { value: v, at: loadSetting(k + "@", "") || now() });
          }
          if (cfg().syncKeys) pushKeys();
          const m = await kv.get("spend:" + monthKey(), null);
          if (m) local("spend", monthKey() + "|" + me.id, m);
        }
        await flush();
        set({ lastSync: now() });
        if (cfg().videos) uploadMissing();
      } catch (e) {
        set({ error: e.message });
      } finally {
        catching = null;
      }
    })();
    return catching;
  }
  function announce() {
    if (!on()) return;
    const d = { name: me.name, worker: cfg().worker, phone: isPhone(), desktop: !!window.cfNet, lastSeen: now(), running: running.size, queued: queue.length };
    st.devices[me.id] = d;
    local("device", me.id, d);
  }

  // ---------- who makes which video
  async function claim(id) {
    if (cfg().enabled) {
      await ready; // don't start before we know what the other devices are doing
      if (!on()) return cfg().worker;
    }
    if (!on()) return true;
    if (!cfg().worker) return false;
    const v = await db.get("videos", id);
    if (!v) return false;
    if (v.worker && v.worker.device !== me.id && !staleWorker(v)) return false;
    await update("videos", id, { worker: { device: me.id, name: me.name, at: now() } });
    return true;
  }
  async function claimPlan(id) {
    if (cfg().enabled) {
      await ready;
      if (!on()) return cfg().worker;
    }
    if (!on()) return true;
    if (!cfg().worker) return false;
    const p = await db.get("projects", id);
    if (p?.worker && p.worker.device !== me.id && !staleWorker(p)) return false;
    await update("projects", id, { worker: { device: me.id, name: me.name, at: now() } });
    return true;
  }
  function heartbeat(id) {
    if (!on()) return { stop() {} };
    const t = setInterval(() => update("videos", id, { worker: { device: me.id, name: me.name, at: now() } }).catch(() => {}), 25000);
    return { stop: () => clearInterval(t) };
  }
  function liveProgress(id, l) {
    if (!on()) return;
    const t = Date.now();
    if (t - (liveAt[id] || 0) < 900) return;
    liveAt[id] = t;
    api.live({ device: me.id, videoId: id, live: l });
  }

  // ---------- finished video files
  const uploading = new Set();
  async function uploadFinal(id) {
    if (!on() || !cfg().videos || uploading.has(id)) return;
    const v = await db.get("videos", id);
    const out = v?.steps?.assemble?.output;
    if (!out?.key || v.status !== "done" || (v.cloud && v.cloud.key === out.key)) return;
    const b = await blobs.get(out.key);
    if (!b) return;
    uploading.add(id);
    try {
      const path = `${id}-${out.key.split(":").pop()}.${out.ext || "mp4"}`;
      await api.upload(path, b);
      await update("videos", id, { cloud: { path, key: out.key, size: b.size, type: b.type } });
    } catch (e) {
      set({ error: e.message });
    } finally {
      uploading.delete(id);
    }
  }
  async function uploadMissing() {
    for (const v of await db.all("videos")) if (v.status === "done" && v.steps?.assemble?.output?.key && !v.cloud) await uploadFinal(v.id);
  }
  const fetching = new Map();
  /** Get a finished video made on another device (once; it's kept here afterwards). */
  function fetchFinal(v) {
    if (!on() || !v?.cloud) return Promise.resolve(null);
    if (fetching.has(v.id)) return fetching.get(v.id);
    const p = (async () => {
      const b = await api.download(v.cloud.path);
      const blob = b.type ? b : new Blob([b], { type: v.cloud.type || "video/mp4" });
      await blobs.put(v.cloud.key, blob);
      return blob;
    })().finally(() => fetching.delete(v.id));
    fetching.set(v.id, p);
    return p;
  }

  // ---------- account
  async function setup({ url, anon }) {
    url = String(url || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(url) && !window.__cfTestSyncAdapter) throw new Error("That doesn't look like a Supabase project URL (https://xxxx.supabase.co).");
    if (!anon || String(anon).trim().length < 20) throw new Error("Paste the anon (public) key too.");
    saveSettingRaw("cf-sync", { ...cfg(), url, anon: String(anon).trim(), enabled: true });
    await connect();
  }
  async function signIn(email, password, create) {
    if (!api) await connect();
    if (!api) throw new Error("Set up the project first.");
    if (create) {
      const r = await api.signUp(email, password);
      if (r.needsConfirm) return { needsConfirm: true };
    } else await api.signIn(email, password);
    await connect();
    return { ok: true };
  }
  async function signOut() {
    try {
      await api?.signOut();
    } catch {}
    unsub?.();
    unsub = null;
    clearInterval(beatTimer);
    saveSettingRaw("cf-sync", { ...cfg(), enabled: false });
    api = null;
    set({ status: "off", user: null, devices: {} });
  }
  function setOptions(patch) {
    saveSettingRaw("cf-sync", { ...cfg(), ...patch });
    if ("syncKeys" in patch && patch.syncKeys) pushKeys();
    if ("worker" in patch) {
      announce();
      if (patch.worker) resumeAll();
    }
    if ("videos" in patch && patch.videos) uploadMissing();
    note();
  }
  const pushKeys = () => local("setting", "cf-keys", { value: keys.all(), at: now() });
  const pairCode = () => "cfpair:" + btoa(JSON.stringify({ u: cfg().url, k: cfg().anon })).replace(/=+$/, "");
  function readPair(text) {
    const t = String(text || "").trim();
    const m = t.match(/cfpair:([A-Za-z0-9+/_-]+)/);
    if (m) {
      const j = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
      return { url: j.u, anon: j.k };
    }
    const url = (t.match(/https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)/i) || [])[0];
    const anon = (t.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)/) || [])[0];
    return url || anon ? { url, anon } : null;
  }

  return {
    me, st, cfg, on, local, apply, connect, claim, claimPlan, heartbeat, live: liveProgress, uploadFinal, fetchFinal,
    setup, signIn, signOut, setOptions, pairCode, readPair, pushKeys, flush,
    isWorker: () => !on() || cfg().worker,
    workersOnline: () => Object.entries(st.devices).filter(([id, d]) => d.worker && (id === me.id || Date.now() - Date.parse(d.lastSeen || 0) < 150000)),
  };
})();

// ---------- hooks: every local change to projects, videos, settings and spending is sent to the cloud
{
  const put = db.put, del = db.del;
  db.put = async (s, v, k) => {
    const r = await put(s, v, k);
    if (s === "projects" || s === "videos") Sync.local(s.slice(0, -1), v.id, v);
    return r;
  };
  db.del = async (s, k) => {
    const cur = s === "projects" || s === "videos" ? await db.get(s, k) : null;
    await del(s, k);
    if (cur) Sync.local(s.slice(0, -1), k, null, true);
  };
  const keySet = keys.set;
  keys.set = (n, v) => {
    keySet(n, v);
    if (Sync.on() && Sync.cfg().syncKeys) Sync.pushKeys();
  };
}
/** saveSetting without sending to the cloud (used for device-only settings and for applying cloud changes). */
function saveSettingRaw(k, v) {
  LS.setItem(k, JSON.stringify(v));
}
{
  const plain = saveSetting;
  saveSetting = (k, v) => {
    plain(k, v);
    if (SYNCED_SETTINGS.has(k)) {
      const at = now();
      saveSettingRaw(k + "@", at);
      Sync.local("setting", k, { value: v, at });
    }
  };
}
/** Spending from every device counts toward the budget. */
{
  const own = monthSpend;
  monthSpend = async (key = monthKey()) => {
    const m = await own(key);
    const others = (await kv.get("spendx:" + key, {})) || {};
    const out = { total: m.total, by: { ...m.by }, days: { ...m.days } };
    for (const [dev, o] of Object.entries(others)) {
      if (dev === Sync.me.id || !o) continue;
      out.total += o.total || 0;
      for (const [s, v] of Object.entries(o.by || {})) out.by[s] = (out.by[s] || 0) + v;
      for (const [d, v] of Object.entries(o.days || {})) out.days[d] = (out.days[d] || 0) + v;
    }
    return out;
  };
  const rec = recordSpend;
  recordSpend = (provider, amount) => {
    const p = rec(provider, amount);
    p.then(async () => {
      const m = await kv.get("spend:" + monthKey(), null);
      if (m) Sync.local("spend", monthKey() + "|" + Sync.me.id, m);
    });
    return p;
  };
}
