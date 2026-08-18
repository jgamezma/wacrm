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
// leaks into the generic routes/registry. That now includes the CATALOG surface
// (spec 003): the scope→capability map, the Admin GraphQL queries, and the
// mapping of Shopify's product/variant shape onto `NormalizedProduct`.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7, §10
//       docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.1, §14
// ============================================================

import crypto from 'crypto';

import {
  ShopProviderError,
  type AuthorizeContext,
  type CatalogReadContext,
  type CompleteConnectionResult,
  type NormalizedProduct,
  type NormalizedVariant,
  type ShopCapability,
  type ShopProvider,
  type VariantInventory,
} from '../provider';

// --- Shopify config (env-driven) --------------------------------------------

/** Shopify Admin API version used for the shop-info lookup and the catalog
 *  GraphQL queries. Pin it so a future Shopify version bump is a deliberate
 *  one-line change, not silent drift. */
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

// --- Catalog: scopes → capabilities -----------------------------------------

/**
 * Shopify scope → generic capability. `write_*` implies the matching `read_*`
 * in Shopify's model, so both count. This map is the ONLY place these scope
 * names appear outside the OAuth request itself (spec 003 §14).
 */
const SCOPE_CAPABILITIES: Record<string, ShopCapability> = {
  read_products: 'products',
  write_products: 'products',
  read_product_listings: 'products',
  read_inventory: 'inventory',
  write_inventory: 'inventory',
};

/** Map stored Shopify scopes onto the capabilities the agent path understands. */
export function shopifyCapabilities(scopes: string[]): Set<ShopCapability> {
  const out = new Set<ShopCapability>();
  for (const raw of scopes) {
    const cap = SCOPE_CAPABILITIES[raw.trim().toLowerCase()];
    if (cap) out.add(cap);
  }
  return out;
}

// --- Catalog: Admin GraphQL --------------------------------------------------

/** Products per GraphQL page. Conservative: Shopify's cost-based rate limiter
 *  charges for nested variant connections, and a smaller page is cheaper to
 *  retry than a rejected big one. */
const CATALOG_PAGE_SIZE = 25;

/** Variants fetched per product. Beyond this a product is a configurator, not
 *  something a WhatsApp reply can usefully enumerate. */
const VARIANTS_PER_PRODUCT = 50;

/** Hard stop on paging so a huge catalog can't turn one sync into an unbounded
 *  job. Truncation is logged, never silent. */
const MAX_CATALOG_PAGES = 100;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

/**
 * Run one Admin GraphQL query. Throws `ShopProviderError` on transport failure
 * or a GraphQL-level error (the message is Shopify's, which is safe to log —
 * the access token never appears in it).
 */
async function shopifyGraphQL<T>(
  ctx: CatalogReadContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const shop = ctx.shopDomain ?? '';
  // Re-validate here even though the caller has: this host goes straight into a
  // URL, and this module is the one that owns that invariant.
  if (!isValidShopDomain(shop)) {
    throw new ShopProviderError('Refusing to query an invalid Shopify shop domain');
  }

  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ctx.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) {
    throw new ShopProviderError(`Shopify GraphQL failed (${res.status})`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    const first = body.errors[0]?.message ?? 'unknown error';
    throw new ShopProviderError(`Shopify GraphQL error: ${first}`);
  }
  if (!body.data) throw new ShopProviderError('Shopify GraphQL returned no data');
  return body.data;
}

/**
 * Build the catalog page query. Inventory fields are included ONLY when the
 * connection was granted inventory access: asking for `inventoryQuantity`
 * without `read_inventory` makes Shopify reject the whole query, so a
 * products-only connection must not request them at all.
 */
export function buildCatalogQuery(hasInventory: boolean): string {
  const inventoryFields = hasInventory
    ? `
              inventoryQuantity
              inventoryItem { tracked }`
    : '';
  return `
    query CatalogPage($cursor: String) {
      shop { currencyCode }
      products(first: ${CATALOG_PAGE_SIZE}, after: $cursor, sortKey: ID) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            handle
            title
            description
            productType
            vendor
            tags
            status
            featuredImage { url }
            variants(first: ${VARIANTS_PER_PRODUCT}) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  availableForSale${inventoryFields}
                  image { url }
                }
              }
            }
          }
        }
      }
    }
  `;
}

interface ShopifyVariantNode {
  id: string;
  title?: string | null;
  sku?: string | null;
  price?: string | null;
  availableForSale?: boolean | null;
  inventoryQuantity?: number | null;
  inventoryItem?: { tracked?: boolean | null } | null;
  image?: { url?: string | null } | null;
}

interface ShopifyProductNode {
  id: string;
  handle?: string | null;
  title?: string | null;
  description?: string | null;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[] | null;
  status?: string | null;
  featuredImage?: { url?: string | null } | null;
  variants?: { edges?: Array<{ node: ShopifyVariantNode }> } | null;
}

