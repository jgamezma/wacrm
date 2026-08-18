// ============================================================
// GET /api/extensions/shop/callback — OAuth callback (SGC & IdeasLab).
//
// Provider-agnostic: the provider id travels in the OAuth cookie (the callback
// URL is shared across providers). Gates before we trust the callback:
//   (1) the provider's own authenticity check (e.g. Shopify HMAC),
//   (2) the CSRF `state` must match the cookie set by /connect,
//   (3) the account must match what started the flow, and the shop domain the
//       provider reports must be a valid host (it may legitimately differ from
//       the one the user typed — see `callback-shop.ts`).
// Then the provider exchanges the code for a credential + shop metadata; we
// encrypt + store it and redirect back to Settings with a `?result=` outcome
// the UI turns into a toast. Failures redirect with `result=error` rather than
// dumping JSON — this is a user-facing navigation.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.1, §10
// ============================================================

import { type NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { resolvePublicOrigin } from '@/lib/extensions/shop/base-url';
import { resolveCallbackShopDomain } from '@/lib/extensions/shop/callback-shop';
import { SHOP_OAUTH_COOKIE } from '@/lib/extensions/shop/constants';
import { getProvider } from '@/lib/extensions/shop/registry';
import { upsertConnection } from '@/lib/extensions/shop/connection';

type Outcome = 'connected' | 'denied' | 'error';

/** Why a callback was rejected. Logged server-side only — never shown to the
 *  browser, which just gets a generic `result=error`. */
type FailureReason =
  | 'provider_error'
  | 'missing_cookie'
  | 'unparsable_cookie'
  | 'unknown_provider'
  | 'bad_signature'
  | 'state_mismatch'
  | 'invalid_shop'
  | 'account_mismatch';

function redirectToSettings(
  request: NextRequest,
  outcome: Outcome,
  reason?: FailureReason,
  detail?: Record<string, unknown>,
): NextResponse {
  if (reason) {
    // The browser only ever sees `result=error`; the operator needs to know
    // which gate closed, so name it here. `detail` carries non-secret context
    // (shop domains, never tokens/codes) so a misconfig is diagnosable.
    console.warn('[shop callback] rejected:', reason, detail ?? '');
  }
  // Build the redirect on the origin the *user* reached us on. `request.url`
  // can be the container's bind address behind a proxy (e.g. 0.0.0.0:80).
  const url = new URL('/settings', resolvePublicOrigin(request));
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
    if (params.get('error')) {
      return redirectToSettings(request, 'denied', 'provider_error');
    }

    // The provider id lives in the cookie (shared callback URL) — read it first.
    const raw = request.cookies.get(SHOP_OAUTH_COOKIE)?.value;
    if (!raw) return redirectToSettings(request, 'error', 'missing_cookie');

    let stored: {
      state?: string;
      provider?: string;
      shop?: string | null;
      accountId?: string;
    };
    try {
      stored = JSON.parse(raw);
    } catch {
      return redirectToSettings(request, 'error', 'unparsable_cookie');
    }

    const provider = stored.provider ? getProvider(stored.provider) : null;
    if (!provider) return redirectToSettings(request, 'error', 'unknown_provider');

    // Flatten the query for the provider's authenticity check.
    const query: Record<string, string> = {};
    params.forEach((v, k) => {
      query[k] = v;
    });

    // (1) Provider authenticity (e.g. Shopify HMAC).
    if (!provider.verifyCallback(query)) {
      return redirectToSettings(request, 'error', 'bad_signature');
    }

    const state = params.get('state');
    // (2) CSRF: the state echoed back must match the one we minted.
    if (!state || !stored.state || stored.state !== state) {
      return redirectToSettings(request, 'error', 'state_mismatch');
    }

    // (3a) Which store are we completing for? The provider's (signed) domain
    // wins over the typed one; it just has to be a valid host.
    const rawShop = params.get('shop') ?? '';
    const resolvedShop = resolveCallbackShopDomain(provider, rawShop, stored.shop ?? null);
    if (!resolvedShop.ok) {
      return redirectToSettings(request, 'error', 'invalid_shop', {
        startedWith: stored.shop,
        callbackShop: rawShop,
      });
    }
    if (resolvedShop.canonicalized) {
      // Not an error: the store's canonical domain differs from what the user
      // typed (aliases, renamed stores, dev-store handles). Worth a trace.
      console.warn('[shop callback] using provider canonical shop domain:', {
        startedWith: stored.shop,
        using: resolvedShop.shopDomain,
      });
    }

    // Re-resolve the session and enforce admin+; then (3b) verify the account
    // that started the flow is the account finishing it (no cross-account mix-up).
    const ctx = await requireRole('admin');
    if (ctx.accountId !== stored.accountId) {
      return redirectToSettings(request, 'error', 'account_mismatch');
    }

    const result = await provider.completeConnection({
      query,
      shopDomain: resolvedShop.shopDomain,
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
