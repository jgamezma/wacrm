// ============================================================
// GET /api/extensions/shop/status — connection status (SGC & IdeasLab).
//
// Returns `{ connected, provider, shop_domain, display_name, connected_at,
// configured, providers }`. `providers` is the list of configured backends so
// the UI can render a picker. Never returns the token — the status fields come
// from the pure `toStatusPayload` mapper, which has no token field. RLS (admin+
// SELECT) means non-admins simply see `connected: false`.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.2
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getConnectionStatus } from '@/lib/extensions/shop/connection';
import { isAnyProviderConfigured, listConfiguredProviders } from '@/lib/extensions/shop/registry';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const status = await getConnectionStatus(supabase, accountId);
    return NextResponse.json({
      ...status,
      configured: isAnyProviderConfigured(),
      providers: listConfiguredProviders(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
