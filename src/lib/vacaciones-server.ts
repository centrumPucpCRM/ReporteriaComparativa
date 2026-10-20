/**
 * Periodos de vacaciones (Supabase, schema `Sistema_vacaciones`) y su sincronización con
 * Oracle CRM. Solo server-side: usa el service role y las credenciales de Oracle.
 *
 * La sincronización es idempotente y se pone al día sola: corre en el cron diario
 * (/api/sistema-vacaciones/sincronizar), al abrir el calendario y después de cada cambio.
 *  - PROGRAMADA que ya empezó  → CTREnVacaciones_c = true  → EN_CURSO
 *  - EN_CURSO que ya terminó   → CTREnVacaciones_c = false → FINALIZADA
 *    (no se toca Oracle si el vendedor tiene otro periodo vigente hoy)
 *  - PROGRAMADA que terminó sin haber empezado (registro de fechas pasadas) → FINALIZADA, sin Oracle
 * Si Oracle falla, el periodo guarda `error` y conserva su estado para reintentarse.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { actualizarVacaciones, listarVendedores } from "@/lib/oracle-crm";
import { hoyLima, sumarDias, type EstadoPeriodo, type Periodo } from "@/lib/vacaciones";

const SCHEMA = "Sistema_vacaciones";

// Códigos de PostgREST / Postgres cuando el schema no está expuesto o la tabla no existe.
const SIN_ESQUEMA = new Set(["PGRST106", "PGRST205", "42P01", "3F000"]);

function fallo(error: { code?: string; message: string }): never {
  if (SIN_ESQUEMA.has(error.code ?? "") || /schema/i.test(error.message)) {
    throw new Error(
      `El schema ${SCHEMA} aún no existe o no está expuesto en Supabase. Ejecutar ` +
        `sql/sistema_vacaciones.sql y agregarlo en Settings → API → Exposed schemas.`,
    );
  }
  if (error.code === "23P01") throw new Error("El vendedor ya tiene vacaciones que se cruzan con esas fechas.");
  if (error.code === "23514") throw new Error("La fecha de fin no puede ser anterior a la de inicio.");
  throw new Error(error.message);
}

function db() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (createAdminClient().schema(SCHEMA) as any).from("periodo");
}

type FilaPeriodo = {
  id: number;
  party_number: string;
  vendedor_nombre: string;
  vendedor_correo: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  nota: string | null;
  estado: EstadoPeriodo;
  error: string | null;
  creado_por: string | null;
  actualizado_por: string | null;
};

function aPeriodo(f: FilaPeriodo): Periodo {
  return {
    id: f.id,
    partyNumber: f.party_number,
    vendedorNombre: f.vendedor_nombre,
    vendedorCorreo: f.vendedor_correo ?? "",
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    nota: f.nota ?? "",
    estado: f.estado,
    error: f.error,
    creadoPor: f.creado_por ?? "",
    actualizadoPor: f.actualizado_por ?? "",
  };
}

function validarFecha(fecha: string, campo: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) {
    throw new Error(`${campo} no es una fecha válida.`);
  }
}

async function obtenerPeriodo(id: number): Promise<Periodo> {
  const { data, error } = await db().select("*").eq("id", id).maybeSingle();
  if (error) fallo(error);
  if (!data) throw new Error("El periodo ya no existe.");
  return aPeriodo(data);
}

/** Periodos no cancelados que se cruzan con [desde, hasta]. */
export async function listarPeriodos(desde: string, hasta: string): Promise<Periodo[]> {
  const { data, error } = await db()
    .select("*")
    .neq("estado", "CANCELADA")
    .lte("fecha_inicio", hasta)
    .gte("fecha_fin", desde)
    .order("fecha_inicio")
    .order("vendedor_nombre");
  if (error) fallo(error);
  return (data as FilaPeriodo[]).map(aPeriodo);
}

export type NuevoPeriodo = { partyNumber: string; fechaInicio: string; fechaFin: string; nota: string };

export async function crearPeriodo(input: NuevoPeriodo, usuario: string): Promise<Periodo> {
  validarFecha(input.fechaInicio, "Desde");
  validarFecha(input.fechaFin, "Hasta");
  // El nombre y correo salen de Oracle, no del navegador.
  const vendedor = (await listarVendedores()).find((v) => v.partyNumber === input.partyNumber);
  if (!vendedor) throw new Error("El vendedor no existe o ya no está activo en Oracle.");
  const { data, error } = await db()
    .insert({
      party_number: vendedor.partyNumber,
      vendedor_nombre: vendedor.nombre,
      vendedor_correo: vendedor.correo || null,
      fecha_inicio: input.fechaInicio,
      fecha_fin: input.fechaFin,
      nota: input.nota.trim() || null,
      creado_por: usuario,
      actualizado_por: usuario,
    })
    .select("*")
    .single();
  if (error) fallo(error);
  return aPeriodo(data);
}

