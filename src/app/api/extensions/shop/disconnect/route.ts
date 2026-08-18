// ============================================================
// POST /api/extensions/shop/disconnect — clear connection (SGC & IdeasLab).
//
// Admin+ only. Drops the account's stored credential regardless of provider.
// The local clear is authoritative — deleting the row severs the link (an
// operator can also revoke the app from the provider's admin). Always succeeds
// (idempotent: no row → 200).
//
// The cached catalog goes with it: a later connect — same account, same or a
// different provider — must never surface the previous shop's products, and the
// agent read path treats "cache is empty" as "no shop connected" (spec 003 §10).
// Catalog first, so a failure there cannot leave products behind with no
// connection to explain them.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.2, US-3
//       docs/extensions/specs/003-shop-catalog-agent-knowledge.md §10
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { deleteConnection } from '@/lib/extensions/shop/connection';
import { clearShopCatalog } from '@/lib/extensions/shop/sync';

export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`shop-disconnect:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    await clearShopCatalog(supabase, accountId);
    await deleteConnection(supabase, accountId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
