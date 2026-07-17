// ============================================================
// Shop connection persistence (SGC & IdeasLab fork).
//
// Reads/writes the `shop_connections` table — provider-agnostic. The primary
// credential is encrypted at rest with the app-wide crypto helper
// (`@/lib/whatsapp/encryption`, AES-256-GCM under ENCRYPTION_KEY) — the same one
// WhatsApp / AI BYO keys use.
//
// The client-facing status payload is produced by a pure mapper
// (`toStatusPayload`) that structurally CANNOT include the token, so a GET can
// never leak ciphertext, let alone plaintext.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §6, §7.2
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';

const TABLE = 'shop_connections';

/** Safe, client-facing connection status. Never carries the token. */
export interface ShopStatus {
  connected: boolean;
  provider: string | null;
  shop_domain: string | null;
  display_name: string | null;
  connected_at: string | null;
}

/** The non-secret columns we select for status. */
interface StatusRow {
  provider: string | null;
  shop_domain: string | null;
  display_name: string | null;
  connected_at: string | null;
}

/**
 * Map a connection row (or its absence) to the safe status payload. Pure — the
 * return type has no token field, so this is the single guarantee that GET
 * responses never expose secrets.
 */
export function toStatusPayload(row: StatusRow | null): ShopStatus {
  if (!row) {
    return {
      connected: false,
      provider: null,
      shop_domain: null,
      display_name: null,
      connected_at: null,
    };
  }
  return {
    connected: true,
    provider: row.provider ?? null,
    shop_domain: row.shop_domain ?? null,
    display_name: row.display_name ?? null,
    connected_at: row.connected_at ?? null,
  };
}

/** Load the account's connection status (safe fields only). */
export async function getConnectionStatus(
  db: SupabaseClient,
  accountId: string,
): Promise<ShopStatus> {
  const { data, error } = await db
    .from(TABLE)
    .select('provider, shop_domain, display_name, connected_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return toStatusPayload(data as StatusRow | null);
}

/** Fields needed to persist a fresh connection after a verified OAuth callback. */
export interface UpsertConnectionInput {
  accountId: string;
  userId: string;
  provider: string;
  shopDomain: string | null;
  displayName: string | null;
  accessToken: string;
  scopes: string[];
}

/**
 * Insert or update the account's connection, encrypting the credential before
 * it touches the database. Keyed on `account_id` (one shop per account, v1).
 */
export async function upsertConnection(
  db: SupabaseClient,
  input: UpsertConnectionInput,
): Promise<void> {
  const { error } = await db.from(TABLE).upsert(
    {
      account_id: input.accountId,
      provider: input.provider,
      shop_domain: input.shopDomain,
      display_name: input.displayName,
      access_token: encrypt(input.accessToken),
      scopes: input.scopes,
      connected_by: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  );
  if (error) throw error;
}

/** Clear the account's connection. Local clear is authoritative — dropping the
 *  row severs the link regardless of whether a provider-side revoke succeeds. */
export async function deleteConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq('account_id', accountId);
  if (error) throw error;
}
