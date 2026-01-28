import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { appConfig } from '@/config/app.config';

export const dynamic = 'force-dynamic';
const DEFAULT_AGENT_MAX_SECONDS = 1200; // 20 minutes max for agent execution
export const maxDuration = 1200;

const sandyDispatcherCache = new Map<number, Agent>();

function getSandyDispatcher(timeoutMs: number): Agent {
  const cached = sandyDispatcherCache.get(timeoutMs);
  if (cached) {
    return cached;
  }

  const agent = new Agent({
    connectTimeout: timeoutMs,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  sandyDispatcherCache.set(timeoutMs, agent);
  return agent;
}

function getSandyConfig() {
  const baseUrl = process.env.SANDY_BASE_URL;
  const apiKey = process.env.SANDY_API_KEY;

  if (!baseUrl) {
    throw new Error('SANDY_BASE_URL is not configured');
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agent,
      model,
      prompt,
      sandboxId,
      maxDuration: bodyDuration,
      rawPrompt,
      systemPromptPath,
      apiBaseUrl,
      env: requestEnv,
    } = body || {};
    const externalAgents = appConfig.agents.availableAgents.filter((id) => id !== 'builtin');

    if (!agent || !model || !prompt || !sandboxId) {
      return NextResponse.json(
        { error: 'agent, model, prompt, and sandboxId are required' },
        { status: 400 }
      );
    }

    if (!externalAgents.includes(agent)) {
      return NextResponse.json(
        { error: `Unknown agent: ${agent}. Available: ${externalAgents.join(', ')}` },
        { status: 400 }
      );
    }

    if (!appConfig.ai.availableModels.includes(model)) {
      return NextResponse.json(
        { error: `Unknown model: ${model}. Available: ${appConfig.ai.availableModels.join(', ')}` },
        { status: 400 }
      );
    }

    const { baseUrl, apiKey } = getSandyConfig();
    const requestedDurationSeconds = Number.isFinite(bodyDuration)
      ? Math.max(60, Number(bodyDuration))
      : DEFAULT_AGENT_MAX_SECONDS;
    const timeoutMs = Math.max(1000, requestedDurationSeconds * 1000);
    const envVars = {
      ...(typeof requestEnv === 'object' && requestEnv ? requestEnv : {}),
      ...(process.env.CHUTES_API_KEY ? { CHUTES_API_KEY: process.env.CHUTES_API_KEY } : {}),
    };
    const resolvedSystemPromptPath =
      systemPromptPath ||
      process.env.SANDY_AGENT_SYSTEM_PROMPT_PATH ||
      process.env.JANUS_SYSTEM_PROMPT_PATH;
    const resolvedApiBase =
      apiBaseUrl ||
      process.env.SANDY_AGENT_API_BASE_URL ||
      process.env.SANDY_AGENT_ROUTER_URL ||
      process.env.JANUS_ROUTER_URL ||
      process.env.JANUS_MODEL_ROUTER_URL;
    const normalizedApiBase = resolvedApiBase
      ? resolvedApiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
      : undefined;
    const resolvedRawPrompt =
      typeof rawPrompt === 'boolean'
        ? rawPrompt
        : process.env.SANDY_AGENT_RAW_PROMPT === 'true';

    if (model === 'janus-router' && !normalizedApiBase) {
      return NextResponse.json(
        { error: 'janus-router requires SANDY_AGENT_API_BASE_URL (or apiBaseUrl in the request).' },
        { status: 400 }
      );
    }

    const response = await fetch(`${baseUrl}/api/sandboxes/${sandboxId}/agent/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        agent,
        model,
        prompt,
        maxDuration: requestedDurationSeconds,
        ...(resolvedRawPrompt !== undefined ? { rawPrompt: resolvedRawPrompt } : {}),
        ...(resolvedSystemPromptPath ? { systemPromptPath: resolvedSystemPromptPath } : {}),
        ...(normalizedApiBase ? { apiBaseUrl: normalizedApiBase } : {}),
        ...(Object.keys(envVars).length ? { env: envVars, envVars } : {}),
      }),
      dispatcher: getSandyDispatcher(timeoutMs),
    } as RequestInit & { dispatcher?: Agent });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      return NextResponse.json({ error: errorText || 'Failed to start agent' }, { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[agent-run] Error:', error);
    return NextResponse.json({ error: 'Failed to start agent' }, { status: 500 });
  }
}

export async function GET() {
  const externalAgents = appConfig.agents.availableAgents.filter((id) => id !== 'builtin');
  return NextResponse.json({
    agents: externalAgents.map((id) => ({
      id,
      name: appConfig.agents.agentDisplayNames[id] || id,
    })),
    models: appConfig.ai.availableModels,
  });
}
