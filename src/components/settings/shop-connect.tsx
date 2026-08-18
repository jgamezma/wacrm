'use client';

// ============================================================
// Settings → Shop panel (SGC & IdeasLab fork).
//
// Provider-agnostic connector UI: pick a backend (Shopify today; more later),
// enter a shop domain when that backend needs one, and connect. Connect is a
// top-level navigation to the connect route (which 302s to the provider) — not
// a fetch, so the cross-origin redirect isn't blocked. The callback route
// redirects back here with `?result=` which we turn into a toast and strip.
//
// It also owns the catalog surface spec 003 adds: what this connection can
// actually read (capabilities, derived server-side from the stored scopes), how
// much catalog is cached, when it was last synced, a manual Sync, and the
// Reconnect prompt when the granted access is narrower than the app now asks for.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §8
//       docs/extensions/specs/003-shop-catalog-agent-knowledge.md §8, US-5
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Package,
  Plug,
  RefreshCw,
  Store,
  Unplug,
  XCircle,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

interface ProviderInfo {
  id: string;
  label: string;
  requiresShopDomain: boolean;
}

interface ShopStatus {
  connected: boolean;
  provider: string | null;
  shop_domain: string | null;
  display_name: string | null;
  connected_at: string | null;
  configured: boolean;
  providers: ProviderInfo[];
  /** Generic flags — 'products' | 'inventory'. Provider-blind by design. */
  capabilities: string[];
  scopes: string[];
  catalog_synced_at: string | null;
  catalog_sync_error: string | null;
  product_count: number;
}

