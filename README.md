<div align="center">

# Chutes Webcoder

Build and refactor web apps by chatting with an AI. Powered by the Chutes LLM API and designed for rapid Next.js development.

</div>

## Setup

1. **Clone & Install**
```bash
git clone <your-repo-url>
cd chutes-webcoder
npm install   # or: pnpm install / yarn install
```

2. **Create `.env.local`**
Provide at least one LLM provider. Using Chutes is recommended and supported out of the box.
```env
# Primary (recommended)
CHUTES_API_KEY=your_chutes_api_key
# Optional: override if needed
# CHUTES_BASE_URL=https://llm.chutes.ai/v1

# Optional providers (enable any you use)
GROQ_API_KEY=your_groq_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1

# Optional integrations
E2B_API_KEY=your_e2b_api_key           # Sandboxes (https://e2b.dev)
FIRECRAWL_API_KEY=your_firecrawl_api_key # Web scraping (https://firecrawl.dev)

# App URL (used for internal API calls in dev)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. **Run**
```bash
npm run dev
```

Then open http://localhost:3000

## Notes

- Defaults to the Chutes API for OpenAI-compatible chat completions (`https://llm.chutes.ai/v1`).
- You can switch models/providers via environment variables without code changes.
- A Render deployment config is included in `render.yaml`.

## Credits

This project is inspired by and builds on the excellent groundwork from **Open Lovable** by Mendable AI. Huge thanks to their team for open-sourcing such a solid foundation.

- Repo: https://github.com/mendableai/open-lovable

## License

MIT