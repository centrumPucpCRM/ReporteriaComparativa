/**
 * Acceso a datos del módulo Eloqua → Oracle (server-only).
 *
 * - prod / test: Supabase con el service role, schema `Eloqua_oracle` / `Eloqua_oracle_test`.
 * - demo: datos de ejemplo en memoria (ver demo.ts); las escrituras no guardan nada.
 *
 * El ambiente sale de una cookie que fija el selector de la UI.
 */

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COOKIE_AMBIENTE,
  SCHEMA_POR_AMBIENTE,
  type Ambiente,
  type Cola,
  type Control,
  type DetalleSolicitud,
  type DuplicadoDni,
  type EstadoSolicitud,
  type Evento,
  type Resumen,
  type Solicitud,
  type SolicitudPrograma,
  variantesDni,
} from "@/lib/eloqua-oracle";
import { demoDetalles, demoDuplicados } from "./demo";

export async function leerAmbiente(): Promise<Ambiente> {
  const v = (await cookies()).get(COOKIE_AMBIENTE)?.value;
  return v === "test" || v === "demo" ? v : "prod";
}

// Códigos de PostgREST / Postgres cuando el schema no está expuesto o la tabla no existe.
const SIN_ESQUEMA = new Set(["PGRST106", "PGRST205", "42P01", "3F000"]);

function fallo(ambiente: Ambiente, error: { code?: string; message: string }): never {
  if (ambiente !== "demo" && (SIN_ESQUEMA.has(error.code ?? "") || /schema/i.test(error.message))) {
    const schema = SCHEMA_POR_AMBIENTE[ambiente];
    throw new Error(
      `El schema ${schema} aún no existe o no está expuesto en Supabase. ` +
        `Ejecutar IntegracionEloquaOracleSalesCloud/sql/001_eloqua_oracle.sql y agregarlo en ` +
        `Settings → API → Exposed schemas. Mientras tanto, cambia a "Demo" para ver el módulo con datos de ejemplo.`,
    );
  }
  throw new Error(error.message);
}

function db(ambiente: Exclude<Ambiente, "demo">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAdminClient().schema(SCHEMA_POR_AMBIENTE[ambiente]) as any;
}

const ESTADOS: EstadoSolicitud[] = ["PENDIENTE", "EN_PROCESO", "OK", "PARCIAL", "ERROR", "EN_ESPERA", "SIN_CONTACTO", "DESCARTADO"];

function inicioDelDiaLima(): string {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Lima" });
  return new Date(`${hoy}T00:00:00-05:00`).toISOString();
}

// ─── Lecturas ────────────────────────────────────────────────────────────────

export async function obtenerResumen(ambiente: Ambiente): Promise<Resumen> {
  if (ambiente === "demo") {
    const ds = demoDetalles().map((d) => d.solicitud);
    const hoy = Object.fromEntries(ESTADOS.map((e) => [e, ds.filter((s) => s.estado === e).length])) as Resumen["hoy"];
    return {
      hoy,
      erroresPorPaso: agruparErrores(ds),
      duplicadosPendientes: demoDuplicados().filter((d) => !d.revisado).length,
      control: { pausado: false, motivo: null, pausado_at: null },
      recientes: ds.slice(0, 8),
    };
  }

  const q = db(ambiente);
  const desde = inicioDelDiaLima();
  const conteos = await Promise.all(
    ESTADOS.map((e) =>
      q.from("solicitud").select("id", { count: "exact", head: true }).eq("estado", e).gte("recibido_at", desde),
    ),
  );
  const hoy = {} as Resumen["hoy"];
  conteos.forEach((r, i) => {
    if (r.error) fallo(ambiente, r.error);
    hoy[ESTADOS[i]] = r.count ?? 0;
  });

  const [errores, duplicados, control, recientes] = await Promise.all([
    q.from("solicitud").select("error_paso").in("estado", ["ERROR", "PARCIAL"]).limit(5000),
    q.from("duplicado_dni").select("id", { count: "exact", head: true }).eq("revisado", false),
    q.from("control").select("pausado, motivo, pausado_at").eq("id", 1).maybeSingle(),
    q.from("solicitud").select("*").order("recibido_at", { ascending: false }).limit(8),
  ]);
  for (const r of [errores, duplicados, control, recientes]) if (r.error) fallo(ambiente, r.error);

  return {
    hoy,
    erroresPorPaso: agruparErrores(errores.data as Pick<Solicitud, "error_paso">[]),
    duplicadosPendientes: duplicados.count ?? 0,
    control: (control.data as Control | null) ?? { pausado: false, motivo: null, pausado_at: null },
    recientes: recientes.data as Solicitud[],
  };
}

