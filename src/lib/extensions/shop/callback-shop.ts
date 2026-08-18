// ============================================================
// Shop connector — callback shop-domain reconciliation (SGC & IdeasLab fork).
//
// The domain the user *typed* in Settings is not always the domain the provider
// *reports* on the callback. Shopify accepts a store's alias or former login
// domain on `/admin/oauth/authorize` and then canonicalizes: a dev store named
// "otraprueba-2" answers as `1f3m3k-vt.myshopify.com`. Rejecting that mismatch
// made a correct install unconnectable, since the user cannot guess the handle.
//
// Trusting the callback's domain is safe *at this point in the route*, and only
// there — two gates have already closed:
//   (1) `verifyCallback` proved the provider signed this exact query with our
//       client secret, so `shop` is not attacker-controlled, and
//   (2) the `state` matched the HttpOnly cookie, binding the callback to the
//       browser/session/account that started the flow.
// The domain therefore decides only WHICH store's token we exchange, never
// WHOSE account it lands in. It still must be a canonical, validated host — the
// value is interpolated into provider URLs (SSRF guard), so an unparsable
// domain is a hard rejection, not a warning.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.1, §10
// ============================================================

import type { ShopProvider } from './provider';

/** The provider surface this reconciliation needs — keeps tests trivial. */
type DomainAwareProvider = Pick<
  ShopProvider,
  'requiresShopDomain' | 'normalizeShopDomain'
>;

export type CallbackShopResolution =
  | {
      ok: true;
      /** Domain to exchange the token against; null for domain-less providers. */
      shopDomain: string | null;
      /** True when the provider reported a different domain than we started with. */
      canonicalized: boolean;
    }
  | { ok: false };

/**
 * Decide which shop domain to complete the connection with.
 *
 * @param provider the provider that owns the flow
 * @param callbackShop raw `shop` value from the (already authenticated) callback
 * @param startedWith normalized domain stored in the OAuth cookie by /connect
 * @returns the domain to use, or `{ ok: false }` when the callback's domain
 *          isn't a valid host for this provider
 */
export function resolveCallbackShopDomain(
  provider: DomainAwareProvider,
  callbackShop: string,
  startedWith: string | null,
): CallbackShopResolution {
  // Domain-less providers (no shop host in their flow) have nothing to compare.
  if (!provider.requiresShopDomain) {
    return { ok: true, shopDomain: startedWith, canonicalized: false };
  }

  const normalized = provider.normalizeShopDomain(callbackShop);
  if (!normalized) return { ok: false };

  return { ok: true, shopDomain: normalized, canonicalized: normalized !== startedWith };
}
