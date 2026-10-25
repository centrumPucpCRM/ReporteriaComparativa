/**
 * Tipos y utilidades de fechas del Sistema de Vacaciones, compartidos entre UI y servidor.
 * Las fechas son días completos "YYYY-MM-DD" en hora Lima (sin zona horaria).
 */

export type EstadoPeriodo = "PROGRAMADA" | "EN_CURSO" | "FINALIZADA" | "CANCELADA";

export type Periodo = {
  id: number;
  tipoId: number;
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

export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// ── Tipos de ausencia, jornada y saldos ─────────────────────────────────────

/** CALENDARIO cuenta todos los días; LABORAL salta los no laborables y los feriados. */
export type Conteo = "CALENDARIO" | "LABORAL";

export type TipoAusencia = {
  id: number;
  codigo: string;
  nombre: string;
  color: string;
  activo: boolean;
  conteo: Conteo;
  /** Los días se restan del saldo anual del vendedor. */
  descuentaSaldo: boolean;
  permiteSaldoNegativo: boolean;
  /** La nota es obligatoria al programar. */
  motivoRequerido: boolean;
  /** Mientras dure, CTREnVacaciones_c = true en Oracle. */
  marcaOracle: boolean;
  orden: number;
};

export const CONTEO_LABEL: Record<Conteo, string> = {
  CALENDARIO: "Días calendario",
  LABORAL: "Días laborales",
};

export type Feriado = { fecha: string; nombre: string };

/** INMEDIATO: todo el año disponible desde enero. MENSUAL: 1/12 por mes cumplido. */
export type MetodoAdquisicion = "INMEDIATO" | "MENSUAL";

export const METODO_LABEL: Record<MetodoAdquisicion, string> = {
  INMEDIATO: "Adquirido inmediatamente",
  MENSUAL: "Acumulación mensual",
};

export type Configuracion = {
  /** 0 = lunes … 6 = domingo. */
  diasLaborales: number[];
  diasPorAnio: number;
  metodoAdquisicion: MetodoAdquisicion;
};

/** Días laborables de la semana + feriados: lo que hace falta para contar días laborales. */
export type Jornada = { diasLaborales: number[]; feriados: Feriado[] };

export function esLaborable(fecha: string, diasLaborales: number[], feriados: Set<string>): boolean {
  return diasLaborales.includes(diaSemana(fecha)) && !feriados.has(fecha);
}

/** Días de [inicio, fin] que caen dentro de [desde, hasta], contados según el tipo. */
export function contarDias(
  inicio: string,
  fin: string,
  conteo: Conteo,
  jornada: Jornada,
  desde = inicio,
  hasta = fin,
): number {
  const a = inicio > desde ? inicio : desde;
  const b = fin < hasta ? fin : hasta;
  if (b < a) return 0;
  if (conteo === "CALENDARIO") return diasEntre(a, b);
  const feriados = new Set(jornada.feriados.map((f) => f.fecha));
  let n = 0;
  for (let d = a; d <= b; d = sumarDias(d, 1)) if (esLaborable(d, jornada.diasLaborales, feriados)) n++;
  return n;
}

export type SaldoVendedor = {
  partyNumber: string;
  nombre: string;
  anio: number;
  asignado: number;
  /** Lo ganado a la fecha según el método de adquisición. */
  adquirido: number;
  /** Días que pasaron del año anterior. */
  transferido: number;
  /** Días usados hasta hoy. */
  tomado: number;
  /** Días de ausencias futuras ya programadas en el año. */
  programado: number;
  /** adquirido + transferido − tomado − programado. */
  saldo: number;
  /** Lo que queda para el resto del año: asignado + transferido − tomado − programado. */
  disponibleAnual: number;
  /** Tiene asignación propia (si no, usa los días por año de la configuración). */
  personalizado: boolean;
  nota: string;
};

export type AsignacionSaldo = { asignados: number; transferidos: number; nota: string };

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Días adquiridos en `anio` a la fecha `hoy`. */
export function diasAdquiridos(asignado: number, anio: number, hoy: string, metodo: MetodoAdquisicion): number {
  const anioHoy = Number(hoy.slice(0, 4));
  if (metodo === "INMEDIATO" || anio < anioHoy) return asignado;
  if (anio > anioHoy) return 0;
  const mesesCumplidos = Number(hoy.slice(5, 7)) - 1;
  return redondear((asignado * mesesCumplidos) / 12);
}

/** Saldo de un vendedor en un año, a partir de sus periodos (de cualquier año). */
export function calcularSaldo(params: {
  partyNumber: string;
  nombre: string;
  anio: number;
  hoy: string;
  periodos: Periodo[];
  tipos: Map<number, TipoAusencia>;
  asignacion: AsignacionSaldo | undefined;
  config: Configuracion;
  jornada: Jornada;
}): SaldoVendedor {
  const { anio, hoy, config, jornada, asignacion } = params;
  const inicioAnio = `${anio}-01-01`;
  const finAnio = `${anio}-12-31`;
  let tomado = 0;
  let programado = 0;
  for (const p of params.periodos) {
    const tipo = params.tipos.get(p.tipoId);
    if (p.partyNumber !== params.partyNumber || p.estado === "CANCELADA" || !tipo?.descuentaSaldo) continue;
    tomado += contarDias(p.fechaInicio, p.fechaFin, tipo.conteo, jornada, inicioAnio, hoy < finAnio ? hoy : finAnio);
    const manana = sumarDias(hoy, 1);
    programado += contarDias(p.fechaInicio, p.fechaFin, tipo.conteo, jornada, manana > inicioAnio ? manana : inicioAnio, finAnio);
  }
  const asignado = asignacion?.asignados ?? config.diasPorAnio;
  const transferido = asignacion?.transferidos ?? 0;
  const adquirido = diasAdquiridos(asignado, anio, hoy, config.metodoAdquisicion);
  return {
    partyNumber: params.partyNumber,
    nombre: params.nombre,
    anio,
    asignado,
    adquirido,
    transferido,
    tomado,
    programado,
    saldo: redondear(adquirido + transferido - tomado - programado),
    disponibleAnual: redondear(asignado + transferido - tomado - programado),
    personalizado: !!asignacion,
    nota: asignacion?.nota ?? "",
  };
}

/** CSV con BOM (Excel lo abre con tildes) y comillas donde haga falta. */
export function aCsv(filas: (string | number)[][]): string {
  const celda = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + filas.map((f) => f.map(celda).join(",")).join("\r\n");
}
