// ============================================================================
// Content Factory SHELL — loads the app, keeps versions, and hosts the
// "Change the app" chat. This part is NOT editable from the chat, so a bad
// change can never break the tool you'd use to fix it.
// ============================================================================
// ---------------------------------------------------------------- desktop app: use the computer's own internet
// In the Windows app, every web request goes through the operating system's network stack
// (system proxy, VPN, company certificates), and services that block browser calls just work.
(() => {
  const net = window.cfNet;
  if (!net || window.__cfNetBridged) return;
  window.__cfNetBridged = true;
  const native = window.fetch.bind(window);
  let n = 0;
  const DROP = new Set(["set-cookie", "set-cookie2"]);
  window.fetch = async function (input, init) {
    const req = new Request(input, init);
    if (!/^https:/i.test(req.url)) return native(input, init);
    const sig = req.signal;
    const aborted = () => new DOMException("The operation was aborted.", sig?.reason?.name === "TimeoutError" ? "TimeoutError" : "AbortError");
    if (sig?.aborted) throw aborted();
    const id = "f" + ++n + "-" + Date.now();
    const body = ["GET", "HEAD"].includes(req.method) ? null : new Uint8Array(await req.arrayBuffer());
    let onAbort;
    const stop = new Promise((_, rej) => {
      onAbort = () => {
        net.abort(id);
        rej(aborted());
      };
      sig?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const r = await Promise.race([net.fetch({ id, url: req.url, method: req.method, headers: [...req.headers], body }), stop]);
      if (r.error) throw new TypeError("Failed to fetch (" + r.error + ")");
      const headers = r.headers.filter(([k]) => !DROP.has(k.toLowerCase()));
      return new Response([101, 204, 205, 304].includes(r.status) ? null : r.body, { status: r.status, statusText: r.statusText, headers });
    } finally {
      sig?.removeEventListener("abort", onAbort);
    }
  };
})();

(() => {
  "use strict";
  const { html, render, useState, useEffect, useRef } = window.htmPreact;
  const BUILTIN = JSON.parse(document.getElementById("cf-source").textContent);
  // the GitHub repository Claude works on (fixes pushed there reach every device by auto-update)
  const REPO = BUILTIN.repo || "TracyxKrivets/content-factory";
  // recent crashes, so "Fix with Claude" can tell Claude exactly what went wrong
  const crashes = [];
  const noteCrash = (msg) => {
    msg = String(msg || "").slice(0, 400);
    if (!msg || crashes.some((c) => c.msg === msg)) return;
    crashes.unshift({ msg, at: new Date().toISOString() });
    crashes.length = Math.min(crashes.length, 8);
  };
  window.addEventListener("error", (e) => noteCrash(`${e.message}${e.filename ? ` (${String(e.filename).split("/").pop()}:${e.lineno})` : ""}`));
  window.addEventListener("unhandledrejection", (e) => noteCrash("Unhandled: " + (e.reason?.stack || e.reason?.message || e.reason)));
  const BOOT_TIMEOUT = 12000;

  // ---------------------------------------------------------------- shell storage
  const mem = new Map();
  let dbp;
  function sdb() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const r = indexedDB.open("content-factory-shell", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("versions", { keyPath: "id" });
          r.result.createObjectStore("meta");
        };
        r.onsuccess = () => res(r.result);
        r.onerror = r.onblocked = () => res(null);
      } catch {
        res(null);
      }
    });
    return dbp;
  }
  async function op(store, mode, fn) {
    const d = await sdb();
    if (!d) return fn(null)?.result;
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r?.result);
      t.onerror = () => rej(t.error);
    });
  }
  const meta = {
    get: async (k, dflt = null) => {
      const v = await op("meta", "readonly", (o) => (o ? o.get(k) : { result: mem.get("m:" + k) }));
      return v === undefined ? dflt : v;
    },
    set: (k, v) => op("meta", "readwrite", (o) => (o ? o.put(v, k) : (mem.set("m:" + k, v), null))),
  };
  const versions = {
    all: async () => ((await op("versions", "readonly", (o) => (o ? o.getAll() : { result: [...mem.values()].filter((x) => x?.files) }))) || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    get: (id) => op("versions", "readonly", (o) => (o ? o.get(id) : { result: mem.get("v:" + id) })),
    put: (v) => op("versions", "readwrite", (o) => (o ? o.put(v) : (mem.set("v:" + v.id, v), null))),
  };

  // ---------------------------------------------------------------- build + run the app
  const jsNames = (files) => Object.keys(files).filter((n) => n.endsWith(".js")).sort();
  const assemble = (files) => `(() => {\n"use strict";\n${jsNames(files).map((n) => `// ==== ${n} ====\n${files[n]}`).join("\n")}\n})();`;
  /** Returns an error message if the code can't even be parsed, else null. */
  function syntaxError(files) {
    try {
      new Function(assemble(files));
      return null;
    } catch (e) {
      // find which file by checking each one alone (files share scope, so only syntax is checked)
      for (const n of jsNames(files)) {
        try {
          new Function(files[n]);
        } catch (e2) {
          return `${n}: ${e2.message}`;
        }
      }
      return e.message;
    }
  }

  // ---------------------------------------------------------------- Claude account (inside claude.ai only)
  // window.claude exists only when the page runs inside a Claude viewer; use() resolves later.
  window.__cfClaude = { inClaude: !!window.claude?.use, sample: null, downloads: null, declined: false };
  window.__cfClaudeP = (async () => {
    if (!window.claude?.use) return window.__cfClaude;
    const [sample, downloads] = await Promise.all([
      window.claude.use("sample").catch(() => null),
      window.claude.use("downloads").catch(() => null),
    ]);
    let tools = false;
    try {
      tools = !!(sample && (await sample.limits())?.tools);
    } catch {}
    Object.assign(window.__cfClaude, { sample, downloads, tools });
    window.dispatchEvent(new Event("cf-claude"));
    return window.__cfClaude;
  })();
  const LS = {
    get(k, d) {
      try {
        return JSON.parse(localStorage.getItem(k) || "null") ?? d;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };

  let readyResolve;
  const appReady = new Promise((r) => (readyResolve = r));
  window.__cfShell = {
    ready: () => {
      readyResolve(true);
      window.cfApp?.booted(); // desktop app: this version started fine, keep it
    },
  };

  // ---------------------------------------------------------------- desktop app: "update ready" bar
  // Lives in the shell so no change to the app can ever hide it.
  if (window.cfApp?.onUpdate) {
    const show = (info) => {
      document.getElementById("cfs-update")?.remove();
      const bar = document.createElement("div");
      bar.id = "cfs-update";
      bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;background:#162447;color:#fff;border:1px solid #ffb84d;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.45);font:14px system-ui,sans-serif;max-width:min(680px,92vw)";
      const txt = document.createElement("span");
      txt.style.flex = "1";
      txt.textContent = "✨ An update to the app is ready" + (info?.notes ? ": " + String(info.notes).replace(/[.!]?$/, ".") : ".") + " Videos being made will carry on after the restart.";
      const go = document.createElement("button");
      go.textContent = "Restart now";
      go.style.cssText = "background:#ffb84d;color:#111;border:0;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer";
      go.onclick = () => window.cfApp.restart();
      const later = document.createElement("button");
      later.textContent = "Later";
      later.title = "It installs by itself next time you open the app";
      later.style.cssText = "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:8px 12px;cursor:pointer";
      later.onclick = () => bar.remove();
      bar.append(txt, go, later);
      document.body.appendChild(bar);
    };
    window.cfApp.onUpdate(show);
    window.cfApp.info().then((i) => i?.pending && show(i.pending)).catch(() => {});
  }

  async function boot() {
    const activeId = await meta.get("active");
    let active = activeId ? await versions.get(activeId) : null;
    // a newer file than the one these changes were made on: use the new file, keep history
    if (active && active.baseBuiltAt !== BUILTIN.builtAt) {
      await meta.set("active", null);
      await meta.set("notice", active.published
        ? { kind: "ok", text: "✓ Your change is now built into the app on all your devices." }
        : { kind: "info", text: "This is a newer copy of the app, so it started fresh. Your earlier chat changes are still in History if you want them back." });
      active = null;
    }
    // the last two starts of this version never finished → it's broken: roll back
    // (one unfinished start can just mean the tab was closed while loading)
    const booting = await meta.get("booting");
    const tries = booting && booting.id === (active?.id || "builtin") ? booting.tries : 0;
    if (active && tries >= 2) {
      await rollback(active, "it stopped the app from starting");
      return location.reload();
    }
    const files = active ? active.files : BUILTIN.files;
    window.__cfActive = { id: active?.id || null, note: active?.note || "Original version", files, published: active?.published || null };
    document.getElementById("cf-app-style").textContent = files["style.css"] || "";
    await meta.set("booting", { id: active?.id || "builtin", tries: tries + 1 });
    const crash = (msg) => onBootCrash(active, msg);
    const onErr = (e) => crash(e?.error?.message || e?.message || String(e?.reason || e));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr);
    try {
      new Function(assemble(files))();
    } catch (e) {
      return crash(e.message);
    }
    const ok = await Promise.race([appReady, new Promise((r) => setTimeout(() => r(false), BOOT_TIMEOUT))]);
    window.removeEventListener("error", onErr);
    window.removeEventListener("unhandledrejection", onErr);
    if (!ok) return crash("the app didn't finish starting");
    await meta.set("booting", null);
  }
  let crashed = false;
  async function onBootCrash(active, msg) {
    if (crashed) return;
    crashed = true;
    console.error("[shell] app failed to start:", msg);
    if (active) {
      await rollback(active, msg);
      location.reload();
    } else {
      document.getElementById("app").innerHTML = `<div class="wrap"><div class="banner bad" style="margin-top:40px">The app couldn't start: ${String(msg).replace(/[<>&]/g, "")}</div></div>`;
    }
  }
  async function rollback(bad, why) {
    await versions.put({ ...bad, broken: true });
    await meta.set("active", bad.parentId || null);
    await meta.set("booting", null);
    await meta.set("notice", { kind: "bad", text: `That change broke the app (${why}), so I undid it automatically. Tell me what you wanted and I'll try another way.` });
    await addChat({ role: "system", text: `The last change was undone automatically because the app failed to start: ${why}` });
    await meta.set("reopen", true);
  }

  // ---------------------------------------------------------------- chat history
  async function getChat() {
    return (await meta.get("chat", [])) || [];
  }
  async function addChat(m) {
    const c = await getChat();
    c.push({ ...m, at: new Date().toISOString() });
    await meta.set("chat", c.slice(-60));
  }

  // ---------------------------------------------------------------- keys (same storage as the app)
  function appKeys() {
    try {
      return JSON.parse(localStorage.getItem("cf-keys") || "{}");
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------- agent tools
  function fileMap(files) {
    return Object.keys(files)
      .sort()
      .map((n) => {
        const src = files[n];
        const lines = src.split("\n").length;
        const names = n.endsWith(".js")
          ? [...src.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=)/gm)].map((m) => m[1] || m[2]).slice(0, 45).join(", ")
          : "app styles (CSS)";
        return `- ${n} (${lines} lines): ${names}`;
      })
      .join("\n");
  }
  const TOOLS = [
    { name: "list_files", description: "List the app's files with line counts and the top-level names in each.", input_schema: { type: "object", properties: {} } },
    {
      name: "read_file",
      description: "Read a file, with line numbers. Read at most ~400 lines at a time.",
      input_schema: { type: "object", properties: { name: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } }, required: ["name"] },
    },
    {
      name: "search",
      description: "Find text in all files (case-insensitive). Returns file:line: text for each match.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "edit_file",
      description: "Replace exact text in a file. old_text must appear exactly once (copy it from read_file without the line numbers; include enough surrounding lines to be unique).",
      input_schema: { type: "object", properties: { name: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["name", "old_text", "new_text"] },
    },
    {
      name: "write_file",
      description: "Create a new file or replace a whole file. Prefer edit_file for changes to existing files.",
      input_schema: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] },
    },
    { name: "delete_file", description: "Delete a file you created. Never delete the core files.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  ];
  const CORE = new Set(Object.keys(BUILTIN.files));
  function runTool(files, name, input, log) {
    const f = input?.name;
    switch (name) {
      case "list_files":
        return fileMap(files);
      case "read_file": {
        if (!(f in files)) return `No file named ${f}. Files: ${Object.keys(files).join(", ")}`;
        const lines = files[f].split("\n");
        const s = Math.max(1, input.start_line || 1);
        const e = Math.min(lines.length, input.end_line || s + 399);
        log(`Reading ${f}`);
        return lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join("\n") + (e < lines.length ? `\n… (${lines.length - e} more lines; read with start_line=${e + 1})` : "");
      }
      case "search": {
        const q = String(input.query || "").toLowerCase();
        if (!q) return "Empty query.";
        const out = [];
        for (const n of Object.keys(files).sort())
          files[n].split("\n").forEach((l, i) => l.toLowerCase().includes(q) && out.length < 40 && out.push(`${n}:${i + 1}: ${l.trim().slice(0, 160)}`));
        log(`Searching for “${input.query}”`);
        return out.length ? out.join("\n") : "No matches.";
      }
      case "edit_file": {
        if (!(f in files)) return `No file named ${f}.`;
        const n = files[f].split(input.old_text).length - 1;
        if (n === 0) return "old_text was not found. Read the file again and copy the exact text (without line numbers).";
        if (n > 1) return `old_text appears ${n} times. Include more surrounding lines so it's unique.`;
        files[f] = files[f].replace(input.old_text, () => input.new_text);
        log(`Editing ${f}`);
        return "Done.";
      }
      case "write_file": {
        if (!/^[\w.-]+\.(js|css)$/.test(f || "")) return "Name must look like 65-feature.js or extra.css.";
        files[f] = String(input.content ?? "");
        log(`${CORE.has(f) ? "Rewriting" : "Creating"} ${f}`);
        return "Done.";
      }
      case "delete_file": {
        if (CORE.has(f)) return "Core files can't be deleted. Edit them instead.";
        if (!(f in files)) return `No file named ${f}.`;
        delete files[f];
        log(`Deleting ${f}`);
        return "Done.";
      }
    }
    return "Unknown tool.";
  }

  function systemPrompt(files) {
    return `You are the built-in developer for "Content Factory", a single-file web app that a non-technical content creator uses to make short-form videos (TikTok, Reels, Shorts). You change the app's own code when they ask to fix, add or remove features. They are not a programmer.

HOW THE APP IS BUILT
- Plain JavaScript files, joined in name order into ONE script with one shared scope (inside an IIFE), plus style.css. No imports, no npm, no build step.
- UI: Preact + htm. Available from window.htmPreact: html, render, useState, useEffect, useRef, useMemo, useCallback. Templates are html\`...\` with \${} expressions; components are functions; close components with <//>.
- Other globals: Mp4Muxer (MP4 writing), fflate (ZIP).
- Storage: IndexedDB through db / kv / blobs helpers and update() in 00-core.js; small settings via LS (localStorage wrapper). Keep old saved data working if you change data shapes.
- Navigation: go("make" | "projects" | "project-<id>" | "connect" | "system"), defined in 50-ui.js; pages are chosen in App(). Use buttons with onClick=\${() => go("x")}, never plain links.
- Network: only the AI provider APIs, called with the user's own keys (20-providers.js). No other websites, no CDNs.
- Video pipeline: 40-pipeline.js (steps, queue), rendering in 30-render.js (canvas + WebCodecs).
- To add a new page: write the component (e.g. in a new file "65-mypage.js"), add it to the page switch in App() and a button in Nav (50-ui.js).

FILES
${fileMap(files)}

RULES
- Make the smallest change that does what they asked. Don't rewrite files or remove features they didn't mention.
- Read the relevant code before editing. edit_file needs old_text copied exactly from read_file output (without the line-number prefix).
- Match the existing look: CSS classes like btn, btn primary, btn small, card, chip, chip on, banner warn/bad/good, row, grid, dim, small. Keep it easy to use: big buttons, plain words, few choices.
- New files: name them like "65-feature.js" so they load after what they use and before 90-boot.js.
- If the request is unclear or risky (deleting their data, huge rewrites), ask one short question instead of editing.
- When finished, reply with 1-3 short plain sentences saying what you changed (no code, no file names). The app reloads by itself to show it on this device; then they can press one button to put it on all their devices (Windows, Android, web), so the change must work everywhere, not only here.
- Each request ends with details from the app (device, page, recent errors). Use them to find problems; don't repeat them back.
- You cannot change this chat panel or the loader, add libraries, or reach other websites. If they ask for that, say so simply.`;
  }

  // ---------------------------------------------------------------- AI providers for the chat
  // rough USD per 1M tokens [input, output] — estimates for the cost note
  const PRICE = { "claude-opus-5-5": [5, 25], "claude-sonnet-5-5": [3, 15], "claude-haiku-5-5": [1, 5], "gpt-4.1": [2, 8] };
  const chatModel = () => LS.get("cf-models", {}).chat || "claude-sonnet-5-5";
  async function callAnthropic(key, system, messages) {
    const model = chatModel();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      }),
    });
    if (!res.ok) throw await apiError(res, "Anthropic");
    const j = await res.json();
    const u = j.usage || {};
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
    return {
      content: j.content || [],
      stop: j.stop_reason,
      cost: (inTok * (PRICE[model] || PRICE["claude-sonnet-5-5"])[0] + (u.output_tokens || 0) * (PRICE[model] || PRICE["claude-sonnet-5-5"])[1]) / 1e6,
    };
  }
  // OpenAI: translate to/from the Anthropic-style messages used by the loop
  async function callOpenAI(key, system, messages, api = { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1", who: "OpenAI" }) {
    const model = api.model;
    const msgs = [{ role: "system", content: system }];
    for (const m of messages) {
      if (typeof m.content === "string") msgs.push({ role: m.role, content: m.content });
      else if (m.role === "assistant") {
        const text = m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        // extra_content carries Gemini's thought signature, which it needs back on the next turn
        const calls = m.content.filter((c) => c.type === "tool_use").map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) }, ...(c.extra ? { extra_content: c.extra } : {}) }));
        msgs.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      } else
        for (const c of m.content) {
          if (c.type === "tool_result") msgs.push({ role: "tool", tool_call_id: c.tool_use_id, content: String(c.content) });
          else if (c.type === "text") msgs.push({ role: "user", content: c.text });
        }
    }
    const res = await fetch(api.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: msgs, tools: TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
    });
    if (!res.ok) throw await apiError(res, api.who);
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    const content = [];
    if (msg.content) content.push({ type: "text", text: msg.content });
    for (const tc of msg.tool_calls || []) {
      let input = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {}
      content.push({ type: "tool_use", id: tc.id || "call_" + Math.random().toString(36).slice(2), name: tc.function.name, input, ...(tc.extra_content ? { extra: tc.extra_content } : {}) });
    }
    const u = j.usage || {};
    return { content, stop: msg.tool_calls?.length ? "tool_use" : "end_turn", cost: ((u.prompt_tokens || 0) * (PRICE[model] || [2, 12])[0] + (u.completion_tokens || 0) * (PRICE[model] || [2, 12])[1]) / 1e6 };
  }
  async function apiError(res, who) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401 || res.status === 403 || /api key not valid|API_KEY_INVALID/i.test(body)) return new Error(`${who} rejected your API key. Check it on the Connect AI page.`);
    if (res.status === 429) return new Error(`${who} is busy right now. Try again in a minute.`);
    if (res.status === 402 || /credit|quota|billing/i.test(body)) return new Error(`Your ${who} account is out of credits.`);
    return new Error(`${who} had a problem (${res.status}). Try again. ${body}`);
  }
  /** Which AI runs the chat: the choice on the Connect AI page, else whatever is available. */
  function pickModel() {
    if (window.__cfMockAgent) return { kind: "loop", call: window.__cfMockAgent };
    const C = window.__cfClaude;
    const k = appKeys();
    const pref = LS.get("cf-roles", {}).chat;
    const opts = {
      "claude-account": C.sample && !C.declined ? { kind: "sample" } : null,
      anthropic: !C.inClaude && k.ANTHROPIC_API_KEY ? { kind: "loop", call: (s, m) => callAnthropic(k.ANTHROPIC_API_KEY, s, m) } : null,
      openai: !C.inClaude && k.OPENAI_API_KEY ? { kind: "loop", call: (s, m) => callOpenAI(k.OPENAI_API_KEY, s, m) } : null,
      // Gemini through its OpenAI-style endpoint; Pro (newest your key has) because editing code needs the smarter model
      gemini: !C.inClaude && k.GEMINI_API_KEY ? { kind: "loop", call: (s, m) => callOpenAI(k.GEMINI_API_KEY, s, m, {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", who: "Gemini",
        model: (LS.get("cf-gemini-models", {}) || {}).pro || "gemini-pro-latest",
      }) } : null,
    };
    // AI services you added yourself (Grok, DeepSeek, Mistral…): same OpenAI-style tool calls
    if (!C.inClaude)
      for (const c of LS.get("cf-custom-ai", []) || [])
        if (c?.id && c.base && k["CUSTOM_" + c.id])
          opts["custom:" + c.id] = { kind: "loop", call: (s, m) => callOpenAI(k["CUSTOM_" + c.id], s, m, { url: c.base + "/chat/completions", model: c.model, who: c.name }) };
    const firstCustom = Object.keys(opts).find((x) => x.startsWith("custom:") && opts[x]);
    return opts[pref] || opts["claude-account"] || opts.anthropic || opts.openai || opts.gemini || (firstCustom && opts[firstCustom]) || null;
  }
  /** Model options for a Claude-account call, from the chosen model name. */
  function sampleModelOpts(model) {
    if (model === "claude-opus-5-5") return { model, modelTier: "complex" };
    if (model === "claude-haiku-5-5") return { model, modelTier: "quick" };
    return { model: "claude-sonnet-5-5", modelTier: "default" };
  }
  function sampleErrorText(e) {
    const c = e?.code;
    if (c === "not_granted") {
      window.__cfClaude.declined = true;
      return "The app wasn't allowed to use your Claude account. Reload the page and press Allow when Claude asks.";
    }
    if (c === "rate_limited") return "You've hit your Claude usage limit for now. Try again a bit later.";
    if (c === "sampling_disabled") return "Claude isn't available for this account here.";
    if (c === "session_expired") return "Please sign in to Claude again.";
    if (c === "prompt_too_large") return "That was too much for one go. Try a smaller request.";
    if (c === "tools_unavailable") return "This Claude app can't edit code from a page yet. Try claude.ai in a web browser.";
    if (c === "cancelled") return "Stopped.";
    return "Claude had a problem with that. Try again.";
  }

  /** Same job as runAgent, but on the viewer's Claude account: sample() runs the tool rounds itself. */
  async function runAgentSample(request, history, log) {
    const sample = window.__cfClaude.sample;
    const files = structuredClone(window.__cfActive.files);
    const before = JSON.stringify(files);
    const tools = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
      execute: (input) => {
        const out = String(runTool(files, t.name, input || {}, log));
        return out.length > 30000 ? out.slice(0, 30000) + "\n… (cut off: read a smaller range)" : out;
      },
    }));
    const turns = [
      { role: "user", content: systemPrompt(files) + "\n\nYou have a limited number of tool rounds per reply. If you run out before you're done, end your reply with the word [CONTINUE] and you'll get another turn." },
      ...history.filter((m) => m.role === "user" || m.role === "assistant").slice(-8).map((m) => ({ role: m.role, content: m.text })),
      { role: "user", content: request },
    ];
    let reply = "";
    let fixes = 0;
    for (let round = 0; round < 5; round++) {
      let r;
      try {
        r = await sample(turns, { tools, ...sampleModelOpts(chatModel()) });
      } catch (e) {
        throw new Error(sampleErrorText(e));
      }
      const text = String(r.text || "").trim();
      reply = text.replace(/\[CONTINUE\]/g, "").trim().split(/\n\s*\n/).pop() || reply;
      turns.push({ role: "assistant", content: text });
      if (/\[CONTINUE\]/.test(text)) {
        log("Continuing…");
        turns.push({ role: "user", content: "Continue where you left off. Your edits so far are kept." });
        continue;
      }
      if (JSON.stringify(files) !== before) {
        const err = syntaxError(files);
        if (err && fixes < 2) {
          fixes++;
          log("Fixing a mistake in the change");
          turns.push({ role: "user", content: `Your change has a syntax error, so it can't run: ${err}. Fix it with edit_file, then reply with the summary again.` });
          continue;
        }
        if (err) throw new Error("I couldn't get that change to work, so nothing was changed. Try asking in a different way.");
      }
      return { reply: reply || "Done.", files, changed: JSON.stringify(files) !== before, cost: 0 };
    }
    throw new Error("That took too many steps, so I stopped and changed nothing. Try a smaller request.");
  }

  /** One user request → tool loop → (maybe) a new version. */
  async function runAgent(request, history, log) {
    await window.__cfClaudeP;
    const model = pickModel();
    if (!model) throw new Error("NO_KEY");
    if (model.kind === "sample") return runAgentSample(request, history, log);
    const files = structuredClone(window.__cfActive.files);
    const before = JSON.stringify(files);
    const system = systemPrompt(files);
    const messages = [
      ...history.filter((m) => m.role === "user" || m.role === "assistant").slice(-8).map((m) => ({ role: m.role, content: m.text })),
      { role: "user", content: request },
    ];
    // Anthropic requires alternating roles starting with user
    while (messages.length && messages[0].role !== "user") messages.shift();
    for (let i = 1; i < messages.length; i++) if (messages[i].role === messages[i - 1].role) messages.splice(i - 1, 1), i--;
    let cost = 0;
    let reply = "";
    let fixes = 0;
    for (let step = 0; step < 30; step++) {
      const r = await model.call(system, messages);
      cost += r.cost || 0;
      messages.push({ role: "assistant", content: r.content });
      const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
      if (text) reply = text;
      const calls = r.content.filter((c) => c.type === "tool_use");
      if (calls.length) {
        messages.push({ role: "user", content: calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: String(runTool(files, c.name, c.input, log)) })) });
        continue;
      }
      // finished: check the change compiles before keeping it
      if (JSON.stringify(files) !== before) {
        const err = syntaxError(files);
        if (err && fixes < 3) {
          fixes++;
          log("Fixing a mistake in the change");
          messages.push({ role: "user", content: `Your change has a syntax error, so it can't run: ${err}. Fix it with edit_file, then reply with the summary again.` });
          continue;
        }
        if (err) throw new Error("I couldn't get that change to work, so nothing was changed. Try asking in a different way.");
      }
      return { reply: reply || "Done.", files, changed: JSON.stringify(files) !== before, cost };
    }
    throw new Error("That took too many steps, so I stopped and changed nothing. Try a smaller request.");
  }

  async function saveVersion(files, note) {
    const v = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
      files, note: note.slice(0, 300), parentId: window.__cfActive.id, baseBuiltAt: BUILTIN.builtAt, createdAt: new Date().toISOString(),
    };
    await versions.put(v);
    await meta.set("active", v.id);
    return v;
  }
  async function activate(id, why) {
    await meta.set("active", id);
    await meta.set("booting", null);
    await meta.set("reopen", true);
    if (why) await addChat({ role: "system", text: why });
    reloadApp();
  }
  function reloadApp() {
    window.__cfReloading = true; // tells the app not to show "leave page?" prompts
    location.reload();
  }

  // ---------------------------------------------------------------- export the current version as a file
  function exportHtml() {
    const files = window.__cfActive.files;
    const tag = (id) => document.getElementById(id);
    const json = JSON.stringify({ files, builtAt: new Date().toISOString() }).replace(/<\//g, "<\\/");
    const head = [...document.head.querySelectorAll("meta,title,link")].map((n) => n.outerHTML).join("\n");
    return `<!DOCTYPE html>
<html lang="en">
<head>
${head}
<style id="cf-shell-style">${tag("cf-shell-style").textContent}</style>
<style id="cf-app-style"></style>
</head>
<body>
<div id="app"><div style="padding:60px;text-align:center;font-family:system-ui;color:#9aa6c8">Loading Content Factory…</div></div>
<div id="cf-shell"></div>
<script id="cf-vendor">${tag("cf-vendor").textContent}</script>
<script type="application/json" id="cf-source">${json}</script>
<script id="cf-shell-js">${tag("cf-shell-js").textContent}</script>
</body>
</html>`;
  }
  async function download(name, text) {
    const d = window.__cfClaude.downloads;
    if (d) {
      try {
        await d.save({ filename: name, data: new Blob([text], { type: "text/html" }) });
      } catch (e) {
        if (e?.code !== "declined") alertBox("Couldn't save the file here: " + (e?.message || e?.code));
      }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/html" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function alertBox(msg) {
    addChat({ role: "system", text: msg });
  }

  // ---------------------------------------------------------------- chat UI
  const SUGGEST = [
    "Add a button to download a project's scripts as a text file",
    "Make the GENERATE VIDEOS button green",
    "Remove the language option",
    "Something's broken: the projects page shows an error",
  ];
  function Shell() {
    const [open, setOpen] = useState(false);
    const [chat, setChat] = useState([]);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [activity, setActivity] = useState([]);
    const [notice, setNotice] = useState(null);
    const [hist, setHist] = useState(null);
    const end = useRef();
    const refresh = async () => setChat(await getChat());
    useEffect(() => {
      (async () => {
        await refresh();
        const n = await meta.get("notice");
        if (n) {
          setNotice(n);
          await meta.set("notice", null);
        }
        if (await meta.get("reopen")) {
          setOpen(true);
          await meta.set("reopen", false);
        }
      })();
    }, []);
    useEffect(() => end.current?.scrollIntoView({ block: "end" }), [chat, activity, open]);

    async function send(msg) {
      msg = (msg ?? text).trim();
      if (!msg || busy) return;
      setText("");
      setBusy(true);
      setActivity([]);
      const history = await getChat();
      await addChat({ role: "user", text: msg });
      await refresh();
      try {
        const out = await runAgent(msg + (await appContext()), history, (a) => setActivity((x) => [...x, a]));
        const costNote = out.cost ? ` (cost about $${out.cost.toFixed(out.cost < 0.01 ? 3 : 2)})` : "";
        if (out.changed) {
          await saveVersion(out.files, out.reply);
          await addChat({ role: "assistant", text: out.reply, changed: true, costNote });
          await meta.set("reopen", true);
          setActivity((x) => [...x, "Reloading to show the change…"]);
          setTimeout(reloadApp, 700);
          return;
        }
        await addChat({ role: "assistant", text: out.reply, costNote });
      } catch (e) {
        if (e.message === "NO_KEY")
          await addChat({
            role: "system",
            text: window.__cfClaude.inClaude
              ? "I can't reach your Claude account from this page right now. Reload it and press Allow when Claude asks."
              : "To change the app I need an AI: add an Anthropic, OpenAI or Gemini key on the Connect AI page (or open the app inside Claude to use your Claude account), then ask again.",
            action: window.__cfClaude.inClaude ? null : "connect",
          });
        else await addChat({ role: "system", text: e.message || String(e) });
      }
      setBusy(false);
      setActivity([]);
      await refresh();
    }
    async function undo() {
      const cur = window.__cfActive;
      if (!cur.id) return;
      const v = await versions.get(cur.id);
      activate(v?.parentId || null, `Undid: “${(v?.note || "last change").slice(0, 80)}”`);
    }
    const isChanged = !!window.__cfActive?.id;

    return html`
      ${!open && html`<button class="cfs-fab" onClick=${() => setOpen(true)} title="Fix, add or remove features">🛠 <span>Fix or change the app</span></button>`}
      ${notice && !open && html`<div class=${"cfs-notice " + notice.kind} onClick=${() => (setOpen(true), setNotice(null))}>${notice.text}</div>`}
      ${open && html`<aside class="cfs-panel">
        <header class="cfs-head">
          <div><b>🛠 Change the app</b><div class="cfs-sub">${!isChanged ? "Tell me what to fix, add or remove" : window.__cfActive.published ? "Your change is on all your devices" : "Changed on this device only"}</div></div>
          <div class="cfs-actions">
            ${isChanged && html`<button class="cfs-btn" onClick=${undo} disabled=${busy} title="Go back to before the last change">↶ Undo</button>`}
            <button class="cfs-btn" onClick=${async () => setHist(await versions.all())} disabled=${busy}>History</button>
            <button class="cfs-btn" onClick=${() => setOpen(false)} title="Close">✕</button>
          </div>
        </header>
        ${notice && html`<div class=${"cfs-banner " + notice.kind}>${notice.text}</div>`}
        <${PublishBox} isChanged=${isChanged} busy=${busy} onBusy=${setBusy} />
        <div class="cfs-msgs">
          ${!chat.length && html`<div class="cfs-empty">
            <p>Tell me what to <b>fix, add or remove</b> and I'll change the app for you, right here. It reloads by itself to show the change, and your projects are kept.</p>
            <p>I try it on <b>this device first</b>. If you like it, one press puts it on <b>all your devices</b>.</p>
            <p class="cfs-dim">If a change goes wrong, press <b>↶ Undo</b>. If it breaks the app, I undo it automatically.</p>
            ${SUGGEST.map((s) => html`<button class="cfs-chip" onClick=${() => send(s)}>${s}</button>`)}
          </div>`}
          ${chat.map((m) => html`<div class=${"cfs-msg " + m.role}>
            ${m.text}${m.changed && html`<div class="cfs-tag">✓ Changed${m.costNote || ""}</div>`}${!m.changed && m.costNote && html`<div class="cfs-tag">${m.costNote.trim()}</div>`}
            ${m.action === "connect" && html`<div><button class="cfs-btn primary" onClick=${() => { window.__cfGo?.("connect"); setOpen(false); }}>🔌 Open Connect AI</button></div>`}
          </div>`)}
          ${busy && html`<div class="cfs-msg assistant cfs-working"><span class="cfs-spin">◐</span> Working on it…
            ${activity.map((a) => html`<div class="cfs-act">${a}</div>`)}</div>`}
          <div ref=${end}></div>
        </div>
        ${html`<form class="cfs-input" onSubmit=${(e) => (e.preventDefault(), send())}>
          <textarea value=${text} placeholder="e.g. add a button that copies all scripts" onInput=${(e) => setText(e.target.value)}
            onKeyDown=${(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} disabled=${busy} rows="2"></textarea>
          <button class="cfs-btn primary" type="submit" disabled=${busy || !text.trim()}>Send</button>
        </form>`}
        ${hist && html`<div class="cfs-overlay" onClick=${() => setHist(null)}><div class="cfs-modal" onClick=${(e) => e.stopPropagation()}>
          <h3>Versions</h3>
          <div class="cfs-vlist">
            ${hist.map((v) => html`<div class=${"cfs-v" + (v.id === window.__cfActive.id ? " on" : "")}>
              <div><div>${v.note}</div><div class="cfs-dim">${new Date(v.createdAt).toLocaleString()}${v.broken ? " · ⚠️ broke the app" : ""}${v.baseBuiltAt !== BUILTIN.builtAt ? " · from an older copy" : ""}</div></div>
              ${v.id === window.__cfActive.id ? html`<span class="cfs-dim">in use</span>` : v.broken ? html`<span class="cfs-dim">can't use</span>` : html`<button class="cfs-btn" onClick=${() => activate(v.id, `Switched to: “${v.note.slice(0, 80)}”`)}>Use this</button>`}
            </div>`)}
            <div class=${"cfs-v" + (!window.__cfActive.id ? " on" : "")}><div><div>Original version</div><div class="cfs-dim">As the file came</div></div>
              ${!window.__cfActive.id ? html`<span class="cfs-dim">in use</span>` : html`<button class="cfs-btn" onClick=${() => activate(null, "Switched back to the original version.")}>Use this</button>`}</div>
          </div>
          <p class="cfs-dim">Changes live in this browser. To keep them, or open them somewhere else, download this version as a file.</p>
          <div class="cfs-row"><button class="cfs-btn primary" onClick=${() => download(`Content Factory${isChanged ? " (changed)" : ""}.html`, exportHtml())}>⬇ Download this version</button>
            <button class="cfs-btn" onClick=${() => setHist(null)}>Close</button></div>
        </div></div>`}
      </aside>`}`;
  }

  // ---------------------------------------------------------------- details for the AI (version, device, recent errors; never keys)
  const deviceName = () => (window.cfNet ? "Windows app" : window.Capacitor?.isNativePlatform?.() ? "Android app" : window.__cfClaude?.inClaude ? "inside Claude" : /Android|iPhone|Mobile/i.test(navigator.userAgent) ? "phone browser" : "browser");
  async function appContext() {
    const lines = [`- Device: ${deviceName()}, screen ${innerWidth}×${innerHeight}`, `- Page they're on: ${location.hash || "#make"}`];
    try {
      const errs = ((await window.__cf?.kv.get("errors", [])) || []).filter((e) => !e.resolved).slice(0, 5);
      for (const e of errs) lines.push(`- Problem in step "${e.step}": ${e.error?.title || ""} ${e.error?.technical ? "(" + String(e.error.technical).slice(0, 300) + ")" : ""}`.trim());
    } catch {}
    for (const c of crashes.slice(0, 4)) lines.push(`- App error: ${c.msg}`);
    return "\n\n(Details from the app, filled in automatically. Use them if they help:\n" + lines.join("\n") + ")";
  }

  // ---------------------------------------------------------------- 📤 put a change on every device (GitHub)
  // The app's code lives in Tracy's GitHub repository. Publishing commits the changed files there;
  // GitHub then builds the Windows, Android and web apps, and every installed copy updates itself.
  const GH_RX = /^(ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{20,}$/;
  const GH_KEY_URL = "https://github.com/settings/tokens/new?scopes=repo&description=Content%20Factory%20app";
  const ghToken = () => {
    const k = appKeys();
    return (k.GITHUB_TOKEN || Object.values(k).find((v) => GH_RX.test(String(v).trim())) || "").trim();
  };
  function saveGhToken(v) {
    v = v.trim();
    if (window.__cf?.keys) window.__cf.keys.set("GITHUB_TOKEN", v);
    else localStorage.setItem("cf-keys", JSON.stringify({ ...appKeys(), GITHUB_TOKEN: v }));
  }
  const repoPath = (n) => (n === "style.css" ? "web/style.css" : "web/src/" + n);
  const norm = (s) => String(s).replace(/\r\n/g, "\n");
  const same = (a, b) => (a == null || b == null ? a == null && b == null : norm(a) === norm(b));
  const ghErr = (msg, key) => Object.assign(new Error(msg), { ghKey: !!key });
  async function gh(tok, p, opts = {}) {
    let res;
    try {
      res = await fetch("https://api.github.com" + p, {
        method: opts.method || "GET",
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        headers: { Authorization: "Bearer " + tok, Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch {
      throw ghErr("Couldn't reach GitHub. Check your internet and press the button again.");
    }
    if (opts.allow404 && res.status === 404) return null;
    if (opts.allow422 && res.status === 422) return { conflict: true };
    if (res.status === 401) throw ghErr("GitHub didn't accept your key. Make a new one with the button below and paste it.", true);
    if (res.status === 403 || res.status === 404) throw ghErr("That GitHub key isn't allowed to change your app. Make a new one with the button below (keep “repo” ticked) and paste it.", true);
    if (!res.ok) throw ghErr(`GitHub had a problem (${res.status}). Press the button again in a minute.`);
    return opts.raw ? res.text() : res.json();
  }
  /** Can this key change the app's repository? */
  async function checkGhToken(tok) {
    const r = await gh(tok, `/repos/${REPO}`);
    if (!r?.permissions?.push) throw ghErr(`That GitHub key can't change ${REPO}. Make it while signed in as the owner, with “repo” ticked.`, true);
  }
  /** The chain of versions behind what's running now, newest first, back to the last published one. */
  async function unpublishedChain() {
    const out = [];
    let id = window.__cfActive?.id;
    while (id) {
      const v = await versions.get(id);
      if (!v || v.baseBuiltAt !== BUILTIN.builtAt) break;
      if (v.published) return { chain: out, base: v.files };
      out.push(v);
      id = v.parentId;
    }
    return { chain: out, base: BUILTIN.files };
  }
  async function publishChanges(log) {
    const tok = ghToken();
    if (!tok) throw ghErr("NEED_KEY", true);
    const { chain, base } = await unpublishedChain();
    const files = window.__cfActive.files;
    const names = [...new Set([...Object.keys(files), ...Object.keys(base)])].filter((n) => !same(files[n], base[n]));
    if (!names.length) throw ghErr("There's nothing new to send: your devices already have this.");
    const notes = chain.map((v) => v.note).reverse();
    const title = ("App change: " + (notes[notes.length - 1] || "update")).replace(/\s+/g, " ").slice(0, 70);
    const message = `${title}\n\nMade with the in-app chat on the ${deviceName()}.\n\n${notes.map((n) => "- " + n.replace(/\s+/g, " ")).join("\n")}\n\nFiles: ${names.map(repoPath).join(", ")}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      log("Checking your app on GitHub");
      const head = (await gh(tok, `/repos/${REPO}/git/ref/heads/main`)).object.sha;
      for (const n of names) {
        const remote = await gh(tok, `/repos/${REPO}/contents/${repoPath(n)}?ref=${head}`, { raw: true, allow404: true });
        if (!same(remote, base[n]) && !same(remote, files[n]))
          throw ghErr("Your app got an update since this change was made, so I didn't send it (it could undo the update). Close and open the app (or press Restart now on the update bar), then ask for the change again.");
      }
      log("Sending the change");
      const commit = await gh(tok, `/repos/${REPO}/git/commits/${head}`);
      const tree = await gh(tok, `/repos/${REPO}/git/trees`, {
        method: "POST",
        body: { base_tree: commit.tree.sha, tree: names.map((n) => (n in files ? { path: repoPath(n), mode: "100644", type: "blob", content: files[n] } : { path: repoPath(n), mode: "100644", type: "blob", sha: null })) },
      });
      const made = await gh(tok, `/repos/${REPO}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [head] } });
      const moved = await gh(tok, `/repos/${REPO}/git/refs/heads/main`, { method: "PATCH", body: { sha: made.sha }, allow422: true });
      if (moved?.conflict) continue; // someone published at the same moment: check again
      for (const v of chain) await versions.put({ ...v, published: made.sha });
      window.__cfActive.published = made.sha;
      const rec = { sha: made.sha, at: new Date().toISOString(), note: notes[notes.length - 1] || "", build: "building" };
      await meta.set("publish", rec);
      return rec;
    }
    throw ghErr("GitHub was busy. Press the button again.");
  }
  /** How GitHub's build of a published change is going: building | ok | failed. */
  async function buildState(sha) {
    const r = await gh(ghToken(), `/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=5`);
    const run = (r.workflow_runs || [])[0];
    if (!run || run.status !== "completed") return "building";
    return run.conclusion === "success" ? "ok" : "failed";
  }

  function PublishBox({ isChanged, busy, onBusy }) {
    const [rec, setRec] = useState(null);
    const [step, setStep] = useState(null); // null | "key" | "sending"
    const [err, setErr] = useState("");
    const [log, setLog] = useState([]);
    const [key, setKey] = useState("");
    const [, tick] = useState(0);
    useEffect(() => {
      meta.get("publish").then((r) => r && setRec(r));
    }, []);
    // follow GitHub's build while the panel is open
    useEffect(() => {
      if (!rec || rec.build !== "building" || !ghToken()) return;
      let stop = false;
      const check = async () => {
        try {
          const b = await buildState(rec.sha);
          if (stop || b === "building") return;
          const r2 = { ...rec, build: b };
          await meta.set("publish", r2);
          setRec(r2);
        } catch {}
      };
      check();
      const t = setInterval(check, 20000);
      return () => ((stop = true), clearInterval(t));
    }, [rec?.sha, rec?.build]);

    const pending = isChanged && !window.__cfActive?.published;
    async function send(withKey) {
      setErr("");
      if (withKey !== undefined) {
        const k = withKey.trim();
        if (!GH_RX.test(k)) return setErr("That doesn't look like a GitHub key. It starts with ghp_ or github_pat_. Copy it again.");
        setStep("sending");
        onBusy(true);
        try {
          await checkGhToken(k);
          saveGhToken(k);
          setKey("");
        } catch (e) {
          onBusy(false);
          setStep("key");
          return setErr(e.message);
        }
      }
      if (!ghToken()) return setStep("key");
      setStep("sending");
      setLog([]);
      onBusy(true);
      try {
        const r = await publishChanges((a) => setLog((x) => [...x, a]));
        await addChat({ role: "system", text: "📤 Sent to all your devices. They'll show “An update to the app is ready” in about 10 minutes." });
        setRec(r);
        setStep(null);
      } catch (e) {
        setStep(e.ghKey && e.message !== "There's nothing new to send: your devices already have this." ? "key" : null);
        if (e.message !== "NEED_KEY") setErr(e.message);
      }
      onBusy(false);
      tick((n) => n + 1);
    }

    if (window.__cfClaude?.inClaude)
      return isChanged ? html`<div class="cfs-banner info">This change is only here. To put changes on all your devices, ask in the Windows or phone app.</div>` : null;
    return html`
      ${rec && !pending && step !== "sending" && html`<div class=${"cfs-banner " + (rec.build === "failed" ? "bad" : "ok")}>
        ${rec.build === "building" && html`<b>📤 Sent to all your devices.</b><br />Building the new version now (about 10 minutes). Then each device shows “An update to the app is ready”: press <b>Restart now</b>.`}
        ${rec.build === "ok" && html`<b>✓ Your change is ready on all devices.</b><br />Each one shows “An update to the app is ready”: press <b>Restart now</b>. This device already has it.`}
        ${rec.build === "failed" && html`<b>The new version didn't build</b>, so your other devices didn't get it. This device still has it. Tell me “the update didn't build” and I'll fix it.`}
        <div class="cfs-row" style="margin-top:8px"><button class="cfs-btn" onClick=${async () => (await meta.set("publish", null), setRec(null))}>OK</button></div>
      </div>`}
      ${pending && step !== "key" && html`<div class="cfs-banner info cfs-pub">
        ${step === "sending"
          ? html`<div><span class="cfs-spin">◐</span> Sending to all your devices…</div>${log.map((a) => html`<div class="cfs-act">${a}</div>`)}`
          : html`<div>This change is <b>only on this device</b>. Happy with it?</div>
            <button class="cfs-btn primary cfs-big" disabled=${busy} onClick=${() => send()}>📤 Put it on all my devices</button>`}
      </div>`}
      ${step === "key" && html`<div class="cfs-banner info cfs-pub">
        <b>One-time step: connect GitHub</b> (where your app is kept, so all your devices get changes).
        <ol>
          <li>Press <b>Get GitHub key</b> and sign in.</li>
          <li>Scroll down and press <b>Generate token</b>.</li>
          <li>Copy the key (starts with ghp_) and paste it here.</li>
        </ol>
        <div class="cfs-row"><button class="cfs-btn" onClick=${() => window.open(GH_KEY_URL, "_blank")}>🔑 Get GitHub key</button></div>
        <input class="cfs-key" type="password" placeholder="Paste the GitHub key here" value=${key} onInput=${(e) => setKey(e.target.value)} />
        <div class="cfs-row">
          <button class="cfs-btn primary" disabled=${!key.trim() || busy} onClick=${() => send(key)}>Save and send</button>
          <button class="cfs-btn" onClick=${() => (setStep(null), setErr(""))}>Not now</button>
        </div>
      </div>`}
      ${err && html`<div class="cfs-banner bad">${err}</div>`}`;
  }

  // ---------------------------------------------------------------- start
  render(html`<${Shell} />`, document.getElementById("cf-shell"));
  boot();
})();
