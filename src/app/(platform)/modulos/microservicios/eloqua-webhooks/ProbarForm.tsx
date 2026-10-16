"use client";

import { useState } from "react";
import { probarEnvio } from "./actions";
import type { ResultadoExport } from "@/lib/eloqua-webhooks";

const CAMPOS = [
  { name: "utm_excel", label: "ID o URL del Google Sheet", required: true },
  { name: "utm_hoja", label: "Pestaña (vacío = primera)" },
  { name: "dni", label: "DNI" },
  { name: "correo", label: "Correo" },
  { name: "PartyNumber", label: "PartyNumber" },
  { name: "OptyNumber", label: "OptyNumber" },
] as const;

export default function ProbarForm() {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoExport | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setEnviando(true);
    setResultado(null);
    try {
      setResultado(await probarEnvio(data));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CAMPOS.map((c) => (
          <label key={c.name} className="block">
            <span className="text-xs font-semibold text-gray-600">{c.label}</span>
            <input
              name={c.name}
              required={"required" in c && c.required}
              defaultValue={c.name === "dni" ? "PRUEBA" : ""}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={enviando}
        className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Agregar fila de prueba"}
      </button>

      {resultado && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            resultado.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {resultado.ok
            ? `Fila agregada en ${resultado.rango ?? "la hoja"}${resultado.conEncabezados ? " (con encabezados)" : ""}.`
            : resultado.error}
        </div>
      )}
    </form>
  );
}
