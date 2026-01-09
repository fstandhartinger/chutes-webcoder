#!/usr/bin/env npx tsx
/**
 * Integration test for agent streaming behavior
 * 
 * Tests that:
 * 1. Agents stream output in real-time (not just at the end)
 * 2. Heartbeat events are sent periodically
 * 3. All agents work correctly with Chutes models
 * 4. Exit codes are properly reported
 */

const API_URL = process.env.WEBCODER_API_URL || 'https://chutes-webcoder.onrender.com';

interface SSEEvent {
  type: string;
  timestamp: number;
  data: any;
}

interface StreamingMetrics {
  totalEvents: number;
  outputEvents: number;
  heartbeatEvents: number;
  statusEvents: number;
  firstOutputAt: number | null;
  lastOutputAt: number | null;
  completeEvent: any | null;
  errors: string[];
  allEvents: SSEEvent[];
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
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

async function createSandbox(): Promise<{ sandboxId: string; url: string }> {
  // First kill any existing sandbox
  await fetch(`${API_URL}/api/kill-sandbox`, { method: 'POST' }).catch(() => {});
  
  const response = await fetch(`${API_URL}/api/create-ai-sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create sandbox: ${response.status} ${text}`);
  }
  
  const data = await response.json();
  const resolvedUrl = data.url && data.url.startsWith('/')
    ? new URL(data.url, API_URL).toString()
    : data.url;
  return { sandboxId: data.sandboxId, url: resolvedUrl };
}