/** PROGRAMADA: cambia fechas y nota. EN_CURSO: solo la fecha de fin (extender o acortar) y la nota. */
export async function editarPeriodo(
  id: number,
  cambios: { fechaInicio: string; fechaFin: string; nota: string },
  usuario: string,
): Promise<void> {
  validarFecha(cambios.fechaInicio, "Desde");
  validarFecha(cambios.fechaFin, "Hasta");
  const actual = await obtenerPeriodo(id);
  if (actual.estado !== "PROGRAMADA" && actual.estado !== "EN_CURSO") {
    throw new Error("Solo se pueden editar vacaciones programadas o en curso.");
  }
  if (actual.estado === "EN_CURSO" && cambios.fechaInicio !== actual.fechaInicio) {
    throw new Error("Las vacaciones ya empezaron: solo se puede cambiar la fecha de fin.");
  }
  const { error } = await db()
    .update({
      fecha_inicio: cambios.fechaInicio,
      fecha_fin: cambios.fechaFin,
      nota: cambios.nota.trim() || null,
      actualizado_por: usuario,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("estado", actual.estado);
  if (error) fallo(error);
}

/** Cancela unas vacaciones que aún no empiezan. */
export async function cancelarPeriodo(id: number, usuario: string): Promise<void> {
  const actual = await obtenerPeriodo(id);
  if (actual.estado !== "PROGRAMADA") throw new Error("Solo se pueden cancelar vacaciones que aún no empiezan.");
  const { error } = await db()
    .update({ estado: "CANCELADA", actualizado_por: usuario, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "PROGRAMADA");
  if (error) fallo(error);
}

/**
 * El vendedor vuelve a trabajar hoy: el periodo termina ayer (la sincronización lo finaliza
 * en Oracle). Si empezó hoy mismo no queda ningún día, así que se cancela y se desmarca ya.
 */
export async function terminarPeriodo(id: number, usuario: string): Promise<void> {
  const actual = await obtenerPeriodo(id);
  if (actual.estado !== "EN_CURSO") throw new Error("Solo se pueden terminar vacaciones en curso.");
  const ayer = sumarDias(hoyLima(), -1);
  const ahora = new Date().toISOString();
  if (actual.fechaInicio <= ayer) {
    const { error } = await db()
      .update({ fecha_fin: ayer, actualizado_por: usuario, updated_at: ahora })
      .eq("id", id)
      .eq("estado", "EN_CURSO");
    if (error) fallo(error);
    return;
  }
  await actualizarVacaciones(actual.partyNumber, false);
  const { error } = await db()
    .update({ estado: "CANCELADA", error: null, actualizado_por: usuario, updated_at: ahora })
    .eq("id", id)
    .eq("estado", "EN_CURSO");
  if (error) fallo(error);
}

export type ResumenSincronizacion = { iniciados: string[]; finalizados: string[]; errores: string[] };

export async function sincronizarPeriodos(origen: string): Promise<ResumenSincronizacion> {
  const hoy = hoyLima();
  const { data, error } = await db()
    .select("*")
    .in("estado", ["PROGRAMADA", "EN_CURSO"])
    .lte("fecha_inicio", hoy)
    .order("fecha_inicio");
  if (error) fallo(error);
  const periodos = (data as FilaPeriodo[]).map(aPeriodo);
  const vigentesHoy = new Set(periodos.filter((p) => p.fechaFin >= hoy).map((p) => p.partyNumber));
  const resumen: ResumenSincronizacion = { iniciados: [], finalizados: [], errores: [] };

  async function pasar(p: Periodo, estado: EstadoPeriodo, oracle: boolean | null) {
    try {
      if (oracle !== null) await actualizarVacaciones(p.partyNumber, oracle);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      resumen.errores.push(`${p.vendedorNombre}: ${mensaje}`);
      await db().update({ error: mensaje.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", p.id);
      return;
    }
    const { error: e } = await db()
      .update({ estado, error: null, updated_at: new Date().toISOString() })
      .eq("id", p.id)
      .eq("estado", p.estado);
    if (e) {
      resumen.errores.push(`${p.vendedorNombre}: ${e.message}`);
      return;
    }
    if (oracle !== null) {
      console.info(`[sistema-vacaciones] ${origen} → ${p.partyNumber} (${p.vendedorNombre}) CTREnVacaciones_c=${oracle}`);
    }
    (estado === "EN_CURSO" ? resumen.iniciados : resumen.finalizados).push(p.vendedorNombre);
  }

  for (const p of periodos) {
    if (p.fechaFin < hoy) {
      // Si otro periodo del vendedor cubre hoy, Oracle debe seguir en true.
      const oracle = p.estado === "EN_CURSO" && !vigentesHoy.has(p.partyNumber) ? false : null;
      await pasar(p, "FINALIZADA", oracle);
    } else if (p.estado === "PROGRAMADA") {
      await pasar(p, "EN_CURSO", true);
    }
  }
  return resumen;
}
