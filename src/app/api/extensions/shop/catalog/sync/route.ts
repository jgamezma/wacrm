// ============================================================
// POST /api/extensions/shop/catalog/sync — pull the catalog (SGC & IdeasLab).
//
// Admin+ only. Kicks a pull-sync for whichever provider this account is
// connected to; the orchestrator (`sync.ts`) owns provider resolution,
// capability gating, and failure recording. Writes go through the service-role
// client because catalog tables have no INSERT/UPDATE policy by design.
//
// The response body shape is the same whether the sync worked or not, so the UI
// reads one shape; the status code says whether the operator can fix it here
// (409: connect/reconnect) or it was the remote shop's fault (502).
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.2, §8
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { shopAdminClient } from '@/lib/extensions/shop/admin-client';
import { syncShopCatalog } from '@/lib/extensions/shop/sync';

/** Failures the operator resolves by connecting (or reconnecting) the shop. */
const RECONNECT_ERRORS = new Set(['not_connected', 'missing_products_capability']);

export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin');

    // A catalog pull is the most expensive admin action here (many remote
    // round-trips + embeddings), so it shares the admin bucket rather than
    // getting a looser one.
    const limit = checkRateLimit(`shop-catalog-sync:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const result = await syncShopCatalog(shopAdminClient(), accountId);

    const status = result.ok
      ? 200
      : RECONNECT_ERRORS.has(result.error ?? '')
        ? 409
        : 502;

    return NextResponse.json(
      {
        ok: result.ok,
        product_count: result.productCount,
        inventory: result.inventory,
        ...(result.error ? { error: result.error } : {}),
      },
      { status },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
