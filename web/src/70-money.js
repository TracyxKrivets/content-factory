// ---------------------------------------------------------------- money: budget, spending, real bills, plans
// The app keeps its own ledger of what each AI call cost (estimated from each service's prices).
// Real bills come from the services that offer them: ElevenLabs (normal key), OpenAI and Anthropic (admin keys).
// Plans and payments happen on each service's own billing page, opened inside the app.
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

const SERVICES = [
  {
    id: "anthropic", name: "Claude API (Anthropic)", icon: "🧠", key: "ANTHROPIC_API_KEY", admin: "ANTHROPIC_ADMIN_KEY",
    how: "Prepaid credits. Buy credits or turn on auto-reload; set a monthly spend limit under Limits.",
    billing: "https://console.anthropic.com/settings/billing", plans: "https://console.anthropic.com/settings/limits",
    adminUrl: "https://console.anthropic.com/settings/admin-keys",
  },
  {
    id: "openai", name: "OpenAI (scripts, voice, images, Sora)", icon: "🤖", key: "OPENAI_API_KEY", admin: "OPENAI_ADMIN_KEY",
    how: "Prepaid credits. Add credits or auto-recharge; set a monthly budget and alerts under Limits.",
    billing: "https://platform.openai.com/settings/organization/billing/overview", plans: "https://platform.openai.com/settings/organization/limits",
    adminUrl: "https://platform.openai.com/settings/organization/admin-keys",
  },
  {
    id: "gemini", name: "Google Gemini", icon: "✨", key: "GEMINI_API_KEY",
    how: "Free tier, or pay as you go through Google Cloud billing (needed for Gemini images). Google doesn't share bills with apps, so open the billing page to see it.",
    billing: "https://console.cloud.google.com/billing", plans: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    id: "elevenlabs", name: "ElevenLabs (voice)", icon: "🎙", key: "ELEVENLABS_API_KEY",
    how: "Monthly plan with a character allowance. Change plan or pay an open invoice on the subscription page.",
    billing: "https://elevenlabs.io/app/subscription", plans: "https://elevenlabs.io/pricing",
  },
  { id: "pexels", name: "Pexels (stock photos)", icon: "📷", key: "PEXELS_API_KEY", how: "Free. Nothing to pay." },
];
const SERVICE_OF = {
  anthropic: "anthropic", openai: "openai", "openai-tts": "openai", "openai-image": "openai", "openai-whisper": "openai", sora: "openai",
  gemini: "gemini", "gemini-tts": "gemini", "gemini-image": "gemini", elevenlabs: "elevenlabs", pexels: "pexels",
};
/** Free providers never count against the budget (Claude account = your Claude plan, no per-use cost). */
const FREE_IDS = new Set(["claude-account", "pexels", "estimated", "generated"]);
const isPaid = (p) => !p.offline && !FREE_IDS.has(p.id);

// ---- ledger (one record per month: total, per service, per day)
let spendLock = Promise.resolve();
function recordSpend(provider, amount) {
  if (!amount || !(amount > 0)) return spendLock;
  spendLock = spendLock.then(async () => {
    const svc = SERVICE_OF[String(provider || "").split(",")[0].trim()] || "other";
    const k = "spend:" + monthKey();
    const m = (await kv.get(k, null)) || { total: 0, by: {}, days: {} };
    m.total += amount;
    m.by[svc] = (m.by[svc] || 0) + amount;
    const d = new Date().getDate();
    m.days[d] = (m.days[d] || 0) + amount;
    await kv.set(k, m);
    changed();
  }).catch(() => {});
  return spendLock;
}
const monthSpend = async (key = monthKey()) => (await kv.get("spend:" + key, null)) || { total: 0, by: {}, days: {} };
const budget = () => ({ monthly: 0, ...loadSetting("cf-budget", {}) });

/** Called before every paid AI call. Stops the video (it can be resumed) once the month's budget is used. */
async function assertBudget() {
  const b = budget();
  if (!b.monthly) return;
  await spendLock;
  const m = await monthSpend();
  if (m.total >= b.monthly)
    throw new ProviderError("budget", `Monthly budget of ${money(b.monthly)} reached (${money(m.total)} spent)`, { retryable: false });
}

