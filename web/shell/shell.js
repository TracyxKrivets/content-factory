// ============================================================================
// Content Factory SHELL — loads the app, keeps versions, and hosts the
// "Change the app" chat. This part is NOT editable from the chat, so a bad
// change can never break the tool you'd use to fix it.
// ============================================================================
(() => {
  "use strict";
  const { html, render, useState, useEffect, useRef } = window.htmPreact;
  const BUILTIN = JSON.parse(document.getElementById("cf-source").textContent);
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
  };

  let readyResolve;
  const appReady = new Promise((r) => (readyResolve = r));
  window.__cfShell = {
    ready: () => readyResolve(true),
  };

  async function boot() {
    const activeId = await meta.get("active");
    let active = activeId ? await versions.get(activeId) : null;
    // a newer file than the one these changes were made on: use the new file, keep history
    if (active && active.baseBuiltAt !== BUILTIN.builtAt) {
      await meta.set("active", null);
      await meta.set("notice", { kind: "info", text: "This is a newer copy of the app, so it started fresh. Your earlier chat changes are still in History if you want them back." });
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
    window.__cfActive = { id: active?.id || null, note: active?.note || "Original version", files };
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
- When finished, reply with 1-3 short plain sentences saying what you changed (no code, no file names). The app reloads by itself to show it.
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
    return opts[pref] || opts["claude-account"] || opts.anthropic || opts.openai || opts.gemini || null;
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
        const out = await runAgent(msg, history, (a) => setActivity((x) => [...x, a]));
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
      ${!open && html`<button class="cfs-fab" onClick=${() => setOpen(true)} title="Fix, add or remove features by chatting">🛠 <span>Change the app</span></button>`}
      ${notice && !open && html`<div class=${"cfs-notice " + notice.kind} onClick=${() => (setOpen(true), setNotice(null))}>${notice.text}</div>`}
      ${open && html`<aside class="cfs-panel">
        <header class="cfs-head">
          <div><b>🛠 Change the app</b><div class="cfs-sub">${isChanged ? "Running your changed version" : "Running the original version"}</div></div>
          <div class="cfs-actions">
            ${isChanged && html`<button class="cfs-btn" onClick=${undo} disabled=${busy} title="Go back to before the last change">↶ Undo</button>`}
            <button class="cfs-btn" onClick=${async () => setHist(await versions.all())} disabled=${busy}>History</button>
            <button class="cfs-btn" onClick=${() => setOpen(false)} title="Close">✕</button>
          </div>
        </header>
        ${notice && html`<div class=${"cfs-banner " + notice.kind}>${notice.text}</div>`}
        <div class="cfs-msgs">
          ${!chat.length && html`<div class="cfs-empty">
            <p>Tell me what to <b>fix, add or remove</b> and I'll change the app for you. It reloads by itself to show the change, and your projects are kept.</p>
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
        <form class="cfs-input" onSubmit=${(e) => (e.preventDefault(), send())}>
          <textarea value=${text} placeholder="e.g. add a button that copies all scripts" onInput=${(e) => setText(e.target.value)}
            onKeyDown=${(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} disabled=${busy} rows="2"></textarea>
          <button class="cfs-btn primary" type="submit" disabled=${busy || !text.trim()}>Send</button>
        </form>
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

  // ---------------------------------------------------------------- start
  render(html`<${Shell} />`, document.getElementById("cf-shell"));
  boot();
})();
