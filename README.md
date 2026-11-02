# Content Factory

Type what you want → press **GENERATE VIDEOS** → get finished vertical shorts (1080×1920 MP4 with voice, visuals, captions, background sound).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add API keys
npm run build && npm start   # http://localhost:3000
```

Needs **ffmpeg** installed (`brew install ffmpeg` / `apt install ffmpeg`).

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
