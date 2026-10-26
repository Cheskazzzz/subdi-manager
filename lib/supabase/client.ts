import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Add Supabase credentials to .env.local first.");
  return { url, key };
}

export function createClient() {
  const { url, key } = credentials();
  return createBrowserClient(url, key);
}

// Sends password reset emails whose link carries the session itself, so it works on any device
// (the default PKCE link only works in the browser that requested it).
export function createRecoveryClient() {
  const { url, key } = credentials();
  return createSupabaseClient(url, key, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