export function ShopConnect() {
  const t = useTranslations('Settings.shop');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountRole, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [shopInput, setShopInput] = useState('');

  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const providers = useMemo(() => status?.providers ?? [], [status]);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/extensions/shop/status', { method: 'GET' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as ShopStatus;
      setStatus(data);
      // Default the picker to the first configured provider.
      setProviderId((prev) => prev || data.providers[0]?.id || '');
    } catch (err) {
      console.error('Failed to load shop status:', err);
      toast.error(t('loadError'));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    fetchStatus();
  }, [authLoading, profileLoading, fetchStatus]);

  // Turn the callback's `?result=` outcome into a toast, then strip it so a
  // refresh doesn't re-fire. Guarded so it runs once per outcome value.
  const handledOutcome = useRef<string | null>(null);
  useEffect(() => {
    const outcome = searchParams.get('result');
    if (!outcome || handledOutcome.current === outcome) return;
    handledOutcome.current = outcome;

    if (outcome === 'connected') toast.success(t('connectedToast'));
    else if (outcome === 'denied') toast.error(t('deniedToast'));
    else if (outcome === 'error') toast.error(t('errorToast'));

    const params = new URLSearchParams(searchParams.toString());
    params.delete('result');
    params.set('tab', 'shop');
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  }, [searchParams, router, t]);

  const selectedProvider = providers.find((p) => p.id === providerId) ?? null;

  function handleConnect() {
    if (!selectedProvider) return;
    const qs = new URLSearchParams({ provider: selectedProvider.id });
    if (selectedProvider.requiresShopDomain) {
      const shop = shopInput.trim();
      if (!shop) {
        toast.error(t('domainRequired'));
        return;
      }
      qs.set('shop', shop);
    }
    // Full-page navigation — the route validates input and 302s to the
    // provider's authorize page. The server is the source of truth.
    window.location.href = `/api/extensions/shop/connect?${qs.toString()}`;
  }

  // Pull the catalog now. The route answers with the same shape whether it
  // worked or not, so both branches read `product_count` / `error`.
  async function handleSyncCatalog() {
    try {
      setSyncing(true);
      const res = await fetch('/api/extensions/shop/catalog/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(t('syncFailed', { reason: data.error || `HTTP ${res.status}` }));
      } else {
        toast.success(t('syncSuccess', { count: data.product_count ?? 0 }));
      }
      await fetchStatus();
    } catch (err) {
      console.error('Catalog sync error:', err);
      toast.error(t('syncFailed', { reason: 'network error' }));
    } finally {
      setSyncing(false);
    }
  }

  // Re-run the provider's OAuth to widen granted access (US-5). Same top-level
  // navigation as the first connect, pre-filled with the connected shop.
  function handleReconnect() {
    if (!status?.provider) return;
    const qs = new URLSearchParams({ provider: status.provider });
    if (status.shop_domain) qs.set('shop', status.shop_domain);
    window.location.href = `/api/extensions/shop/connect?${qs.toString()}`;
  }

  async function handleDisconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    try {
      setDisconnecting(true);
      const res = await fetch('/api/extensions/shop/disconnect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('disconnectError'));
        return;
      }
      toast.success(t('disconnectedToast'));
      await fetchStatus();
    } catch (err) {
      console.error('Disconnect error:', err);
      toast.error(t('disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const connectedProviderLabel =
    providers.find((p) => p.id === status?.provider)?.label ?? status?.provider ?? '';
  const capabilities = status?.capabilities ?? [];
  const hasProducts = capabilities.includes('products');
  const hasInventory = capabilities.includes('inventory');
  const lastSync = status?.catalog_synced_at
    ? new Date(status.catalog_synced_at).toLocaleString()
    : null;

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="max-w-2xl space-y-6">
        {/* No provider configured on the server — nothing can connect yet. */}
        {!configured && (
          <Alert className="bg-amber-950/30 border-amber-700/50">
            <AlertTitle className="text-amber-200">{t('notConfiguredTitle')}</AlertTitle>
            <AlertDescription className="text-amber-100/80 text-sm">
              {t('notConfiguredDesc')}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="size-5 text-primary" />
              <CardTitle className="text-foreground">{t('cardTitle')}</CardTitle>
            </div>
            <CardDescription className="text-muted-foreground">
              {t('cardDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status line */}
            <div className="flex items-center gap-2">
              {connected ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-foreground">
                {connected ? t('statusConnected') : t('statusNotConnected')}
              </span>
            </div>

            {connected && (
              <p className="text-sm text-muted-foreground">
                {t('connectedVia', {
                  name: status?.display_name || status?.shop_domain || '',
                  provider: connectedProviderLabel,
                })}
              </p>
            )}

            {/* Connect form — only when disconnected and a provider exists. */}
            {!connected && configured && (
              <div className="space-y-4">
                {/* Provider picker — shown only when there's a choice. */}
                {providers.length > 1 && (
                  <div className="space-y-2">
                    <Label htmlFor="shop-provider" className="text-muted-foreground">
                      {t('providerLabel')}
                    </Label>
                    <select
                      id="shop-provider"
                      value={providerId}
                      onChange={(e) => setProviderId(e.target.value)}
                      disabled={!canEdit}
                      className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedProvider?.requiresShopDomain && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('shopDomainLabel')}</Label>
                    <Input
                      placeholder="acme.myshopify.com"
                      value={shopInput}
                      onChange={(e) => setShopInput(e.target.value)}
                      disabled={!canEdit}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">{t('shopDomainHint')}</p>
                  </div>
                )}
              </div>
            )}

            {!canEdit && (
              <p className="text-xs text-muted-foreground">{t('adminOnly')}</p>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              {connected ? (
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={!canEdit || disconnecting}
                  className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                >
                  {disconnecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t('disconnecting')}
                    </>
                  ) : (
                    <>
                      <Unplug className="size-4" />
                      {t('disconnect')}
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleConnect}
                  disabled={!canEdit || !configured || !selectedProvider}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Plug className="size-4" />
                  {t('connect')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Catalog — only meaningful once a shop is linked. */}
        {connected && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package className="size-5 text-primary" />
                <CardTitle className="text-foreground">{t('catalogTitle')}</CardTitle>
              </div>
              <CardDescription className="text-muted-foreground">
                {t('catalogDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* What this connection may read. Capability flags, not scope
                  names — the provider decides how its scopes map. */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t('capabilitiesLabel')}
                </p>
                <div className="flex flex-wrap gap-4">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {hasProducts ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <XCircle className="size-4 text-muted-foreground" />
                    )}
                    {t('capProducts')}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {hasInventory ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <XCircle className="size-4 text-muted-foreground" />
                    )}
                    {t('capInventory')}
                  </span>
                </div>
                {status?.scopes && status.scopes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('scopesLabel', { scopes: status.scopes.join(', ') })}
                  </p>
                )}
              </div>

              {/* Missing access is a reconnect, never a silent retry: stored
                  credentials cannot gain scopes they were not granted (US-5). */}
              {!hasInventory && (
                <Alert className="bg-amber-950/30 border-amber-700/50">
                  <AlertTitle className="text-amber-200">
                    {t('reconnectTitle')}
                  </AlertTitle>
                  <AlertDescription className="text-amber-100/80 text-sm">
                    {t('reconnectDesc')}
                  </AlertDescription>
                </Alert>
              )}

              {status?.catalog_sync_error && (
                <Alert className="bg-red-950/30 border-red-800/50">
                  <AlertTitle className="text-red-200">{t('syncErrorTitle')}</AlertTitle>
                  <AlertDescription className="text-red-100/80 text-sm">
                    {status.catalog_sync_error}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-1 text-sm text-muted-foreground">
                <p>{t('productsCached', { count: status?.product_count ?? 0 })}</p>
                <p>{lastSync ? t('lastSync', { when: lastSync }) : t('neverSynced')}</p>
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  variant="outline"
                  onClick={handleSyncCatalog}
                  disabled={!canEdit || syncing}
                  className="border-border"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t('syncing')}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="size-4" />
                      {t('syncNow')}
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleReconnect}
                  disabled={!canEdit}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Plug className="size-4" />
                  {t('reconnect')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
