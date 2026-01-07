#!/usr/bin/env npx tsx
/**
 * Test various CLI + Model combinations against the deployed chutes-webcoder API
 * 
 * Tests the production-like setup with Sandy sandboxes and Chutes models
 */

const API_URL = process.env.WEBCODER_API_URL || 'https://chutes-webcoder.onrender.com';

interface TestResult {
  agent: string;
  model: string;
  success: boolean;
  duration: number;
  firstOutputAt: number | null;
  outputCount: number;
  previewOk: boolean;
  previewErrors: string[];
  error?: string;
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

async function killExistingSandbox(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/kill-sandbox`, { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch {
    // Ignore errors
  }
}

async function createSandbox(): Promise<{ sandboxId: string; url: string }> {
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

async function runAgent(
  agent: string,
  model: string,
  prompt: string,
  sandboxId: string,
  timeoutMs: number = 180000
): Promise<TestResult> {
  const startTime = Date.now();
  let firstOutputAt: number | null = null;
  let outputCount = 0;
  let success = false;
  let error: string | undefined;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(`${API_URL}/api/agent-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, model, prompt, sandboxId }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
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
          
          if (data.type === 'output' || data.type === 'agent-output') {
            outputCount++;
            if (firstOutputAt === null) {
              firstOutputAt = Date.now() - startTime;
            }
            // Log first few outputs
            if (outputCount <= 3) {
              const text = data.text || JSON.stringify(data.data).substring(0, 60);
              log(`    📝 ${text.substring(0, 70)}...`, 'magenta');
            }
          } else if (data.type === 'complete') {
            success = data.success === true;
          } else if (data.type === 'error') {
            error = data.error;
          } else if (data.type === 'heartbeat' && outputCount === 0) {
            log(`    💓 Heartbeat (${data.elapsed}s)`, 'cyan');
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } catch (e: any) {
    error = e.message;
    if (e.name === 'AbortError') {
      error = 'Timeout exceeded';
    }
  }
  
  return {
    agent,
    model,
    success,
    duration: Date.now() - startTime,
    firstOutputAt,
    outputCount,
    previewOk: false,
    previewErrors: [],
    error,
  };
}

