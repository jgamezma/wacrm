// ============================================================
// Shop connector — public origin resolution (SGC & IdeasLab fork).
//
// The OAuth callback finishes with a browser redirect back to Settings, so it
// needs the origin the *user* reached us on — not the address the Node server
// happens to be bound to. Behind a reverse proxy (EasyPanel/Traefik, nginx,
// Hostinger) `request.url` can carry the container's bind address, which is how
// a callback ended up redirecting to `https://0.0.0.0:80/settings`.
//
// Resolution order mirrors the invite-link helper in
// `src/app/api/account/invitations/route.ts` so operators only have one env var
// to learn: `NEXT_PUBLIC_SITE_URL` wins, then proxy headers, then the Host
// header, and `request.url` is the last resort.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.1
// ============================================================

/** Hosts that can only ever be a server bind address, never a real origin. */
const BIND_ONLY_HOSTNAMES = new Set(['0.0.0.0', '::', '[::]', '']);

function isUsableHost(host: string | undefined): host is string {
  if (!host) return false;
  const hostname = host.split(':')[0].trim().toLowerCase();
  return !BIND_ONLY_HOSTNAMES.has(hostname);
}

function firstHeaderValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)?.split(',')[0]?.trim();
  return value || undefined;
}

/**
 * Resolve the public origin (scheme + host) to build user-facing redirects on.
 *
 * @param request the incoming request, used for proxy/Host headers
 * @returns an origin with no trailing slash, e.g. `https://crm.example.com`
 */
export function resolvePublicOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Malformed config shouldn't break the OAuth return trip — fall through
      // to the request-derived origin, but say so loudly.
      console.warn(
        '[shop] NEXT_PUBLIC_SITE_URL is not a valid URL, ignoring:',
        explicit,
      );
    }
  }

  const forwardedHost = firstHeaderValue(request, 'x-forwarded-host');
  if (isUsableHost(forwardedHost)) {
    const proto = firstHeaderValue(request, 'x-forwarded-proto') || 'https';
    return `${proto}://${forwardedHost}`;
  }

  const requestUrl = new URL(request.url);
  const host = firstHeaderValue(request, 'host');
  if (isUsableHost(host)) {
    return `${requestUrl.protocol}//${host}`;
  }

  // No trustworthy header at all: the bind address is all we have. Warn so the
  // operator sees why the redirect looks wrong and sets NEXT_PUBLIC_SITE_URL.
  console.warn(
    '[shop] could not derive a public origin from the request; set NEXT_PUBLIC_SITE_URL. Falling back to:',
    requestUrl.origin,
  );
  return requestUrl.origin;
}