/** Rough cost of one video with the current Connect AI choices (for the Make page). */
function estimateVideoCost(lengthSec = 30) {
  const head = (cap, avoid = []) => chain(cap, avoid)[0];
  const llm = head("llm"), voice = head("voice"), img = head("image"), cap = head("captions");
  const scenes = Math.max(3, Math.round(lengthSec / 5));
  const chars = lengthSec * 15;
  let c = 0;
  if (llm && isPaid(llm)) c += llm.id === "anthropic" ? (/opus/.test(modelChoice("writer")) ? 0.12 : /haiku/.test(modelChoice("writer")) ? 0.015 : 0.05) : llm.id === "gemini" ? 0.02 : 0.03;
  if (voice && isPaid(voice)) c += voice.id === "elevenlabs" ? chars * PRICE.elevenlabsPerChar : voice.id === "openai-tts" ? chars * PRICE.openaiTtsPerChar : 0.003;
  const imgCost = (p, n) => (!p || !isPaid(p) ? 0 : p.id === "openai-image" ? n * PRICE.openaiImage : p.id === "gemini-image" ? n * 0.045 : 0);
  if (img?.id === "sora") {
    const s = soraSettings(), per = soraPrice(s.model), each = soraClipSec(lengthSec / scenes);
    c += s.mode === "hook" ? each * per + imgCost(head("image", ["sora"]), scenes - 1) : scenes * each * per;
  } else c += imgCost(img, scenes);
  if (cap?.id === "openai-whisper") c += (lengthSec / 60) * PRICE.whisperPerMinute;
  return c;
}

