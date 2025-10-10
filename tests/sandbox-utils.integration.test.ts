import test from 'node:test';
import assert from 'node:assert/strict';

import { writeFileWithFallback } from '@/lib/sandbox/utils';

const noopLogger = {
  log: () => {},
  warn: () => {},
  error: () => {}
};

test('writeFileWithFallback falls back to Python when files.write fails', async () => {
  const fallbackScripts: string[] = [];
  let makeDirCalls = 0;

  const sandbox = {
    files: {
      makeDir: async () => {
        makeDirCalls += 1;
        return true;
      },
      write: async () => {
        throw new Error('simulated write failure');
      }
    },
    runCode: async (script: string) => {
      fallbackScripts.push(script);
      return { logs: { stdout: ['fallback'], stderr: [] } };
    }
  };

  const cache = new Set<string>();
  const method = await writeFileWithFallback(sandbox, '/home/user/app/src/App.jsx', '<div />', {
    directoryCache: cache,
    logger: noopLogger,
    directoryTimeoutMs: 5_000,
    writeTimeoutMs: 5_000
  });

  assert.equal(method, 'python-fallback', 'fallback method should be reported');
  assert.equal(makeDirCalls, 1, 'makeDir should be invoked once for directory creation');
  assert.equal(fallbackScripts.length, 1, 'runCode fallback should be executed once');
  assert.ok(fallbackScripts[0].includes('App.jsx'), 'fallback script should reference target file');
  assert.ok(cache.has('/home/user/app/src'), 'directory cache should include created folder');
});
