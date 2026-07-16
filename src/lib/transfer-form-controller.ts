/**
 * ST-41: UI form-state controller for the แกะของ/ย้ายสต็อก page.
 *
 * Pure functions that handle the TransferPage form state transitions.
 * The component calls these; tests call them directly to prove behavior.
 */

import {
  getThailandTodayDateString,
  isFutureThailandDate,
  isValidDateString,
  formatThailandBuddhistDate,
} from './thailand-date';

export interface TransferFormState {
  businessDate: string; // YYYY-MM-DD
  submitting: boolean;
}

export type TransferFormAction =
  | { type: 'INIT' }
  | { type: 'SET_DATE'; date: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_SUCCESS' }
  | { type: 'SUBMIT_ERROR' };

/**
 * ST-41: Reducer for the TransferPage form state.
 *
 * Key invariants:
 *   - INIT: businessDate defaults to Thailand today
 *   - SUBMIT_SUCCESS: businessDate resets to Thailand today (ONLY on success)
 *   - SUBMIT_ERROR: businessDate is PRESERVED (not reset)
 *   - submitting: true on SUBMIT_START, false on SUCCESS and ERROR
 */
export function transferFormReducer(
  state: TransferFormState,
  action: TransferFormAction
): TransferFormState {
  switch (action.type) {
    case 'INIT':
      return { businessDate: getThailandTodayDateString(), submitting: false };
    case 'SET_DATE':
      return { ...state, businessDate: action.date };
    case 'SUBMIT_START':
      return { ...state, submitting: true };
    case 'SUBMIT_SUCCESS':
      // ST-41: reset to today ONLY after successful save
      return { businessDate: getThailandTodayDateString(), submitting: false };
    case 'SUBMIT_ERROR':
      // ST-41: PRESERVE the selected date — do NOT reset on error
      return { ...state, submitting: false };
    default:
      return state;
  }
}

/**
 * ST-41: Validate the form before API call.
 * Returns null if valid, or an error message if invalid.
 */
export function validateTransferForm(state: TransferFormState): string | null {
  if (!state.businessDate || state.businessDate.trim() === '') {
    return 'กรุณาระบุวันที่แกะของ';
  }
  if (!isValidDateString(state.businessDate)) {
    return 'รูปแบบวันที่ไม่ถูกต้อง';
  }
  if (isFutureThailandDate(state.businessDate)) {
    return 'ไม่สามารถเลือกวันที่ในอนาคตได้';
  }
  return null;
}

/**
 * ST-41: Build the submit payload date field.
 * Returns YYYY-MM-DD (date-only, not a datetime timestamp).
 */
export function buildSubmitDatePayload(state: TransferFormState): string {
  return state.businessDate;
}
