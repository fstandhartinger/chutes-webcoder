import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/config/app.config';

export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 minutes max for agent execution

// Agent configurations
const AGENTS = {
  'claude-code': {
    name: 'Claude Code',
    command: 'claude',
    setupEnv: (model: string, apiKey: string) => ({
      ANTHROPIC_BASE_URL: 'https://claude.chutes.ai',
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_API_KEY: apiKey,
      // Override all model slots to use our selected model
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      CLAUDE_CODE_SUBAGENT_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
      API_TIMEOUT_MS: '600000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }),
    buildCommand: (prompt: string) => [
      'claude', '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--allowedTools', 'Read,Write,Edit,Bash',
      '--permission-mode', 'acceptEdits'
    ],
  },
  'codex': {
    name: 'OpenAI Codex',
    command: 'codex',
    setupEnv: (model: string, apiKey: string) => ({
      // Use the Chutes Responses proxy for Codex
      OPENAI_API_KEY: apiKey,
      OPENAI_BASE_URL: 'https://responses.chutes.ai/v1',
      // Also set these for compatibility
      MY_PROVIDER_API_KEY: apiKey,
      CODEX_MODEL: model,
      // Suppress interactive prompts
      NO_COLOR: '1',
      TERM: 'dumb',
    }),
    buildCommand: (prompt: string) => [
      'codex', 'exec', '--full-auto', '--skip-git-repo-check', prompt
    ],
  },
  'aider': {
    name: 'Aider',
    command: 'aider',
    setupEnv: (model: string, apiKey: string) => ({
      OPENAI_API_KEY: apiKey,
      OPENAI_API_BASE: 'https://llm.chutes.ai/v1',
      AIDER_MODEL: `openai/${model}`,
      // Suppress color codes and interactive prompts
      NO_COLOR: '1',
      TERM: 'dumb',
    }),
    buildCommand: (prompt: string) => [
      'aider',
      '--yes',                    // Auto-confirm all prompts
      '--no-git',                 // Don't use git
      '--no-auto-commits',        // Don't auto-commit
      '--no-show-model-warnings', // Suppress model warnings
      '--no-pretty',              // Disable pretty output (no spinners/colors)
      '--no-stream',              // Don't stream output (get complete response)
      '--message', prompt
    ],
  },
} as const;

type AgentType = keyof typeof AGENTS;

interface AgentRunRequest {
  agent: AgentType;
  model: string;
  prompt: string;
  sandboxId: string;
}

// Get Sandy API configuration
function getSandyConfig() {
  const baseUrl = process.env.SANDY_BASE_URL;
  const apiKey = process.env.SANDY_API_KEY;
  
  if (!baseUrl) {
    throw new Error('SANDY_BASE_URL is not configured');
  }
  
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

// Make a request to Sandy API
async function sandyRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { baseUrl, apiKey } = getSandyConfig();
  const url = `${baseUrl}${path}`;
  
  const headers = new Headers(options.headers || {});
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  headers.set('Content-Type', 'application/json');
  
  const response = await fetch(url, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandy API error ${response.status}: ${text}`);
  }
  
  return response.json();
}

// Execute command in sandbox and stream output
async function execInSandbox(
  sandboxId: string,
  command: string,
  env: Record<string, string> = {},
  timeoutMs: number = 600000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return sandyRequest(`/api/sandboxes/${sandboxId}/exec`, {
    method: 'POST',
    body: JSON.stringify({
      command,
      cwd: '/workspace',
      env,
      timeoutMs,
    }),
  });
}

// Setup Claude config via environment variables (settings.json not needed when using env vars)
// Claude Code reads from ANTHROPIC_* env vars which we pass directly to exec

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  try {
    const body: AgentRunRequest = await request.json();
    const { agent, model, prompt, sandboxId } = body;
    
    // Validate agent
    if (!AGENTS[agent]) {
      return NextResponse.json(
        { error: `Unknown agent: ${agent}. Available: ${Object.keys(AGENTS).join(', ')}` },
        { status: 400 }
      );
    }
    
    // Validate model
    if (!appConfig.ai.availableModels.includes(model)) {
      return NextResponse.json(
        { error: `Unknown model: ${model}. Available: ${appConfig.ai.availableModels.join(', ')}` },
        { status: 400 }
      );
    }
    
    // Validate sandbox
    if (!sandboxId) {
      return NextResponse.json(
        { error: 'sandboxId is required' },
        { status: 400 }
      );
    }
    
    // Get API key
    const apiKey = process.env.CHUTES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CHUTES_API_KEY is not configured' },
        { status: 500 }
      );
    }
    
    const agentConfig = AGENTS[agent];
    
    // Create streaming response
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    
    const sendEvent = async (data: object) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };
    
    // Run agent in background
    (async () => {
      try {
        await sendEvent({ type: 'status', message: `Starting ${agentConfig.name}...` });
        
        // Build environment variables (Claude Code reads from ANTHROPIC_* env vars)
        const env = agentConfig.setupEnv(model, apiKey);
        
        // Build command
        const commandParts = agentConfig.buildCommand(prompt);
        const command = commandParts.map(part => 
          part.includes(' ') ? `"${part.replace(/"/g, '\\"')}"` : part
        ).join(' ');
        
        await sendEvent({ 
          type: 'status', 
          message: `Running ${agentConfig.name} with model ${appConfig.ai.modelDisplayNames[model] || model}...` 
        });
        
        console.log(`[agent-run] Executing: ${command}`);
        console.log(`[agent-run] Environment:`, Object.keys(env));
        
        // Execute the agent command
        // For now, we use a simple exec - in production, we'd want streaming
        const result = await execInSandbox(
          sandboxId,
          command,
          env,
          600000 // 10 minute timeout
        );
        
        // Helper to strip ANSI escape codes
        const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
        
        // Parse and stream the output
        if (result.stdout) {
          const cleanOutput = stripAnsi(result.stdout);
          
          // For Claude Code, try to parse as JSON lines
          if (agent === 'claude-code') {
            const lines = cleanOutput.split('\n').filter(Boolean);
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                await sendEvent({ type: 'agent-output', data: parsed });
              } catch {
                // Plain text output - send as single message
                if (line.trim()) {
                  await sendEvent({ type: 'output', text: line.trim() });
                }
              }
            }
          } else {
            // For other agents, send the entire output as one message
            if (cleanOutput.trim()) {
              await sendEvent({ type: 'output', text: cleanOutput.trim() });
            }
          }
        }
        
        if (result.stderr) {
          const cleanStderr = stripAnsi(result.stderr);
          if (cleanStderr.trim()) {
            await sendEvent({ type: 'stderr', text: cleanStderr.trim() });
          }
        }
        
        await sendEvent({ 
          type: 'complete', 
          exitCode: result.exitCode,
          success: result.exitCode === 0
        });
        
      } catch (error: any) {
        console.error('[agent-run] Error:', error);
        await sendEvent({ type: 'error', error: error.message });
      } finally {
        await writer.close();
      }
    })();
    
    return new NextResponse(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error: any) {
    console.error('[agent-run] Request error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// GET endpoint to list available agents and models
export async function GET() {
  return NextResponse.json({
    agents: Object.entries(AGENTS).map(([id, config]) => ({
      id,
      name: config.name,
      command: config.command,
    })),
    models: appConfig.ai.availableModels.map(id => ({
      id,
      name: appConfig.ai.modelDisplayNames[id] || id,
    })),
    defaultModel: appConfig.ai.defaultModel,
  });
}