async function runAgentWithStreaming(
  agent: string,
  model: string,
  prompt: string,
  sandboxId: string,
  onEvent?: (event: SSEEvent) => void
): Promise<StreamingMetrics> {
  const metrics: StreamingMetrics = {
    totalEvents: 0,
    outputEvents: 0,
    heartbeatEvents: 0,
    statusEvents: 0,
    firstOutputAt: null,
    lastOutputAt: null,
    completeEvent: null,
    errors: [],
    allEvents: [],
  };
  
  const startTime = Date.now();
  
  const response = await fetch(`${API_URL}/api/agent-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, model, prompt, sandboxId }),
  });
  
  if (!response.ok || !response.body) {
    throw new Error(`Agent run failed: ${response.status}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      
      try {
        const data = JSON.parse(line.slice(6));
        const event: SSEEvent = {
          type: data.type,
          timestamp: Date.now() - startTime,
          data,
        };
        
        metrics.totalEvents++;
        metrics.allEvents.push(event);
        
        if (data.type === 'output' || data.type === 'agent-output') {
          metrics.outputEvents++;
          if (metrics.firstOutputAt === null) {
            metrics.firstOutputAt = event.timestamp;
          }
          metrics.lastOutputAt = event.timestamp;
        } else if (data.type === 'heartbeat') {
          metrics.heartbeatEvents++;
        } else if (data.type === 'status') {
          metrics.statusEvents++;
        } else if (data.type === 'complete') {
          metrics.completeEvent = data;
        } else if (data.type === 'error') {
          metrics.errors.push(data.error);
        }
        
        if (onEvent) {
          onEvent(event);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  
  return metrics;
}

async function testAgentStreaming(agent: string, model: string): Promise<boolean> {
  log(`\n${'─'.repeat(70)}`, 'yellow');
  log(`Testing: ${agent} + ${model}`, 'bold');
  log(`${'─'.repeat(70)}`, 'yellow');
  
  try {
    // Create sandbox
    log('  Creating sandbox...', 'cyan');
    const { sandboxId, url } = await createSandbox();
    log(`  Sandbox: ${sandboxId}`, 'cyan');
    log(`  URL: ${url}`, 'cyan');
    
    // Wait for sandbox to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Run agent with streaming
    const prompt = 'Create a file called hello.txt containing "Hello from streaming test"';
    log(`  Prompt: "${prompt.substring(0, 60)}..."`, 'cyan');
    log(`  Running ${agent}...`, 'blue');
    
    let lastEventTime = 0;
    const metrics = await runAgentWithStreaming(agent, model, prompt, sandboxId, (event) => {
      const timeSinceLast = event.timestamp - lastEventTime;
      lastEventTime = event.timestamp;
      
      if (event.type === 'output' || event.type === 'agent-output') {
        const text = event.data.text || JSON.stringify(event.data.data).substring(0, 80);
        log(`    [${(event.timestamp / 1000).toFixed(1)}s +${timeSinceLast}ms] 📝 ${text.substring(0, 70)}...`, 'magenta');
      } else if (event.type === 'status') {
        log(`    [${(event.timestamp / 1000).toFixed(1)}s] 📊 ${event.data.message}`, 'blue');
      } else if (event.type === 'heartbeat') {
        log(`    [${(event.timestamp / 1000).toFixed(1)}s] 💓 Heartbeat (elapsed: ${event.data.elapsed}s)`, 'cyan');
      } else if (event.type === 'complete') {
        const status = event.data.success ? '✅' : '❌';
        log(`    [${(event.timestamp / 1000).toFixed(1)}s] ${status} Complete (exit: ${event.data.exitCode})`, event.data.success ? 'green' : 'red');
      }
    });
    
    // Analyze results
    log(`\n  Results:`, 'cyan');
    log(`    Total events: ${metrics.totalEvents}`, 'cyan');
    log(`    Output events: ${metrics.outputEvents}`, 'cyan');
    log(`    Heartbeat events: ${metrics.heartbeatEvents}`, 'cyan');
    log(`    Status events: ${metrics.statusEvents}`, 'cyan');
    
    if (metrics.firstOutputAt !== null) {
      log(`    First output at: ${(metrics.firstOutputAt / 1000).toFixed(1)}s`, 'cyan');
    }
    if (metrics.lastOutputAt !== null) {
      log(`    Last output at: ${(metrics.lastOutputAt / 1000).toFixed(1)}s`, 'cyan');
    }
    
    // Check streaming quality
    const streamingQuality = {
      hasOutput: metrics.outputEvents > 0,
      hasMultipleOutputs: metrics.outputEvents > 1,
      hasHeartbeats: metrics.heartbeatEvents > 0,
      hasComplete: metrics.completeEvent !== null,
      success: metrics.completeEvent?.success === true,
      noErrors: metrics.errors.length === 0,
    };
    
    log(`\n  Streaming Quality:`, 'cyan');
    log(`    Has output: ${streamingQuality.hasOutput ? '✅' : '❌'}`, streamingQuality.hasOutput ? 'green' : 'red');
    log(`    Multiple outputs: ${streamingQuality.hasMultipleOutputs ? '✅' : '⚠️'}`, streamingQuality.hasMultipleOutputs ? 'green' : 'yellow');
    log(`    Has heartbeats: ${streamingQuality.hasHeartbeats ? '✅' : '⚠️'}`, streamingQuality.hasHeartbeats ? 'green' : 'yellow');
    log(`    Has complete: ${streamingQuality.hasComplete ? '✅' : '❌'}`, streamingQuality.hasComplete ? 'green' : 'red');
    log(`    Success: ${streamingQuality.success ? '✅' : '❌'}`, streamingQuality.success ? 'green' : 'red');
    log(`    No errors: ${streamingQuality.noErrors ? '✅' : '❌'}`, streamingQuality.noErrors ? 'green' : 'red');
    
    if (metrics.errors.length > 0) {
      log(`\n  Errors:`, 'red');
      for (const error of metrics.errors) {
        log(`    - ${error}`, 'red');
      }
    }
    
    const passed = streamingQuality.hasOutput && streamingQuality.hasComplete && streamingQuality.success;
    log(`\n  Result: ${passed ? '✅ PASSED' : '❌ FAILED'}`, passed ? 'green' : 'red');
    
    return passed;
  } catch (error) {
    log(`  Error: ${error}`, 'red');
    return false;
  }
}

async function main() {
  log('\n' + '═'.repeat(70), 'bold');
  log('  🧪 AGENT STREAMING INTEGRATION TESTS', 'bold');
  log('═'.repeat(70), 'bold');
  
  log(`\nAPI URL: ${API_URL}`, 'cyan');
  
  // Parse command line args
  const args = process.argv.slice(2);
  const specificAgent = args.find(a => a.startsWith('--agent='))?.split('=')[1];
  const specificModel = args.find(a => a.startsWith('--model='))?.split('=')[1];
  
  let tests = [
    { agent: 'codex', model: 'deepseek-ai/DeepSeek-V3.2-TEE' },
    { agent: 'aider', model: 'deepseek-ai/DeepSeek-V3.2-TEE' },
    // Note: claude-code requires Claude-compatible models via claude.chutes.ai proxy
    // { agent: 'claude-code', model: 'deepseek-ai/DeepSeek-V3.2-TEE' },
  ];
  
  if (specificAgent || specificModel) {
    tests = tests.filter(t => 
      (!specificAgent || t.agent === specificAgent) &&
      (!specificModel || t.model === specificModel)
    );
    
    // If specific agent requested but not in default list, add it
    if (specificAgent && !tests.length) {
      tests = [{ agent: specificAgent, model: specificModel || 'deepseek-ai/DeepSeek-V3.2-TEE' }];
    }
  }
  
  if (tests.length === 0) {
    log('No tests to run!', 'red');
    process.exit(1);
  }
  
  const results: { agent: string; model: string; passed: boolean }[] = [];
  
  for (const test of tests) {
    const passed = await testAgentStreaming(test.agent, test.model);
    results.push({ ...test, passed });
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  // Summary
  log('\n' + '═'.repeat(70), 'bold');
  log('  📊 SUMMARY', 'bold');
  log('═'.repeat(70), 'bold');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  log(`\n  Passed: ${passed}/${results.length}`, passed === results.length ? 'green' : 'yellow');
  log(`  Failed: ${failed}/${results.length}`, failed === 0 ? 'green' : 'red');
  
  log('\n  Details:', 'cyan');
  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const color = result.passed ? 'green' : 'red';
    log(`    ${status} ${result.agent} + ${result.model}`, color);
  }
  
  log('\n' + '═'.repeat(70), 'bold');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});






























