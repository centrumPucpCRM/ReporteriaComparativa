"use client";

import { aCsv, type TipoAusencia } from "@/lib/vacaciones";

/** Etiqueta con el color del tipo de ausencia. */
export function TipoChip({ tipo }: { tipo: TipoAusencia | undefined }) {
  if (!tipo) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tipo.color }} /> {tipo.nombre}
    </span>
  );
}

export function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([aCsv(filas)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function Aviso({ texto, onCerrar }: { texto: string; onCerrar: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      <span>{texto}</span>
      <button onClick={onCerrar} aria-label="Cerrar aviso" className="text-emerald-700 hover:text-emerald-900">
        ✕
      </button>
    </div>
  );
}

export function ErrorCaja({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{children}</div>;
}

export const INPUT =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-500";

export const BOTON_PRIMARIO =
  "inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";

export const BOTON_SECUNDARIO =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60";

export function IconoDescarga() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

export function Flechas({ onAnterior, onSiguiente, etiqueta }: { onAnterior: () => void; onSiguiente: () => void; etiqueta: string }) {
  return (
    <>
      <button onClick={onAnterior} aria-label={`${etiqueta} anterior`} className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button onClick={onSiguiente} aria-label={`${etiqueta} siguiente`} className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </>
  );
}
