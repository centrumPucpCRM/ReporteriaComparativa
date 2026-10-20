/**
 * Tipos y utilidades de fechas del Sistema de Vacaciones, compartidos entre UI y servidor.
 * Las fechas son días completos "YYYY-MM-DD" en hora Lima (sin zona horaria).
 */

export type EstadoPeriodo = "PROGRAMADA" | "EN_CURSO" | "FINALIZADA" | "CANCELADA";

export type Periodo = {
  id: number;
  partyNumber: string;
  vendedorNombre: string;
  vendedorCorreo: string;
  fechaInicio: string;
  fechaFin: string;
  nota: string;
  estado: EstadoPeriodo;
  /** Último fallo al escribir en Oracle; el periodo se reintenta en la próxima sincronización. */
  error: string | null;
  creadoPor: string;
  actualizadoPor: string;
};

export const ESTADO_LABEL: Record<EstadoPeriodo, string> = {
  PROGRAMADA: "Programada",
  EN_CURSO: "En curso",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
};

export function hoyLima(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Lima" });
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Días calendario entre dos fechas, ambas incluidas. */
export function diasEntre(inicio: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1;
}

/** 0 = lunes … 6 = domingo. */
export function diaSemana(fecha: string): number {
  return (new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function formatoFecha(fecha: string, opciones: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(`${fecha}T00:00:00Z`).toLocaleDateString("es-PE", { ...opciones, timeZone: "UTC" });
}