interface CatalogPageData {
  shop?: { currencyCode?: string | null } | null;
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
    edges?: Array<{ node: ShopifyProductNode }> | null;
  } | null;
}

/** Keep only public https URLs — Meta has to fetch these, and a non-https or
 *  otherwise odd value is never worth persisting (spec 003 §10). */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Map Shopify's PRODUCT status enum onto the normalised set. */
function normalizeStatus(status: string | null | undefined): NormalizedProduct['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'active';
    case 'ARCHIVED':
      return 'archived';
    default:
      // DRAFT, or anything Shopify adds later: treat as not-publishable, which
      // keeps it out of agent retrieval.
      return 'draft';
  }
}

/** Map one Shopify product node (+ its variants) onto `NormalizedProduct`. */
export function toNormalizedProduct(
  node: ShopifyProductNode,
  currency: string | null,
): NormalizedProduct {
  const variants: NormalizedVariant[] = (node.variants?.edges ?? []).map(
    ({ node: v }) => ({
      externalId: v.id,
      title: v.title ?? null,
      sku: v.sku ?? null,
      price: v.price ?? null,
      currency,
      // `undefined` (field not requested — no inventory capability) and an
      // explicit null both mean "unknown", never zero.
      inventoryQuantity:
        typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : null,
      inventoryTracked: v.inventoryItem?.tracked === true,
      available: typeof v.availableForSale === 'boolean' ? v.availableForSale : null,
      imageUrl: safeImageUrl(v.image?.url),
    }),
  );

  return {
    externalId: node.id,
    handle: node.handle ?? null,
    title: node.title?.trim() || '(untitled)',
    // `description` is Shopify's plain-text field (`descriptionHtml` is the
    // markup one), so nothing needs stripping here.
    description: node.description?.trim() || null,
    productType: node.productType?.trim() || null,
    vendor: node.vendor?.trim() || null,
    tags: (node.tags ?? []).filter((t) => typeof t === 'string' && t.trim()),
    status: normalizeStatus(node.status),
    imageUrl: safeImageUrl(node.featuredImage?.url),
    variants,
  };
}

/**
 * Page the shop's products, yielding normalised products as they arrive.
 *
 * Async generator, not an array: a catalog can be thousands of products, and
 * the sync orchestrator persists each page instead of holding the whole thing.
 */
export async function* listShopifyCatalog(
  ctx: CatalogReadContext,
): AsyncGenerator<NormalizedProduct> {
  const hasInventory = shopifyCapabilities(ctx.scopes).has('inventory');
  const query = buildCatalogQuery(hasInventory);

  let cursor: string | null = null;
  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    const data: CatalogPageData = await shopifyGraphQL<CatalogPageData>(ctx, query, {
      cursor,
    });
    const currency = data.shop?.currencyCode ?? null;
    const edges = data.products?.edges ?? [];

    for (const edge of edges) {
      yield toNormalizedProduct(edge.node, currency);
    }

    const pageInfo = data.products?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) return;
    cursor = pageInfo.endCursor;
  }

  console.warn(
    `[shop shopify] catalog paging stopped at ${MAX_CATALOG_PAGES} pages (${
      MAX_CATALOG_PAGES * CATALOG_PAGE_SIZE
    } products); the rest of the catalog was not synced.`,
  );
}

interface VariantStockData {
  nodes?: Array<{
    id?: string;
    inventoryQuantity?: number | null;
    availableForSale?: boolean | null;
  } | null> | null;
}

const VARIANT_STOCK_QUERY = `
  query VariantStock($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        inventoryQuantity
        availableForSale
      }
    }
  }
`;

/**
 * Live stock for a handful of variants, by Shopify GID. Only ever called when
 * the connection has the `inventory` capability (the generic caller enforces
 * that), because `inventoryQuantity` needs `read_inventory`.
 */
export async function refreshShopifyInventory(
  input: CatalogReadContext & { variantExternalIds: string[] },
): Promise<VariantInventory[]> {
  const ids = input.variantExternalIds.filter(Boolean);
  if (ids.length === 0) return [];

  const data = await shopifyGraphQL<VariantStockData>(input, VARIANT_STOCK_QUERY, {
    ids,
  });
  const out: VariantInventory[] = [];
  for (const node of data.nodes ?? []) {
    if (!node?.id) continue;
    out.push({
      externalId: node.id,
      inventoryQuantity:
        typeof node.inventoryQuantity === 'number' ? node.inventoryQuantity : null,
      available: typeof node.availableForSale === 'boolean' ? node.availableForSale : null,
    });
  }
  return out;
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

  capabilities: shopifyCapabilities,

  listCatalog(ctx: CatalogReadContext): AsyncIterable<NormalizedProduct> {
    return listShopifyCatalog(ctx);
  },

  refreshInventory: refreshShopifyInventory,
};
