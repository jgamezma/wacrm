// ============================================================
// GET /api/extensions/shop/callback — OAuth callback (SGC & IdeasLab).
//
// Provider-agnostic: the provider id travels in the OAuth cookie (the callback
// URL is shared across providers). Gates before we trust the callback:
//   (1) the provider's own authenticity check (e.g. Shopify HMAC),
//   (2) the CSRF `state` must match the cookie set by /connect,
//   (3) the shop + account must match what started the flow.
// Then the provider exchanges the code for a credential + shop metadata; we
// encrypt + store it and redirect back to Settings with a `?result=` outcome
// the UI turns into a toast. Failures redirect with `result=error` rather than
// dumping JSON — this is a user-facing navigation.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.1, §10
// ============================================================

import { type NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { SHOP_OAUTH_COOKIE } from '@/lib/extensions/shop/constants';
import { getProvider } from '@/lib/extensions/shop/registry';
import { upsertConnection } from '@/lib/extensions/shop/connection';

type Outcome = 'connected' | 'denied' | 'error';

function redirectToSettings(request: NextRequest, outcome: Outcome): NextResponse {
  const url = new URL('/settings', request.url);
  url.searchParams.set('tab', 'shop');
  url.searchParams.set('result', outcome);
  const res = NextResponse.redirect(url);
  // Always clear the one-shot OAuth cookie once we've reached the callback.
  res.cookies.delete(SHOP_OAUTH_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    // User declined at the provider, or the provider returned an error.
    if (params.get('error')) return redirectToSettings(request, 'denied');

    // The provider id lives in the cookie (shared callback URL) — read it first.
    const raw = request.cookies.get(SHOP_OAUTH_COOKIE)?.value;
    if (!raw) return redirectToSettings(request, 'error');

    let stored: {
      state?: string;
      provider?: string;
      shop?: string | null;
      accountId?: string;
    };
    try {
      stored = JSON.parse(raw);
    } catch {
      return redirectToSettings(request, 'error');
    }

    const provider = stored.provider ? getProvider(stored.provider) : null;
    if (!provider) return redirectToSettings(request, 'error');

    // Flatten the query for the provider's authenticity check.
    const query: Record<string, string> = {};
    params.forEach((v, k) => {
      query[k] = v;
    });

    // (1) Provider authenticity (e.g. Shopify HMAC).
    if (!provider.verifyCallback(query)) {
      return redirectToSettings(request, 'error');
    }

    const state = params.get('state');
    // (2) CSRF: the state echoed back must match the one we minted.
    if (!state || !stored.state || stored.state !== state) {
      return redirectToSettings(request, 'error');
    }

    // (3a) Shop match, for domain-scoped providers.
    if (provider.requiresShopDomain) {
      const shopParam = provider.normalizeShopDomain(params.get('shop') ?? '');
      if (!shopParam || shopParam !== stored.shop) {
        return redirectToSettings(request, 'error');
      }
    }

    // Re-resolve the session and enforce admin+; then (3b) verify the account
    // that started the flow is the account finishing it (no cross-account mix-up).
    const ctx = await requireRole('admin');
    if (ctx.accountId !== stored.accountId) {
      return redirectToSettings(request, 'error');
    }

    const result = await provider.completeConnection({
      query,
      shopDomain: stored.shop ?? null,
    });

    await upsertConnection(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      provider: provider.id,
      shopDomain: result.shopDomain,
      displayName: result.displayName,
      accessToken: result.accessToken,
      scopes: result.scopes,
    });

    return redirectToSettings(request, 'connected');
  } catch (err) {
    // Never leak internals (tokens, stack) to the browser — log server-side
    // and surface a generic error outcome.
    console.error('[shop callback] failed:', err);
    return redirectToSettings(request, 'error');
  }
}
