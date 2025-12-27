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
      // Use claude.chutes.ai proxy which translates Anthropic Messages API to Chutes models
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
      // Suppress colors for cleaner output
      NO_COLOR: '1',
      TERM: 'dumb',
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

// System instruction to enforce React/Vite tech stack
const REACT_VITE_SYSTEM_PROMPT = `
IMPORTANT REQUIREMENTS - Follow these strictly:

1. You MUST create a React application using Vite as the bundler
2. The project structure MUST be:
   - /workspace/src/App.jsx - Main app component
   - /workspace/src/main.jsx - Entry point
   - /workspace/src/index.css - Styles (using Tailwind CSS classes)
   - /workspace/index.html - HTML template
   - /workspace/vite.config.js - Vite configuration
   - /workspace/package.json - Dependencies

3. Use the following tech stack:
   - React 18 with functional components and hooks
   - Tailwind CSS for styling (use utility classes)
   - NO external CSS frameworks (no Bootstrap, Material UI, etc)
   - NO TypeScript (use .jsx files)

4. The app MUST:
   - Be a complete, working web application
   - Run on port 5173 (Vite default)
   - Have all dependencies installed
   - Start with "npm run dev"

5. After creating all files, run these commands:
   - cd /workspace && npm install
   - npm run dev

6. Make sure the app visually works and displays content in the browser.

User Request:
`;

