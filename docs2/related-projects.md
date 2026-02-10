# Chutes Webcoder -- Related Projects

Chutes Webcoder is part of a broader ecosystem of Chutes infrastructure
projects. This document links to the documentation for related systems.

## Sandy -- Sandbox Infrastructure

**Documentation:** [../../sandy/docs/](../../sandy/docs/)

Sandy provides the sandbox infrastructure (Firecracker microVMs by default; restricted Docker sandboxes when explicitly requested) that Webcoder uses for
code execution, Vite dev servers, and agent CLI runs. Webcoder communicates with
Sandy through the Sandy Controller REST API.

Key integration points:
- `POST /api/sandboxes` -- create sandboxes
- `POST /api/sandboxes/:id/exec` -- run commands
- `POST /api/sandboxes/:id/files/write` -- write files
- `GET /api/sandboxes/:id/files/read` -- read files
- `POST /api/sandboxes/:id/agent/run` -- execute CLI agents (SSE stream)
- `POST /api/sandboxes/:id/agent/cancel` -- cancel running agents
- `POST /api/sandboxes/:id/terminate` -- destroy sandboxes

## Agent as a Service Web -- Agent Web UI

**Documentation:** [../../agent-as-a-service-web/docs2/](../../agent-as-a-service-web/docs2/)

The Agent as a Service Web project provides an alternative web UI for running
coding agents in Sandy sandboxes. While Webcoder focuses on an IDE-like
experience with live preview, the Agent Web UI provides a simpler chat-based
interface for agent interactions.

Shared concepts:
- Sandy sandbox lifecycle management
- SSE streaming of agent output
- Model routing through Janus
- Multiple agent support (Claude Code, Codex, Aider, etc.)

## Janus PoC -- Competition Platform

**Documentation:** [../../janus-poc/docs2/](../../janus-poc/docs2/)

The Janus proof-of-concept platform provides model routing and competition
infrastructure. Webcoder uses the Janus router for intelligent model selection
and failover when agents make API calls.

Key integration:
- Webcoder's `apiBaseUrl` (from `SANDY_AGENT_API_BASE_URL`) points to the Janus
  router
- The `janus-router` model ID tells Janus to auto-select the best available
  Chutes model
- Janus provides an Anthropic Messages API-compatible endpoint, so agents like
  Claude Code can use it transparently

## Chutes Knowledge Agent

**Documentation:** [../../chutes-knowledge-agent/docs2/](../../chutes-knowledge-agent/docs2/)

The Knowledge Agent is a support bot that uses the same Sandy sandbox
infrastructure and agent execution pattern. While Webcoder generates web
applications, the Knowledge Agent uses agents to research and answer support
questions from a curated knowledge base.

Shared patterns:
- Sandy sandbox creation and management
- Agent execution via `/api/sandboxes/:id/agent/run`
- SSE streaming and `SSEJsonBuffer` parsing
- Model routing through Janus

## Chutes IDP -- Identity Provider

**Documentation:** [../../chutes_idp/docs2/](../../chutes_idp/docs2/)

Webcoder uses Chutes IDP for user authentication via OAuth2 Authorization Code
flow. The `AuthProvider` context in the root layout manages auth state.

Auth endpoints:
- `/api/auth/login` -- redirect to Chutes IDP
- `/api/auth/callback` -- handle OAuth callback
- `/api/auth/logout` -- clear session
- `/api/auth/me` -- get current user info