async function checkPreview(sandboxId: string, previewUrl: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  let html = '';
  try {
    const response = await fetch(previewUrl);
    if (!response.ok) {
      errors.push(`Preview HTTP ${response.status}`);
    } else {
      html = await response.text();
    }
  } catch (e: any) {
    errors.push(`Preview request failed: ${e.message || String(e)}`);
  }

  if (html && !html.includes('/@vite/client')) {
    errors.push('Preview HTML missing /@vite/client');
  }
  if (html && !html.includes('/src/main.jsx')) {
    errors.push('Preview HTML missing /src/main.jsx');
  }

  const cookie = `sandySandboxId=${sandboxId}`;
  const assetPaths = ['/@vite/client', '/src/main.jsx'];
  for (const assetPath of assetPaths) {
    try {
      const assetUrl = new URL(assetPath, API_URL).toString();
      const assetResponse = await fetch(assetUrl, { headers: { Cookie: cookie } });
      if (!assetResponse.ok) {
        errors.push(`Asset ${assetPath} HTTP ${assetResponse.status}`);
      }
    } catch (e: any) {
      errors.push(`Asset ${assetPath} request failed: ${e.message || String(e)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

async function testCombination(agent: string, model: string): Promise<TestResult> {
  log(`\n  Testing: ${agent} + ${model}`, 'blue');
  
  // Kill any existing sandbox first
  await killExistingSandbox();
  
  // Create fresh sandbox
  log(`    Creating sandbox...`, 'cyan');
  const { sandboxId, url } = await createSandbox();
  log(`    Sandbox: ${sandboxId}`, 'cyan');
  
  // Wait for sandbox to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const prompt = 'Create a file called test.txt containing "Test successful"';
  log(`    Running agent...`, 'blue');
  
  const result = await runAgent(agent, model, prompt, sandboxId, 180000);

  log(`    Checking preview...`, 'cyan');
  const previewCheck = await checkPreview(sandboxId, url);
  const previewStatus = previewCheck.ok ? 'OK' : 'FAIL';
  log(`    Preview: ${previewStatus}`, previewCheck.ok ? 'green' : 'red');
  if (!previewCheck.ok) {
    for (const previewError of previewCheck.errors) {
      log(`    Preview error: ${previewError}`, 'red');
    }
  }

  result.previewOk = previewCheck.ok;
  result.previewErrors = previewCheck.errors;
  result.success = result.success && previewCheck.ok;

  const status = result.success ? '✅ PASS' : '❌ FAIL';
  const color = result.success ? 'green' : 'red';
  
  log(`    ${status} in ${(result.duration / 1000).toFixed(1)}s`, color);
  if (result.firstOutputAt) {
    log(`    First output: ${(result.firstOutputAt / 1000).toFixed(1)}s, Total outputs: ${result.outputCount}`, 'cyan');
  }
  if (result.error) {
    log(`    Error: ${result.error}`, 'red');
  }
  
  return result;
}

async function main() {
  log('\n' + '═'.repeat(70), 'bold');
  log('  🧪 CLI + MODEL COMBINATION TESTS', 'bold');
  log('═'.repeat(70), 'bold');
  
  log(`\nAPI URL: ${API_URL}`, 'cyan');
  
  // Define test matrix
  const agents = ['codex', 'aider', 'claude-code'];
  const models = [
    'deepseek-ai/DeepSeek-V3.2-TEE',
    'zai-org/GLM-4.7-TEE',
  ];
  
  // Parse CLI args
  const args = process.argv.slice(2);
  const specificAgent = args.find(a => a.startsWith('--agent='))?.split('=')[1];
  const specificModel = args.find(a => a.startsWith('--model='))?.split('=')[1];
  
  let combinations: Array<{ agent: string; model: string }> = [];
  
  if (specificAgent && specificModel) {
    combinations = [{ agent: specificAgent, model: specificModel }];
  } else if (specificAgent) {
    combinations = models.map(m => ({ agent: specificAgent, model: m }));
  } else if (specificModel) {
    combinations = agents.map(a => ({ agent: a, model: specificModel }));
  } else {
    // Default: test a subset to keep test time reasonable
    combinations = [
      { agent: 'codex', model: 'deepseek-ai/DeepSeek-V3.2-TEE' },
      { agent: 'aider', model: 'deepseek-ai/DeepSeek-V3.2-TEE' },
      { agent: 'codex', model: 'zai-org/GLM-4.7-TEE' },
      { agent: 'claude-code', model: 'deepseek-ai/DeepSeek-V3.2-TEE' },
    ];
  }
  
  log(`\nTesting ${combinations.length} combination(s)...`, 'yellow');
  
  const results: TestResult[] = [];
  
  for (const combo of combinations) {
    const result = await testCombination(combo.agent, combo.model);
    results.push(result);
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Summary
  log('\n' + '═'.repeat(70), 'bold');
  log('  📊 SUMMARY', 'bold');
  log('═'.repeat(70), 'bold');
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  log(`\n  Passed: ${passed}/${results.length}`, passed === results.length ? 'green' : 'yellow');
  log(`  Failed: ${failed}/${results.length}`, failed === 0 ? 'green' : 'red');
  
  log('\n  Results by combination:', 'cyan');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const color = result.success ? 'green' : 'red';
    const time = (result.duration / 1000).toFixed(1);
    log(`    ${status} ${result.agent} + ${result.model} (${time}s)`, color);
    if (result.error) {
      log(`       Error: ${result.error}`, 'red');
    }
    if (!result.previewOk) {
      log(`       Preview: ${result.previewErrors.join('; ') || 'failed'}`, 'red');
    }
  }
  
  log('\n' + '═'.repeat(70), 'bold');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});



















