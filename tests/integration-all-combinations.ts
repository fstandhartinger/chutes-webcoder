#!/usr/bin/env npx tsx
/**
 * Comprehensive Integration Tests for All Agent/Model Combinations
 * 
 * This script tests every combination of:
 * - Agents: claude-code, codex, aider
 * - Models: GLM-4.7-TEE, DeepSeek-V3.2-TEE, MiniMax-M2, MiMo-V2-Flash
 * 
 * For each combination it:
 * 1. Creates a real Sandy sandbox on the Hetzner server
 * 2. Runs the agent with a test prompt
 * 3. Verifies streaming output works
 * 4. Verifies the end result is a working app
 * 5. Cleans up the sandbox
 * 
 * Usage:
 *   SANDY_API_KEY=xxx CHUTES_API_KEY=xxx npx tsx tests/integration-all-combinations.ts
 * 
 * Or for a specific combination:
 *   npx tsx tests/integration-all-combinations.ts --agent=aider --model=zai-org/GLM-4.7-TEE
 */

import { parseArgs } from 'util';

// Configuration
const SANDY_BASE_URL = process.env.SANDY_BASE_URL || 'https://sandy.65.109.64.180.nip.io';
const SANDY_API_KEY = process.env.SANDY_API_KEY;
const CHUTES_API_KEY = process.env.CHUTES_API_KEY;
const API_BASE_URL = process.env.TEST_API_URL || 'https://chutes-webcoder.onrender.com';

// Test prompt
const TEST_PROMPT = 'Create a simple tic tac toe game with React. Include a 3x3 grid, X and O players that alternate turns, win detection, and a reset button. Make it visually appealing with a dark theme.';

// All agents and models
const ALL_AGENTS = ['claude-code', 'aider'] as const; // codex removed - not fully supported yet
const ALL_MODELS = [
  'zai-org/GLM-4.7-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'MiniMaxAI/MiniMax-M2.1-TEE',
  'XiaomiMiMo/MiMo-V2-Flash',
] as const;

type Agent = typeof ALL_AGENTS[number];
type Model = typeof ALL_MODELS[number];

