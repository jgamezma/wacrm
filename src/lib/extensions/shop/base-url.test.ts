import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvePublicOrigin } from './base-url';

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resolvePublicOrigin', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over anything on the request', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    const origin = resolvePublicOrigin(
      req('https://0.0.0.0:80/api/extensions/shop/callback', {
        host: '0.0.0.0:80',
      }),
    );
    expect(origin).toBe('https://crm.example.com');
  });

  it('falls back to proxy headers when no env is set', () => {
    const origin = resolvePublicOrigin(
      req('http://0.0.0.0:80/api/extensions/shop/callback', {
        host: '0.0.0.0:80',
        'x-forwarded-host': 'crm.example.com, internal.local',
        'x-forwarded-proto': 'https, http',
      }),
    );
    expect(origin).toBe('https://crm.example.com');
  });

  it('uses the Host header when no proxy headers are present', () => {
    const origin = resolvePublicOrigin(
      req('https://internal:3000/api/extensions/shop/callback', {
        host: 'crm.example.com',
      }),
    );
    expect(origin).toBe('https://crm.example.com');
  });

  it('ignores a bind-address Host and warns instead of inventing a host', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origin = resolvePublicOrigin(
      req('https://0.0.0.0:80/api/extensions/shop/callback', {
        host: '0.0.0.0:80',
      }),
    );
    expect(origin).toBe('https://0.0.0.0:80');
    expect(warn).toHaveBeenCalled();
  });

  it('ignores a malformed NEXT_PUBLIC_SITE_URL and uses the request', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not-a-url');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origin = resolvePublicOrigin(
      req('https://internal:3000/x', { host: 'crm.example.com' }),
    );
    expect(origin).toBe('https://crm.example.com');
    expect(warn).toHaveBeenCalled();
  });
});
