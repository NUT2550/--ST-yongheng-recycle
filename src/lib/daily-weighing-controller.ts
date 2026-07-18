/**
 * ST-35: Production controller functions for daily purchase weighing.
 *
 * These functions encapsulate the route handler logic (auth → authorize → service call)
 * in a testable way — they accept a pre-authenticated payload and repository,
 * so tests can call them directly without Next.js runtime or JWT.
 *
 * The Next.js route handlers are thin wrappers that:
 * 1. Extract token from request
 * 2. Verify token
 * 3. Call these controller functions
 *
 * Tests call these controller functions directly with test payloads.
 */

import type { DailyPurchaseWeighingRepository } from './daily-weighing-repository';
import {
  aggregateDailyPurchasesWithRepository,
  saveDailyPurchaseWeighing,
  getDailyWeighingHistory,
  getDailyWeighingDetail,
} from './daily-purchase-weighing-service';
import { hasDailyPurchaseWeighingPermission } from './daily-weighing-permission';
import { isValidWeighingDate, isValidWeighingCategory } from './daily-purchase-weighing';
import type { AggregationResult } from './daily-purchase-weighing';

export interface AuthPayload {
  userId: string;
  name: string;
  role: string;
  permissions?: Record<string, boolean>;
}

export interface ControllerResponse<T = unknown> {
  status: number;
  data: T;
}

/**
 * GET aggregation controller — called after auth.
 * Returns 403 if not permitted, 400 if invalid params, 200 with aggregation.
 */
export async function getAggregationController(
  repo: DailyPurchaseWeighingRepository,
  payload: AuthPayload,
  dateStr: string | null,
  category: string | null
): Promise<ControllerResponse> {
  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return { status: 403, data: { error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอดซื้อ' } };
  }

  if (!dateStr || !category) {
    return { status: 400, data: { error: 'กรุณาระบุวันที่และหมวดหมู่' } };
  }
  if (!isValidWeighingDate(dateStr)) {
    return { status: 400, data: { error: 'รูปแบบวันที่ไม่ถูกต้อง' } };
  }
  if (!isValidWeighingCategory(category)) {
    return { status: 400, data: { error: 'หมวดหมู่ต้องเป็น ทองแดง หรือ ทองเหลือง' } };
  }

  try {
    const result = await aggregateDailyPurchasesWithRepository(repo, dateStr, category);
    return { status: 200, data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { status: 400, data: { error: msg } };
  }
}

/**
 * GET history controller — called after auth.
 * Returns 403 if not permitted, 200 with sessions list.
 */
export async function getHistoryController(
  repo: DailyPurchaseWeighingRepository,
  payload: AuthPayload,
  page: number,
  limit: number
): Promise<ControllerResponse> {
  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return { status: 403, data: { error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอดซื้อ' } };
  }

  const skip = (page - 1) * limit;
  const { sessions, total } = await getDailyWeighingHistory(repo, skip, limit);
  return { status: 200, data: { sessions, total } };
}

/**
 * GET detail controller — called after auth.
 * Returns 403 if not permitted, 404 if not found, 200 with session.
 */
export async function getDetailController(
  repo: DailyPurchaseWeighingRepository,
  payload: AuthPayload,
  id: string
): Promise<ControllerResponse> {
  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return { status: 403, data: { error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอดซื้อ' } };
  }

  const session = await getDailyWeighingDetail(repo, id);
  if (!session) {
    return { status: 404, data: { error: 'ไม่พบรายการ' } };
  }
  return { status: 200, data: { session } };
}

/**
 * POST save controller — called after auth.
 * Returns 403 if not permitted, 201 on success, 400/409/500 on error.
 */
export async function postSaveController(
  repo: DailyPurchaseWeighingRepository,
  payload: AuthPayload,
  body: unknown,
  aggregationOverride?: AggregationResult
): Promise<ControllerResponse> {
  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return { status: 403, data: { error: 'ไม่มีสิทธิ์บันทึกผลชั่ง' } };
  }

  const result = await saveDailyPurchaseWeighing(repo, body, payload.userId, payload.name, aggregationOverride);

  if (result.success) {
    return { status: 201, data: { session: result.session } };
  } else {
    return { status: result.status, data: { error: result.error } };
  }
}
