/**
 * Retry and timeout utilities for API calls
 */

import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "retryableErrors">> & {
  retryableErrors: string[];
} = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    "RATE_LIMIT",
    "429",
    "503",
    "502",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "temporarily unavailable",
    "too many requests",
  ],
};

function isRetryable(error: unknown, retryableErrors: string[]): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return retryableErrors.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries || !isRetryable(error, opts.retryableErrors)) {
        logger.warn("Retry exhausted or non-retryable error", {
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          isRetryable: isRetryable(error, opts.retryableErrors),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      logger.info("Retrying after transient error", {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`TIMEOUT: Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}
