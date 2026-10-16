"use client";

import { useState } from "react";
import { probarEnvio } from "./actions";
import type { ResultadoExport } from "@/lib/eloqua-webhooks";

const CAMPOS_EJEMPLO = `{
  "dni": "12345678",
  "correo": "prueba@correo.com",
  "PartyNumber": "",
  "OptyNumber": ""
}`;

const INPUT =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500";

export default function ProbarForm() {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoExport | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    let campos: Record<string, unknown>;
    try {
      campos = JSON.parse(String(form.get("campos") || "{}"));
      if (!campos || typeof campos !== "object" || Array.isArray(campos)) throw new Error();
    } catch {
      setResultado({ ok: false, status: 400, error: "Los campos deben ser un objeto JSON válido." });
      return;
    }

    setEnviando(true);
    setResultado(null);
    try {
      setResultado(
        await probarEnvio({ ...campos, utm_excel: form.get("utm_excel"), utm_hoja: form.get("utm_hoja") }),
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">utm_excel · ID o URL del Google Sheet *</span>
          <input name="utm_excel" required className={INPUT} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">utm_hoja · Nombre de la pestaña *</span>
          <input name="utm_hoja" required className={INPUT} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-gray-600">
          Campos opcionales (JSON) · se escriben como columnas en este mismo orden
        </span>
        <textarea name="campos" rows={6} defaultValue={CAMPOS_EJEMPLO} className={`${INPUT} font-mono`} />
      </label>
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
          {resultado.ok ? (
            <>
              Fila agregada en {resultado.rango}
              {resultado.conEncabezados ? " (con encabezados)" : ""}.
              <br />
              Columnas: <b>{resultado.columnas.join(" · ")}</b>
            </>
          ) : (
            resultado.error
          )}
        </div>
      )}
    </form>
  );
}
