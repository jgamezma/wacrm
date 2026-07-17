// ============================================================
// Shop connector — provider registry (SGC & IdeasLab fork).
//
// The single place that knows which providers exist. Adding WooCommerce (or
// any backend) is a two-line change here plus a new file under `providers/` —
// the routes, DB, and UI stay untouched.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §8
// ============================================================

import { toProviderInfo, type ShopProvider, type ShopProviderInfo } from './provider';
import { shopifyProvider } from './providers/shopify';

/** Every known provider, in display order. */
const PROVIDERS: readonly ShopProvider[] = [shopifyProvider];

const BY_ID = new Map<string, ShopProvider>(PROVIDERS.map((p) => [p.id, p]));

/** Resolve a provider by its id, or null if unknown. */
export function getProvider(id: string): ShopProvider | null {
  return BY_ID.get(id) ?? null;
}

/** All providers whose server credentials are configured, as client-safe info. */
export function listConfiguredProviders(): ShopProviderInfo[] {
  return PROVIDERS.filter((p) => p.isConfigured()).map(toProviderInfo);
}

/** True iff at least one provider is configured on this server. */
export function isAnyProviderConfigured(): boolean {
  return PROVIDERS.some((p) => p.isConfigured());
}
