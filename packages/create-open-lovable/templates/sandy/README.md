# Open Lovable - Sandy Sandbox

This project is configured to use Sandy sandboxes for code execution.

## Setup

1. Ensure your Sandy service is deployed and reachable.
2. Collect the Sandy base URL, API key, and host suffix.
3. Get your Firecrawl API key from [https://firecrawl.dev](https://firecrawl.dev)
4. Copy `.env.example` to `.env` and add your API keys
5. Run `npm install` to install dependencies
6. Run `npm run dev` to start the development server

## Sandy Features

- Self-hosted sandbox service for container execution
- Vite-ready runtime with Node + Python
- Port 5173 preview routed through HTTPS proxy
- On-demand sandbox creation per session

## Configuration

You can adjust Sandy settings in `config/app.config.ts`:

- `timeoutMinutes`: Sandbox session timeout
- `vitePort`: Development server port (default: 5173)
- `viteStartupDelay`: Time to wait for Vite to start
- `workingDirectory`: Working directory inside the sandbox

## Troubleshooting

If you encounter issues:

1. Verify the Sandy API is healthy (`/api/health`)
2. Confirm `SANDY_BASE_URL` and `SANDY_HOST_SUFFIX` are correct
3. Check the Sandy service logs for container startup failures
