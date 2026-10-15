"use client";

import type { ReactNode } from "react";
import Papa from "papaparse";

const BADGE_COLORS = {
  gray: "bg-gray-100 text-gray-700",
  emerald: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-800",
  sky: "bg-sky-100 text-sky-800",
} as const;

export type BadgeColor = keyof typeof BADGE_COLORS;

export function Badge({ color, children }: { color: BadgeColor; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_COLORS[color]}`}
    >
      {children}
    </span>
  );
}

export function descargarCsv(nombre: string, filas: Record<string, unknown>[]) {
  // BOM para que Excel abra bien las tildes.
  const blob = new Blob(["﻿" + Papa.unparse(filas)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

/** Barra apilada: verde = enviados, rojo = error, ámbar = sin confirmar. */
export function BarraProgreso({
  total,
  ok,
  error,
  sinConfirmar = 0,
  alto = "h-2",
}: {
  total: number;
  ok: number;
  error: number;
  sinConfirmar?: number;
  alto?: string;
}) {
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-gray-100 ${alto}`}>
      <div className="bg-emerald-500 transition-all" style={{ width: pct(ok) }} />
      <div className="bg-red-500 transition-all" style={{ width: pct(error) }} />
      <div className="bg-amber-400 transition-all" style={{ width: pct(sinConfirmar) }} />
    </div>
  );
}

/**
 * Sin actividad por más de este tiempo, un broadcast EN_CURSO se considera
 * detenido (se cerró la pestaña que lo enviaba). Cada lote toca `updated_at`.
 */
const INACTIVO_MS = 2 * 60 * 1000;

export function estaActivo(b: { estado: string; updated_at: string }): boolean {
  return b.estado === "EN_CURSO" && Date.now() - new Date(b.updated_at).getTime() < INACTIVO_MS;
}

export function EstadoBroadcast({
  b,
}: {
  b: { estado: string; updated_at: string; fallidos: number; total: number; enviados: number };
}) {
  if (b.estado === "FINALIZADO") {
    return b.fallidos > 0 ? (
      <Badge color="amber">Finalizado con errores</Badge>
    ) : (
      <Badge color="emerald">Finalizado</Badge>
    );
  }
  if (estaActivo(b)) {
    return (
      <Badge color="sky">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
        Enviando
      </Badge>
    );
  }
  return <Badge color="red">Detenido</Badge>;
}

export function formatoFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}
