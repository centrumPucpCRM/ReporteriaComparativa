"use client";

import { useState } from "react";

/**
 * Botones de importar / exportar vacaciones. Aún sin funcionalidad: el formato se definirá
 * cuando llegue un archivo de ejemplo del sistema de origen (ver "Sistema de Vacaciones" en CLAUDE.md).
 */

type Accion = "importar" | "exportar";

const TEXTO: Record<Accion, { titulo: string; descripcion: string }> = {
  importar: {
    titulo: "Importar vacaciones",
    descripcion:
      "Aquí podrás cargar el archivo de vacaciones de otro sistema (Excel o CSV) para crear o actualizar los periodos de cada vendedor de una sola vez. El formato se definirá con un archivo de ejemplo de ese sistema.",
  },
  exportar: {
    titulo: "Exportar vacaciones",
    descripcion:
      "Aquí podrás descargar las vacaciones (vendedor, fechas, estado y notas) en un archivo para compartirlas o cargarlas en otro sistema.",
  },
};

export default function ImportarExportar() {
  const [abierto, setAbierto] = useState<Accion | null>(null);

  return (
    <>
      <div className="inline-flex rounded-lg border border-gray-300 bg-white">
        <button
          onClick={() => setAbierto("importar")}
          className="inline-flex items-center gap-2 rounded-l-lg px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Importar
        </button>
        <button
          onClick={() => setAbierto("exportar")}
          className="inline-flex items-center gap-2 rounded-r-lg border-l border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exportar
        </button>
      </div>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAbierto(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900">{TEXTO[abierto].titulo}</h3>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Próximamente</span>
            </div>
            <p className="mt-3 text-sm text-gray-600">{TEXTO[abierto].descripcion}</p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setAbierto(null)}
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
