#!/usr/bin/env npx tsx
/**
 * Agent Stream Analyzer
 * 
 * Simulates coding CLI runs and analyzes the response stream to understand
 * how to best display the output in the frontend.
 */

import fetch from 'node-fetch';
import { SSEJsonBuffer } from '../lib/agent-output-parser';

// Configuration
const API_URL = process.env.API_URL || 'https://chutes-webcoder.onrender.com';
const TIMEOUT_MS = 600000; // 10 minutes

interface StreamEvent {
  timestamp: number;
  type: string;
  data: any;
  raw: string;
}

interface AnalysisResult {
  events: StreamEvent[];
  eventTypes: Map<string, number>;
  firstContentTime: number | null;
  totalDuration: number;
  outputLines: string[];
  statusMessages: string[];
  errors: string[];
  fileUpdates: string[];
  exitCode: number | null;
  success: boolean;
}

async function createSandbox(): Promise<{ sandboxId: string; url: string }> {
  console.log('📦 Creating sandbox...');
  
  // First kill any existing sandbox
  await fetch(`${API_URL}/api/kill-sandbox`, { method: 'POST' }).catch(() => {});
  
  const response = await fetch(`${API_URL}/api/create-ai-sandbox-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create sandbox: ${response.status}`);
  }
  
  const data = await response.json() as any;
  const resolvedUrl = data.url && data.url.startsWith('/')
    ? new URL(data.url, API_URL).toString()
    : data.url;
  console.log(`✅ Sandbox created: ${data.sandboxId}`);
  console.log(`   URL: ${resolvedUrl}`);
  
  return { sandboxId: data.sandboxId, url: resolvedUrl };
}

