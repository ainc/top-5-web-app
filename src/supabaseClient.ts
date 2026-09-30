// One browser client for the whole app.
// Vite only exposes env vars that start with VITE_, so the publishable key is
// named that way in .env. The service role and database URL stay in .env.local
// and never reach this file. There is no custom API server: supabase-js calls
// PostgREST in the browser, and Row Level Security is what limits those calls.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Add them to .env and restart Vite.");
  }
  client = createClient(url, key);
  return client;
}
