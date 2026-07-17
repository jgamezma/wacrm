// ============================================================
// Shop connector — shared constants (SGC & IdeasLab fork).
// Spec: docs/extensions/specs/002-shop-inventory-connect.md
// ============================================================

/**
 * Name of the short-lived HttpOnly cookie that carries the OAuth `state` + the
 * chosen provider id + shop domain + originating account across the connect →
 * callback hop. Set by the connect route, read and cleared by the callback
 * route. Provider-agnostic: the callback URL is the same for every provider, so
 * the provider id travels in this cookie.
 */
export const SHOP_OAUTH_COOKIE = 'shop_oauth';