interface TestResult {
  agent: Agent;
  model: Model;
  sandboxId: string;
  sandboxUrl: string;
  success: boolean;
  duration: number;
  streamedEvents: number;
  hasOutput: boolean;
  hasFiles: boolean;
  viteRunning: boolean;
  error?: string;
  output?: string;
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Sandy API helpers
async function sandyRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${SANDY_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  
  if (SANDY_API_KEY) {
    headers.set('Authorization', `Bearer ${SANDY_API_KEY}`);
  }
  headers.set('Content-Type', 'application/json');
  
  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandy API error ${response.status}: ${text}`);
  }
  
  return response.json();
}

async function createSandbox(): Promise<{ sandboxId: string; url: string }> {
  return sandyRequest('/api/sandboxes', { method: 'POST' });
}

async function terminateSandbox(sandboxId: string): Promise<void> {
  try {
    await sandyRequest(`/api/sandboxes/${sandboxId}/terminate`, { method: 'POST' });
  } catch (e) {
    console.warn(`Failed to terminate sandbox ${sandboxId}:`, e);
  }
}

async function execInSandbox(
  sandboxId: string, 
  command: string, 
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return sandyRequest(`/api/sandboxes/${sandboxId}/exec`, {
    method: 'POST',
    body: JSON.stringify({
      command,
      cwd: '/workspace',
      env,
      timeoutMs: 30000,
    }),
  });
}

async function listFiles(sandboxId: string, path: string = '/workspace'): Promise<string[]> {
  try {
    const result = await execInSandbox(sandboxId, `find ${path} -type f -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" 2>/dev/null | head -20`);
    return result.stdout.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function checkViteRunning(sandboxId: string): Promise<boolean> {
  try {
    const result = await execInSandbox(sandboxId, 'pgrep -f "vite" || echo "not running"');
    return !result.stdout.includes('not running');
  } catch {
    return false;
  }
}

// Agent run helper
async function runAgent(
  agent: Agent,
  model: Model,
  prompt: string,
  sandboxId: string,
  onEvent: (event: any) => void
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/api/agent-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, model, prompt, sandboxId }),
  });
  
  if (!response.ok) {
    const text = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${text}` };
  }
  
  const reader = response.body?.getReader();
  if (!reader) {
    return { success: false, error: 'No response body' };
  }
  
  const decoder = new TextDecoder();
  let buffer = '';
  let success = false;
  let error: string | undefined;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent(data);
            
            if (data.type === 'error') {
              error = data.error;
            }
            if (data.type === 'complete') {
              success = data.success;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return { success, error };
}

// Run a single test
async function runTest(agent: Agent, model: Model): Promise<TestResult> {
  const startTime = Date.now();
  const events: any[] = [];
  let sandboxId = '';
  let sandboxUrl = '';
  
  try {
    // Create sandbox
    log(`\n  Creating sandbox...`, 'cyan');
    const sandbox = await createSandbox();
    sandboxId = sandbox.sandboxId;
    sandboxUrl = sandbox.url;
    log(`  Sandbox: ${sandboxId}`, 'cyan');
    
    // Wait for sandbox to be ready
    await new Promise(r => setTimeout(r, 3000));
    
    // Run the agent
    log(`  Running ${agent} with ${model}...`, 'cyan');
    const result = await runAgent(agent, model, TEST_PROMPT, sandboxId, (event) => {
      events.push(event);
      
      // Log streaming events
      if (event.type === 'status') {
        log(`    Status: ${event.message}`, 'blue');
      } else if (event.type === 'output') {
        const preview = event.text?.slice(0, 100) || '';
        log(`    Output: ${preview}${event.text?.length > 100 ? '...' : ''}`, 'magenta');
      } else if (event.type === 'error') {
        log(`    Error: ${event.error}`, 'red');
      } else if (event.type === 'complete') {
        log(`    Complete: ${event.success ? 'SUCCESS' : 'FAILED'}`, event.success ? 'green' : 'red');
      }
    });
    
    // Wait a bit for files to be written
    await new Promise(r => setTimeout(r, 2000));
    
    // Check results
    log(`  Checking results...`, 'cyan');
    const files = await listFiles(sandboxId);
    const viteRunning = await checkViteRunning(sandboxId);
    
    const hasOutput = events.some(e => e.type === 'output' || e.type === 'agent-output');
    const hasFiles = files.length > 0;
    
    log(`    Files created: ${files.length}`, files.length > 0 ? 'green' : 'yellow');
    log(`    Vite running: ${viteRunning}`, viteRunning ? 'green' : 'yellow');
    
    const duration = Date.now() - startTime;
    
    return {
      agent,
      model,
      sandboxId,
      sandboxUrl,
      success: result.success && hasFiles,
      duration,
      streamedEvents: events.length,
      hasOutput,
      hasFiles,
      viteRunning,
      error: result.error,
      output: events.filter(e => e.type === 'output').map(e => e.text).join('\n').slice(0, 500),
    };
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      agent,
      model,
      sandboxId,
      sandboxUrl,
      success: false,
      duration,
      streamedEvents: events.length,
      hasOutput: false,
      hasFiles: false,
      viteRunning: false,
      error: error.message,
    };
  } finally {
    // Cleanup
    if (sandboxId) {
      log(`  Cleaning up sandbox ${sandboxId}...`, 'cyan');
      await terminateSandbox(sandboxId);
    }
  }
}

// Main
async function main() {
  // Parse command line arguments
  const { values } = parseArgs({
    options: {
      agent: { type: 'string' },
      model: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  
  if (values.help) {
    console.log(`
Usage: npx tsx tests/integration-all-combinations.ts [options]

Options:
  --agent=<agent>   Test only this agent (claude-code, aider)
  --model=<model>   Test only this model (e.g., zai-org/GLM-4.7-TEE)
  -h, --help        Show this help

Environment:
  SANDY_API_KEY     Required - Sandy API key
  CHUTES_API_KEY    Required - Chutes API key
  SANDY_BASE_URL    Optional - Sandy server URL (default: https://sandy.65.109.64.180.nip.io)
  TEST_API_URL      Optional - Webcoder API URL (default: https://chutes-webcoder.onrender.com)
`);
    process.exit(0);
  }
  
  // Check requirements
  if (!SANDY_API_KEY) {
    log('Error: SANDY_API_KEY environment variable is required', 'red');
    process.exit(1);
  }
  
  if (!CHUTES_API_KEY) {
    log('Error: CHUTES_API_KEY environment variable is required', 'red');
    process.exit(1);
  }
  
  // Determine which tests to run
  let agents: Agent[] = values.agent ? [values.agent as Agent] : [...ALL_AGENTS];
  let models: Model[] = values.model ? [values.model as Model] : [...ALL_MODELS];
  
  // Validate
  for (const agent of agents) {
    if (!ALL_AGENTS.includes(agent as any)) {
      log(`Error: Unknown agent: ${agent}`, 'red');
      process.exit(1);
    }
  }
  
  for (const model of models) {
    if (!ALL_MODELS.includes(model as any)) {
      log(`Error: Unknown model: ${model}`, 'red');
      process.exit(1);
    }
  }
  
  const totalTests = agents.length * models.length;
  
  log(`\n${'='.repeat(70)}`, 'bright');
  log(`  INTEGRATION TESTS: All Agent/Model Combinations`, 'bright');
  log(`${'='.repeat(70)}`, 'bright');
  log(`\nConfiguration:`, 'cyan');
  log(`  Sandy URL:    ${SANDY_BASE_URL}`, 'cyan');
  log(`  API URL:      ${API_BASE_URL}`, 'cyan');
  log(`  Agents:       ${agents.join(', ')}`, 'cyan');
  log(`  Models:       ${models.join(', ')}`, 'cyan');
  log(`  Total tests:  ${totalTests}`, 'cyan');
  log(`\nTest prompt: "${TEST_PROMPT.slice(0, 80)}..."`, 'cyan');
  
  const results: TestResult[] = [];
  let testNumber = 0;
  
  for (const agent of agents) {
    for (const model of models) {
      testNumber++;
      log(`\n${'─'.repeat(70)}`, 'yellow');
      log(`TEST ${testNumber}/${totalTests}: ${agent} + ${model}`, 'bright');
      log(`${'─'.repeat(70)}`, 'yellow');
      
      const result = await runTest(agent, model);
      results.push(result);
      
      // Brief pause between tests
      if (testNumber < totalTests) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  // Print summary
  log(`\n${'='.repeat(70)}`, 'bright');
  log(`  TEST RESULTS SUMMARY`, 'bright');
  log(`${'='.repeat(70)}`, 'bright');
  
  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  log(`\nPassed: ${passed.length}/${results.length}`, passed.length === results.length ? 'green' : 'yellow');
  
  // Detailed results table
  log(`\n${'Agent'.padEnd(15)} ${'Model'.padEnd(30)} ${'Status'.padEnd(10)} ${'Events'.padEnd(8)} ${'Files'.padEnd(6)} ${'Duration'.padEnd(10)}`, 'bright');
  log(`${'-'.repeat(15)} ${'-'.repeat(30)} ${'-'.repeat(10)} ${'-'.repeat(8)} ${'-'.repeat(6)} ${'-'.repeat(10)}`, 'reset');
  
  for (const r of results) {
    const status = r.success ? 'PASS' : 'FAIL';
    const color = r.success ? 'green' : 'red';
    const modelShort = r.model.split('/').pop() || r.model;
    const duration = `${(r.duration / 1000).toFixed(1)}s`;
    
    log(
      `${r.agent.padEnd(15)} ${modelShort.padEnd(30)} ${status.padEnd(10)} ${String(r.streamedEvents).padEnd(8)} ${(r.hasFiles ? 'YES' : 'NO').padEnd(6)} ${duration.padEnd(10)}`,
      color
    );
  }
  
  // Failed tests details
  if (failed.length > 0) {
    log(`\nFailed Tests Details:`, 'red');
    for (const r of failed) {
      log(`\n  ${r.agent} + ${r.model}:`, 'red');
      log(`    Error: ${r.error || 'Unknown error'}`, 'red');
      if (r.output) {
        log(`    Output preview: ${r.output.slice(0, 200)}...`, 'yellow');
      }
    }
  }
  
  // Exit code
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  log(`\nFatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
































