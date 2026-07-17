// ============================================================
// GET /api/extensions/shop/connect?provider=<id>&shop=<domain> — start OAuth
// (SGC & IdeasLab).
//
// Admin+ only. Provider-agnostic: resolves the chosen provider, validates the
// shop domain when the provider needs one, builds the authorize URL and 302s
// the browser to the provider. The `state` + provider id + shop + originating
// account are stashed in a short-lived HttpOnly cookie so the callback can
// verify them (CSRF + provider + account + shop binding). Must be reached by a
// top-level navigation (window.location), not fetch() — otherwise the
// cross-origin redirect is blocked.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.1
// ============================================================

import { type NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { SHOP_OAUTH_COOKIE } from '@/lib/extensions/shop/constants';
import { getProvider } from '@/lib/extensions/shop/registry';
import { generateState } from '@/lib/extensions/shop/state';

export async function GET(request: NextRequest) {
  try {
    const { accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`shop-connect:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const providerId = request.nextUrl.searchParams.get('provider') ?? '';
    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json({ error: 'Unknown shop provider' }, { status: 400 });
    }
    if (!provider.isConfigured()) {
      // Not configured — the UI hides/disables the option, but guard the route
      // too so a hand-crafted request can't start a redirect that only fails at
      // the provider. 503: the feature exists but the server isn't set up.
      return NextResponse.json(
        { error: `${provider.label} is not configured on this server` },
        { status: 503 },
      );
    }

    // Validate/normalize the shop domain before it's ever trusted (SSRF /
    // open-redirect guard). Providers that don't need one skip this.
    let shopDomain: string | null = null;
    if (provider.requiresShopDomain) {
      shopDomain = provider.normalizeShopDomain(
        request.nextUrl.searchParams.get('shop') ?? '',
      );
      if (!shopDomain) {
        return NextResponse.json(
          { error: 'A valid shop domain is required' },
          { status: 400 },
        );
      }
    }

    const state = generateState();
    const authorizeUrl = provider.buildAuthorizeUrl({ state, shopDomain });

    const res = NextResponse.redirect(authorizeUrl);
    res.cookies.set(
      SHOP_OAUTH_COOKIE,
      JSON.stringify({ state, provider: provider.id, shop: shopDomain, accountId }),
      {
        httpOnly: true,
        // Lax lets the cookie ride the top-level GET redirect back from the
        // provider while still blocking cross-site POST/embedded requests.
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 600, // 10 minutes — the OAuth round trip is seconds.
      },
    );
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
