// ============================================================
// Shop connector — provider contract (SGC & IdeasLab fork).
//
// A `ShopProvider` is one commerce backend (Shopify today; WooCommerce or
// others later). The connect / callback / status / disconnect routes are
// written ONCE against this interface and never mention a specific provider —
// adding a backend means implementing this contract and registering it, not
// touching the routes or the DB.
//
// The shape is deliberately built around the OAuth authorization-code flow with
// an optional user-supplied shop domain (which fits Shopify and most hosted
// storefronts). It is provisional: revisit the contract when the second
// provider lands if its flow doesn't fit — that's the point at which the right
// abstraction is actually knowable.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7, §8
//       docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.1 (catalog)
// ============================================================

/** Raised by a provider when an OAuth/API step fails. Message is safe to log;
 *  it never contains tokens. */
export class ShopProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopProviderError';
  }
}

/** Inputs for building a provider authorize URL. */
export interface AuthorizeContext {
  /** Opaque CSRF token the route also stores in the OAuth cookie. */
  state: string;
  /** Normalized shop domain — present iff `requiresShopDomain` is true. */
  shopDomain: string | null;
}

/** What a provider returns once a callback has been verified + exchanged. */
export interface CompleteConnectionResult {
  /** Primary credential to persist (encrypted at rest by the caller). */
  accessToken: string;
  /** Granted scopes, for audit / future gating. */
  scopes: string[];
  /** Canonical shop domain, or null for non-domain-scoped providers. */
  shopDomain: string | null;
  /** Human-friendly shop/store name for display, if the provider exposes one. */
  displayName: string | null;
}

// --- Catalog (spec 003) -----------------------------------------------------

/**
 * What a connection can actually do, in terms the agent path understands.
 * Providers map their own scope strings onto these; nothing outside a provider
 * module knows what `read_products` means.
 */
export type ShopCapability = 'products' | 'inventory';

/** A product in the shape the cache, retrieval, prompt, and send all use. */
export interface NormalizedProduct {
  externalId: string;
  handle: string | null;
  title: string;
  /** Plain text — providers strip their own markup before returning. */
  description: string | null;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  status: 'active' | 'draft' | 'archived';
  /** Public https URL, or null. Only sync ever produces this value. */
  imageUrl: string | null;
  variants: NormalizedVariant[];
}

/** One purchasable variant (SKU / size grain) of a `NormalizedProduct`. */
export interface NormalizedVariant {
  externalId: string;
  title: string | null;
  sku: string | null;
  /** Decimal string (money — never a float), or null when unpriced. */
  price: string | null;
  currency: string | null;
  /** NULL/undefined-safe: null means "unknown", not "zero". */
  inventoryQuantity: number | null;
  inventoryTracked: boolean;
  /** In stock yes/no; null when the provider doesn't say. */
  available: boolean | null;
  imageUrl: string | null;
}

/** Credentials + context a provider needs to read the remote catalog. */
export interface CatalogReadContext {
  accessToken: string;
  shopDomain: string | null;
  /** Scopes as stored at connect time — a provider may need them to decide
   *  which fields it is allowed to ask the remote API for. */
  scopes: string[];
}

/** One variant's live stock, as returned by `refreshInventory`. */
export interface VariantInventory {
  externalId: string;
  inventoryQuantity: number | null;
  available: boolean | null;
}

/** One commerce backend the shop connector can link to. */
export interface ShopProvider {
  /** Stable machine id persisted in `shop_connections.provider`, e.g. 'shopify'. */
  readonly id: string;
  /** Human label for the UI, e.g. 'Shopify'. */
  readonly label: string;
  /** Whether connecting requires the user to type a shop/site domain first. */
  readonly requiresShopDomain: boolean;

  /** True iff this provider's server credentials are all present in env. */
  isConfigured(): boolean;

  /**
   * Validate + normalize a user-entered shop domain to its canonical form, or
   * return null if it can't be valid. Only meaningful when
   * `requiresShopDomain` is true; domain-less providers return the input's
   * emptiness as null / a fixed value.
   */
  normalizeShopDomain(input: string): string | null;

  /** Build the provider authorize URL to redirect the browser to. */
  buildAuthorizeUrl(ctx: AuthorizeContext): string;

  /**
   * Verify the authenticity of the callback query (e.g. Shopify's HMAC
   * signature). Returns false rather than throwing on any mismatch. Providers
   * with no such mechanism return true and rely on the `state` + cookie match
   * enforced by the route.
   */
  verifyCallback(query: Record<string, string>): boolean;

  /**
   * Exchange a verified callback for a credential + shop metadata. `shopDomain`
   * is the canonical, validated host the route resolved for this callback —
   * normally the one the provider itself reported (see `callback-shop.ts`).
   */
  completeConnection(input: {
    query: Record<string, string>;
    shopDomain: string | null;
  }): Promise<CompleteConnectionResult>;

  /**
   * Map this provider's stored scope strings onto generic capabilities. This is
   * the ONLY place a provider's scope vocabulary is interpreted; everything
   * else branches on `products` / `inventory`.
   */
  capabilities(scopes: string[]): Set<ShopCapability>;

  /**
   * Page the remote catalog into the normalised shape. Yields products so the
   * caller can persist incrementally instead of buffering a whole catalog in
   * memory; the caller owns persistence, dedupe, and deletion of stale rows.
   *
   * Throws `ShopProviderError` on a remote failure — sync records the reason.
   */
  listCatalog(ctx: CatalogReadContext): AsyncIterable<NormalizedProduct>;

  /**
   * Optional live stock refresh for a small set of variant external ids, used
   * right before a reply goes out so "we have 4" isn't stale. Providers without
   * a cheap inventory API omit it and sync-time quantities stand. Callers must
   * not invoke it unless the connection has the `inventory` capability.
   */
  refreshInventory?(
    input: CatalogReadContext & { variantExternalIds: string[] },
  ): Promise<VariantInventory[]>;
}

/** Safe descriptor of a provider for the client (no secrets). */
export interface ShopProviderInfo {
  id: string;
  label: string;
  requiresShopDomain: boolean;
}

/** Project a provider to its client-safe descriptor. */
export function toProviderInfo(p: ShopProvider): ShopProviderInfo {
  return { id: p.id, label: p.label, requiresShopDomain: p.requiresShopDomain };
}
