/**
 * Deploy Flow Integration Tests
 * Tests the complete deployment process including base64 file reading
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const E2B_API_KEY = process.env.E2B_API_KEY || 'e2b_1a58a57202a6bdbf29fd7c39444b436b7a074581';

import test from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '@e2b/code-interpreter';
import { appConfig } from '@/config/app.config';

let testSandbox: Sandbox | null = null;

// Clean up sandbox after all tests
test.after(async () => {
  if (testSandbox) {
    console.log('[cleanup] Terminating test sandbox...');
    try {
      await testSandbox.kill();
    } catch (e) {
      console.error('[cleanup] Error terminating sandbox:', e);
    }
  }
});

// Simulate the runCommand function from e2b-provider.ts to check for bugs
async function simulateRunCommand(sandbox: Sandbox, command: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}> {
  const execResult = await sandbox.runCode(`
import subprocess, os, shlex, json

os.chdir('${appConfig.e2b.workingDirectory}')

raw_cmd = ${JSON.stringify(command)}
cmd = shlex.split(raw_cmd)
proc = subprocess.run(cmd, capture_output=True, text=True)

print(json.dumps({
  "stdout": proc.stdout,
  "stderr": proc.stderr,
  "returncode": proc.returncode
}))
  `);

  // BUG: The original code uses '\\n' which is a literal backslash-n
  // This should be '\n' for actual newline
  const output = execResult.logs.stdout.join('\\n').trim();
  let parsed: any = null;

  try {
    parsed = JSON.parse(output.split('\\n').pop() || '');
  } catch {
    parsed = null;
  }

  const stdout = parsed?.stdout ?? output;
  const stderr = parsed?.stderr ?? execResult.logs.stderr.join('\\n');
  const exitCode = typeof parsed?.returncode === 'number'
    ? parsed.returncode
    : (execResult.error ? 1 : 0);

  return {
    stdout,
    stderr,
    exitCode,
    success: exitCode === 0
  };
}

// Fixed version of runCommand
async function fixedRunCommand(sandbox: Sandbox, command: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}> {
  const execResult = await sandbox.runCode(`
import subprocess, os, shlex, json

os.chdir('${appConfig.e2b.workingDirectory}')

raw_cmd = ${JSON.stringify(command)}
cmd = shlex.split(raw_cmd)
proc = subprocess.run(cmd, capture_output=True, text=True)

print(json.dumps({
  "stdout": proc.stdout,
  "stderr": proc.stderr,
  "returncode": proc.returncode
}))
  `);

  // FIXED: Use actual newline character '\n' instead of '\\n'
  const output = execResult.logs.stdout.join('\n').trim();
  let parsed: any = null;

  try {
    // Get the last line which should contain the JSON
    const lines = output.split('\n');
    const jsonLine = lines[lines.length - 1];
    parsed = JSON.parse(jsonLine || '');
  } catch {
    parsed = null;
  }

  const stdout = parsed?.stdout ?? output;
  const stderr = parsed?.stderr ?? execResult.logs.stderr.join('\n');
  const exitCode = typeof parsed?.returncode === 'number'
    ? parsed.returncode
    : (execResult.error ? 1 : 0);

  return {
    stdout,
    stderr,
    exitCode,
    success: exitCode === 0
  };
}

test('Deploy Flow Tests', async (t) => {
  await t.test('should create sandbox and setup project', async () => {
    console.log('[test] Creating sandbox...');
    
    testSandbox = await Sandbox.create({
      apiKey: E2B_API_KEY,
      timeoutMs: 10 * 60 * 1000 // 10 minutes for full setup
    });
    
    assert.ok(testSandbox, 'Sandbox should be created');
    console.log('[test] Sandbox created:', (testSandbox as any).sandboxId);
    
    // Create a simple project structure
    await testSandbox.runCode(`
import os
import json

os.makedirs('/home/user/app/src', exist_ok=True)

# Create package.json
pkg = {
    "name": "deploy-test",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite --host",
        "build": "vite build"
    },
    "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    },
    "devDependencies": {
        "@vitejs/plugin-react": "^4.0.0",
        "vite": "^4.3.9"
    }
}

with open('/home/user/app/package.json', 'w') as f:
    json.dump(pkg, f, indent=2)

# Create vite.config.js
vite_config = '''import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist'
  }
})'''

with open('/home/user/app/vite.config.js', 'w') as f:
    f.write(vite_config)

# Create index.html
html = '''<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><div id="root"></div>
<script type="module" src="/src/main.jsx"></script>
</body></html>'''

with open('/home/user/app/index.html', 'w') as f:
    f.write(html)

# Create main.jsx
main = '''import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)'''

with open('/home/user/app/src/main.jsx', 'w') as f:
    f.write(main)

# Create App.jsx
app = '''export default function App() {
  return <div>Hello Deploy Test!</div>
}'''

with open('/home/user/app/src/App.jsx', 'w') as f:
    f.write(app)

print('Project setup complete')
    `);
    
    console.log('[test] Project files created');
  });

  await t.test('should run npm install', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    console.log('[test] Running npm install...');
    
    const result = await testSandbox.runCode(`
import subprocess
import os

os.chdir('/home/user/app')
proc = subprocess.run(['npm', 'install'], capture_output=True, text=True, timeout=180)
print('Exit:', proc.returncode)
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] npm install result:', stdout);
    assert.ok(stdout.includes('Exit: 0'), 'npm install should succeed');
  });

  await t.test('should build the project', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    console.log('[test] Running build...');
    
    const result = await fixedRunCommand(testSandbox, 'npm run build');
    console.log('[test] Build exit code:', result.exitCode);
    
    if (result.exitCode !== 0) {
      console.log('[test] Build stderr:', result.stderr);
    }
    
    assert.equal(result.exitCode, 0, 'Build should succeed');
  });

  await t.test('should list dist files', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const result = await testSandbox.runCode(`
import os
import json

def list_files(path):
    files = []
    for root, dirs, filenames in os.walk(path):
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git']]
        for filename in filenames:
            rel_path = os.path.relpath(os.path.join(root, filename), path)
            files.append(rel_path)
    return files

files = list_files("/home/user/app/dist")
print(json.dumps(files))
    `);
    
    const files = JSON.parse(result.logs.stdout.join(''));
    console.log('[test] Dist files:', files);
    assert.ok(files.length > 0, 'Should have dist files');
    assert.ok(files.some((f: string) => f.includes('index.html')), 'Should have index.html');
  });

  await t.test('should read file with base64 correctly', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // Test with fixed runCommand (the bug was '\\n' instead of '\n')
    console.log('[test] Testing base64 with fixed runCommand...');
    const fixedResult = await fixedRunCommand(testSandbox, 'base64 /home/user/app/dist/index.html');
    console.log('[test] Fixed result exitCode:', fixedResult.exitCode);
    console.log('[test] Fixed stdout length:', fixedResult.stdout.length);
    console.log('[test] Fixed stdout preview:', fixedResult.stdout.substring(0, 100));
    
    assert.equal(fixedResult.exitCode, 0, 'Command should succeed');
    
    // Decode and verify
    const fixedDecoded = Buffer.from(fixedResult.stdout.trim(), 'base64').toString();
    console.log('[test] Decoded preview:', fixedDecoded.substring(0, 100));
    
    // Should decode to valid HTML
    assert.ok(fixedDecoded.includes('<!DOCTYPE html') || fixedDecoded.includes('<html'), 'Should decode to valid HTML');
  });

  await t.test('should handle multi-line base64 output correctly', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // Create a larger file to test multi-line base64
    await testSandbox.runCode(`
content = "x" * 10000  # Large content to produce multi-line base64
with open('/home/user/app/dist/large-test.txt', 'w') as f:
    f.write(content)
print('Large file created')
    `);
    
    // Test with original runCommand
    const originalResult = await simulateRunCommand(testSandbox, 'base64 /home/user/app/dist/large-test.txt');
    console.log('[test] Large file original stdout length:', originalResult.stdout.length);
    
    // Test with fixed runCommand
    const fixedResult = await fixedRunCommand(testSandbox, 'base64 /home/user/app/dist/large-test.txt');
    console.log('[test] Large file fixed stdout length:', fixedResult.stdout.length);
    
    // Decode both
    const originalDecoded = Buffer.from(originalResult.stdout.trim(), 'base64').toString();
    const fixedDecoded = Buffer.from(fixedResult.stdout.trim(), 'base64').toString();
    
    console.log('[test] Original decoded length:', originalDecoded.length);
    console.log('[test] Fixed decoded length:', fixedDecoded.length);
    
    // Check if decoding produced correct content
    assert.equal(fixedDecoded.length, 10000, 'Fixed should decode to 10000 chars');
    
    // Check if original also works (it might, since the JSON parsing handles it)
    console.log('[test] Original worked correctly:', originalDecoded.length === 10000);
  });

  await t.test('should simulate complete deploy flow', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    console.log('[test] Simulating complete deploy flow...');
    
    // Step 1: List dist files
    const listResult = await testSandbox.runCode(`
import os
import json

def list_files(path):
    files = []
    for root, dirs, filenames in os.walk(path):
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git']]
        for filename in filenames:
            rel_path = os.path.relpath(os.path.join(root, filename), path)
            files.append(rel_path)
    return files

files = list_files("/home/user/app/dist")
print(json.dumps(files))
    `);
    
    const fileList = JSON.parse(listResult.logs.stdout.join(''));
    console.log('[test] Files to deploy:', fileList);
    
    // Step 2: Read each file as base64
    const distDir = '/home/user/app/dist';
    const files: Record<string, string> = {};
    
    for (const relPath of fileList) {
      if (relPath === 'large-test.txt') continue; // Skip test file
      
      const fullPath = `${distDir}/${relPath}`;
      const base64Result = await fixedRunCommand(testSandbox, `base64 ${fullPath}`);
      
      if (base64Result.exitCode !== 0 || !base64Result.stdout) {
        console.log(`[test] Failed to read ${relPath}:`, base64Result.stderr);
        continue;
      }
      
      files[relPath] = base64Result.stdout.trim();
    }
    
    console.log('[test] Files collected:', Object.keys(files));
    assert.ok(Object.keys(files).length > 0, 'Should have collected files');
    
    // Step 3: Verify files decode correctly
    for (const [rel, b64] of Object.entries(files)) {
      const decoded = Buffer.from(b64, 'base64');
      console.log(`[test] ${rel}: ${b64.length} base64 chars -> ${decoded.length} bytes`);
      assert.ok(decoded.length > 0, `${rel} should have content`);
    }
    
    console.log('[test] Deploy simulation complete!');
  });
});

console.log('Starting Deploy Flow Tests...');

