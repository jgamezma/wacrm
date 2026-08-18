// ============================================================
// GET /api/extensions/shop/products?q= — search the synced catalog
// (SGC & IdeasLab).
//
// Any account member: agents need this for the inbox product picker. Returns
// client-safe rows only — id, title, image URL, and the ready-to-send caption
// (built server-side so the browser never re-implements price/availability
// wording). No tokens, no provider identity, no scopes.
//
// Substring search over the denormalised `search_text` blob rather than the FTS
// RPC: a picker is typed one letter at a time, and `plainto_tsquery` won't match
// "nik" against "Nike". The agent path (`catalog.ts`) uses the ranked RPCs.
//
// Only `active` products are searchable — the same rule the agent path follows,
// so an agent can't send a customer something the shop isn't publishing.
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.6, US-6
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { loadCatalogProducts, toProductSuggestions } from '@/lib/extensions/shop/catalog';

/** Picker-sized page. */
const RESULT_LIMIT = 20;

/** Longest query we bother sending to Postgres. */
const QUERY_MAX_CHARS = 100;

/** One search per keystroke is fine; a scraper is not. Fork-owned bucket so it
 *  doesn't share a budget with message sends. */
const SEARCH_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

/**
 * Strip the characters PostgREST treats as filter syntax. `%` / `_` are left
 * alone: a user typing them only widens their own ILIKE, which is harmless.
 */
function sanitizeQuery(raw: string): string {
  return raw.trim().slice(0, QUERY_MAX_CHARS).replace(/[,()*]/g, ' ').trim();
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();

    const limit = checkRateLimit(`shop-products:${userId}`, SEARCH_RATE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const query = sanitizeQuery(new URL(request.url).searchParams.get('q') ?? '');

    // RLS scopes this to the caller's account; the explicit filter documents it.
    let select = supabase
      .from('shop_products')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .order('title', { ascending: true })
      .limit(RESULT_LIMIT);
    if (query) select = select.ilike('search_text', `%${query}%`);

    const { data, error } = await select;
    if (error) {
      console.error('[shop products] search failed:', error);
      return NextResponse.json({ error: 'Failed to search products' }, { status: 500 });
    }

    const ids = (data ?? []).map((row) => (row as { id: string }).id);
    const products = await loadCatalogProducts(supabase, accountId, ids);

    return NextResponse.json({ products: toProductSuggestions(products) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
