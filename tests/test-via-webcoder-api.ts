#!/usr/bin/env npx tsx
/**
 * Integration Tests via Webcoder API
 * 
 * This test script uses the deployed Webcoder API to test all agent/model combinations.
 * It calls the /api/sandbox endpoint to create sandboxes and /api/agent-run for agents.
 * 
 * This way, it uses the same infrastructure as the actual app.
 * 
 * Usage:
 *   npx tsx tests/test-via-webcoder-api.ts
 * 
 * Or test a specific combination:
 *   npx tsx tests/test-via-webcoder-api.ts --agent=aider --model=zai-org/GLM-4.7-TEE
 */

import { parseArgs } from 'util';

// Configuration
const API_BASE_URL = process.env.TEST_API_URL || 'https://chutes-webcoder.onrender.com';

// Test prompt - creates a simple file to verify agent functionality
const TEST_PROMPT = 'Create a file called Game.jsx with a simple React component that displays "Hello from AI" as a heading';

// All agents and models
// Note: opencode is experimental and excluded from default tests
const ALL_AGENTS = ['codex', 'aider', 'claude-code'] as const;
const ALL_MODELS = [
  'zai-org/GLM-4.7-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'MiniMaxAI/MiniMax-M2',
  'XiaomiMiMo/MiMo-V2-Flash',
  'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
] as const;

type Agent = typeof ALL_AGENTS[number];
type Model = typeof ALL_MODELS[number];

interface TestResult {
  agent: Agent;
  model: Model;
  sandboxId: string;
  success: boolean;
  duration: number;
  streamedEvents: number;
  hasOutput: boolean;
  exitCode?: number;
  error?: string;
  outputPreview?: string;
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

// Kill existing sandbox
async function killSandbox(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/kill-sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    // Wait a moment for cleanup
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    // Ignore errors - sandbox might not exist
  }
}

// Create sandbox via Webcoder API
async function createSandbox(forceNew: boolean = false): Promise<{ sandboxId: string; url: string }> {
  // Kill existing sandbox if we want a fresh one
  if (forceNew) {
    log(`    Killing existing sandbox...`, 'cyan');
    await killSandbox();
  }
  
  const response = await fetch(`${API_BASE_URL}/api/create-ai-sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create sandbox: ${response.status} ${text}`);
  }
  
  const data = await response.json();
  const resolvedUrl = data.url && data.url.startsWith('/')
    ? new URL(data.url, API_BASE_URL).toString()
    : data.url;
  return { sandboxId: data.sandboxId, url: resolvedUrl };
}

// Run agent and stream results
async function runAgent(
  agent: Agent,
  model: Model,
  prompt: string,
  sandboxId: string,
  onEvent: (event: any) => void
): Promise<{ success: boolean; exitCode?: number; error?: string }> {
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
  let exitCode: number | undefined;
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
              exitCode = data.exitCode;
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
  
  return { success, exitCode, error };
}

