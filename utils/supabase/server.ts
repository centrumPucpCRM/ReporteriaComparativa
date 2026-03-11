import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function readEnvValue(name: string): string {
  const raw = (process.env[name] || "").trim();
  const value = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;
  return value.replace(/^['"]|['"]$/g, "");
}

export async function createClient() {
  const cookieStore = await cookies();
  const supabaseUrl = readEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = readEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component no puede setear cookies.
            // El middleware se encarga de refrescar la sesión.
          }
        },
      },
    }
  );
}
