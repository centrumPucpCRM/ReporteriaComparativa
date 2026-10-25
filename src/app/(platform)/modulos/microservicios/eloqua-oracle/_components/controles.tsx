"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AMBIENTES, type Ambiente } from "@/lib/eloqua-oracle";
import { cambiarAmbiente } from "../actions";

type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

export function AmbienteSelector({ actual }: { actual: Ambiente }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ambiente</span>
      <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
        {AMBIENTES.map((a) => (
          <button
            key={a.id}
            disabled={pendiente}
            onClick={() =>
              startTransition(async () => {
                await cambiarAmbiente(a.id);
                router.refresh();
              })
            }
            className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-60 ${
              actual === a.id
                ? a.id === "prod"
                  ? "bg-violet-600 text-white"
                  : a.id === "test"
                    ? "bg-amber-500 text-white"
                    : "bg-gray-700 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IrADemo() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  return (
    <button
      disabled={pendiente}
      onClick={() =>
        startTransition(async () => {
          await cambiarAmbiente("demo");
          router.refresh();
        })
      }
      className="shrink-0 rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-60"
    >
      {pendiente ? "Cambiando…" : "Ver en Demo"}
    </button>
  );
}

/** Botón que ejecuta una server action (ya enlazada con sus argumentos) y muestra el resultado. */
export function BotonAccion({
  accion,
  label,
  confirmar,
  variante = "primario",
}: {
  accion: () => Promise<Resultado>;
  label: string;
  confirmar?: string;
  variante?: "primario" | "secundario" | "peligro";
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [msg, setMsg] = useState<Resultado | null>(null);
  const estilos = {
    primario: "bg-violet-600 text-white hover:bg-violet-700",
    secundario: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    peligro: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        disabled={pendiente}
        onClick={() => {
          if (confirmar && !window.confirm(confirmar)) return;
          startTransition(async () => {
            const r = await accion();
            setMsg(r);
            if (r.ok) router.refresh();
          });
        }}
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${estilos[variante]}`}
      >
        {pendiente ? "Procesando…" : label}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.ok ? msg.mensaje : msg.error}</span>}
    </span>
  );
}
