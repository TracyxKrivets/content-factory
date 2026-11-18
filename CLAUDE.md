# Content Factory: notes for Claude

Tracy's bulk short-form video app. Type a request, press GENERATE VIDEOS, get finished vertical
shorts (script, voice, visuals, captions, music, MP4). It runs as a Windows app, an Android app,
a web page and inside Claude, and it updates itself from this repository.

Tracy changes the app from inside it: the **🛠 Fix or change the app** panel (in `web/shell/shell.js`).
Its AI (Tracy's API key) edits `web/src/` + `web/style.css` on that device first; then **📤 Put it on all my
devices** commits the changed files straight to `main` through the GitHub API (Tracy's GitHub key, saved
as `GITHUB_TOKEN`). So commits titled "App change: …" come from the app, not from a person at a computer.
It refuses to send if the same file changed on GitHub since, so it never undoes an update.
Keep that flow working, and keep it inside the app (no claude.ai links).

## How Tracy wants it

- **Stoner-proof**: one obvious button, plain words, no setup steps, no jargon on screen.
- Reply in plain language: what changed and what to do next (usually just "press Restart now when the bar appears").
  Don't explain code unless asked.
- Working solutions over explanations. Finish the job: build, test, push.
- Connect AI shows **only the APIs Tracy has added** under each job. Never list services without a saved key,
  and never bring back per-service key input boxes: all keys go in the one "Paste any API key" box,
  which sorts them by itself.
- Never throw a pasted key away. Unsupported ones are kept as "kept for later".
- Keep the app genre-neutral. Content type is free text, with no hard-coded formats.

## Where things are

| Path | What |
|---|---|
| `web/src/*.js` | **The app** (Preact + htm, no bundler). Files are joined in name order into one script, so a later file can wrap functions from an earlier one. |
| `web/src/00-core.js` | storage (IndexedDB), keys, key detection, errors, settings |
| `web/src/10-content.js` | prompts, languages, offline practice writer |
| `web/src/15-platforms.js` | platform monetization rules (TikTok, Douyin…) |
| `web/src/20-providers.js` | AI services (Anthropic, OpenAI, Gemini, ElevenLabs, Pexels, Sora…) |
| `web/src/22-custom-ai.js` | added OpenAI-compatible services (Grok, DeepSeek, Mistral…) |
| `web/src/30-render.js` | video rendering (canvas → WebCodecs → MP4) |
| `web/src/40-pipeline.js` | the step pipeline, queue, retries |
| `web/src/60-pages.js` | the pages (Make, Projects, Connect AI, System) |
| `web/src/70-money.js` | budget, spending, bills |
| `web/src/75-sync.js`, `76-devices.js` | phone + PC live sync (Supabase) |
| `web/shell/` | protected loader + "Change the app" chat + publish-to-all-devices (GitHub) + update bar (the app can't break these) |
| `web/build.mjs` | builds the single file `web/dist/content-factory.html` and syntax-checks everything |
| `desktop/` | Windows app (Electron): network bridge, auto-update, in-app windows |
| `mobile/` | Android app (Capacitor) + `launcher.html` (auto-update with rollback) |
| `.github/workflows/build.yml` | on every push to main: web + update feed → GitHub Pages; APK + .exe → the `latest` release |
| `tests/` | end-to-end tests (headless Chromium, all AI services simulated) |
| `src/`, `supabase/` | older server edition (Next.js). Not used by the apps. |

## Make a change

1. Edit `web/src/` (or `web/shell/`, `desktop/`, `mobile/`).
2. Build: `node web/build.mjs`. It fails on syntax errors.
3. Test:
   ```
   cd tests && npm install && npx playwright install chromium && node run.js           # everything (~15 min)
   node run.js t1 keys mine                                                          # quick ones
   ```
   Add or adjust a test in `tests/` for what you changed. If a test checks UI that was removed on
   purpose, update the test, not the app. If Chromium can't be installed in your environment,
   at least build, then explain what you couldn't test.
4. Commit and push to `main`. GitHub Actions builds and publishes in about 10 minutes. Every
   installed app (Windows, Android, web) then shows "✨ An update to the app is ready".
   Check the run, and the `android` job especially: `gh run list` / `gh run view <id> --log-failed`.
5. Tell Tracy in plain words what changed.

## Things that bite

- The app runs as **one script**. `const` names must be unique across all `web/src` files; check with the build.
- To wrap a function from an earlier file (sync does this), declare it with `function` or `let`, not `const`.
- `window.__cf` exposes internals for tests (`db`, `kv`, `Sync`, `editScript`…). Keep it.
- Inside Claude (artifact), `fetch` to outside services is blocked: `canFetch()` is false. Features must degrade.
- Desktop: web security must stay on (turning it off disables WebCodecs). Requests go through `window.cfNet` (Electron `net`).
- Every installed copy checks that a new version calls `window.cfApp.booted()` (done by the shell). If it doesn't within 30 s, the copy rolls back.
- Android signing uses the `CF_SIGNING` repository secret. Never commit keystores or keys.
- Monetization rules change: re-check with a web search before editing `15-platforms.js`.
