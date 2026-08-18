// ============================================================
// Service-role client for shop catalog sync (SGC & IdeasLab fork).
//
// Mirrors `src/lib/ai/admin-client.ts` / `src/lib/flows/admin-client.ts`.
// Catalog rows have NO insert/update RLS policy on purpose (migration 9004):
// they are written only by server pull-sync, never accepted from a browser, so
// the writer needs the service role. Reads stay on the caller's RLS client.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _adminClient: SupabaseClient | null = null;

/** Lazy, shared service-role client. Throws only when the env is missing. */
export function shopAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
