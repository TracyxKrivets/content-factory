# Content Factory

Type what you want → press **GENERATE VIDEOS** → get finished vertical shorts (1080×1920 MP4 with voice, visuals, captions, background sound).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add API keys
npm run build && npm start   # http://localhost:3000
```

Needs **ffmpeg** installed (`brew install ffmpeg` / `apt install ffmpeg`).

You don't need any keys to start. With no keys the app runs in **practice mode**: offline template writer, robot voice, and title-card visuals. You can test the whole flow that way, and each card says 🧪 Practice quality.

| Key | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Real AI scripts (cheap model for checks/scenes, quality model for writing) |
| `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` | Real AI voice |
| `OPENAI_API_KEY` | AI images + exact caption timing |
| `PEXELS_API_KEY` | Free stock photos |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Cloud database + file storage (run `supabase/schema.sql` first) |

Without Supabase, everything saves to `./data` on the server.

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

**Cost:** LLM, voice and image results are cached by input. Usage is logged per call with an estimated cost (prices are in `providers/pricing.ts`).