// ---- real bills from the services
async function fetchBill(svc) {
  const k = keys.get(svc.key), a = svc.admin && keys.get(svc.admin);
  const since = monthStart();
  if (svc.id === "elevenlabs" && k) {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": k }, signal: timeout(20000) });
    if (!res.ok) throw await httpError(res, "elevenlabs");
    const j = await res.json();
    const inv = j.next_invoice;
    const cur = (j.currency || "usd").toUpperCase();
    return {
      plan: `${cap(j.tier || "?")} plan${j.status && j.status !== "active" ? ` (${j.status.replace(/_/g, " ")})` : ""}`,
      lines: [
        `Characters used: ${(j.character_count || 0).toLocaleString()} of ${(j.character_limit || 0).toLocaleString()}` + (j.next_character_count_reset_unix ? `, resets ${new Date(j.next_character_count_reset_unix * 1000).toLocaleDateString()}` : ""),
        inv && inv.amount_due_cents != null ? `Next bill: ${(inv.amount_due_cents / 100).toFixed(2)} ${cur}${inv.next_payment_attempt_unix > 0 ? ` on ${new Date(inv.next_payment_attempt_unix * 1000).toLocaleDateString()}` : ""}` : null,
        j.has_open_invoices ? "⚠️ You have an unpaid invoice. Pay it on the subscription page." : null,
      ].filter(Boolean),
      usage: j.character_limit ? j.character_count / j.character_limit : null,
      alert: !!j.has_open_invoices || ["past_due", "incomplete"].includes(j.status),
    };
  }
  if (svc.id === "openai" && a) {
    let total = 0, page = null;
    for (let i = 0; i < 4; i++) {
      const u = `https://api.openai.com/v1/organization/costs?start_time=${Math.floor(since / 1000)}&bucket_width=1d&limit=31${page ? "&page=" + encodeURIComponent(page) : ""}`;
      const res = await fetch(u, { headers: { Authorization: `Bearer ${a}` }, signal: timeout(20000) });
      if (!res.ok) throw await httpError(res, "openai");
      const j = await res.json();
      for (const b of j.data || []) for (const r of b.results || []) total += Number(r.amount?.value) || 0;
      if (!j.has_more || !j.next_page) break;
      page = j.next_page;
    }
    return { spent: total, lines: [`Billed by OpenAI this month: ${money(total)} (all your OpenAI usage, not only this app)`] };
  }
  if (svc.id === "anthropic" && a) {
    let cents = 0, page = null;
    for (let i = 0; i < 4; i++) {
      const u = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(since.toISOString())}&bucket_width=1d&limit=31${page ? "&page=" + encodeURIComponent(page) : ""}`;
      const res = await fetch(u, { headers: { "x-api-key": a, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, signal: timeout(20000) });
      if (!res.ok) throw await httpError(res, "anthropic");
      const j = await res.json();
      for (const b of j.data || []) for (const r of b.results || []) cents += Number(r.amount) || 0; // amounts are in cents
      if (!j.has_more || !j.next_page) break;
      page = j.next_page;
    }
    return { spent: cents / 100, lines: [`Billed by Anthropic this month: ${money(cents / 100)} (all your Claude API usage, not only this app)`] };
  }
  return null;
}

/** Billing pages open inside the desktop app (your logins are kept); in a browser they open in a new tab. */
function openSite(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function MoneyPage() {
  const [b, setB] = useState(budget);
  const [draft, setDraft] = useState(() => (budget().monthly ? String(budget().monthly) : ""));
  const [bills, setBills] = useState({});
  const data = useData(async () => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: "short" }), m: await monthSpend(monthKey(d)) });
    }
    const ps = (await db.all("projects")).filter((p) => !p.deletedAt && p.createdAt >= monthStart().toISOString());
    return { months, cur: months[5].m, projects: ps.sort((x, y) => (y.cost || 0) - (x.cost || 0)).slice(0, 6) };
  });
  useData(async () => keys.all());
  const loadBills = async () => {
    for (const s of SERVICES) {
      if (!keys.get(s.key) && !(s.admin && keys.get(s.admin))) continue;
      if (!canFetch()) continue;
      setBills((x) => ({ ...x, [s.id]: { loading: true } }));
      try {
        const r = await fetchBill(s);
        setBills((x) => ({ ...x, [s.id]: r || { none: true } }));
      } catch (e) {
        const pe = toProviderError(e, s.id);
        setBills((x) => ({ ...x, [s.id]: { error: pe.code === "auth" ? "The key was refused (bills need the right key, see below)." : pe.code === "network" ? "Couldn't reach the service." : "Couldn't load the bill right now." } }));
      }
    }
  };
  useEffect(() => {
    loadBills();
  }, []);
  const saveBudget = () => {
    const n = Math.max(0, Number(String(draft).replace(/[^0-9.]/g, "")) || 0);
    const next = { ...b, monthly: n };
    setB(next);
    saveSetting("cf-budget", next);
    toast(n ? `Monthly budget set to ${money(n)} ✓` : "Budget turned off");
  };
  if (!data) return html`<div class="dim">Loading…</div>`;
  const spent = data.cur.total;
  const pct = b.monthly ? Math.min(1, spent / b.monthly) : 0;
  const left = b.monthly ? Math.max(0, b.monthly - spent) : null;
  const max = Math.max(0.01, ...data.months.map((x) => x.m.total));
  const svcName = (id) => SERVICES.find((s) => s.id === id)?.name || "Other";
  return html`<div style="max-width:820px;margin:0 auto">
    <h1 style="margin-top:16px">💰 Money</h1>
    <p class="dim" style="margin-top:0">Your budget, what the app has spent, your real bills, and where to change plans or pay.</p>

    <div class="card">
      <div class="row" style="align-items:flex-end;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div class="small dim">Spent this month (by this app)</div>
          <div style="font-size:38px;font-weight:800;line-height:1.1">${money(spent)}${b.monthly ? html`<span class="dim" style="font-size:18px;font-weight:600"> of ${money(b.monthly)}</span>` : ""}</div>
          ${b.monthly > 0 && html`<div class="meter" style="margin-top:10px"><div style=${`width:${pct * 100}%;background:${pct >= 1 ? "var(--red)" : pct >= 0.8 ? "var(--amber)" : "var(--green)"}`}></div></div>
            <div class="small" style="margin-top:6px">${pct >= 1 ? html`<b style="color:var(--red)">Budget used up.</b> Paid AI work is paused; free options still work.` : `${money(left)} left this month.`}</div>`}
        </div>
        <div style="min-width:240px">
          <label class="lbl small">Monthly budget (USD)</label>
          <div class="row" style="gap:8px"><input class="input" inputmode="decimal" placeholder="e.g. 20 (empty = no limit)" value=${draft} onInput=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && saveBudget()} style="width:170px" />
            <button class="btn primary" onClick=${saveBudget}>Save</button></div>
          <div class="small dim" style="margin-top:6px">When it's reached, videos pause instead of spending more. Raise it and press Try again to carry on.</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <b>This month by service</b>
      ${Object.keys(data.cur.by).length === 0 ? html`<p class="small dim">Nothing spent yet this month.</p>` : html`<div style="display:grid;gap:8px;margin-top:10px">
        ${Object.entries(data.cur.by).sort((x, y) => y[1] - x[1]).map(([id, v]) => html`<div class="row" style="gap:10px"><span class="small" style="width:220px">${svcName(id)}</span>
          <div class="meter" style="flex:1"><div style=${`width:${(v / spent) * 100}%`}></div></div><b class="small" style="width:70px;text-align:right">${money(v)}</b></div>`)}</div>`}
      <div class="small dim" style="margin-top:14px">Last 6 months</div>
      <div class="bars">${data.months.map((x) => html`<div class="mbar" title=${money(x.m.total)}><div style=${`height:${(x.m.total / max) * 100}%`}></div><span>${x.label}</span></div>`)}</div>
      ${data.projects.some((p) => p.cost > 0) && html`<div class="small dim" style="margin-top:12px">Top projects this month</div>
        <div style="display:grid;gap:4px;margin-top:6px">${data.projects.filter((p) => p.cost > 0).map((p) => html`<button class="row linkrow" onClick=${() => go("project-" + p.id)}><span class="small" style="flex:1;text-align:left">${p.title}</span><b class="small">${money(p.cost)}</b></button>`)}</div>`}
      <p class="small dim" style="margin:12px 0 0">These are the app's own estimates from each service's prices. The real bills below can differ a little.</p>
    </div>

    <h2 style="margin:26px 0 10px">Bills and plans</h2>
    <div style="display:grid;gap:12px">${SERVICES.map((s) => {
      const has = keys.get(s.key) || (s.admin && keys.get(s.admin));
      const bill = bills[s.id];
      return html`<div class=${"card" + (bill?.alert ? " alertcard" : "")}>
        <div class="row" style="gap:10px"><span style="font-size:24px">${s.icon}</span><div style="flex:1"><b>${s.name}</b>
          <div class="small dim">${has ? s.how : "Not connected."}</div></div>
          ${has && data.cur.by[s.id] > 0 && html`<span class="small dim">app spent ${money(data.cur.by[s.id])}</span>`}</div>
        ${has && bill && html`<div style="margin:10px 0 0 34px;display:grid;gap:4px">
          ${bill.loading && html`<span class="small dim">Loading your bill…</span>`}
          ${bill.error && html`<span class="small" style="color:#ffe0a0">${bill.error}</span>`}
          ${bill.plan && html`<b class="small">${bill.plan}</b>`}
          ${(bill.lines || []).map((l) => html`<span class="small">${l}</span>`)}
          ${bill.usage != null && html`<div class="meter" style="max-width:360px"><div style=${`width:${Math.min(1, bill.usage) * 100}%;background:${bill.usage > 0.9 ? "var(--red)" : "var(--green)"}`}></div></div>`}
        </div>`}
        ${has && s.admin && !keys.get(s.admin) && canFetch() && html`<p class="small dim" style="margin:10px 0 0 34px">To see your real ${s.id === "openai" ? "OpenAI" : "Anthropic"} bill here, paste an <b>admin key</b> (it starts with ${s.id === "openai" ? "sk-admin-" : "sk-ant-admin"}) in the key box on Connect AI. <a href=${s.adminUrl} target="_blank" rel="noreferrer" onClick=${(e) => { e.preventDefault(); openSite(s.adminUrl); }} style="text-decoration:underline">Make one ↗</a></p>`}
        ${s.billing && html`<div class="row" style="gap:8px;margin:12px 0 0 34px;flex-wrap:wrap">
          <button class="btn small primary" onClick=${() => openSite(s.billing)}>💳 Pay / add credits</button>
          <button class="btn small" onClick=${() => openSite(s.plans)}>Change plan or limits</button>
        </div>`}
      </div>`;
    })}</div>
    <p class="small dim" style="margin-top:14px">Paying and changing plans happen on each service's own secure page (the app never sees your card). ${window.cfNet ? "They open in a window inside the app and remember your login." : "They open in a new tab."}</p>
    <button class="btn" style="margin-top:6px" onClick=${loadBills}>↻ Refresh bills</button>
  </div>`;
}