async function runAgent(
  sandboxId: string, 
  agent: string, 
  model: string, 
  prompt: string
): Promise<AnalysisResult> {
  console.log(`\n🤖 Running ${agent} with ${model}...`);
  console.log(`   Prompt: "${prompt.substring(0, 60)}..."`);
  
  const startTime = Date.now();
  const events: StreamEvent[] = [];
  const eventTypes = new Map<string, number>();
  const outputLines: string[] = [];
  const statusMessages: string[] = [];
  const errors: string[] = [];
  const fileUpdates: string[] = [];
  let firstContentTime: number | null = null;
  let exitCode: number | null = null;
  let success = false;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(`${API_URL}/api/agent-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, model, prompt, sandboxId }),
      signal: controller.signal as any
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }
    
    const reader = response.body as any;
    const decoder = new TextDecoder();
    const sseBuffer = new SSEJsonBuffer();
    
    for await (const chunk of reader) {
      const text = decoder.decode(chunk, { stream: true });
      const { jsonObjects } = sseBuffer.addChunk(text, false);
      
      for (const data of jsonObjects) {
        try {
          const elapsed = Date.now() - startTime;
          
          const event: StreamEvent = {
            timestamp: elapsed,
            type: data.type,
            data,
            raw: JSON.stringify(data)
          };
          events.push(event);
          
          // Count event types
          eventTypes.set(data.type, (eventTypes.get(data.type) || 0) + 1);
          
          // Track first content
          if (!firstContentTime && (data.type === 'output' || data.type === 'agent-output')) {
            firstContentTime = elapsed;
          }
          
          // Categorize events
          switch (data.type) {
            case 'output':
              outputLines.push(data.text || '');
              break;
            case 'status':
              statusMessages.push(data.message || '');
              break;
            case 'error':
              errors.push(data.error || '');
              break;
            case 'files-update':
              fileUpdates.push(...(data.files || []));
              break;
            case 'complete':
              exitCode = data.exitCode;
              success = data.success;
              break;
          }
          
          // Log event with timing
          const typeEmoji = {
            'status': '📊',
            'output': '📝',
            'heartbeat': '💓',
            'complete': '✅',
            'error': '❌',
            'files-update': '📁',
            'agent-output': '🤖'
          }[data.type] || '📨';
          
          const preview = data.text?.substring(0, 80) || 
                          data.message?.substring(0, 80) || 
                          (data.type === 'heartbeat' ? `elapsed: ${data.elapsed}s` : '');
          
          console.log(`   [${(elapsed/1000).toFixed(1)}s] ${typeEmoji} ${data.type}: ${preview}`);
          
        } catch (e) {
          // Skip malformed events
        }
      }
    }
    
    const { jsonObjects: finalObjects } = sseBuffer.flush();
    for (const data of finalObjects) {
      try {
        const elapsed = Date.now() - startTime;
        events.push({
          timestamp: elapsed,
          type: data.type,
          data,
          raw: JSON.stringify(data)
        });
        eventTypes.set(data.type, (eventTypes.get(data.type) || 0) + 1);
        if (!firstContentTime && (data.type === 'output' || data.type === 'agent-output')) {
          firstContentTime = elapsed;
        }
        switch (data.type) {
          case 'output':
            outputLines.push(data.text || '');
            break;
          case 'status':
            statusMessages.push(data.message || '');
            break;
          case 'error':
            errors.push(data.error || '');
            break;
          case 'files-update':
            fileUpdates.push(...(data.files || []));
            break;
          case 'complete':
            exitCode = data.exitCode;
            success = data.success;
            break;
        }
      } catch (e) {
        // Skip malformed events
      }
    }
    
  } catch (error: any) {
    if (error.name === 'AbortError') {
      errors.push('Timeout');
    } else {
      errors.push(error.message);
    }
  } finally {
    clearTimeout(timeout);
  }
  
  const totalDuration = Date.now() - startTime;
  
  return {
    events,
    eventTypes,
    firstContentTime,
    totalDuration,
    outputLines,
    statusMessages,
    errors,
    fileUpdates,
    exitCode,
    success
  };
}

async function checkPreview(sandboxUrl: string): Promise<{ working: boolean; content?: string }> {
  console.log('\n🔍 Checking preview...');
  
  try {
    const response = await fetch(sandboxUrl, { 
      timeout: 10000,
      headers: { 'Accept': 'text/html' }
    } as any);
    
    if (!response.ok) {
      console.log(`   ❌ Preview returned ${response.status}`);
      return { working: false };
    }
    
    const html = await response.text();
    
    // Check if it's a valid React app
    if (html.includes('<div id="root">') || html.includes('react')) {
      console.log(`   ✅ Preview is working (React app detected)`);
      
      // Check for actual content
      if (html.includes('Hello') || html.includes('Game') || html.length > 1000) {
        console.log(`   ✅ Content detected in preview`);
        return { working: true, content: html.substring(0, 500) };
      }
    }
    
    console.log(`   ⚠️ Preview returned HTML but content unclear`);
    return { working: true, content: html.substring(0, 500) };
    
  } catch (error: any) {
    console.log(`   ❌ Preview check failed: ${error.message}`);
    return { working: false };
  }
}

function analyzeResults(result: AnalysisResult): void {
  console.log('\n' + '='.repeat(70));
  console.log('📊 ANALYSIS RESULTS');
  console.log('='.repeat(70));
  
  console.log(`\n⏱️  Timing:`);
  console.log(`   Total duration: ${(result.totalDuration / 1000).toFixed(1)}s`);
  console.log(`   First content: ${result.firstContentTime ? (result.firstContentTime / 1000).toFixed(1) + 's' : 'N/A'}`);
  
  console.log(`\n📨 Event Types:`);
  for (const [type, count] of result.eventTypes) {
    console.log(`   ${type}: ${count}`);
  }
  
  console.log(`\n📝 Output Summary:`);
  console.log(`   Lines: ${result.outputLines.length}`);
  console.log(`   Status messages: ${result.statusMessages.length}`);
  console.log(`   File updates: ${result.fileUpdates.length}`);
  console.log(`   Errors: ${result.errors.length}`);
  
  if (result.exitCode !== null) {
    console.log(`\n🏁 Exit Code: ${result.exitCode} (${result.success ? 'SUCCESS' : 'FAILED'})`);
  }
  
  // Show sample output
  if (result.outputLines.length > 0) {
    console.log(`\n📄 Sample Output (first 5 lines):`);
    result.outputLines.slice(0, 5).forEach((line, i) => {
      console.log(`   ${i + 1}. ${line.substring(0, 100)}`);
    });
  }
  
  // Show status messages
  if (result.statusMessages.length > 0) {
    console.log(`\n📊 Status Messages:`);
    result.statusMessages.forEach((msg, i) => {
      console.log(`   ${i + 1}. ${msg}`);
    });
  }
  
  // Show errors
  if (result.errors.length > 0) {
    console.log(`\n❌ Errors:`);
    result.errors.forEach((err, i) => {
      console.log(`   ${i + 1}. ${err}`);
    });
  }
  
  // Show file updates
  if (result.fileUpdates.length > 0) {
    console.log(`\n📁 Files Updated:`);
    result.fileUpdates.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file}`);
    });
  }
}

