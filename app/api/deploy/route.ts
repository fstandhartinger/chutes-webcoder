import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { withTimeout } from '@/lib/retry';

declare global {
  // eslint-disable-next-line no-var
  var activeSandbox: any;
}

export async function POST() {
  try {
    if (!global.activeSandbox) {
      return NextResponse.json({ success: false, error: 'No active sandbox' }, { status: 400 });
    }

    // Run Vite build inside sandbox
    const buildResult: any = await withTimeout(global.activeSandbox.runCode(`
import subprocess, json, os, base64
os.chdir('/home/user/app')

proc = subprocess.run(['npm','run','build'], capture_output=True, text=True)
success = (proc.returncode == 0)

output = {'success': success, 'stdout': proc.stdout[-5000:], 'stderr': proc.stderr[-5000:]}
print(json.dumps(output))
    `), 180000, 'Build timed out');

    const buildJson = safeParseJson((buildResult?.logs?.stdout || []).join('')) || {};
    if (!buildJson.success) {
      return NextResponse.json({ success: false, error: 'Build failed', details: buildJson.stderr || buildJson.stdout }, { status: 500 });
    }

    // Collect dist files as base64 payload
    const collectResult: any = await withTimeout(global.activeSandbox.runCode(`
import os, json, base64
root = '/home/user/app/dist'
files = {}
for dirpath, dirnames, filenames in os.walk(root):
    for filename in filenames:
        fp = os.path.join(dirpath, filename)
        rel = os.path.relpath(fp, root)
        try:
            with open(fp, 'rb') as f:
                b = f.read()
                files[rel] = base64.b64encode(b).decode('utf-8')
        except Exception as e:
            pass
print(json.dumps({'files': files}))
    `), 120000, 'Collecting build files timed out');

    const collected = safeParseJson((collectResult?.logs?.stdout || []).join('')) || { files: {} };
    const files: Record<string, string> = collected.files || {};
    if (!files || Object.keys(files).length === 0) {
      return NextResponse.json({ success: false, error: 'No build files produced' }, { status: 500 });
    }

    const id = randomUUID();
    const baseDir = path.join(process.cwd(), 'deployments', id);
    await fs.mkdir(baseDir, { recursive: true });

    // Write files
    for (const [rel, b64] of Object.entries(files)) {
      const outPath = path.join(baseDir, rel);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const buf = Buffer.from(b64 as string, 'base64');
      await fs.writeFile(outPath, buf);
    }

    const url = `/deploy/${id}/`;
    return NextResponse.json({ success: true, id, url });
  } catch (error) {
    console.error('[deploy] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

function safeParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}


