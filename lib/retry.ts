// Lightweight retry and timeout helpers for server routes

export interface RetryOptions {
  retries: number;
  delayMs: number;
  backoffFactor?: number; // multiplier for exponential backoff
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  isRetryable?: (error: unknown) => boolean
): Promise<T> {
  const {
    retries = 2,
    delayMs = 500,
    backoffFactor = 2,
    onRetry
  } = options;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      if (isRetryable && !isRetryable(error)) break;
      if (onRetry) await onRetry(error, attempt + 1);
      const wait = delayMs * Math.pow(backoffFactor, attempt);
      await delay(wait);
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operation failed after retries');
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message || `Operation timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export function isRetryableHttpStatus(status?: number): boolean {
  if (!status) return true;
  // Retry on 5xx and 429 by default
  return status >= 500 || status === 429;
}


