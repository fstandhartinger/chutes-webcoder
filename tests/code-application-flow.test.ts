import test from 'node:test';
import assert from 'node:assert/strict';

import { writeFileWithFallback } from '@/lib/sandbox/utils';

const noopLogger = {
  log: () => {},
  warn: () => {},
  error: () => {}
};

test('writeFileWithFallback reuses cached directories across multiple writes', async () => {
  const cache = new Set<string>();
  const writes: string[] = [];
  let makeDirInvocations = 0;

  const sandbox = {
    files: {
      makeDir: async (path: string) => {
        makeDirInvocations += 1;
        return true;
      },
      write: async (path: string) => {
        writes.push(path);
        return { ok: true };
      }
    }
  };

  const paths = [
    '/home/user/app/src/components/Header.jsx',
    '/home/user/app/src/components/Footer.jsx'
  ];

  for (const fullPath of paths) {
    const method = await writeFileWithFallback(sandbox, fullPath, '<section />', {
      directoryCache: cache,
      logger: noopLogger
    });
    assert.equal(method, 'files.write');
  }

  assert.equal(makeDirInvocations, 1, 'directory creation should happen once due to caching');
  assert.deepEqual(writes, paths, 'all file writes should be forwarded to files.write');
  assert.ok(cache.has('/home/user/app/src/components'));
});
