<div align="center">

# Chutes Webcoder

A Chutes-flavoured fork of [firecrawl/open-lovable](https://github.com/firecrawl/open-lovable) that keeps pace with the upstream features (Vercel sandboxing, GitHub integration, new builder UI) while defaulting to the Chutes LLM platform.

</div>

## What's Included

- **Sandbox Providers** – use the self-hosted Sandy sandbox by default, with Vercel or E2B available as optional alternatives.
- **Chutes-first AI defaults** – preconfigured to use Chutes' OpenAI-compatible endpoint while still supporting Groq, OpenAI, Anthropic, Gemini, and the Vercel AI Gateway.
- **CLI Coding Agents** – integrated support for multiple AI coding agents running inside Sandy sandboxes:
  - **Claude Code** (`@anthropic-ai/claude-code`) – via `claude.chutes.ai` proxy
  - **OpenAI Codex** (`@openai/codex`) – via `responses.chutes.ai` Responses API proxy
  - **Aider** (`aider-chat`) – Python-based coding assistant via OpenAI-compatible endpoint
  - **OpenCode** (`opencode-ai`) – terminal-native AI coding agent with custom provider support
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

   # Sandbox provider (Sandy by default)
   SANDBOX_PROVIDER=sandy
   SANDY_BASE_URL=https://sandy.example.com
   SANDY_API_KEY=your_sandy_api_key
   SANDY_HOST_SUFFIX=.sandy.example.com
   NEXT_PUBLIC_SANDBOX_HOST_SUFFIX=.sandy.example.com

   # Optional: Vercel sandbox (requires Vercel account setup)
   # SANDBOX_PROVIDER=vercel
   # VERCEL_OIDC_TOKEN=... or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID

   # Optional: E2B sandbox (legacy)
   # SANDBOX_PROVIDER=e2b
   # E2B_API_KEY=your_e2b_api_key

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
- Switching between Sandy, Vercel, and E2B sandboxes is a matter of flipping `SANDBOX_PROVIDER` and providing the appropriate credentials.
- Sandy preview URLs are derived from `SANDY_HOST_SUFFIX` (and `NEXT_PUBLIC_SANDBOX_HOST_SUFFIX` for the UI).
- GitHub integration and the new “Builder” experience follow the upstream conventions—set `GITHUB_TOKEN`, `NEXTAUTH_SECRET`, etc., if you adopt those workflows.

## CLI Coding Agents

The `/api/agent-run` endpoint enables running external CLI coding agents inside Sandy sandboxes. Each agent is configured to use Chutes' model endpoints:

| Agent | Package | API Endpoint | Notes |
|-------|---------|--------------|-------|
| Claude Code | `@anthropic-ai/claude-code` | `claude.chutes.ai` | Works with Claude-compatible models |
| Codex | `@openai/codex` | `responses.chutes.ai/v1` | Uses OpenAI Responses API proxy; auto-generates `config.toml` |
| Aider | `aider-chat` (Python) | `llm.chutes.ai/v1` | OpenAI-compatible; models prefixed with `openai/` |
| OpenCode | `opencode-ai` | `llm.chutes.ai/v1` | OpenAI-compatible; models prefixed with `openai/` |

### Agent API Usage

```bash
curl -X POST https://your-deployment.com/api/agent-run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "codex",
    "model": "deepseek-ai/DeepSeek-V3.2-TEE",
    "prompt": "Create a hello world React component",
    "sandboxId": "your-sandbox-id",
    "apiKey": "your-chutes-api-key"
  }'
```

### Available Models

| Model ID | Display Name | Best For |
|----------|--------------|----------|
| `deepseek-ai/DeepSeek-V3.2-TEE` | DeepSeek V3.2 | Codex, Aider, OpenCode |
| `zai-org/GLM-4.7-TEE` | GLM-4.7 | General coding |
| `MiniMaxAI/MiniMax-M1-80k` | MiniMax M1 | Long context tasks |
| `Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8` | Qwen3 Coder 480B | Specialized coding |
| `XiaomiMiMo/MiMo-V2-Flash` | MiMo V2 Flash | Fast inference |

### Testing Agents

Run integration tests for specific agent/model combinations:

```bash
# Test a specific agent with a specific model
npx tsx tests/test-via-webcoder-api.ts --agent=codex --model=deepseek-ai/DeepSeek-V3.2-TEE

# Test all combinations (takes a while)
npx tsx tests/test-via-webcoder-api.ts
```

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
