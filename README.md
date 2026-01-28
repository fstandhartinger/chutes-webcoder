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
  - **Factory Droid** (`droid`) – Factory AI CLI (requires `FACTORY_API_KEY`)
  - **OpenHands** (`openhands`) – OpenHands CLI (via OpenAI-compatible endpoint)
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

   # Sandbox provider (Sandy by default; dedicated host)
   SANDBOX_PROVIDER=sandy
   SANDY_BASE_URL=https://sandy.65.109.64.180.nip.io
   SANDY_API_KEY=your_sandy_api_key
   SANDY_HOST_SUFFIX=.sandy.65.109.64.180.nip.io
   NEXT_PUBLIC_SANDBOX_HOST_SUFFIX=.sandy.65.109.64.180.nip.io
   # Optional: force Sandy controller routing (use docker-backed upstreams for agent runs)
   SANDY_PREFERRED_UPSTREAM=docker-primary

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

   # Optional: GitHub OAuth (user connections)
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   GITHUB_OAUTH_REDIRECT_URI=http://localhost:3000/api/github/oauth/callback
   # Optional override (defaults to repo read:user user:email)
   GITHUB_OAUTH_SCOPE=repo read:user user:email

   # Optional: Netlify OAuth (user connections)
   NETLIFY_CLIENT_ID=your_netlify_client_id
   NETLIFY_CLIENT_SECRET=your_netlify_client_secret
   NETLIFY_OAUTH_REDIRECT_URI=http://localhost:3000/api/netlify/oauth/callback
   # Optional override if you need custom scopes
   NETLIFY_OAUTH_SCOPE=

   # Optional: Factory Droid CLI
   FACTORY_API_KEY=your_factory_api_key
   DROID_MODEL=glm-4.6
   ```

> **Note**: The production Sandy host moved to `https://sandy.65.109.64.180.nip.io` (old Sandy is deprecated).

3. **Run dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Configuration Notes

- `config/app.config.ts` lists all sandbox and model settings. The default model is `chutes/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8`, but the upstream presets (GPT‑5, Claude Sonnet 4, Gemini 2.0 Flash, Kimi K2) remain available.
- Switching between Sandy, Vercel, and E2B sandboxes is a matter of flipping `SANDBOX_PROVIDER` and providing the appropriate credentials.
- Sandy preview URLs are derived from `SANDY_HOST_SUFFIX` (and `NEXT_PUBLIC_SANDBOX_HOST_SUFFIX` for the UI).
- GitHub import/export uses user OAuth tokens; set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for the OAuth callback.
- Sandy provides a shared cache mount for npm/pip/HF downloads, so repeated sandbox runs reuse dependencies.

## CLI Coding Agents

The `/api/agent-run` endpoint proxies to Sandy's agent API, which runs CLI agents inside the sandbox. Each agent is configured to use Chutes' model endpoints:

| Agent | Package | API Endpoint | Status | Typical Speed |
|-------|---------|--------------|--------|---------------|
| **Aider** | `aider-chat` (Python) | `llm.chutes.ai/v1` | ✅ Tested | ~10s |
| **Codex** | `@openai/codex` | `responses.chutes.ai/v1` | ✅ Tested | ~15-160s |
| **Claude Code** | `@anthropic-ai/claude-code` | `claude.chutes.ai` | ⚠️ Slower | >60s |
| **OpenCode** | `opencode-ai` | `llm.chutes.ai/v1` | ✅ Tested | ~20s |
| **Factory Droid** | `droid` | `factory.ai` | ⚠️ Requires key | Varies |
| **OpenHands** | `openhands` | `llm.chutes.ai/v1` | ✅ Tested | ~30s |

### Sandy Agent Routing (optional)

If you want Sandy agents to route through the Janus model router (and include a custom system prompt file), set the following env vars:

```env
# Route Anthropic-style calls via the Janus model router
SANDY_AGENT_API_BASE_URL=http://your-janus-router-host:port
# Provide a system prompt file path inside the sandbox (if you upload an agent pack)
SANDY_AGENT_SYSTEM_PROMPT_PATH=/workspace/agent-pack/prompts/system.md
# Optional: skip Sandy's web-dev wrapper prompt
SANDY_AGENT_RAW_PROMPT=true
```

`/api/agent-run` forwards `systemPromptPath`, `apiBaseUrl`, `rawPrompt`, and `env` to Sandy when provided.

### Tested Model Combinations

| Agent | DeepSeek V3.2 | GLM-4.7 |
|-------|---------------|---------|
| **Aider** | ✅ 10.2s | ✅ Works |
| **Codex** | ✅ 156.9s | ✅ 13.4s |
| **Claude Code** | ⚠️ Slow | ⚠️ Slow |
| **OpenHands** | ✅ Works | ✅ Works |

### Real-Time Output Streaming

The agent-run API streams Sandy's SSE output to provide real-time feedback:

- Agent output is streamed to the client as soon as it's available (500ms polling interval)
- Heartbeat events every 5 seconds keep the connection alive
- Output is sent line-by-line for immediate visual feedback
- Users see progress immediately instead of waiting for completion

### Sandy + Claude Code routing notes

For Claude Code (and other CLI agents) we now recommend routing through the Janus model router instead of hard‑coding a single model:

- Set Sandy `/agent/run` `apiBaseUrl` to the Janus router (Anthropic Messages compatible).
- Keep `model` as `janus-router` so the router can select + fail over across Chutes models.
- Pass `rawPrompt: true` when you already provide a system prompt.
- Upload an agent pack into `/workspace/agent-pack` and set `JANUS_SYSTEM_PROMPT_PATH` or pass `systemPromptPath=/workspace/agent-pack/prompts/system.md` so Claude Code reads the full instruction set.
- Save generated files to `/workspace/artifacts`; cache sandbox artifact URLs server‑side (e.g., `/var/data/...`) and serve them via `/api/artifacts/...` before the sandbox exits.
- You can set `SANDY_AGENT_API_BASE_URL` and `SANDY_AGENT_SYSTEM_PROMPT_PATH` as defaults so `/api/agent-run` auto‑wires the router + system prompt.

> **Note:** Factory Droid requires a proprietary `FACTORY_API_KEY` and uses Factory-hosted models. OpenCode uses the OpenAI-compatible endpoint and supports Chutes models via `OPENAI_BASE_URL`.

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
| `deepseek-ai/DeepSeek-V3.2-TEE` | DeepSeek V3.2 | Codex, Aider (recommended) |
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
