"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function urlErrorMessage(code: string | null): string | null {
  if (code === "link_expired") return "El link expiró o ya fue usado. Pedí uno nuevo.";
  if (code === "cross_browser")
    return "El link debe abrirse en el mismo navegador donde lo solicitaste. Pedí uno nuevo y abrilo desde acá.";
  return null;
}

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const error = formError ?? urlErrorMessage(searchParams.get("error"));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setLoading(true);

    const supabase = createClient();
    // redirectTo se ignora si el template usa {{ .TokenHash }}, pero lo mandamos
    // como fallback por si el template todavía usa {{ .ConfirmationURL }}.
    const redirectTo = `${window.location.origin}/auth/callback?next=/auth/reset`;
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (authError) {
      setFormError("No pudimos enviar el correo. Intentá nuevamente.");
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-800">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Restablecer contraseña
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Te enviaremos un enlace para crear una nueva contraseña.
        </p>

        {sent ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              Si existe una cuenta con ese correo, te enviamos el enlace. Revisá tu
              bandeja de entrada (y spam).
            </p>
            <Link
              href="/login"
              className="text-center text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
            >
              Volver al login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="email"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {loading ? "Enviando..." : "Enviar enlace"}
            </button>

            <Link
              href="/login"
              className="text-center text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
            >
              Volver al login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando...</p>
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
