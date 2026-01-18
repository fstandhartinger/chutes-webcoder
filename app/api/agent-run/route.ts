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
    const { agent, model, prompt, sandboxId, maxDuration: bodyDuration } = body || {};
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

    const response = await fetch(`${baseUrl}/api/sandboxes/${sandboxId}/agent/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ agent, model, prompt, maxDuration: requestedDurationSeconds }),
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
