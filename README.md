# Content Factory

## ⚡ Two ways to open it

**Inside Claude (free, no keys):** https://claude.ai/artifact/G6eEobvvmshFojyA5nYxEt
The Writer and the change-the-app chat run on your Claude account. Outside services (ElevenLabs, OpenAI, Pexels) are blocked inside Claude, so videos there are text + music over color backgrounds.

**Windows app:** double-click **`Content Factory.exe`**. It opens in its own window; keys, projects and videos are saved in `%APPDATA%\Content Factory`, so they're there next time. Windows may say "Windows protected your PC" the first time (the app isn't signed): click **More info → Run anyway**. Rebuild after changes: `node web/build.mjs`, then in `desktop/`: `npm install` and `npm run build:win` (output in `desktop/dist/`).

**The file (all services):** open `Content Factory.html`

Double-click **`Content Factory.html`**. That's it: no install, no server, no start-up.
Everything runs in your browser (Chrome or Edge recommended): AI calls with your keys, saving, and making the MP4s.

- Want a link you can open anywhere, including your phone? Drag the file onto https://app.netlify.com/drop (rename it `index.html` first).
- Connect AI: paste any keys (one, several, or a whole .env file) into one box and they sort themselves: Anthropic, OpenAI, Google Gemini, ElevenLabs, Pexels. Then the page is grouped by job (Writer, Voice, Visuals, Caption timing, Chat). Gemini works for writing, voice, images (Nano Banana) and the chat, always using the newest models your key can reach. Pick what does each job; Claude models Opus 5.5 / Sonnet 5.5 / Haiku 5.5 are selectable.
- No formats to manage: type the kind of content you want and the AI designs the style.
- **📲 Platforms:** pick where the videos go (TikTok, YouTube Shorts, Instagram Reels, Facebook Reels, Snapchat Spotlight, Douyin, Kuaishou, Xiaohongshu, WeChat Channels, Bilibili). Each platform's monetization rules go into the script, the check and the style. The number of videos is per platform (1 video on 3 platforms = 3 videos, each made for its platform and filed in its own folder in the ZIP). Each video reaches its platform's pay minimum: TikTok and Snapchat videos are made over 1 minute even if you chose a shorter length, while the others keep your length, captions avoid each app's buttons, and Chinese platforms get the required visible AI生成 label. Every finished video shows ✓/⚠ per platform, ready-to-paste post text, and a posting checklist (rules checked Nov 2026, in `web/src/15-platforms.js`). Earning also depends on followers, views and country, so approval can't be guaranteed.
- **🎥 Sora:** in Connect AI → Visuals, pick "Sora AI video" (uses your OpenAI key) for realistic moving clips per scene, on every scene or just the hook. Sora 2 is about $0.10 per second of clip, Sora 2 Pro about $0.30. Refused scenes fall back to pictures. File version only.
- **💰 Money:** set a monthly budget (videos pause instead of spending past it; raise it and press Try again), see spending by service and month, and see real bills: ElevenLabs plan/usage/next invoice with your normal key, OpenAI and Anthropic totals with an admin key (`sk-admin-…` / `sk-ant-admin…`, pasted in the same key box). "Pay / add credits" and "Change plan or limits" open each service's own billing page (inside the Windows app, with logins remembered). The Make page shows the estimated cost before you generate.
- **📡 Internet:** the Windows app sends every request through Windows' own network stack (system proxy, VPN, company certificates). If the internet drops, videos pause and continue by themselves when it's back. System → Internet connection tests each service.
- Projects and keys are saved **in that browser**. A different browser or device starts empty.
- Keep the tab open while videos are being made. If you close it, they pick up where they left off next time you open it.
- **🛠 Change the app:** the button in the corner opens a chat. Describe what to fix, add or remove, and the AI edits the app's own code (uses your Anthropic or OpenAI key). It reloads by itself to show the change.
  - **Undo** goes back one change; **History** lists every version; **Download this version** saves the changed app as a new file.
  - If a change stops the app from starting, it is undone automatically. The chat itself can't be edited, so it always works.
- Developers: edit the source in `web/src/` (app) and `web/shell/` (loader + chat), then run `node web/build.mjs`.

