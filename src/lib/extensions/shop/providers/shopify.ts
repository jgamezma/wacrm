// ============================================================
// Shop connector — Shopify provider (SGC & IdeasLab fork).
//
// The first `ShopProvider` implementation. Standard Shopify Admin OAuth
// (authorization code, offline token). Shopify does NOT use PKCE; the callback
// is authenticated by an HMAC-SHA256 signature over the query string, keyed by
// the app's client secret — so `verifyCallback` is the security-critical check
// here, alongside the `state` cookie match the route enforces.
//
// Shop-domain validation is equally load-bearing: the shop host is
// interpolated into the authorize URL, the token-exchange URL, and the
// shop-info URL. An unvalidated value would be an SSRF / open-redirect vector,
// so `normalizeShopDomain` rejects anything that isn't a real
// `<shop>.myshopify.com` host BEFORE it reaches a URL.
//
// All Shopify-specific env, endpoints, and crypto live in THIS file — nothing
// leaks into the generic routes/registry.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7, §10
// ============================================================

import crypto from 'crypto';

import {
  ShopProviderError,
  type AuthorizeContext,
  type CompleteConnectionResult,
  type ShopProvider,
} from '../provider';

// --- Shopify config (env-driven) --------------------------------------------

/** Shopify Admin API version used for the shop-info lookup. Pin it so a future
 *  Shopify version bump is a deliberate one-line change, not silent drift. */
const SHOPIFY_API_VERSION = '2024-10';

/** Default OAuth scopes when `SHOPIFY_SCOPES` is unset. Minimal by design. */
const DEFAULT_SHOPIFY_SCOPES = 'read_products';

interface ShopifyEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Comma-joined scope string as Shopify expects it in the authorize URL. */
  scopes: string;
}

function getEnv(): ShopifyEnv | null {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  const scopes = process.env.SHOPIFY_SCOPES?.trim() || DEFAULT_SHOPIFY_SCOPES;
  return { clientId, clientSecret, redirectUri, scopes };
}

function requireEnv(): ShopifyEnv {
  const env = getEnv();
  if (!env) throw new ShopProviderError('Shopify is not configured');
  return env;
}

// --- Shop-domain validation -------------------------------------------------

// A valid myshopify host: starts alphanumeric, then letters/digits/hyphens, and
// ends in exactly ".myshopify.com". Lowercased. No ports, paths, or userinfo.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Normalize user input to a canonical `<shop>.myshopify.com` host, or null. */
export function normalizeShopDomain(input: string): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, ''); // strip scheme
  value = value.split('/')[0]; // strip any path/query
  value = value.split(':')[0]; // drop a stray port
  if (value && !value.includes('.')) {
    value = `${value}.myshopify.com`; // bare handle → full host
  }
  return SHOP_DOMAIN_RE.test(value) ? value : null;
}

/** True iff `domain` is already a canonical, valid myshopify host. */
export function isValidShopDomain(domain: string): boolean {
  return SHOP_DOMAIN_RE.test(domain);
}

// --- HMAC verification ------------------------------------------------------

/**
 * Verify the HMAC-SHA256 signature Shopify appends to the callback query.
 * Message is every param except `hmac`/`signature`, sorted by key and joined
 * `k=v` with `&`; the digest is compared to the `hmac` param in constant time.
 */
export function verifyCallbackHmac(
  query: Record<string, string>,
  clientSecret: string,
): boolean {
  const provided = query.hmac;
  if (!provided) return false;

  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', clientSecret)
    .update(message)
    .digest('hex');

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false; // timingSafeEqual throws on mismatch
  return crypto.timingSafeEqual(a, b);
}

// --- Authorize URL ----------------------------------------------------------

export function buildAuthorizeUrl(env: ShopifyEnv, shop: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    scope: env.scopes,
    redirect_uri: env.redirectUri,
    state,
  });
  // Omitting grant_options[] requests an OFFLINE (non-expiring) access token.
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// --- HTTP: token exchange + shop info ---------------------------------------

async function exchangeCodeForToken(
  env: ShopifyEnv,
  shop: string,
  code: string,
): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code,
    }),
  });
  if (!res.ok) {
    throw new ShopProviderError(`Shopify token exchange failed (${res.status})`);
  }
  return (await res.json()) as { access_token: string; scope: string };
}

async function fetchShopName(shop: string, accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
    { headers: { 'X-Shopify-Access-Token': accessToken } },
  );
  if (!res.ok) {
    throw new ShopProviderError(`Shopify shop-info fetch failed (${res.status})`);
  }
  const data = (await res.json()) as { shop?: { name?: string } };
  return data.shop?.name ?? null;
}

// --- Provider implementation ------------------------------------------------

export const shopifyProvider: ShopProvider = {
  id: 'shopify',
  label: 'Shopify',
  requiresShopDomain: true,

  isConfigured() {
    return getEnv() !== null;
  },

  normalizeShopDomain,

  buildAuthorizeUrl({ state, shopDomain }: AuthorizeContext): string {
    const env = requireEnv();
    if (!shopDomain || !isValidShopDomain(shopDomain)) {
      throw new ShopProviderError('A valid Shopify shop domain is required');
    }
    return buildAuthorizeUrl(env, shopDomain, state);
  },

  verifyCallback(query: Record<string, string>): boolean {
    const env = getEnv();
    if (!env) return false;
    return verifyCallbackHmac(query, env.clientSecret);
  },

  async completeConnection({
    query,
    shopDomain,
  }: {
    query: Record<string, string>;
    shopDomain: string | null;
  }): Promise<CompleteConnectionResult> {
    const env = requireEnv();
    if (!shopDomain || !isValidShopDomain(shopDomain)) {
      throw new ShopProviderError('Refusing to complete connection for invalid shop domain');
    }
    const code = query.code;
    if (!code) throw new ShopProviderError('Missing authorization code');

    const tokens = await exchangeCodeForToken(env, shopDomain, code);
    const name = await fetchShopName(shopDomain, tokens.access_token);

    return {
      accessToken: tokens.access_token,
      scopes: tokens.scope ? tokens.scope.split(',').filter(Boolean) : [],
      shopDomain,
      displayName: name,
    };
  },
};
