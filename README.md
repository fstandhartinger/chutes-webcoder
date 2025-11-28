<div align="center">

# Chutes Webcoder

A Chutes-flavoured fork of [firecrawl/open-lovable](https://github.com/firecrawl/open-lovable) that keeps pace with the upstream features (Vercel sandboxing, GitHub integration, new builder UI) while defaulting to the Chutes LLM platform.

</div>

## What's Included

- **Dual Sandbox Providers** – choose between the new Vercel sandbox (default) or E2B with automatic fallback handling.
- **Chutes-first AI defaults** – preconfigured to use Chutes' OpenAI-compatible endpoint while still supporting Groq, OpenAI, Anthropic, Gemini, and the Vercel AI Gateway.
- **Upstream Enhancements** – AI Builder UI, morph fast-apply edits, GitHub integration hooks, CLI scaffolding (`packages/create-open-lovable`).
- **Render-ready deployment** – `render.yaml` and sensible `NEXT_PUBLIC_APP_URL` defaults for local routing.

## Quickstart

1. **Clone & install**
   ```bash
   git clone https://github.com/fstandhartinger/chutes-webcoder.git
   cd chutes-webcoder
   npm install   # or pnpm install / yarn install
   ```

2. **Copy `.env.example` ➜ `.env.local`** and set the variables you need.
   ```env
   # Required services
   FIRECRAWL_API_KEY=your_firecrawl_api_key
   CHUTES_API_KEY=your_chutes_api_key
   CHUTES_BASE_URL=https://llm.chutes.ai/v1
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # Sandbox provider (E2B by default)
   SANDBOX_PROVIDER=e2b
   E2B_API_KEY=your_e2b_api_key

   # Optional: Vercel sandbox (requires Vercel account setup)
   # SANDBOX_PROVIDER=vercel
   # VERCEL_OIDC_TOKEN=... or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID

   # Optional: AI Gateway / vendor keys
   AI_GATEWAY_API_KEY=...
   OPENAI_API_KEY=...
   ANTHROPIC_API_KEY=...
   GEMINI_API_KEY=...
   GROQ_API_KEY=...

   # Optional: Morph fast apply key
   MORPH_API_KEY=...
   ```

3. **Run dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Configuration Notes

- `config/app.config.ts` lists all sandbox and model settings. The default model is `chutes/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8`, but the upstream presets (GPT‑5, Claude Sonnet 4, Gemini 2.0 Flash, Kimi K2) remain available.
- Switching between Vercel and E2B sandboxes is a matter of flipping `SANDBOX_PROVIDER` and providing the appropriate credentials.
- GitHub integration and the new “Builder” experience follow the upstream conventions—set `GITHUB_TOKEN`, `NEXTAUTH_SECRET`, etc., if you adopt those workflows.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js with Turbopack |
| `npm run build` | Production build (lint + type-check included) |
| `npm run start` | Start the production server |
| `npm run lint` | ESLint via `next lint` |
| `npm run test:all` | Node-based smoke tests (sandbox utils + parser) |

> **Commit/Push Checklist:** Always run `npm run lint` and `npm run build` before committing or pushing. The Render deploy pipeline enforces the same checks and will fail on any linting/type errors, so keeping your local checks green prevents broken builds.

## Credits & License

Originally created by the Firecrawl team as **Open Lovable**. This fork tracks upstream while layering in the Chutes defaults. Licensed under MIT.
