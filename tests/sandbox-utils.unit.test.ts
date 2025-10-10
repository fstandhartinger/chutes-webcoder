import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureDirectoryExists } from '@/lib/sandbox/utils';

const noopLogger = {
  log: () => {},
  warn: () => {},
  error: () => {}
};

test('ensureDirectoryExists uses makeDir and caches directories', async () => {
  const calls: string[] = [];
  const sandbox = {
    files: {
      makeDir: async (path: string) => {
        calls.push(path);
        return true;
      }
    }
  };

  const cache = new Set<string>();
  const fullPath = '/home/user/app/src/components/Button.tsx';

  await ensureDirectoryExists(sandbox, fullPath, {
    directoryCache: cache,
    logger: noopLogger
  });

  // Second call should hit cache and avoid extra makeDir invocation
  await ensureDirectoryExists(sandbox, fullPath, {
    directoryCache: cache,
    logger: noopLogger
  });

  assert.equal(calls.length, 1, 'makeDir should be called only once thanks to caching');
  assert.ok(cache.has('/home/user/app/src/components'), 'cache should track created directory');
});
