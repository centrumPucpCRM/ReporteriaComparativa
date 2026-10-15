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

/**
 * Barra apilada con lo que realmente pasó con cada contacto:
 * verde = entregado en WhatsApp, rojo = error al enviar o no entregado,
 * celeste = Infobip lo aceptó y falta que WhatsApp confirme la entrega,
 * ámbar = envío cortado a mitad (sin confirmar). Gris = aún no procesado.
 */
export function BarraProgreso({
  total,
  entregados,
  fallidos,
  confirmando = 0,
  sinConfirmar = 0,
  alto = "h-2",
}: {
  total: number;
  entregados: number;
  fallidos: number;
  confirmando?: number;
  sinConfirmar?: number;
  alto?: string;
}) {
  const pct = (n: number) => (total ? `${(Math.max(0, n) / total) * 100}%` : "0%");
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-gray-100 ${alto}`}>
      <div className="bg-emerald-500 transition-all" style={{ width: pct(entregados) }} />
      <div className="bg-red-500 transition-all" style={{ width: pct(fallidos) }} />
      <div className="bg-sky-300 transition-all" style={{ width: pct(confirmando) }} />
      <div className="bg-amber-400 transition-all" style={{ width: pct(sinConfirmar) }} />
    </div>
  );
}

export function LeyendaProgreso() {
  const item = (color: string, texto: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {texto}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {item("bg-emerald-500", "Entregado")}
      {item("bg-red-500", "Error o no entregado")}
      {item("bg-sky-300", "Confirmando entrega")}
      {item("bg-amber-400", "Envío cortado")}
      {item("bg-gray-200", "Pendiente de enviar")}
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
  b: {
    estado: string;
    updated_at: string;
    fallidos: number;
    enviados?: number;
    entregados?: number;
    no_entregados?: number;
  };
}) {
  if (b.estado === "FINALIZADO") {
    const noEntregados = b.no_entregados ?? 0;
    const confirmando = Math.max(0, (b.enviados ?? 0) - (b.entregados ?? 0) - noEntregados);
    if (confirmando > 0) {
      return (
        <Badge color="sky">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
          Confirmando entrega
        </Badge>
      );
    }
    if ((b.entregados ?? 0) === 0 && b.fallidos + noEntregados > 0) {
      return <Badge color="red">Ninguno entregado</Badge>;
    }
    return b.fallidos > 0 || noEntregados > 0 ? (
      <Badge color="amber">Finalizado con errores</Badge>
    ) : (
      <Badge color="emerald">Entregado</Badge>
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

/**
 * Estado de una fila: primero si Infobip aceptó el envío (OK/ERROR) y, para
 * los OK, si WhatsApp lo entregó.
 */
export function EstadoFilaBadge({
  estado,
  reutilizada,
  entrega,
}: {
  estado: string;
  reutilizada: boolean | null;
  entrega: string | null;
}) {
  if (estado === "OK") {
    const conv = reutilizada ? "existente" : "nueva";
    if (entrega === "ENTREGADO") return <Badge color="emerald">Entregado · {conv}</Badge>;
    if (entrega === "NO_ENTREGADO") return <Badge color="red">No entregado · {conv}</Badge>;
    return <Badge color="sky">Enviado, confirmando entrega · {conv}</Badge>;
  }
  if (estado === "ERROR") return <Badge color="red">Error al enviar</Badge>;
  if (estado === "PENDIENTE") return <Badge color="gray">Pendiente</Badge>;
  return <Badge color="amber">Sin confirmar</Badge>;
}

/** Celda del resumen (estilo "Resumen de Broadcast" de Infobip). */
export function CeldaResumen({
  label,
  ayuda,
  children,
  destacado,
}: {
  label: string;
  /** Explicación corta que aparece al pasar el mouse por el ícono (i). */
  ayuda?: string;
  children: ReactNode;
  destacado?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <p className="flex items-center gap-1 text-xs font-semibold text-gray-500">
        {label}
        {ayuda ? (
          <span
            title={ayuda}
            className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-gray-400 text-[9px] font-bold text-gray-500"
          >
            i
          </span>
        ) : null}
      </p>
      <div className={`mt-1 truncate font-bold ${destacado ? "text-xl text-gray-900" : "text-lg text-gray-800"}`}>
        {children}
      </div>
    </div>
  );
}

/** Grilla con bordes entre celdas, como el resumen de Infobip. */
export function GrillaDatos({ children, columnas = 3 }: { children: ReactNode; columnas?: 2 | 3 | 4 }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columnas];
  return (
    // gap-px sobre fondo gris = líneas de 1px entre celdas, sin bordes dobles.
    <div className={`grid grid-cols-1 ${cols} gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200`}>
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** "Actualizado 18:40:12" + aviso si la página se refresca sola. */
export function UltimaActualizacion({ fecha, automatico }: { fecha: Date | null; automatico?: boolean }) {
  if (!fecha) return null;
  return (
    <span className="self-center text-xs text-gray-500">
      Actualizado {fecha.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      {automatico ? " · se actualiza solo" : ""}
    </span>
  );
}

export function formatoFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}