// Helper to wrap user prompt with system instructions
function wrapPromptForReactVite(prompt: string): string {
  return REACT_VITE_SYSTEM_PROMPT + prompt;
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

// Make a request to Sandy API with retry logic
async function sandyRequest<T>(
  path: string,
  options: RequestInit = {},
  retries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  const { baseUrl, apiKey } = getSandyConfig();
  const url = `${baseUrl}${path}`;
  
  const headers = new Headers(options.headers || {});
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  headers.set('Content-Type', 'application/json');
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const text = await response.text();
        // Don't retry 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Sandy API error ${response.status}: ${text}`);
        }
        throw new Error(`Sandy API error ${response.status}: ${text}`);
      }
      
      return response.json();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry if it's a 4xx error or abort
      if (lastError.message.includes('404') || 
          lastError.message.includes('400') ||
          lastError.name === 'AbortError') {
        throw lastError;
      }
      
      // Retry with exponential backoff for transient errors
      if (attempt < retries - 1) {
        console.log(`[sandyRequest] Retry ${attempt + 1}/${retries} after error:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
      }
    }
  }
  
  throw lastError || new Error('Sandy API request failed after retries');
}

// Execute command in sandbox (synchronous) with validation
async function execInSandbox(
  sandboxId: string,
  command: string,
  env: Record<string, string> = {},
  timeoutMs: number = 600000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!sandboxId || sandboxId.length < 8) {
    throw new Error(`Invalid sandboxId: ${sandboxId}`);
  }
  
  // Sanitize command - remove any control characters
  const sanitizedCommand = command.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  
  return sandyRequest(`/api/sandboxes/${sandboxId}/exec`, {
    method: 'POST',
    body: JSON.stringify({
      command: sanitizedCommand,
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
    // Use a unique separator to split content from byte count
    const SEPARATOR = '___SANDY_OFFSET_SEP___';
    const result = await execInSandbox(
      sandboxId,
      `tail -c +${offset + 1} ${outputFile} 2>/dev/null; echo "${SEPARATOR}"; wc -c < ${outputFile} 2>/dev/null`,
      {},
      5000
    );

    // Split by separator to get content and byte count separately
    const parts = result.stdout.split(SEPARATOR);
    const content = parts[0] || '';
    const newOffset = parts[1] ? parseInt(parts[1].trim()) || offset : offset;

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
    
    // Verify sandbox exists before proceeding
    try {
      await sandyRequest<{ sandboxId: string }>(`/api/sandboxes/${sandboxId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        return NextResponse.json(
          { error: `Sandbox ${sandboxId} not found. Please create a new sandbox.` },
          { status: 404 }
        );
      }
      // Re-throw other errors
      throw error;
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
        
        // Wrap prompt with React/Vite system instructions
        const wrappedPrompt = wrapPromptForReactVite(prompt);

        // Build command
        const commandParts = agentConfig.buildCommand(wrappedPrompt, model);
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
        let consecutiveErrors = 0;
        const maxPolls = 1200; // 10 minutes at 500ms intervals
        const pollInterval = 500; // 500ms between polls
        const maxConsecutiveErrors = 5; // Allow some transient errors

        // Buffer for incomplete JSON lines (Claude Code stream-json format)
        let jsonLineBuffer = '';

        while (running && pollCount < maxPolls && consecutiveErrors < maxConsecutiveErrors) {
          // Wait before polling
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          try {
            // Check if process is still running (check done file)
            running = await isProcessRunning(sandboxId, doneFile);

            // Read new output
            const { content, newOffset } = await readOutputFromOffset(sandboxId, outputFile, offset);

            // Reset error counter on success
            consecutiveErrors = 0;

            if (content && content !== lastSentContent) {
              const newContent = content.substring(lastSentContent.length);
              if (newContent.trim()) {
                const cleanContent = stripAnsi(newContent);

                // For Claude Code, try to parse as JSON lines with buffering
                if (agent === 'claude-code') {
                  // Add new content to buffer
                  jsonLineBuffer += cleanContent;

                  // Process complete lines (those ending with newline)
                  const lines = jsonLineBuffer.split('\n');
                  // Keep the last incomplete line in the buffer
                  jsonLineBuffer = lines.pop() || '';

                  for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    try {
                      const parsed = JSON.parse(trimmedLine);
                      await sendEvent({ type: 'agent-output', data: parsed });
                    } catch {
                      // If it looks like incomplete JSON, skip it
                      // Only send as output if it's clearly NOT JSON
                      if (!trimmedLine.startsWith('{') && !trimmedLine.startsWith('"')) {
                        await sendEvent({ type: 'output', text: trimmedLine });
                      }
                      // Otherwise, it's likely a malformed JSON line - skip it
                    }
                  }
                } else {
                  // For other agents (Codex, Aider), filter and format output
                  const lines = cleanContent.split('\n');
                  const batchedLines: string[] = [];

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // Filter out noise patterns from Codex/Aider
                    if (trimmed.startsWith('--------') ||
                        trimmed.startsWith('workdir:') ||
                        trimmed.startsWith('model:') ||
                        trimmed.startsWith('provider:') ||
                        trimmed.startsWith('approval:') ||
                        trimmed.startsWith('sandbox:') ||
                        trimmed.startsWith('reasoning') ||
                        trimmed.startsWith('session id:') ||
                        trimmed.startsWith('mcp startup:') ||
                        trimmed.startsWith('bash -lc') ||
                        trimmed.startsWith('bash -c') ||
                        trimmed.match(/^OpenAI Codex v[\d.]+/) ||
                        trimmed.match(/^exec$/) ||
                        trimmed.match(/in \/workspace (succeeded|exited|failed) in \d+ms/) || // Command exec logs
                        trimmed.match(/^\d+$/) || // Pure numbers (byte counts, etc)
                        trimmed.match(/^user$/) ||
                        trimmed.match(/^___SANDY_OFFSET_SEP___$/) ||
                        trimmed.match(/^npm error Log files were not written/) || // Verbose npm log message
                        trimmed.match(/^npm error You can rerun/) // Verbose npm suggestion
                    ) {
                      continue; // Skip noise
                    }

                    // Format Codex plan updates nicely
                    if (trimmed.startsWith('Plan update')) {
                      // Send any batched content first
                      if (batchedLines.length > 0) {
                        await sendEvent({ type: 'output', text: batchedLines.join('\n') });
                        batchedLines.length = 0;
                      }
                      await sendEvent({ type: 'status', message: 'Planning...' });
                      continue;
                    }

                    // Skip agent name lines
                    if (trimmed === 'codex' || trimmed === 'aider') {
                      continue;
                    }

                    // Collect meaningful output for batching
                    batchedLines.push(trimmed);
                  }

                  // Send batched lines as a single message
                  if (batchedLines.length > 0) {
                    await sendEvent({ type: 'output', text: batchedLines.join('\n') });
                  }
                }

                lastSentContent = content;
              }
            }

            offset = newOffset;
          } catch (pollError) {
            consecutiveErrors++;
            console.warn(`[agent-run] Poll error ${consecutiveErrors}/${maxConsecutiveErrors}:`, pollError);
            
            // If sandbox is gone, stop polling
            if (pollError instanceof Error && 
                (pollError.message.includes('404') || pollError.message.includes('not found'))) {
              console.error('[agent-run] Sandbox disappeared during execution');
              await sendEvent({ type: 'error', error: 'Sandbox was terminated unexpectedly' });
              running = false;
              break;
            }
          }
          
          // Send heartbeat every 10 polls (5 seconds) to keep connection alive
          if (pollCount % 10 === 0 && running) {
            await sendEvent({ type: 'heartbeat', elapsed: pollCount * pollInterval / 1000 });
          }
        }
        
        // Check if we exited due to too many errors
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('[agent-run] Too many consecutive polling errors');
          await sendEvent({ type: 'error', error: 'Lost connection to sandbox' });
        }
        
        // Process any remaining buffered content for Claude Code
        if (agent === 'claude-code' && jsonLineBuffer.trim()) {
          try {
            const parsed = JSON.parse(jsonLineBuffer.trim());
            await sendEvent({ type: 'agent-output', data: parsed });
          } catch {
            // Skip malformed JSON in buffer
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
              // For Claude Code, try to parse as JSON
              if (agent === 'claude-code') {
                try {
                  const parsed = JSON.parse(line);
                  await sendEvent({ type: 'agent-output', data: parsed });
                } catch {
                  // Only send non-JSON lines as output
                  if (!line.startsWith('{') && !line.startsWith('"')) {
                    await sendEvent({ type: 'output', text: line });
                  }
                }
              } else {
                await sendEvent({ type: 'output', text: line });
              }
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