---

## Server edition (Next.js)

Use this instead if you want background jobs that keep running with the tab closed, logins, and cloud saving.

Type what you want → press **GENERATE VIDEOS** → get finished vertical shorts (1080×1920 MP4 with voice, visuals, captions, background sound).

## Run it

1. Install **Node.js** (version 20 or newer) from https://nodejs.org. This is the only thing you install.
2. Double-click **Start Content Factory**: `.command` on Mac, `.bat` on Windows. Or run `npm run go` in a terminal.

The first run installs everything and builds the app (a few minutes). After that it starts in seconds and opens your browser. Keep the window open while you use it; close it to stop.

You don't need ffmpeg. A video editor is bundled, and the app uses your own ffmpeg if you have one.
On Mac, the first time you may need to right-click the `.command` file → Open.

You don't need any keys to start. With no keys the app runs in **practice mode**: offline template writer, robot voice, and title-card visuals. Each card says 🧪 Practice quality.

**Connect AI:** go to ⚙ System → Connect AI and paste a key. The app works out which service it's for, stores it encrypted on the server, and tests it. No `.env` editing needed.

| Key | Unlocks |
|---|---|
| Anthropic or OpenAI | Real AI scripts (cheap model for checks and scenes, quality model for writing) |
| ElevenLabs or OpenAI | Real AI voice |
| OpenAI | AI images (`gpt-image-2`) + exact caption timing |
| Pexels | Free stock photos |

Environment variables still work as a fallback, and model names can be overridden there (see `.env.example`).

### Accounts + cloud saving (Supabase)

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`.
3. Restart the app.

Accounts switch on automatically: log in / sign up, and every user sees only their own projects, formats, keys and videos. Files are stored in the Supabase Storage bucket `content-factory`.

Without Supabase, everything saves to `./data` on the server and there's no login (single user). Projects made in single-user mode don't carry over to accounts.

## Formats

Nothing is genre-specific. **Blank** is the default: the AI just follows your request.
Starter formats (edit or delete freely): Did You Know, Top 5 List, Storytime, Motivation, Product Spotlight, Scary Story.
With style set to **✨ Auto**, the app picks a format from your words ("did you know…", "top 5…", "scary…"). Anything else uses Blank.

## Deploy

Use the `Dockerfile` on Railway, Render, Fly.io or a VPS. Vercel won't work, because rendering needs ffmpeg and long-running jobs.

## How it's built

```
src/app/                 UI pages + API routes
src/lib/providers/       Adapters: llm/ voice/ image/ captions/ music/ + registry (index.ts)
src/lib/pipeline/        steps.ts (each module), runner.ts, prompts.ts, render.ts (ffmpeg), captions.ts
src/lib/jobs/            DB-backed queue + worker (starts inside the server via instrumentation.ts)
src/lib/db/              Repo interface → local JSON files or Supabase
src/lib/formats/         Starter formats, CRUD, auto-detect
```

**Pipeline per video:** script → script check → scenes → voice → visuals → music → captions → assemble → final check.
Each step's status and output are saved. Finished steps never run again. Regenerating a part resets only that step and the steps that depend on it.

**Adding a provider:** write an adapter that implements the interface in `src/lib/providers/types.ts`, then add it to `REGISTRY` in `src/lib/providers/index.ts`. Nothing else changes.

**Recovery:**
- Temporary failures retry automatically with backoff, then fall back to the next provider.
- Providers that keep failing are deprioritized for 5 minutes.
- **USE BACKUP** stops using the failed provider for the whole project and re-queues every video stuck on it.
- If the server crashes, jobs resume from the first unfinished step.
- Deleting a project moves it to the trash, where you can restore it.

**Tested against a real Supabase stack** (Postgres + PostgREST + GoTrue + Storage running locally): schema, saving, file upload and re-download, signup/login/logout, and isolation between two users.

`npm start` sets `NODE_USE_ENV_PROXY=1`, so the server's AI calls go through `HTTPS_PROXY` if your host uses one.

**Cost:** LLM, voice and image results are cached by input. Usage is logged per call with an estimated cost (prices are in `providers/pricing.ts`).
