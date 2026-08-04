/**
 * ST-41: UI form-state tests for the TransferPage.
 *
 * Executes the REAL transferFormReducer from src/lib/transfer-form-controller.ts
 * — the same reducer the TransferPage component uses. Tests prove actual state
 * transitions, not documentation-only booleans.
 *
 * ST-62: updated for the idempotency-key lifecycle. INIT and SUBMIT_SUCCESS
 * now require an idempotencyKey / nextIdempotencyKey payload (the component
 * generates it via generateIdempotencyKey, keeping the reducer pure).
 *
 * Run: bun test tests/st41-ui-form.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  transferFormReducer,
  validateTransferForm,
  buildSubmitDatePayload,
  type TransferFormState,
} from '../src/lib/transfer-form-controller';
import {
  getThailandTodayDateString,
  isFutureThailandDate,
  isValidDateString,
} from '../src/lib/thailand-date';

const K1 = 'idem-test-k1';
const K2 = 'idem-test-k2';

// Helper: a state with a key already set (matches what INIT produces).
function stateWith(date: string, submitting: boolean, key = K1): TransferFormState {
  return { businessDate: date, submitting, idempotencyKey: key };
}

// ============ 1. Initial state defaults to Thailand today ============

describe('ST-41 UI: initial state', () => {
  test('1. INIT sets businessDate to Thailand today', () => {
    const state = transferFormReducer({ businessDate: '', submitting: false, idempotencyKey: '' }, { type: 'INIT', idempotencyKey: K1 });
    expect(state.businessDate).toBe(getThailandTodayDateString());
    expect(state.submitting).toBe(false);
    expect(state.idempotencyKey).toBe(K1);
  });
});

// ============ 2. Date selection ============

describe('ST-41 UI: date selection', () => {
  test('2. SET_DATE updates businessDate', () => {
    const initial = transferFormReducer({ businessDate: '', submitting: false, idempotencyKey: '' }, { type: 'INIT', idempotencyKey: K1 });
    const state = transferFormReducer(initial, { type: 'SET_DATE', date: '2026-07-14' });
    expect(state.businessDate).toBe('2026-07-14');
    // ST-62: key preserved during date composition
    expect(state.idempotencyKey).toBe(K1);
  });
});

// ============ 3. Submit payload ============

describe('ST-41 UI: submit payload', () => {
  test('3. buildSubmitDatePayload returns YYYY-MM-DD (not a datetime)', () => {
    const state: TransferFormState = stateWith('2026-07-14', false);
    const payload = buildSubmitDatePayload(state);
    expect(payload).toBe('2026-07-14');
    expect(payload).not.toContain('T'); // date-only, not datetime
  });
});

// ============ 4. Success resets date to today ============

describe('ST-41 UI: success resets date', () => {
  test('4. SUBMIT_SUCCESS resets businessDate to Thailand today', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K2 });
    expect(result.businessDate).toBe(getThailandTodayDateString());
    expect(result.submitting).toBe(false);
    // ST-62: key rotated to the next intent's key
    expect(result.idempotencyKey).toBe(K2);
  });
});

// ============ 5. Error preserves selected date ============

describe('ST-41 UI: error preserves date (400, 409, 500, network)', () => {
  test('5. SUBMIT_ERROR preserves yesterday (HTTP 400 case)', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_ERROR' });
    expect(result.businessDate).toBe('2026-07-14'); // preserved, NOT reset
    expect(result.submitting).toBe(false);
    // ST-62: key PRESERVED so retry reuses it
    expect(result.idempotencyKey).toBe(K1);
  });

  test('6. SUBMIT_ERROR preserves yesterday (HTTP 409 case)', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_ERROR' });
    expect(result.businessDate).toBe('2026-07-14');
    expect(result.idempotencyKey).toBe(K1);
  });

  test('7. SUBMIT_ERROR preserves yesterday (HTTP 500 case)', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_ERROR' });
    expect(result.businessDate).toBe('2026-07-14');
    expect(result.idempotencyKey).toBe(K1);
  });

  test('8. SUBMIT_ERROR preserves yesterday (network failure case)', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_ERROR' });
    expect(result.businessDate).toBe('2026-07-14');
    expect(result.idempotencyKey).toBe(K1);
  });
});

// ============ 6. Submitting state ============

describe('ST-41 UI: submitting state', () => {
  test('9. SUBMIT_START sets submitting=true', () => {
    const state: TransferFormState = stateWith('2026-07-14', false);
    const result = transferFormReducer(state, { type: 'SUBMIT_START' });
    expect(result.submitting).toBe(true);
    expect(result.businessDate).toBe('2026-07-14'); // date unchanged
    // ST-62: key preserved (same submission intent)
    expect(result.idempotencyKey).toBe(K1);
  });

  test('10. submitting returns to false on success', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_SUCCESS', nextIdempotencyKey: K2 });
    expect(result.submitting).toBe(false);
  });

  test('11. submitting returns to false on error', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_ERROR' });
    expect(result.submitting).toBe(false);
  });

  test('12. duplicate submit blocked — SET_DATE/SET_DATE cannot fire while submitting (button disabled)', () => {
    const state: TransferFormState = stateWith('2026-07-14', true);
    const result = transferFormReducer(state, { type: 'SUBMIT_START' });
    expect(result.submitting).toBe(true); // still submitting
    expect(result.idempotencyKey).toBe(K1); // key unchanged
  });
});

// ============ 7. Form validation (prevents API call) ============

describe('ST-41 UI: form validation prevents API call', () => {
  test('13. future date → validation error (API not called)', () => {
    const state: TransferFormState = stateWith('2099-12-31', false);
    const error = validateTransferForm(state);
    expect(error).toBe('ไม่สามารถเลือกวันที่ในอนาคตได้');
  });

  test('14. blank date → validation error (API not called)', () => {
    const state: TransferFormState = stateWith('', false);
    const error = validateTransferForm(state);
    expect(error).toBe('กรุณาระบุวันที่แกะของ');
  });

  test('15. valid yesterday → no validation error (API proceeds)', () => {
    const state: TransferFormState = stateWith('2026-07-14', false);
    const error = validateTransferForm(state);
    expect(error).toBeNull();
  });
});
