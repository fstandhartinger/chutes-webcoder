import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { withTimeout } from '@/lib/retry';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import type { CommandResult } from '@/lib/sandbox/types';

export async function POST() {
  try {
    const provider = sandboxManager.getActiveProvider() || (global as any).activeSandboxProvider;
    if (!provider) {
      return NextResponse.json({ success: false, error: 'No active sandbox' }, { status: 400 });
    }

    const sandboxInfo = provider.getSandboxInfo?.();
    const workingDir = sandboxInfo?.provider === 'vercel' ? '/vercel/sandbox' : '/home/user/app';
    const distDir = `${workingDir}/dist`;

    // Run Vite build inside sandbox
    const buildResult = await withTimeout(provider.runCommand('npm run build'), 180000, 'Build timed out') as CommandResult;

    if (buildResult.exitCode !== 0) {
      return NextResponse.json({ success: false, error: 'Build failed', details: buildResult.stderr || buildResult.stdout }, { status: 500 });
    }

    // Collect dist files as base64 payload
    const fileList = await withTimeout(provider.listFiles(distDir), 120000, 'Collecting build files timed out') as string[];

    if (!fileList || fileList.length === 0) {
      return NextResponse.json({ success: false, error: 'No build files produced' }, { status: 500 });
    }

    const files: Record<string, string> = {};

    for (const relPath of fileList) {
      const fullPath = relPath.startsWith('/') ? relPath : `${distDir}/${relPath}`;
      const base64Result = await provider.runCommand(`base64 ${fullPath}`);
      if (base64Result.exitCode !== 0 || !base64Result.stdout) {
        continue;
      }
      files[relPath] = String(base64Result.stdout).trim();
    }

    if (Object.keys(files).length === 0) {
      return NextResponse.json({ success: false, error: 'No build files could be read' }, { status: 500 });
    }

    const id = randomUUID();
    const baseDir = path.join(process.cwd(), 'public', 'deployments', id);
    await fs.mkdir(baseDir, { recursive: true });

    // Write files
    for (const [rel, b64] of Object.entries(files)) {
      const outPath = path.join(baseDir, rel);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const buf = Buffer.from(b64 as string, 'base64');
      await fs.writeFile(outPath, buf);
    }

    const url = `/deploy/${id}`;
    return NextResponse.json({ success: true, id, url });
  } catch (error) {
    console.error('[deploy] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
