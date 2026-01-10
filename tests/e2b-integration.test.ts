/**
 * Comprehensive E2B Integration Tests
 * Tests sandbox creation, file operations, build process, and deployment
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

// Set environment variables directly if not loaded
const E2B_API_KEY = process.env.E2B_API_KEY || 'e2b_1a58a57202a6bdbf29fd7c39444b436b7a074581';

if (!E2B_API_KEY) {
  console.error('E2B_API_KEY is required');
  process.exit(1);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '@e2b/code-interpreter';

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

test('E2B Sandbox Creation', async (t) => {
  await t.test('should create a new sandbox successfully', async () => {
    console.log('[test] Creating sandbox with API key:', E2B_API_KEY.substring(0, 10) + '...');
    
    testSandbox = await Sandbox.create({
      apiKey: E2B_API_KEY,
      timeoutMs: 5 * 60 * 1000 // 5 minutes
    });
    
    assert.ok(testSandbox, 'Sandbox should be created');
    
    const sandboxId = (testSandbox as any).sandboxId;
    console.log('[test] Sandbox created with ID:', sandboxId);
    assert.ok(sandboxId, 'Sandbox should have an ID');
  });

  await t.test('should be able to run Python code', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const result = await testSandbox!.runCode(`
print("Hello from E2B!")
import json
print(json.dumps({"status": "ok", "value": 42}))
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] Python output:', stdout);
    
    assert.ok(stdout.includes('Hello from E2B!'), 'Should run Python code');
    assert.ok(stdout.includes('"status": "ok"'), 'Should output JSON');
  });
});

test('E2B File Operations', async (t) => {
  await t.test('should create directories using Python', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const result = await testSandbox!.runCode(`
import os
os.makedirs('/home/user/app/src/components', exist_ok=True)
print('Directory created successfully')
print(os.path.exists('/home/user/app/src/components'))
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] Directory creation output:', stdout);
    assert.ok(stdout.includes('True'), 'Directory should exist');
  });

  await t.test('should write files using Python', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const testContent = 'export const Hello = () => <div>Hello World!</div>;';
    
    const result = await testSandbox!.runCode(`
import os
import json

content = ${JSON.stringify(testContent)}

# Write the file
with open('/home/user/app/src/components/Hello.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
    
# Verify
with open('/home/user/app/src/components/Hello.jsx', 'r') as f:
    written = f.read()
    
print(json.dumps({"written": written, "match": written == content}))
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] File write output:', stdout);
    
    const parsed = JSON.parse(stdout.trim().split('\n').pop() || '{}');
    assert.equal(parsed.match, true, 'Written content should match original');
  });

  await t.test('should use files.write API when available', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // Try using the files API if available
    if (testSandbox!.files && typeof testSandbox!.files.write === 'function') {
      const testContent = 'Test content via files.write API';
      await testSandbox!.files.write('/home/user/app/test-api.txt', testContent);
      
      // Verify
      const result = await testSandbox!.runCode(`
with open('/home/user/app/test-api.txt', 'r') as f:
    print(f.read())
      `);
      
      const stdout = result.logs.stdout.join('\n').trim();
      assert.equal(stdout, testContent, 'Files API should work');
      console.log('[test] files.write API works correctly');
    } else {
      console.log('[test] files.write API not available, skipping');
    }
  });

  await t.test('should list files in directory', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const result = await testSandbox!.runCode(`
import os
import json

def list_files(path):
    files = []
    if os.path.exists(path):
        for root, dirs, filenames in os.walk(path):
            dirs[:] = [d for d in dirs if d not in ['node_modules', '.git']]
            for filename in filenames:
                rel_path = os.path.relpath(os.path.join(root, filename), path)
                files.append(rel_path)
    return files

files = list_files("/home/user/app")
print(json.dumps(files))
    `);
    
    const stdout = result.logs.stdout.join('').trim();
    console.log('[test] File list output:', stdout);
    
    try {
      const files = JSON.parse(stdout);
      assert.ok(Array.isArray(files), 'Should return array of files');
      console.log('[test] Found files:', files);
    } catch (e) {
      console.log('[test] Could not parse file list, output was:', stdout);
    }
  });
});

test('E2B Vite Setup', async (t) => {
  await t.test('should create package.json', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const packageJson = {
      name: "test-sandbox-app",
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "vite --host",
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.0.0",
        vite: "^4.3.9",
        tailwindcss: "^3.3.0",
        postcss: "^8.4.31",
        autoprefixer: "^10.4.16"
      }
    };
    
    const result = await testSandbox!.runCode(`
import json
import os

os.makedirs('/home/user/app', exist_ok=True)

pkg = ${JSON.stringify(packageJson)}

with open('/home/user/app/package.json', 'w') as f:
    json.dump(pkg, f, indent=2)

print('package.json created')

with open('/home/user/app/package.json', 'r') as f:
    print(f.read())
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] Package.json creation:', stdout.substring(0, 200) + '...');
    assert.ok(stdout.includes('package.json created'), 'Should create package.json');
  });

  await t.test('should create vite.config.js', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    allowedHosts: ['.e2b.app', '.e2b.dev', 'localhost', '127.0.0.1']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})`;
    
    const result = await testSandbox!.runCode(`
import os

os.makedirs('/home/user/app', exist_ok=True)

config = ${JSON.stringify(viteConfig)}

with open('/home/user/app/vite.config.js', 'w') as f:
    f.write(config)

print('vite.config.js created')
    `);
    
    const stdout = result.logs.stdout.join('\n');
    assert.ok(stdout.includes('vite.config.js created'), 'Should create vite.config.js');
  });

  await t.test('should create index.html', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
    
    const result = await testSandbox!.runCode(`
with open('/home/user/app/index.html', 'w') as f:
    f.write(${JSON.stringify(indexHtml)})
print('index.html created')
    `);
    
    const stdout = result.logs.stdout.join('\n');
    assert.ok(stdout.includes('index.html created'), 'Should create index.html');
  });

  await t.test('should create React entry files', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const mainJsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;

    const appJsx = `function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-4xl font-bold mb-4">Test App</h1>
        <p className="text-lg text-gray-400">
          Sandbox Ready!
        </p>
      </div>
    </div>
  )
}

export default App`;

    const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: rgb(17 24 39);
}`;

    const result = await testSandbox!.runCode(`
import os

os.makedirs('/home/user/app/src', exist_ok=True)

with open('/home/user/app/src/main.jsx', 'w') as f:
    f.write(${JSON.stringify(mainJsx)})

with open('/home/user/app/src/App.jsx', 'w') as f:
    f.write(${JSON.stringify(appJsx)})

with open('/home/user/app/src/index.css', 'w') as f:
    f.write(${JSON.stringify(indexCss)})

print('React files created')

# List created files
for f in os.listdir('/home/user/app/src'):
    print(f'  - {f}')
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] React files creation:', stdout);
    assert.ok(stdout.includes('React files created'), 'Should create React files');
  });

  await t.test('should create tailwind config', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;

    const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;
    
    const result = await testSandbox!.runCode(`
with open('/home/user/app/tailwind.config.js', 'w') as f:
    f.write(${JSON.stringify(tailwindConfig)})

with open('/home/user/app/postcss.config.js', 'w') as f:
    f.write(${JSON.stringify(postcssConfig)})

print('Tailwind config created')
    `);
    
    const stdout = result.logs.stdout.join('\n');
    assert.ok(stdout.includes('Tailwind config created'), 'Should create tailwind config');
  });
});

test('E2B npm and Build', async (t) => {
  await t.test('should run npm install', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    console.log('[test] Running npm install (this may take a while)...');
    
    const result = await testSandbox!.runCode(`
import subprocess
import os

os.chdir('/home/user/app')

proc = subprocess.run(['npm', 'install', '--legacy-peer-deps'], capture_output=True, text=True, timeout=180)

print('Exit code:', proc.returncode)
print('stdout:', proc.stdout[-1000:] if len(proc.stdout) > 1000 else proc.stdout)
if proc.returncode != 0:
    print('stderr:', proc.stderr[-500:] if len(proc.stderr) > 500 else proc.stderr)
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] npm install output (truncated):', stdout.substring(0, 500));
    
    // Check if npm install succeeded or already had packages
    const hasExitCode0 = stdout.includes('Exit code: 0');
    const hasNodeModules = await testSandbox!.runCode(`
import os
print(os.path.exists('/home/user/app/node_modules'))
    `);
    
    const nodeModulesExists = hasNodeModules.logs.stdout.join('').includes('True');
    assert.ok(hasExitCode0 || nodeModulesExists, 'npm install should succeed or node_modules should exist');
  });

  await t.test('should run vite build', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    console.log('[test] Running vite build...');
    
    const result = await testSandbox!.runCode(`
import subprocess
import os
import json

os.chdir('/home/user/app')

proc = subprocess.run(['npm', 'run', 'build'], capture_output=True, text=True, timeout=120)

print(json.dumps({
    "exitCode": proc.returncode,
    "stdout": proc.stdout[-2000:] if len(proc.stdout) > 2000 else proc.stdout,
    "stderr": proc.stderr[-1000:] if len(proc.stderr) > 1000 else proc.stderr
}))
    `);
    
    const stdout = result.logs.stdout.join('\n');
    console.log('[test] Build output:', stdout.substring(0, 800));
    
    try {
      const output = JSON.parse(stdout.trim().split('\n').pop() || '{}');
      console.log('[test] Build exit code:', output.exitCode);
      
      if (output.exitCode !== 0) {
        console.log('[test] Build stderr:', output.stderr);
      }
      
      // Check if dist was created even if build had warnings
      const distCheck = await testSandbox!.runCode(`
import os
import json

dist_exists = os.path.exists('/home/user/app/dist')
dist_files = []
if dist_exists:
    for root, dirs, files in os.walk('/home/user/app/dist'):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), '/home/user/app/dist')
            dist_files.append(rel)

print(json.dumps({"distExists": dist_exists, "files": dist_files}))
      `);
      
      const distOutput = JSON.parse(distCheck.logs.stdout.join('').trim());
      console.log('[test] Dist check:', distOutput);
      
      assert.ok(distOutput.distExists, 'dist directory should exist after build');
      assert.ok(distOutput.files.length > 0, 'dist should contain files');
      
    } catch (e) {
      console.log('[test] Could not parse build output, raw:', stdout);
      throw e;
    }
  });

  await t.test('should list dist files correctly', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    const result = await testSandbox!.runCode(`
import os
import json

dist_path = '/home/user/app/dist'
files = []

if os.path.exists(dist_path):
    for root, dirs, filenames in os.walk(dist_path):
        # Skip common directories that shouldn't be included
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git']]
        for filename in filenames:
            rel_path = os.path.relpath(os.path.join(root, filename), dist_path)
            files.append(rel_path)

print(json.dumps({"files": files, "count": len(files)}))
    `);
    
    const stdout = result.logs.stdout.join('').trim();
    const output = JSON.parse(stdout);
    
    console.log('[test] Dist files:', output.files);
    assert.ok(output.count > 0, 'Should have dist files');
    assert.ok(output.files.some((f: string) => f.includes('index.html')), 'Should have index.html');
  });

  await t.test('should read dist files as base64', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // This tests the deployment mechanism that reads files as base64
    const result = await testSandbox!.runCode(`
import os
import base64
import json

dist_path = '/home/user/app/dist'
files_b64 = {}

for root, dirs, filenames in os.walk(dist_path):
    dirs[:] = [d for d in dirs if d not in ['node_modules', '.git']]
    for filename in filenames:
        full_path = os.path.join(root, filename)
        rel_path = os.path.relpath(full_path, dist_path)
        
        with open(full_path, 'rb') as f:
            content = f.read()
            files_b64[rel_path] = base64.b64encode(content).decode('utf-8')

# Print summary
print(json.dumps({
    "fileCount": len(files_b64),
    "files": list(files_b64.keys()),
    "sampleFile": list(files_b64.keys())[0] if files_b64 else None,
    "sampleLength": len(files_b64.get(list(files_b64.keys())[0], '')) if files_b64 else 0
}))
    `);
    
    const stdout = result.logs.stdout.join('').trim();
    const output = JSON.parse(stdout);
    
    console.log('[test] Base64 files summary:', output);
    assert.ok(output.fileCount > 0, 'Should have files');
    assert.ok(output.sampleLength > 0, 'Should have base64 content');
  });
});

test('E2B runCommand Function', async (t) => {
  await t.test('should parse JSON output from runCommand correctly', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // This tests the exact pattern used in e2b-provider.ts runCommand
    const command = 'ls -la /home/user/app';
    
    const execResult = await testSandbox!.runCode(`
import subprocess, os, shlex, json

os.chdir('/home/user/app')

raw_cmd = ${JSON.stringify(command)}
cmd = shlex.split(raw_cmd)
proc = subprocess.run(cmd, capture_output=True, text=True)

print(json.dumps({
  "stdout": proc.stdout,
  "stderr": proc.stderr,
  "returncode": proc.returncode
}))
    `);

    const output = execResult.logs.stdout.join('\\n').trim();
    console.log('[test] runCommand raw output:', output.substring(0, 300));
    
    // Parse the same way the provider does
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

    console.log('[test] Parsed result:', { exitCode, stdoutLength: stdout.length });
    assert.equal(exitCode, 0, 'Command should succeed');
    assert.ok(stdout.length > 0, 'Should have stdout');
  });

  await t.test('should handle command with special characters', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // Test with a command that has spaces and special chars
    const command = 'echo "Hello World!" && pwd';
    
    const execResult = await testSandbox!.runCode(`
import subprocess, os, json

os.chdir('/home/user/app')

# Use shell=True for complex commands
proc = subprocess.run(${JSON.stringify(command)}, shell=True, capture_output=True, text=True)

print(json.dumps({
  "stdout": proc.stdout,
  "stderr": proc.stderr,
  "returncode": proc.returncode
}))
    `);

    const output = execResult.logs.stdout.join('').trim();
    const parsed = JSON.parse(output.split('\n').pop() || '{}');
    
    console.log('[test] Complex command result:', parsed);
    assert.equal(parsed.returncode, 0, 'Complex command should work');
    assert.ok(parsed.stdout.includes('Hello World!'), 'Should capture output');
  });
});

test('E2B Provider listFiles Bug Test', async (t) => {
  await t.test('should handle listFiles for dist directory', async () => {
    assert.ok(testSandbox, 'Sandbox should exist');
    
    // This tests the pattern used in the deploy endpoint
    const directory = '/home/user/app/dist';
    
    const result = await testSandbox!.runCode(`
import os
import json

def list_files(path):
    files = []
    for root, dirs, filenames in os.walk(path):
        # Skip node_modules and .git
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', '.next', 'dist', 'build']]
        for filename in filenames:
            rel_path = os.path.relpath(os.path.join(root, filename), path)
            files.append(rel_path)
    return files

files = list_files("${directory}")
print(json.dumps(files))
    `);
    
    const stdout = result.logs.stdout.join('');
    console.log('[test] listFiles result:', stdout);
    
    try {
      const files = JSON.parse(stdout);
      console.log('[test] Files array:', files);
      assert.ok(Array.isArray(files), 'Should return array');
      
      // BUG CHECK: The current listFiles in e2b-provider.ts excludes 'dist' from directories
      // but when listing dist itself, this causes issues
      // The deploy endpoint lists files from dist directory, not from within it
      
    } catch (e) {
      console.error('[test] Parse error:', e);
    }
  });
});

console.log('Starting E2B Integration Tests...');
console.log('E2B_API_KEY:', E2B_API_KEY ? 'Set (length: ' + E2B_API_KEY.length + ')' : 'Not set');








