type FilaCola = Pick<Solicitud, "id" | "dni" | "estado" | "paso_actual" | "error_paso" | "error_motivo" | "recibido_at">;

/** Cuántas solicitudes hay en curso o con error en cada paso (para el canvas del Resumen). */
export async function obtenerCola(ambiente: Ambiente): Promise<Cola> {
  let filas: FilaCola[];
  if (ambiente === "demo") {
    filas = demoDetalles().map((d) => d.solicitud);
  } else {
    const columnas = "id, dni, estado, paso_actual, error_paso, error_motivo, recibido_at";
    const [vivas, fuera] = await Promise.all([
      db(ambiente)
        .from("solicitud")
        .select(columnas)
        .in("estado", ["PENDIENTE", "EN_PROCESO", "ERROR", "PARCIAL", "EN_ESPERA"])
        .order("recibido_at", { ascending: false })
        .limit(5000),
      // Las que salieron de la cola son finales: solo las de hoy, para que no se acumulen.
      db(ambiente)
        .from("solicitud")
        .select(columnas)
        .eq("estado", "SIN_CONTACTO")
        .gte("recibido_at", inicioDelDiaLima())
        .order("recibido_at", { ascending: false })
        .limit(1000),
    ]);
    for (const r of [vivas, fuera]) if (r.error) fallo(ambiente, r.error);
    filas = [...(vivas.data as FilaCola[]), ...(fuera.data as FilaCola[])];
  }

  const porPaso: Cola["porPaso"] = {};
  const de = (paso: string) => (porPaso[paso] ??= { enCurso: 0, errores: 0, enEspera: 0, fuera: 0, muestras: [] });
  let pendientes = 0;
  const enCola: Cola["enCola"] = [];
  for (const f of [...filas].reverse()) {
    if (f.estado === "PENDIENTE") {
      pendientes++;
      if (enCola.length < 10) enCola.push({ id: f.id, dni: f.dni, recibido_at: f.recibido_at });
    }
    else if (f.estado === "EN_PROCESO" && f.paso_actual) de(f.paso_actual).enCurso++;
    else if (f.estado === "SIN_CONTACTO" && f.paso_actual) {
      const p = de(f.paso_actual);
      p.fuera++;
      if (p.muestras.length < 10) p.muestras.push({ id: f.id, dni: f.dni, motivo: f.error_motivo, estado: f.estado });
    } else if (f.estado === "EN_ESPERA" && f.paso_actual) {
      // Notificada al cliente: espera su corrección en el paso que notificó.
      const p = de(f.paso_actual);
      p.enEspera++;
      if (p.muestras.length < 10) p.muestras.push({ id: f.id, dni: f.dni, motivo: f.error_motivo, estado: f.estado });
    } else if ((f.estado === "ERROR" || f.estado === "PARCIAL") && f.error_paso) {
      const p = de(f.error_paso);
      p.errores++;
      if (p.muestras.length < 10) p.muestras.push({ id: f.id, dni: f.dni, motivo: f.error_motivo, estado: f.estado });
    }
  }
  return { pendientes, enCola, porPaso };
}

function agruparErrores(filas: Pick<Solicitud, "error_paso">[]): Resumen["erroresPorPaso"] {
  const m = new Map<string, number>();
  for (const f of filas) if (f.error_paso) m.set(f.error_paso, (m.get(f.error_paso) ?? 0) + 1);
  return [...m.entries()].map(([paso, total]) => ({ paso, total })).sort((a, b) => b.total - a.total);
}

export interface FiltroSolicitudes {
  estados: EstadoSolicitud[];
  paso?: string | null;
  page?: number;
  pageSize?: number;
}

