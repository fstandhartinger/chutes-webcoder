import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load environment variables for local runs. In CI, env may already be set.
dotenvConfig({ path: resolve(process.cwd(), '.env.local') });
dotenvConfig({ path: resolve(process.cwd(), '.env') });

import test from 'node:test';
import assert from 'node:assert/strict';

import { SandyProvider } from '@/lib/sandbox/providers/sandy-provider';

const SANDY_BASE_URL = process.env.SANDY_BASE_URL || '';
const SANDY_API_KEY = process.env.SANDY_API_KEY || '';

// This test is intentionally skipped unless live Sandy credentials are present.
const SKIP_SANDY = !SANDY_BASE_URL || !SANDY_API_KEY;

let provider: SandyProvider | null = null;

test.after(async () => {
  if (provider?.isAlive()) {
    await provider.terminate();
  }
});

function resolveHostSuffix(): string {
  const raw = (
    process.env.SANDY_HOST_SUFFIX ||
    process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX ||
    ''
  ).trim();
  if (!raw) {
    return '.sandy.localhost';
  }
  return raw.startsWith('.') ? raw : `.${raw}`;
}

async function tryFetchHtml(
  url: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, { redirect: 'follow' });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

test(
  'SandyProvider live: create sandbox, setup Vite app, and verify preview is reachable',
  { skip: SKIP_SANDY, timeout: 7 * 60_000 },
  async () => {
    provider = new SandyProvider({
      sandy: {
        baseUrl: SANDY_BASE_URL,
        apiKey: SANDY_API_KEY,
        hostSuffix: process.env.SANDY_HOST_SUFFIX || process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX,
        preferredUpstream: process.env.SANDY_PREFERRED_UPSTREAM,
        workdir: process.env.SANDY_WORKDIR
      }
    });

    const info = await provider.createSandbox();

    assert.ok(info.sandboxId, 'sandboxId should be returned');
    assert.ok(info.url, 'sandbox url should be returned');

    const echo = await provider.runCommand('echo sandy-ok');
    assert.equal(echo.exitCode, 0, `expected exitCode=0, got ${echo.exitCode}`);
    assert.ok(
      (echo.stdout || echo.stderr).includes('sandy-ok'),
      'expected echo output'
    );

    // Verify file write/read works against the live Sandy filesystem API.
    await provider.writeFile('test.txt', 'hello');
    const readBack = await provider.readFile('test.txt');
    assert.equal(readBack, 'hello', 'read content should match written content');

    await provider.setupViteApp();

    const viteConfig = await provider.readFile('vite.config.js');
    assert.ok(viteConfig.includes('defineConfig'), 'vite.config.js should be present');

    const hostSuffix = resolveHostSuffix();
    const expectedHost = `${info.sandboxId}${hostSuffix}`;

    // If a host suffix is configured, the provider should embed it into the HMR config.
    if ((process.env.SANDY_HOST_SUFFIX || process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX || '').trim()) {
      assert.ok(
        viteConfig.includes(`host: '${expectedHost}'`),
        'vite hmr host should match sandbox host'
      );
    }

    const baseProtocol = SANDY_BASE_URL.startsWith('https') ? 'https' : 'http';
    const candidateUrls = Array.from(
      new Set([info.url, `${baseProtocol}://${expectedHost}`].filter(Boolean))
    );

    // Poll for the Vite server to come up behind Sandy ingress.
    const deadline = Date.now() + 60_000;
    let lastError = '';

    while (Date.now() < deadline) {
      for (const url of candidateUrls) {
        try {
          const { ok, status, body } = await tryFetchHtml(url);
          if (ok && body.includes('<!DOCTYPE html')) {
            assert.ok(
              body.includes('<div id="root"></div>') || body.includes('Sandbox App'),
              'expected Vite index.html content'
            );
            return;
          }
          lastError = `${url} -> status ${status}`;
        } catch (e) {
          lastError = `${url} -> ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    assert.fail(`preview never became reachable: ${lastError}`);
  }
);

