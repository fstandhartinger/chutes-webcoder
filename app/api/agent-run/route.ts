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
    buildCommand: (prompt: string, _model: string) => [
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
    buildCommand: (prompt: string, model: string) => [
      'codex', 'exec', '--full-auto', '--skip-git-repo-check', '--model', model, prompt
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
    buildCommand: (prompt: string, _model: string) => [
      'aider',
      '--yes',                    // Auto-confirm all prompts
      '--no-git',                 // Don't use git
      '--no-auto-commits',        // Don't auto-commit
      '--no-show-model-warnings', // Suppress model warnings
      '--no-pretty',              // Disable pretty output (no spinners/colors)
      '--message', prompt
      // NOTE: Removed --no-stream to allow streaming output
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

// Execute command in sandbox (synchronous)
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

// Start a command in background and return immediately
async function startBackgroundCommand(
  sandboxId: string,
  command: string,
  env: Record<string, string> = {},
  outputFile: string = '/tmp/agent_output.log',
  pidFile: string = '/tmp/agent.pid',
  doneFile: string = '/tmp/agent.done'
): Promise<void> {
  // Start the command in background, redirecting all output to file
  // Write the exit code to done file when finished
  const bgCommand = `rm -f ${doneFile}; nohup sh -c '${command.replace(/'/g, "'\\''")};echo $? > ${doneFile}' > ${outputFile} 2>&1 & echo $! > ${pidFile}`;
  await execInSandbox(sandboxId, bgCommand, env, 10000);
}

// Check if background process is still running
async function isProcessRunning(sandboxId: string, doneFile: string = '/tmp/agent.done'): Promise<boolean> {
  try {
    // Check if the done file exists - if it does, the process has finished
    const result = await execInSandbox(
      sandboxId,
      `test -f ${doneFile} && echo "done" || echo "running"`,
      {},
      5000
    );
    return result.stdout.trim() === 'running';
  } catch {
    return false;
  }
}

// Read output from file, starting from a specific byte offset
async function readOutputFromOffset(
  sandboxId: string,
  outputFile: string = '/tmp/agent_output.log',
  offset: number = 0
): Promise<{ content: string; newOffset: number }> {
  try {
    const result = await execInSandbox(
      sandboxId,
      `tail -c +${offset + 1} ${outputFile} 2>/dev/null; wc -c < ${outputFile} 2>/dev/null`,
      {},
      5000
    );
    
    const lines = result.stdout.split('\n');
    const newOffset = parseInt(lines[lines.length - 1].trim()) || offset;
    const content = lines.slice(0, -1).join('\n');
    
    return { content, newOffset };
  } catch {
    return { content: '', newOffset: offset };
  }
}

// Get exit code of completed process
async function getExitCode(sandboxId: string, doneFile: string = '/tmp/agent.done'): Promise<number> {
  try {
    // Read the exit code from the done file
    const result = await execInSandbox(
      sandboxId,
      `cat ${doneFile} 2>/dev/null || echo "1"`,
      {},
      5000
    );
    return parseInt(result.stdout.trim()) || 0;
  } catch {
    return 1;
  }
}

// Helper to strip ANSI escape codes
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '');
}

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
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      } catch {
        // Writer may be closed, ignore
      }
    };
    
    // Run agent in background with streaming output
    (async () => {
      const outputFile = '/tmp/agent_output.log';
      const pidFile = '/tmp/agent.pid';
      const doneFile = '/tmp/agent.done';
      let lastSentContent = '';
      
      try {
        await sendEvent({ type: 'status', message: `Starting ${agentConfig.name}...` });
        
        // Build environment variables
        const env = agentConfig.setupEnv(model, apiKey);
        
        // Clean up any previous output files
        await execInSandbox(sandboxId, `rm -f ${outputFile} ${pidFile} ${doneFile}`, {}, 5000).catch(() => {});
        
        // For Codex, create config.toml before running
        if (agent === 'codex') {
          const configToml = `
# Generated by chutes-webcoder agent-run
model_provider = "chutes-ai"
model = "${model}"
model_reasoning_effort = "high"

[model_providers."chutes-ai"]
name = "Chutes AI via responses proxy"
base_url = "https://responses.chutes.ai/v1"
env_key = "MY_PROVIDER_API_KEY"
wire_api = "responses"

[notice]
hide_full_access_warning = true

[features]
view_image_tool = true
web_search_request = true

[experimental]
rmcp_client = true
`;
          await execInSandbox(
            sandboxId,
            `mkdir -p /root/.codex && cat > /root/.codex/config.toml << 'CONFIGEOF'
${configToml}
CONFIGEOF`,
            env,
            10000
          );
          console.log('[agent-run] Created Codex config.toml');
        }
        
        // Build command
        const commandParts = agentConfig.buildCommand(prompt, model);
        const command = commandParts.map(part => 
          part.includes(' ') || part.includes('"') ? `"${part.replace(/"/g, '\\"')}"` : part
        ).join(' ');
        
        await sendEvent({ 
          type: 'status', 
          message: `Running ${agentConfig.name} with model ${appConfig.ai.modelDisplayNames[model] || model}...` 
        });
        
        console.log(`[agent-run] Executing in background: ${command}`);
        console.log(`[agent-run] Environment:`, Object.keys(env));
        
        // Start the command in background
        await startBackgroundCommand(sandboxId, command, env, outputFile, pidFile, doneFile);
        
        // Poll for output and stream it
        let offset = 0;
        let running = true;
        let pollCount = 0;
        const maxPolls = 1200; // 10 minutes at 500ms intervals
        const pollInterval = 500; // 500ms between polls
        
        while (running && pollCount < maxPolls) {
          // Wait before polling
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;
          
          // Check if process is still running (check done file)
          running = await isProcessRunning(sandboxId, doneFile);
          
          // Read new output
          const { content, newOffset } = await readOutputFromOffset(sandboxId, outputFile, offset);
          
          if (content && content !== lastSentContent) {
            const newContent = content.substring(lastSentContent.length);
            if (newContent.trim()) {
              const cleanContent = stripAnsi(newContent);
              
              // For Claude Code, try to parse as JSON lines
              if (agent === 'claude-code') {
                const lines = cleanContent.split('\n').filter(Boolean);
                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line);
                    await sendEvent({ type: 'agent-output', data: parsed });
                  } catch {
                    if (line.trim()) {
                      await sendEvent({ type: 'output', text: line.trim() });
                    }
                  }
                }
              } else {
                // For other agents, send line by line for real-time feel
                const lines = cleanContent.split('\n');
                for (const line of lines) {
                  if (line.trim()) {
                    await sendEvent({ type: 'output', text: line.trim() });
                  }
                }
              }
              
              lastSentContent = content;
            }
          }
          
          offset = newOffset;
          
          // Send heartbeat every 10 polls (5 seconds) to keep connection alive
          if (pollCount % 10 === 0 && running) {
            await sendEvent({ type: 'heartbeat', elapsed: pollCount * pollInterval / 1000 });
          }
        }
        
        // Read any remaining output
        const { content: finalContent } = await readOutputFromOffset(sandboxId, outputFile, 0);
        if (finalContent && finalContent !== lastSentContent) {
          const newContent = finalContent.substring(lastSentContent.length);
          if (newContent.trim()) {
            const cleanContent = stripAnsi(newContent);
            const lines = cleanContent.split('\n').filter(line => line.trim());
            for (const line of lines) {
              await sendEvent({ type: 'output', text: line });
            }
          }
        }
        
        // Get exit code
        const exitCode = await getExitCode(sandboxId, doneFile);
        
        await sendEvent({ 
          type: 'complete', 
          exitCode,
          success: exitCode === 0
        });
        
      } catch (error: unknown) {
        console.error('[agent-run] Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await sendEvent({ type: 'error', error: errorMessage });
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
    
  } catch (error: unknown) {
    console.error('[agent-run] Request error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: errorMessage },
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
