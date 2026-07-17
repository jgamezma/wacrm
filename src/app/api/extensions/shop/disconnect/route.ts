// ============================================================
// POST /api/extensions/shop/disconnect — clear connection (SGC & IdeasLab).
//
// Admin+ only. Drops the account's stored credential regardless of provider.
// The local clear is authoritative — deleting the row severs the link (an
// operator can also revoke the app from the provider's admin). Always succeeds
// (idempotent: no row → 200).
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.2, US-3
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { deleteConnection } from '@/lib/extensions/shop/connection';

export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`shop-disconnect:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    await deleteConnection(supabase, accountId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
