import { createBrowserClient } from "@supabase/ssr";

function sanitizeEnvValue(raw: string, envName: string): string {
  const trimmed = (raw || "").trim();

  // Handle accidental pastes like: NEXT_PUBLIC_SUPABASE_URL=https://...
  const value = trimmed.startsWith(`${envName}=`)
    ? trimmed.slice(envName.length + 1).trim()
    : trimmed;

  // Remove wrapping quotes if present.
  const unquoted = value.replace(/^['"]|['"]$/g, "");
  return unquoted;
}

export function createClient() {
  // Must use static NEXT_PUBLIC references so Next injects values into client bundle.
  const supabaseUrl = sanitizeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    "NEXT_PUBLIC_SUPABASE_URL"
  );
  const supabaseAnonKey = sanitizeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
