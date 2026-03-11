import { createBrowserClient } from "@supabase/ssr";

function readEnvValue(name: string): string {
  const raw = (process.env[name] || "").trim();

  // Handle accidental pastes like: NEXT_PUBLIC_SUPABASE_URL=https://...
  const value = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;

  // Remove wrapping quotes if present.
  const unquoted = value.replace(/^['"]|['"]$/g, "");
  return unquoted;
}

export function createClient() {
  const supabaseUrl = readEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = readEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey
  );
}
