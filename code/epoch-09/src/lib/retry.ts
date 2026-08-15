const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  isRetryable?: (err: unknown) => boolean;
}

// Exponential backoff + FULL JITTER — the industry-standard herd-breaker.
// Without jitter, every instance's retry timer expires in sync: wave after
// synchronized wave onto a recovering dependency. Randomized delay smears
// the wave thin.
//
// 🛡️ Only idempotent operations get retried: retrying a non-idempotent POST
// that actually committed duplicates its effect (Epoch 09 builds the
// idempotency keys that make retries safe end-to-end).
export async function withRetry<T>(
  call: () => Promise<T>,
  { maxAttempts = 3, baseMs = 200, capMs = 10_000, isRetryable = () => true }: RetryOptions = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await call();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      const cap = Math.min(baseMs * 2 ** attempt, capMs);
      await sleep(Math.random() * cap); // full jitter
    }
  }
  throw lastErr;
}