export async function listarSolicitudes(
  ambiente: Ambiente,
  f: FiltroSolicitudes,
): Promise<{ filas: (Solicitud & { programas: SolicitudPrograma[] })[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, f.pageSize ?? 50);

  if (ambiente === "demo") {
    const todas = demoDetalles()
      .filter((d) => f.estados.includes(d.solicitud.estado))
      .filter((d) => !f.paso || d.solicitud.error_paso === f.paso);
    return {
      filas: todas
        .slice((page - 1) * pageSize, page * pageSize)
        .map((d) => ({ ...d.solicitud, programas: d.programas })),
      total: todas.length,
    };
  }

  let query = db(ambiente)
    .from("solicitud")
    .select("*, programas:solicitud_programa(*)", { count: "exact" })
    .in("estado", f.estados)
    .order("recibido_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (f.paso) query = query.eq("error_paso", f.paso);
  const { data, count, error } = await query;
  if (error) fallo(ambiente, error);
  return { filas: data, total: count ?? 0 };
}

export async function obtenerDetalle(ambiente: Ambiente, id: number): Promise<DetalleSolicitud | null> {
  if (ambiente === "demo") return demoDetalles().find((d) => d.solicitud.id === id) ?? null;

  const q = db(ambiente);
  const [s, programas, eventos, duplicado] = await Promise.all([
    q.from("v_solicitud_auditoria").select("*").eq("id", id).maybeSingle(),
    q.from("solicitud_programa").select("*").eq("solicitud_id", id).order("orden"),
    q.from("evento").select("*").eq("solicitud_id", id).order("created_at"),
    q.from("duplicado_dni").select("*").eq("solicitud_id", id).order("detectado_at", { ascending: false }).limit(1),
  ]);
  for (const r of [s, programas, eventos, duplicado]) if (r.error) fallo(ambiente, r.error);
  if (!s.data) return null;
  return {
    solicitud: s.data as Solicitud,
    programas: programas.data as SolicitudPrograma[],
    eventos: eventos.data as Evento[],
    duplicado: ((duplicado.data as DuplicadoDni[])[0] ?? null),
  };
}

export async function buscarPorDni(
  ambiente: Ambiente,
  dni: string,
): Promise<(Solicitud & { programas: SolicitudPrograma[] })[]> {
  if (!dni.trim()) return [];
  // Igualdad exacta con y sin ceros a la izquierda: "3040421" encuentra "03040421" (y viceversa).
  const variantes = variantesDni(dni);

  if (ambiente === "demo") {
    return demoDetalles()
      .filter((d) => variantes.includes(d.solicitud.dni))
      .map((d) => ({ ...d.solicitud, programas: d.programas }));
  }

  const { data, error } = await db(ambiente)
    .from("v_solicitud_auditoria")
    .select("*")
    .in("dni", variantes)
    .order("recibido_at", { ascending: false })
    .limit(200);
  if (error) fallo(ambiente, error);
  const ids = (data as Solicitud[]).map((s) => s.id);
  const progs = ids.length
    ? await db(ambiente).from("solicitud_programa").select("*").in("solicitud_id", ids)
    : { data: [], error: null };
  if (progs.error) fallo(ambiente, progs.error);
  return (data as Solicitud[]).map((s) => ({
    ...s,
    programas: (progs.data as SolicitudPrograma[]).filter((p) => p.solicitud_id === s.id),
  }));
}

export async function listarDuplicados(ambiente: Ambiente, soloPendientes: boolean): Promise<DuplicadoDni[]> {
  if (ambiente === "demo") return demoDuplicados().filter((d) => !soloPendientes || !d.revisado);

  let query = db(ambiente).from("duplicado_dni").select("*").order("detectado_at", { ascending: false }).limit(500);
  if (soloPendientes) query = query.eq("revisado", false);
  const { data, error } = await query;
  if (error) fallo(ambiente, error);
  return data as DuplicadoDni[];
}

// ─── Escrituras ──────────────────────────────────────────────────────────────

/** Vuelve a encolar: el worker retoma cada una desde el paso que falló. */
export async function reintentar(ambiente: Ambiente, ids: number[]): Promise<number> {
  if (ambiente === "demo" || !ids.length) return ids.length;
  const { data, error } = await db(ambiente)
    .from("solicitud")
    .update({ estado: "PENDIENTE", updated_at: new Date().toISOString() })
    .in("id", ids)
    .in("estado", ["ERROR", "PARCIAL"])
    .select("id");
  if (error) fallo(ambiente, error);
  return (data as unknown[]).length;
}

/** Reintenta todas las solicitudes que se detuvieron en un paso (botón del canvas). */
export async function reintentarPorPaso(ambiente: Ambiente, paso: string): Promise<number> {
  if (ambiente === "demo") {
    return demoDetalles().filter((d) => ["ERROR", "PARCIAL"].includes(d.solicitud.estado) && d.solicitud.error_paso === paso).length;
  }
  const { data, error } = await db(ambiente)
    .from("solicitud")
    .update({ estado: "PENDIENTE", updated_at: new Date().toISOString() })
    .eq("error_paso", paso)
    .in("estado", ["ERROR", "PARCIAL"])
    .select("id");
  if (error) fallo(ambiente, error);
  return (data as unknown[]).length;
}

export async function descartar(ambiente: Ambiente, ids: number[]): Promise<number> {
  if (ambiente === "demo" || !ids.length) return ids.length;
  const { data, error } = await db(ambiente)
    .from("solicitud")
    .update({ estado: "DESCARTADO", updated_at: new Date().toISOString() })
    .in("id", ids)
    .in("estado", ["ERROR", "PARCIAL", "PENDIENTE", "EN_ESPERA"])
    .select("id");
  if (error) fallo(ambiente, error);
  return (data as unknown[]).length;
}

export async function marcarDuplicadoRevisado(ambiente: Ambiente, id: number, usuario: string): Promise<void> {
  if (ambiente === "demo") return;
  const { error } = await db(ambiente)
    .from("duplicado_dni")
    .update({ revisado: true, revisado_por: usuario })
    .eq("id", id);
  if (error) fallo(ambiente, error);
}

export async function reanudarCola(ambiente: Ambiente, usuario: string): Promise<void> {
  if (ambiente === "demo") return;
  const { error } = await db(ambiente)
    .from("control")
    .update({ pausado: false, motivo: null, pausado_at: null, actualizado_por: usuario, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) fallo(ambiente, error);
}

// ─── Pasos de identidad ejecutados desde la plataforma ───────────────────────

/** Estados desde los que se puede mover una solicitud a un paso: no la está procesando nadie y no terminó OK. */
export const ESTADOS_MOVIBLES: EstadoSolicitud[] = ["PENDIENTE", "ERROR", "PARCIAL", "EN_ESPERA", "SIN_CONTACTO", "DESCARTADO"];

export type EventoNuevo = Pick<Evento, "paso" | "resultado" | "duracion_ms" | "detalle">;

/**
 * Toma la solicitud para ejecutarle un paso: la pasa a EN_PROCESO solo si sigue en el estado que
 * se leyó (si el worker la tomó en el medio, no se pisa). null = ya no se puede.
 */
export async function tomarSolicitud(ambiente: Exclude<Ambiente, "demo">, id: number, paso: string): Promise<Solicitud | null> {
  const q = db(ambiente);
  const { data: actual, error } = await q.from("solicitud").select("*").eq("id", id).maybeSingle();
  if (error) fallo(ambiente, error);
  const s = actual as Solicitud | null;
  if (!s || !ESTADOS_MOVIBLES.includes(s.estado)) return null;
  const ahora = new Date().toISOString();
  const { data, error: e2 } = await q
    .from("solicitud")
    .update({ estado: "EN_PROCESO", paso_actual: paso, iniciado_at: ahora, updated_at: ahora })
    .eq("id", id)
    .eq("estado", s.estado)
    .select("*");
  if (e2) fallo(ambiente, e2);
  return (data as Solicitud[])[0] ?? null;
}

export async function registrarEventos(ambiente: Exclude<Ambiente, "demo">, solicitudId: number, eventos: EventoNuevo[]): Promise<void> {
  if (!eventos.length) return;
  const { error } = await db(ambiente)
    .from("evento")
    .insert(eventos.map((e) => ({ ...e, solicitud_id: solicitudId, programa_id: null })));
  if (error) fallo(ambiente, error);
}

export async function actualizarSolicitud(
  ambiente: Exclude<Ambiente, "demo">,
  id: number,
  cambios: Partial<
    Pick<Solicitud, "estado" | "paso_actual" | "error_paso" | "error_tipo" | "error_motivo" | "error_detalle" | "payload" | "dni" | "correo_valido" | "telefono_valido"> & {
      telefono_prueba_id: string | null;
    }
  >,
): Promise<void> {
  const { error } = await db(ambiente)
    .from("solicitud")
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq("id", id);
  // 42703 = columna inexistente (correo_valido…) · 23514 = el check de estado no conoce EN_ESPERA / SIN_CONTACTO.
  if (error && (error.code === "42703" || error.code === "23514")) {
    throw new Error(
      `Faltan migraciones en el schema ${SCHEMA_POR_AMBIENTE[ambiente]}: ejecutar en Supabase → SQL Editor ` +
        `IntegracionEloquaOracleSalesCloud/sql/002_seguimiento_cliente.sql, 003_validacion_contacto.sql y 004_unificar_duplicados.sql (${error.message}).`,
    );
  }
  if (error) fallo(ambiente, error);
}

/** Crea una solicitud de prueba (lote propio, origen "plataforma") ya tomada en el paso indicado. */
export async function crearSolicitudPrueba(
  ambiente: Exclude<Ambiente, "demo">,
  dni: string,
  payload: Record<string, unknown>,
  paso: string,
): Promise<Solicitud> {
  const q = db(ambiente);
  const { data: lote, error } = await q.from("lote").insert({ origen: "plataforma", total: 1 }).select("id").single();
  if (error) fallo(ambiente, error);
  const ahora = new Date().toISOString();
  const { data, error: e2 } = await q
    .from("solicitud")
    .insert({ lote_id: (lote as { id: number }).id, dni, payload, estado: "EN_PROCESO", paso_actual: paso, iniciado_at: ahora, intentos: 1 })
    .select("*")
    .single();
  if (e2) fallo(ambiente, e2);
  return data as Solicitud;
}
