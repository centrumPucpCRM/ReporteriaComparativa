"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Status = "checking" | "ready" | "success" | "error";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Verifica el token en cuanto monta. Hay 4 caminos posibles porque distintas
  // versiones / configs de Supabase entregan el token en lugares distintos.
  useEffect(() => {
    const supabase = createClient();
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const typeParam = url.searchParams.get("type");
    const code = url.searchParams.get("code");
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    const cleanUrl = () => {
      window.history.replaceState(null, "", "/auth/reset");
    };

    const failWith = (msg: string) => {
      setStatus("error");
      setError(msg);
    };

    async function init() {
      const hasUrlToken =
        (tokenHash && typeParam) || (accessToken && refreshToken) || !!code;

      // CRÍTICO: si el link del email trae token, primero limpiamos cualquier
      // sesión preexistente (cookies del usuario logueado en otro tab del mismo
      // navegador). Sin esto, verifyOtp se "mezcla" con la sesión vieja y
      // updateUser termina apuntando al usuario equivocado o no persistiendo.
      if (hasUrlToken) {
        await supabase.auth.signOut({ scope: "local" });
      }

      // 1) token_hash (cross-browser, recomendado).
      if (tokenHash && typeParam === "recovery") {
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (otpErr) {
          failWith("El enlace es inválido o expiró.");
          return;
        }
        cleanUrl();
        setStatus("ready");
        return;
      }

      // 2) Hash fragment legacy (#access_token=...&refresh_token=...).
      if (accessToken && refreshToken) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessErr) {
          failWith("El enlace es inválido o expiró.");
          return;
        }
        cleanUrl();
        setStatus("ready");
        return;
      }

      // 3) PKCE code (mismo navegador).
      if (code) {
        const { error: codeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (codeErr) {
          failWith("El enlace es inválido o expiró.");
          return;
        }
        cleanUrl();
        setStatus("ready");
        return;
      }

      // 4) Sin token en URL: única vía válida es venir redirigido desde
      //    /auth/callback (que ya hizo verifyOtp server-side y seteó cookies).
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        cleanUrl();
        setStatus("ready");
        return;
      }

      failWith("El enlace es inválido o expiró.");
    }

    init();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updErr } = await supabase.auth.updateUser({ password });

    if (updErr) {
      setError(updErr.message);
      setLoading(false);
      return;
    }
    setStatus("success");
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-800">
        {status === "checking" && (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Verificando enlace...
          </p>
        )}

        {status === "error" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Enlace inválido
            </h1>
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
              {error ?? "No se pudo verificar el enlace."}
            </p>
            <Link
              href="/auth/forgot"
              className="rounded-full bg-zinc-900 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Solicitar un nuevo enlace
            </Link>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Contraseña actualizada
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ya podés ingresar con tu nueva contraseña.
            </p>
            <button
              onClick={() => {
                router.replace("/");
                router.refresh();
              }}
              className="rounded-full bg-zinc-900 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Ir a módulos
            </button>
          </div>
        )}

        {status === "ready" && (
          <>
            <h1 className="mb-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Nueva contraseña
            </h1>
            <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
              Elegí una contraseña para tu cuenta.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Nueva contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-50"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="confirm"
                  className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Confirmar contraseña
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-50"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 rounded-full bg-zinc-900 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {loading ? "Guardando..." : "Guardar contraseña"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