function suggestImprovements(result: AnalysisResult): void {
  console.log('\n' + '='.repeat(70));
  console.log('💡 IMPROVEMENT SUGGESTIONS');
  console.log('='.repeat(70));
  
  const suggestions: string[] = [];
  
  // Timing analysis
  if (result.firstContentTime && result.firstContentTime > 5000) {
    suggestions.push('First content takes >5s - consider showing a "thinking" indicator');
  }
  
  // Event analysis
  if (result.eventTypes.get('heartbeat')! > 20) {
    suggestions.push('Many heartbeats - agent is taking a long time, show progress bar');
  }
  
  // Output analysis
  if (result.outputLines.length > 50) {
    suggestions.push('Many output lines - consider collapsing or summarizing');
  }
  
  // Error analysis
  if (result.errors.length > 0) {
    suggestions.push('Errors occurred - ensure clear error display in UI');
  }
  
  // Success analysis
  if (!result.success && result.exitCode !== 0) {
    suggestions.push('Agent failed - show clear failure message with retry option');
  }
  
  // File updates
  if (result.fileUpdates.length === 0 && result.success) {
    suggestions.push('No file updates reported - check file detection logic');
  }
  
  if (suggestions.length === 0) {
    console.log('\n   ✅ Stream looks good - no major issues detected');
  } else {
    suggestions.forEach((s, i) => {
      console.log(`\n   ${i + 1}. ${s}`);
    });
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const agent = args.find(a => a.startsWith('--agent='))?.split('=')[1] || 'codex';
  const model = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'zai-org/GLM-4.7-TEE';
  const prompt = args.find(a => a.startsWith('--prompt='))?.split('=')[1] || 
    'Create a simple React counter component in App.jsx that shows a count and has increment/decrement buttons';
  
  console.log('='.repeat(70));
  console.log('🧪 AGENT STREAM ANALYZER');
  console.log('='.repeat(70));
  console.log(`API URL: ${API_URL}`);
  console.log(`Agent: ${agent}`);
  console.log(`Model: ${model}`);
  console.log(`Prompt: ${prompt}`);
  
  try {
    // Create sandbox
    const { sandboxId, url } = await createSandbox();
    
    // Wait for sandbox to be ready
    console.log('\n⏳ Waiting for sandbox to be ready...');
    await new Promise(r => setTimeout(r, 3000));
    
    // Run agent
    const result = await runAgent(sandboxId, agent, model, prompt);
    
    // Analyze results
    analyzeResults(result);
    
    // Check preview
    const previewResult = await checkPreview(url);
    
    // Suggest improvements
    suggestImprovements(result);
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📋 FINAL SUMMARY');
    console.log('='.repeat(70));
    console.log(`\n   Agent: ${agent}`);
    console.log(`   Model: ${model}`);
    console.log(`   Duration: ${(result.totalDuration / 1000).toFixed(1)}s`);
    console.log(`   Success: ${result.success ? '✅ YES' : '❌ NO'}`);
    console.log(`   Preview: ${previewResult.working ? '✅ WORKING' : '❌ NOT WORKING'}`);
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();


























