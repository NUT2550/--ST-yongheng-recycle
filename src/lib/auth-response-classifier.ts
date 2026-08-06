/**
 * ST-75: Auth response classifier — pure function for testing.
 *
 * Classifies HTTP response status from auth/import endpoints into
 * actionable categories. Used by page.tsx + import dialogs.
 *
 * Rules:
 * - 200 → AUTHENTICATED (set user)
 * - 401 → SESSION_EXPIRED (clear token + user)
 * - 403 → PERMISSION_DENIED (keep token, close dialog)
 * - 429/5xx → TRANSIENT_ERROR (keep token, show retry)
 * - other → UNKNOWN (keep token, don't change state)
 */

export type AuthResponseAction =
  | 'AUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'TRANSIENT_ERROR'
  | 'UNKNOWN';

export function classifyAuthResponse(status: number): AuthResponseAction {
  if (status === 200) return 'AUTHENTICATED';
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 429 || status >= 500) return 'TRANSIENT_ERROR';
  return 'UNKNOWN';
}

/**
 * ST-75: Should token be cleared for this status?
 * Only 401 clears the token. 403/429/5xx do NOT.
 */
export function shouldClearToken(status: number): boolean {
  return classifyAuthResponse(status) === 'SESSION_EXPIRED';
}

/**
 * ST-75: Should user state be cleared for this status?
 * Only 401 clears user state. Others preserve it.
 */
export function shouldClearUser(status: number): boolean {
  return classifyAuthResponse(status) === 'SESSION_EXPIRED';
}
