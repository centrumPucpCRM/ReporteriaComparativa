import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function readEnvValue(name: string): string {
  const raw = (process.env[name] || "").trim();
  const value = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;
  return value.replace(/^['"]|['"]$/g, "");
}

// Cliente admin (service role). Bypasea RLS — usar SOLO en server-side
// y nunca exponer la key al cliente.
export function createAdminClient() {
  const supabaseUrl = readEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnvValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan variables NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY para el cliente admin."
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
