"use client";

import { useState } from "react";
import { ESTADO_LABEL, contarDias, hoyLima } from "@/lib/vacaciones";
import { obtenerMovimientos } from "../actions";
import { IconoDescarga, descargarCsv } from "./comun";

/**
 * Importar: aún sin funcionalidad; el formato se definirá cuando llegue un archivo de ejemplo
 * del sistema de origen (ver "Sistema de Vacaciones" en CLAUDE.md).
 * Exportar: descarga en CSV las ausencias del año en curso (para otros rangos, ver Movimientos).
 */
export default function ImportarExportar() {
  const [abierto, setAbierto] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportar() {
    const anio = hoyLima().slice(0, 4);
    setExportando(true);
    setError(null);
    const r = await obtenerMovimientos({ desde: `${anio}-01-01`, hasta: `${anio}-12-31` });
    setExportando(false);
    if (!r.ok) return setError(r.error);
    const tipos = new Map(r.data.tipos.map((t) => [t.id, t]));
    descargarCsv(`vacaciones-${anio}.csv`, [
      ["Vendedor", "Party Number", "Correo", "Tipo", "Desde", "Hasta", "Días", "Estado", "Nota"],
      ...r.data.periodos.map((p) => {
        const tipo = tipos.get(p.tipoId);
        return [
          p.vendedorNombre,
          p.partyNumber,
          p.vendedorCorreo,
          tipo?.nombre ?? "",
          p.fechaInicio,
          p.fechaFin,
          p.estado === "CANCELADA" ? 0 : contarDias(p.fechaInicio, p.fechaFin, tipo?.conteo ?? "CALENDARIO", r.data.jornada),
          ESTADO_LABEL[p.estado],
          p.nota,
        ];
      }),
    ]);
  }

  return (
    <>
      <div className="inline-flex rounded-lg border border-gray-300 bg-white">
        <button
          onClick={() => setAbierto(true)}
          className="inline-flex items-center gap-2 rounded-l-lg px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Importar
        </button>
        <button
          onClick={() => void exportar()}
          disabled={exportando}
          title="Descargar en CSV las ausencias de este año"
          className="inline-flex items-center gap-2 rounded-r-lg border-l border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <IconoDescarga />
          {exportando ? "Exportando…" : "Exportar"}
        </button>
      </div>

      {(abierto || error) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {error ? (
              <>
                <h3 className="text-lg font-bold text-gray-900">No se pudo exportar</h3>
                <p className="mt-3 text-sm text-red-700">{error}</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900">Importar vacaciones</h3>
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Próximamente</span>
                </div>
                <p className="mt-3 text-sm text-gray-600">
                  Aquí podrás cargar el archivo de vacaciones de otro sistema (Excel o CSV) para crear o actualizar los periodos de
                  cada vendedor de una sola vez. El formato se definirá con un archivo de ejemplo de ese sistema.
                </p>
              </>
            )}
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setAbierto(false);
                  setError(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
