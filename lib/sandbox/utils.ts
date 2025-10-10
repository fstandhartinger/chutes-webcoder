import { withTimeout } from '@/lib/retry';

export interface SandboxLike {
  files?: {
    write?: (path: string, data: string | ArrayBuffer | Blob | ReadableStream) => Promise<unknown> | unknown;
    makeDir?: (path: string) => Promise<unknown> | unknown;
  };
  runCode?: (code: string) => Promise<unknown> | unknown;
}

export interface SandboxWriteOptions {
  directoryCache?: Set<string>;
  directoryTimeoutMs?: number;
  writeTimeoutMs?: number;
  logger?: Pick<typeof console, 'log' | 'warn' | 'error'>;
}

const DEFAULT_DIR_TIMEOUT = 10_000;
const DEFAULT_WRITE_TIMEOUT = 45_000;

function resolveDirectory(fullPath: string): string | null {
  const normalized = fullPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return null;
  }
  const dirPath = normalized.slice(0, lastSlash);
  if (!dirPath || dirPath === '/' || dirPath === '') {
    return null;
  }
  return dirPath;
}

export async function ensureDirectoryExists(
  sandbox: SandboxLike,
  fullPath: string,
  options: SandboxWriteOptions = {}
): Promise<void> {
  const dirPath = resolveDirectory(fullPath);
  if (!dirPath) {
    return;
  }

  const cache = options.directoryCache;
  if (cache?.has(dirPath)) {
    return;
  }

  const logger = options.logger ?? console;
  const timeoutMs = options.directoryTimeoutMs ?? DEFAULT_DIR_TIMEOUT;

  try {
    if (sandbox?.files?.makeDir) {
      await withTimeout(Promise.resolve(sandbox.files.makeDir(dirPath)), timeoutMs, `Directory creation for ${dirPath} timed out`);
    } else if (sandbox?.runCode) {
      throw new Error('Sandbox makeDir API unavailable');
    } else {
      throw new Error('Sandbox instance does not expose filesystem helpers');
    }
  } catch (primaryError) {
    logger.warn?.(`[sandbox-utils] makeDir failed for ${dirPath}, attempting Python fallback`, primaryError);
    if (!sandbox?.runCode) {
      throw primaryError instanceof Error ? primaryError : new Error(String(primaryError));
    }

    try {
      await withTimeout(
        Promise.resolve(
          sandbox.runCode!(
            `import os\n` +
            `os.makedirs(${JSON.stringify(dirPath)}, exist_ok=True)`
          )
        ),
        timeoutMs,
        `Fallback directory creation for ${dirPath} timed out`
      );
    } catch (fallbackError) {
      logger.error?.(`[sandbox-utils] Python fallback failed for ${dirPath}`, fallbackError);
      throw fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
    }
  }

  cache?.add(dirPath);
}

export async function writeFileWithFallback(
  sandbox: SandboxLike,
  fullPath: string,
  content: string,
  options: SandboxWriteOptions = {}
): Promise<'files.write' | 'python-fallback'> {
  const logger = options.logger ?? console;
  const writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT;

  await ensureDirectoryExists(sandbox, fullPath, options);

  try {
    if (sandbox?.files?.write) {
      let payload: string | ArrayBuffer = content;
      if (typeof TextEncoder !== 'undefined') {
        const encoded = new TextEncoder().encode(content);
        payload = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
      } else if (typeof Buffer !== 'undefined') {
        const buffer = Buffer.from(content, 'utf-8');
        payload = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      }
      await withTimeout(
        Promise.resolve(sandbox.files.write(fullPath, payload)),
        writeTimeoutMs,
        `Writing ${fullPath} timed out`
      );
      logger.log?.(`[sandbox-utils] Wrote ${fullPath} via files.write`);
      return 'files.write';
    }
    throw new Error('Sandbox files.write API unavailable');
  } catch (primaryError) {
    logger.warn?.(`[sandbox-utils] files.write failed for ${fullPath}, falling back to Python`, primaryError);
    if (!sandbox?.runCode) {
      throw primaryError instanceof Error ? primaryError : new Error(String(primaryError));
    }

    try {
      await withTimeout(
        Promise.resolve(
          sandbox.runCode!(
            `import os\n` +
            `os.makedirs(os.path.dirname(${JSON.stringify(fullPath)}), exist_ok=True)\n` +
            `with open(${JSON.stringify(fullPath)}, 'w', encoding='utf-8') as f:\n` +
            `    f.write(${JSON.stringify(content)})\n` +
            `print(\"✓ Written: ${fullPath}\")`
          )
        ),
        writeTimeoutMs,
        `Fallback write for ${fullPath} timed out`
      );
      logger.log?.(`[sandbox-utils] Wrote ${fullPath} via Python fallback`);
      return 'python-fallback';
    } catch (fallbackError) {
      logger.error?.(`[sandbox-utils] Python fallback failed for ${fullPath}`, fallbackError);
      throw fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
    }
  }
}
