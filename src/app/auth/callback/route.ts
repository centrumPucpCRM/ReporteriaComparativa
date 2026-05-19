import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  const supabase = await createClient();

  // Cross-browser: token_hash + verifyOtp (no requiere code_verifier en localStorage).
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const dest = next ?? (type === "recovery" ? "/auth/reset" : "/update-password");
      return NextResponse.redirect(`${origin}${dest}`);
    }
    if (type === "recovery") {
      return NextResponse.redirect(`${origin}/auth/forgot?error=link_expired`);
    }
    return NextResponse.redirect(`${origin}/login?error=invalid_invite`);
  }

  // Mismo navegador: code PKCE (invite legacy, magic link, etc.).
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next ?? "/update-password"}`);
    }
    if (next?.startsWith("/auth/reset")) {
      return NextResponse.redirect(`${origin}/auth/forgot?error=cross_browser`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=invalid_invite`);
}
