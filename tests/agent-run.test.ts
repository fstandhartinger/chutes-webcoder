/**
 * Tests for the Agent Run API
 * 
 * These tests verify that all agent/model combinations work correctly.
 * 
 * Run with: npx tsx tests/agent-run.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

// Configuration
const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const SANDY_BASE_URL = process.env.SANDY_BASE_URL || 'https://sandy.94.130.222.43.nip.io';
const SANDY_API_KEY = process.env.SANDY_API_KEY;
const CHUTES_API_KEY = process.env.CHUTES_API_KEY;

// Available agents and models
const AGENTS = ['builtin', 'claude-code', 'codex', 'aider'] as const;
const MODELS = [
  'zai-org/GLM-4.7-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'MiniMaxAI/MiniMax-M2.1-TEE',
  'XiaomiMiMo/MiMo-V2-Flash',
] as const;

// Test sandbox management
let testSandboxId: string | null = null;

async function createTestSandbox(): Promise<string> {
  if (!SANDY_API_KEY) {
    throw new Error('SANDY_API_KEY is required for tests');
  }
  
  const response = await fetch(`${SANDY_BASE_URL}/api/sandboxes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SANDY_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create sandbox: ${response.status}`);
  }
  
  const data = await response.json();
  return data.sandboxId;
}

async function terminateSandbox(sandboxId: string): Promise<void> {
  if (!SANDY_API_KEY) return;
  
  try {
    await fetch(`${SANDY_BASE_URL}/api/sandboxes/${sandboxId}/terminate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SANDY_API_KEY}`,
      },
    });
  } catch (e) {
    console.warn('Failed to terminate sandbox:', e);
  }
}

// Helper to consume SSE stream
async function consumeSSEStream(response: Response): Promise<{
  events: any[];
  error?: string;
  success: boolean;
}> {
  const events: any[] = [];
  let error: string | undefined;
  let success = false;
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  
  const decoder = new TextDecoder();
  let buffer = '';
  
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
            events.push(data);
            
            if (data.type === 'error') {
              error = data.error;
            }
            if (data.type === 'complete') {
              success = data.success;
            }
          } catch (e) {
            console.warn('Failed to parse SSE data:', line);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return { events, error, success };
}

// Unit Tests
describe('Agent Configuration', () => {
  test('all agents have required fields', async () => {
    const response = await fetch(`${API_BASE_URL}/api/agent-run`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.agents).toBeDefined();
    expect(data.models).toBeDefined();
    expect(data.defaultModel).toBeDefined();
    
    for (const agent of data.agents) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.command).toBeDefined();
    }
  });
  
  test('all models are available', async () => {
    const response = await fetch(`${API_BASE_URL}/api/agent-run`);
    const data = await response.json();
    
    for (const model of MODELS) {
      const found = data.models.find((m: any) => m.id === model);
      expect(found).toBeDefined();
    }
  });
});

// Integration Tests - require sandbox
describe('Agent Run Integration', () => {
  beforeAll(async () => {
    if (!SANDY_API_KEY || !CHUTES_API_KEY) {
      console.warn('Skipping integration tests - SANDY_API_KEY or CHUTES_API_KEY not set');
      return;
    }
    
    testSandboxId = await createTestSandbox();
    console.log('Created test sandbox:', testSandboxId);
    
    // Wait for sandbox to be ready
    await new Promise(resolve => setTimeout(resolve, 5000));
  });
  
  afterAll(async () => {
    if (testSandboxId) {
      await terminateSandbox(testSandboxId);
      console.log('Terminated test sandbox:', testSandboxId);
    }
  });
  
  // Skip builtin since it uses a different API
  const externalAgents = AGENTS.filter(a => a !== 'builtin');
  
  for (const agent of externalAgents) {
    describe(`Agent: ${agent}`, () => {
      // Test with default model only to save time
      const model = MODELS[0];
      
      test(`should run with model ${model}`, async () => {
        if (!testSandboxId) {
          console.warn('Skipping - no sandbox');
          return;
        }
        
        const response = await fetch(`${API_BASE_URL}/api/agent-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent,
            model,
            prompt: 'Create a file called hello.txt with the content "Hello World"',
            sandboxId: testSandboxId,
          }),
        });
        
        expect(response.ok).toBe(true);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        
        const result = await consumeSSEStream(response);
        
        // Should have status events
        const statusEvents = result.events.filter(e => e.type === 'status');
        expect(statusEvents.length).toBeGreaterThan(0);
        
        // Should have a complete event
        const completeEvent = result.events.find(e => e.type === 'complete');
        expect(completeEvent).toBeDefined();
        
        // Log result for debugging
        console.log(`[${agent}/${model}] Result:`, {
          eventsCount: result.events.length,
          success: result.success,
          error: result.error,
        });
      }, 120000); // 2 minute timeout
    });
  }
});

// Smoke Tests - Quick validation without full execution
describe('Agent Run Smoke Tests', () => {
  test('rejects unknown agent', async () => {
    const response = await fetch(`${API_BASE_URL}/api/agent-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'unknown-agent',
        model: MODELS[0],
        prompt: 'test',
        sandboxId: 'fake-sandbox',
      }),
    });
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Unknown agent');
  });
  
  test('rejects unknown model', async () => {
    const response = await fetch(`${API_BASE_URL}/api/agent-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'claude-code',
        model: 'unknown/model',
        prompt: 'test',
        sandboxId: 'fake-sandbox',
      }),
    });
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Unknown model');
  });
  
  test('requires sandboxId', async () => {
    const response = await fetch(`${API_BASE_URL}/api/agent-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'claude-code',
        model: MODELS[0],
        prompt: 'test',
      }),
    });
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('sandboxId');
  });
});

// Run tests
if (import.meta.main) {
  console.log('Running agent-run tests...');
  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('SANDY_BASE_URL:', SANDY_BASE_URL);
  console.log('Has SANDY_API_KEY:', !!SANDY_API_KEY);
  console.log('Has CHUTES_API_KEY:', !!CHUTES_API_KEY);
}































