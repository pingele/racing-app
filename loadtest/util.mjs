// Small helpers shared across the Node scripts: bounded concurrency and
// retry-with-backoff for the rate-limited AWS APIs (Cognito auth, DynamoDB).

// Run `fn` over `items` with at most `limit` in flight at once. Preserves order.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const RETRYABLE = new Set([
  'TooManyRequestsException',
  'ThrottlingException',
  'LimitExceededException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
]);

export async function withRetry(fn, { tries = 6, baseMs = 250 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        RETRYABLE.has(err?.name) || err?.$metadata?.httpStatusCode === 429;
      if (!retryable || attempt === tries - 1) throw err;
      const wait = baseMs * 2 ** attempt + Math.floor(Math.random() * 150);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Decode a JWT payload (no verification — just to read `sub`/`nickname`).
export function decodeJwt(token) {
  const part = token.split('.')[1];
  const json = Buffer.from(part, 'base64url').toString('utf8');
  return JSON.parse(json);
}

// Fisher–Yates shuffle (in place) — used to randomize predicted finish orders.
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