// Run a single test
async function runTest(agent: Agent, model: Model): Promise<TestResult> {
  const startTime = Date.now();
  const events: any[] = [];
  let sandboxId = '';
  
  try {
    // Create a fresh sandbox for each test
    log(`\n  Creating fresh sandbox via Webcoder API...`, 'cyan');
    const sandbox = await createSandbox(true);
    sandboxId = sandbox.sandboxId;
    log(`  Sandbox ID: ${sandboxId}`, 'cyan');
    log(`  Sandbox URL: ${sandbox.url}`, 'cyan');
    
    // Wait for sandbox to be ready
    log(`  Waiting for sandbox to be ready...`, 'cyan');
    await new Promise(r => setTimeout(r, 5000));
    
    // Run the agent
    log(`  Running ${agent} with ${model}...`, 'cyan');
    log(`  Prompt: "${TEST_PROMPT.slice(0, 60)}..."`, 'cyan');
    
    const result = await runAgent(agent, model, TEST_PROMPT, sandboxId, (event) => {
      events.push(event);
      
      // Log streaming events in real-time
      if (event.type === 'status') {
        log(`    📊 ${event.message}`, 'blue');
      } else if (event.type === 'output') {
        const preview = (event.text || '').slice(0, 80).replace(/\n/g, ' ');
        log(`    📝 ${preview}${(event.text || '').length > 80 ? '...' : ''}`, 'magenta');
      } else if (event.type === 'agent-output') {
        log(`    🤖 Agent output received`, 'magenta');
      } else if (event.type === 'stderr') {
        const preview = (event.text || '').slice(0, 80).replace(/\n/g, ' ');
        log(`    ⚠️ ${preview}`, 'yellow');
      } else if (event.type === 'error') {
        log(`    ❌ ${event.error}`, 'red');
      } else if (event.type === 'complete') {
        log(`    ✅ Complete: ${event.success ? 'SUCCESS' : 'FAILED'} (exit: ${event.exitCode})`, event.success ? 'green' : 'red');
      }
    });
    
    const duration = Date.now() - startTime;
    const hasOutput = events.some(e => e.type === 'output' || e.type === 'agent-output');
    const outputText = events.filter(e => e.type === 'output').map(e => e.text).join('\n');
    
    return {
      agent,
      model,
      sandboxId,
      success: result.success,
      duration,
      streamedEvents: events.length,
      hasOutput,
      exitCode: result.exitCode,
      error: result.error,
      outputPreview: outputText.slice(0, 300),
    };
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      agent,
      model,
      sandboxId,
      success: false,
      duration,
      streamedEvents: events.length,
      hasOutput: false,
      error: error.message,
    };
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
Usage: npx tsx tests/test-via-webcoder-api.ts [options]

Options:
  --agent=<agent>   Test only this agent (claude-code, aider)
  --model=<model>   Test only this model (e.g., zai-org/GLM-4.7-TEE)
  -h, --help        Show this help

Environment:
  TEST_API_URL      Optional - Webcoder API URL (default: https://chutes-webcoder.onrender.com)
`);
    process.exit(0);
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
  
  log(`\n${'═'.repeat(70)}`, 'bright');
  log(`  🧪 AGENT/MODEL INTEGRATION TESTS`, 'bright');
  log(`${'═'.repeat(70)}`, 'bright');
  log(`\nConfiguration:`, 'cyan');
  log(`  API URL:      ${API_BASE_URL}`, 'cyan');
  log(`  Agents:       ${agents.join(', ')}`, 'cyan');
  log(`  Models:       ${models.join(', ')}`, 'cyan');
  log(`  Total tests:  ${totalTests}`, 'cyan');
  
  const results: TestResult[] = [];
  let testNumber = 0;
  
  for (const agent of agents) {
    for (const model of models) {
      testNumber++;
      log(`\n${'─'.repeat(70)}`, 'yellow');
      log(`📋 TEST ${testNumber}/${totalTests}: ${agent} + ${model}`, 'bright');
      log(`${'─'.repeat(70)}`, 'yellow');
      
      const result = await runTest(agent, model);
      results.push(result);
      
      // Summary for this test
      log(`\n  Summary:`, 'cyan');
      log(`    Duration: ${(result.duration / 1000).toFixed(1)}s`, 'cyan');
      log(`    Events streamed: ${result.streamedEvents}`, 'cyan');
      log(`    Has output: ${result.hasOutput ? 'Yes' : 'No'}`, result.hasOutput ? 'green' : 'yellow');
      log(`    Result: ${result.success ? '✅ PASSED' : '❌ FAILED'}`, result.success ? 'green' : 'red');
      if (result.error) {
        log(`    Error: ${result.error}`, 'red');
      }
      
      // Brief pause between tests
      if (testNumber < totalTests) {
        log(`\n  ⏳ Waiting 5s before next test...`, 'cyan');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  
  // Print final summary
  log(`\n${'═'.repeat(70)}`, 'bright');
  log(`  📊 FINAL RESULTS`, 'bright');
  log(`${'═'.repeat(70)}`, 'bright');
  
  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  log(`\n  Passed: ${passed.length}/${results.length}`, passed.length === results.length ? 'green' : 'yellow');
  log(`  Failed: ${failed.length}/${results.length}`, failed.length > 0 ? 'red' : 'green');
  
  // Results table
  log(`\n${'Agent'.padEnd(15)} ${'Model'.padEnd(25)} ${'Status'.padEnd(8)} ${'Events'.padEnd(8)} ${'Output'.padEnd(8)} ${'Time'.padEnd(10)}`, 'bright');
  log(`${'-'.repeat(15)} ${'-'.repeat(25)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(10)}`, 'reset');
  
  for (const r of results) {
    const status = r.success ? '✅ PASS' : '❌ FAIL';
    const color = r.success ? 'green' : 'red';
    const modelShort = r.model.split('/').pop()?.slice(0, 22) || r.model;
    const duration = `${(r.duration / 1000).toFixed(1)}s`;
    const hasOutput = r.hasOutput ? '✓' : '✗';
    
    log(
      `${r.agent.padEnd(15)} ${modelShort.padEnd(25)} ${status.padEnd(8)} ${String(r.streamedEvents).padEnd(8)} ${hasOutput.padEnd(8)} ${duration.padEnd(10)}`,
      color
    );
  }
  
  // Failed test details
  if (failed.length > 0) {
    log(`\n${'─'.repeat(70)}`, 'red');
    log(`  ❌ FAILED TESTS DETAILS:`, 'red');
    log(`${'─'.repeat(70)}`, 'red');
    
    for (const r of failed) {
      log(`\n  ${r.agent} + ${r.model}:`, 'red');
      log(`    Sandbox: ${r.sandboxId}`, 'yellow');
      log(`    Error: ${r.error || 'Unknown error'}`, 'red');
      if (r.outputPreview) {
        log(`    Output preview:`, 'yellow');
        log(`      ${r.outputPreview.slice(0, 200).replace(/\n/g, '\n      ')}`, 'yellow');
      }
    }
  }
  
  log(`\n${'═'.repeat(70)}`, 'bright');
  
  // Exit code
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});









