/**
 * ST-62: Idempotency key lifecycle tests.
 *
 * Proves the core review goal: the idempotency key is stable per submission
 * intent, so double-click, retry-after-failure, and response-loss all reuse
 * the SAME key (letting the server dedup), while a new submission intent
 * rotates to a NEW key.
 *
 * These tests exercise the REAL transferFormReducer (pure) — the same reducer
 * the TransferPage component uses. They do NOT need a database; the
 * server-side dedup that CONSUMES the key is proven separately in
 * tests/st62-postgres-idempotency.test.ts (including the concurrent-duplicate
 * guarantee that at most one StockTransfer is created per key).
 *
 * Run: bun test tests/st62-idempotency-key-lifecycle.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  transferFormReducer,
  generateIdempotencyKey,
  type TransferFormState,
} from '../src/lib/transfer-form-controller';

const K1 = 'idem-intent-1';
const K2 = 'idem-intent-2';
const K3 = 'idem-intent-3';

function fresh(): TransferFormState {
  return transferFormReducer(
    { businessDate: '', submitting: false, idempotencyKey: '' },
    { type: 'INIT', idempotencyKey: K1 },
  );
}

describe('ST-62 key lifecycle: double-click reuses the same key', () => {
  test('1. two SUBMIT_START in a row (double-click) keep the same key', () => {
    const s0 = fresh();
    // First click
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    // Second click before success (double-click / race)
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_START' });
    expect(s1.idempotencyKey).toBe(K1);
    expect(s2.idempotencyKey).toBe(K1);
    expect(s2.idempotencyKey).toBe(s1.idempotencyKey);
  });

  test('2. SUBMIT_START then SET_DATE then SUBMIT_START keeps the same key', () => {
    // User starts submit, nudges the date, clicks again — still the same intent.
    const s0 = fresh();
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    const s2 = transferFormReducer(s1, { type: 'SET_DATE', date: '2026-07-15' });
    const s3 = transferFormReducer(s2, { type: 'SUBMIT_START' });
    expect(s3.idempotencyKey).toBe(K1);
  });
});

describe('ST-62 key lifecycle: retry-after-failure reuses the same key', () => {
  test('3. SUBMIT_ERROR → SUBMIT_START (retry) reuses the same key', () => {
    // Simulates: network failure on first attempt, user clicks retry.
    const s0 = fresh();
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    // First attempt fails (network/timeout/500) — key must be PRESERVED.
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_ERROR' });
    expect(s2.idempotencyKey).toBe(K1);
    // User retries the SAME submission — same key, so server can REPLAY or re-run.
    const s3 = transferFormReducer(s2, { type: 'SUBMIT_START' });
    expect(s3.idempotencyKey).toBe(K1);
  });

  test('4. response-loss scenario: SUBMIT_ERROR (client thinks failed) → retry same key', () => {
    // Server committed the transfer but the response was lost (network drop).
    // Client dispatches SUBMIT_ERROR. On retry with the SAME key, the server
    // finds the committed StockTransfer via idempotencyKey and returns REPLAY
    // (201 + the original bill) instead of creating a duplicate.
    const s0 = fresh();
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_ERROR' }); // response lost
    const s3 = transferFormReducer(s2, { type: 'SUBMIT_START' }); // retry
    expect(s3.idempotencyKey).toBe(K1);
  });

  test('5. multiple retries (flaky network) all reuse the same key', () => {
    const s0 = fresh();
    let s = transferFormReducer(s0, { type: 'SUBMIT_START' });
    for (let i = 0; i < 5; i++) {
      s = transferFormReducer(s, { type: 'SUBMIT_ERROR' });
      s = transferFormReducer(s, { type: 'SUBMIT_START' });
    }
    expect(s.idempotencyKey).toBe(K1);
  });
});

describe('ST-62 key lifecycle: new submission intent rotates the key', () => {
  test('6. SUBMIT_SUCCESS rotates to a new key for the next intent', () => {
    const s0 = fresh();
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    // First submission succeeds — intent complete, rotate key.
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K2 });
    expect(s2.idempotencyKey).toBe(K2);
    expect(s2.idempotencyKey).not.toBe(K1);
  });

  test('7. after success, the next submission uses the new key (not the old one)', () => {
    const s0 = fresh();
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K2 });
    // New intent begins — SUBMIT_START must carry K2, NOT K1.
    const s3 = transferFormReducer(s2, { type: 'SUBMIT_START' });
    expect(s3.idempotencyKey).toBe(K2);
  });

  test('8. two successive intents use two different keys', () => {
    const s0 = fresh(); // K1
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K2 });
    const s3 = transferFormReducer(s2, { type: 'SUBMIT_START' });
    const s4 = transferFormReducer(s3, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K3 });
    const s5 = transferFormReducer(s4, { type: 'SUBMIT_START' });
    expect(s1.idempotencyKey).toBe(K1);
    expect(s3.idempotencyKey).toBe(K2);
    expect(s5.idempotencyKey).toBe(K3);
    expect(new Set([K1, K2, K3]).size).toBe(3);
  });
});

describe('ST-62 key lifecycle: generateIdempotencyKey produces unique keys', () => {
  test('9. two calls produce different keys', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.startsWith('idem-')).toBe(true);
    expect(b.startsWith('idem-')).toBe(true);
  });

  test('10. generated keys pass the server-side validation regex', async () => {
    const { validateIdempotencyKey } = await import('../src/lib/idempotency-fingerprint');
    for (let i = 0; i < 20; i++) {
      const key = generateIdempotencyKey();
      expect(validateIdempotencyKey(key)).toBeNull();
    }
  });
});

describe('ST-62 key lifecycle: the full realistic flow', () => {
  test('11. mount → submit → fail → retry → succeed → new intent (full cycle)', () => {
    // 1. Form mounts → INIT with K1
    const s0 = transferFormReducer(
      { businessDate: '', submitting: false, idempotencyKey: '' },
      { type: 'INIT', idempotencyKey: K1 },
    );
    expect(s0.idempotencyKey).toBe(K1);

    // 2. User clicks submit
    const s1 = transferFormReducer(s0, { type: 'SUBMIT_START' });
    expect(s1.idempotencyKey).toBe(K1);

    // 3. Network fails → SUBMIT_ERROR (key PRESERVED)
    const s2 = transferFormReducer(s1, { type: 'SUBMIT_ERROR' });
    expect(s2.idempotencyKey).toBe(K1);

    // 4. User retries → SUBMIT_START (same key → server dedups)
    const s3 = transferFormReducer(s2, { type: 'SUBMIT_START' });
    expect(s3.idempotencyKey).toBe(K1);

    // 5. Success → SUBMIT_SUCCESS rotates to K2
    const s4 = transferFormReducer(s3, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K2 });
    expect(s4.idempotencyKey).toBe(K2);

    // 6. New submission intent → uses K2
    const s5 = transferFormReducer(s4, { type: 'SUBMIT_START' });
    expect(s5.idempotencyKey).toBe(K2);
  });
});
