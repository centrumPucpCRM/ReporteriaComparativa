/**
 * Periodos de vacaciones / ausencias (Supabase, schema `Sistema_vacaciones`) y su sincronización
 * con Oracle CRM. Solo server-side: usa el service role y las credenciales de Oracle.
 *
 * La sincronización es idempotente y se pone al día sola: corre en el cron diario
 * (/api/sistema-vacaciones/sincronizar), al abrir el calendario y después de cada cambio.
 *  - PROGRAMADA que ya empezó  → CTREnVacaciones_c = true  → EN_CURSO
 *  - EN_CURSO que ya terminó   → CTREnVacaciones_c = false → FINALIZADA
 *    (no se toca Oracle si el vendedor tiene otro periodo vigente hoy que también marca)
 *  - PROGRAMADA que terminó sin haber empezado (registro de fechas pasadas) → FINALIZADA, sin Oracle
 * Los tipos con `marca_oracle = false` cambian de estado igual pero nunca tocan Oracle.
 * Si Oracle falla, el periodo guarda `error` y conserva su estado para reintentarse.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { actualizarVacaciones, listarVendedores, type Vendedor } from "@/lib/oracle-crm";
import {
  calcularSaldo,
  contarDias,
  hoyLima,
  sumarDias,
  type AsignacionSaldo,
  type Configuracion,
  type Conteo,
  type EstadoPeriodo,
  type Feriado,
  type Jornada,
  type MetodoAdquisicion,
  type Periodo,
  type SaldoVendedor,
  type TipoAusencia,
} from "@/lib/vacaciones";

const SCHEMA = "Sistema_vacaciones";

// Códigos de PostgREST / Postgres cuando el schema no está expuesto o la tabla no existe.
const SIN_ESQUEMA = new Set(["PGRST106", "PGRST205", "42P01", "3F000"]);

function fallo(error: { code?: string; message: string }): never {
  if (SIN_ESQUEMA.has(error.code ?? "") || /schema/i.test(error.message)) {
    throw new Error(
      `Faltan tablas del schema ${SCHEMA} en Supabase. Ejecutar sql/sistema_vacaciones.sql y ` +
        `sql/sistema_vacaciones_002_tipos_saldos.sql, y tener el schema en Settings → API → Exposed schemas.`,
    );
  }
  if (error.code === "42703" || error.code === "PGRST204") {
    throw new Error("Falta ejecutar sql/sistema_vacaciones_002_tipos_saldos.sql en Supabase.");
  }
  if (error.code === "23P01") throw new Error("El vendedor ya tiene una ausencia que se cruza con esas fechas.");
  if (error.code === "23514") throw new Error("La fecha de fin no puede ser anterior a la de inicio.");
  throw new Error(error.message);
}

function tabla(nombre: "periodo" | "tipo" | "feriado" | "saldo" | "configuracion") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (createAdminClient().schema(SCHEMA) as any).from(nombre);
}

function db() {
  return tabla("periodo");
}

type FilaPeriodo = {
  id: number;
  tipo_id: number;
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
    tipoId: f.tipo_id,
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

export type FiltroMovimientos = {
  desde: string;
  hasta: string;
  tipoId?: number;
  estado?: EstadoPeriodo;
  partyNumber?: string;
};

/** Informe de movimientos: periodos (cancelados incluidos) que se cruzan con el rango. */
export async function buscarPeriodos(f: FiltroMovimientos): Promise<Periodo[]> {
  validarFecha(f.desde, "Desde");
  validarFecha(f.hasta, "Hasta");
  let q = db().select("*").lte("fecha_inicio", f.hasta).gte("fecha_fin", f.desde);
  if (f.tipoId) q = q.eq("tipo_id", f.tipoId);
  if (f.estado) q = q.eq("estado", f.estado);
  if (f.partyNumber) q = q.eq("party_number", f.partyNumber);
  const { data, error } = await q.order("fecha_inicio").order("vendedor_nombre").limit(5000);
  if (error) fallo(error);
  return (data as FilaPeriodo[]).map(aPeriodo);
}

// ── Tipos de ausencia ──────────────────────────────────────────────────────

type FilaTipo = {
  id: number;
  codigo: string;
  nombre: string;
  color: string;
  activo: boolean;
  conteo: Conteo;
  descuenta_saldo: boolean;
  permite_saldo_negativo: boolean;
  motivo_requerido: boolean;
  marca_oracle: boolean;
  orden: number;
};

function aTipo(f: FilaTipo): TipoAusencia {
  return {
    id: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    color: f.color,
    activo: f.activo,
    conteo: f.conteo,
    descuentaSaldo: f.descuenta_saldo,
    permiteSaldoNegativo: f.permite_saldo_negativo,
    motivoRequerido: f.motivo_requerido,
    marcaOracle: f.marca_oracle,
    orden: f.orden,
  };
}

export async function listarTipos(): Promise<TipoAusencia[]> {
  const { data, error } = await tabla("tipo").select("*").order("orden").order("nombre");
  if (error) fallo(error);
  return (data as FilaTipo[]).map(aTipo);
}

async function mapaTipos(): Promise<Map<number, TipoAusencia>> {
  return new Map((await listarTipos()).map((t) => [t.id, t]));
}

export type TipoInput = Omit<TipoAusencia, "id">;

export async function guardarTipo(input: TipoInput, id: number | null): Promise<void> {
  const codigo = input.codigo.trim().toUpperCase();
  const nombre = input.nombre.trim();
  if (!codigo || !nombre) throw new Error("Código y nombre son obligatorios.");
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error("El color no es válido.");
  const fila = {
    codigo,
    nombre,
    color: input.color,
    activo: input.activo,
    conteo: input.conteo,
    descuenta_saldo: input.descuentaSaldo,
    permite_saldo_negativo: input.descuentaSaldo && input.permiteSaldoNegativo,
    motivo_requerido: input.motivoRequerido,
    marca_oracle: input.marcaOracle,
    orden: Math.trunc(input.orden) || 0,
    updated_at: new Date().toISOString(),
  };
  if (id !== null) {
    // Cambiar si marca Oracle con periodos en curso dejaría a Oracle desincronizado.
    const anterior = (await mapaTipos()).get(id);
    if (anterior && anterior.marcaOracle !== fila.marca_oracle) {
      const { count, error } = await db().select("id", { count: "exact", head: true }).eq("tipo_id", id).eq("estado", "EN_CURSO");
      if (error) fallo(error);
      if (count) throw new Error(`Hay ${count} ausencia(s) en curso de este tipo: no se puede cambiar "Marca en Oracle" hasta que terminen.`);
    }
  }
  const { error } = id === null ? await tabla("tipo").insert(fila) : await tabla("tipo").update(fila).eq("id", id);
  if (error?.code === "23505") throw new Error(`Ya existe un tipo con el código ${codigo}.`);
  if (error) fallo(error);
}

export async function eliminarTipo(id: number): Promise<void> {
  const { error } = await tabla("tipo").delete().eq("id", id);
  if (error?.code === "23503") throw new Error("Este tipo ya tiene ausencias registradas: desactívalo en lugar de eliminarlo.");
  if (error) fallo(error);
}

// ── Feriados y configuración ───────────────────────────────────────────────

export async function listarFeriados(desde = "0001-01-01", hasta = "9999-12-31"): Promise<Feriado[]> {
  const { data, error } = await tabla("feriado").select("fecha, nombre").gte("fecha", desde).lte("fecha", hasta).order("fecha");
  if (error) fallo(error);
  return data as Feriado[];
}

export async function guardarFeriado(fecha: string, nombre: string): Promise<void> {
  validarFecha(fecha, "La fecha");
  if (!nombre.trim()) throw new Error("Indica el nombre del feriado.");
  const { error } = await tabla("feriado").upsert({ fecha, nombre: nombre.trim() }, { onConflict: "fecha" });
  if (error) fallo(error);
}

export async function eliminarFeriado(fecha: string): Promise<void> {
  const { error } = await tabla("feriado").delete().eq("fecha", fecha);
  if (error) fallo(error);
}

const CONFIG_POR_DEFECTO: Configuracion = { diasLaborales: [0, 1, 2, 3, 4], diasPorAnio: 30, metodoAdquisicion: "INMEDIATO" };

export async function obtenerConfiguracion(): Promise<Configuracion> {
  const { data, error } = await tabla("configuracion").select("*").eq("id", 1).maybeSingle();
  if (error) fallo(error);
  if (!data) return CONFIG_POR_DEFECTO;
  return {
    diasLaborales: (data.dias_laborales as number[]).slice().sort(),
    diasPorAnio: Number(data.dias_por_anio),
    metodoAdquisicion: data.metodo_adquisicion as MetodoAdquisicion,
  };
}

export async function guardarConfiguracion(c: Configuracion, usuario: string): Promise<void> {
  const dias = [...new Set(c.diasLaborales)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!dias.length) throw new Error("Marca al menos un día laboral.");
  if (!(c.diasPorAnio >= 0)) throw new Error("Los días por año no pueden ser negativos.");
  const { error } = await tabla("configuracion").upsert({
    id: 1,
    dias_laborales: dias,
    dias_por_anio: c.diasPorAnio,
    metodo_adquisicion: c.metodoAdquisicion,
    actualizado_por: usuario,
    updated_at: new Date().toISOString(),
  });
  if (error) fallo(error);
}

export async function obtenerJornada(): Promise<Jornada> {
  const [config, feriados] = await Promise.all([obtenerConfiguracion(), listarFeriados()]);
  return { diasLaborales: config.diasLaborales, feriados };
}

// ── Saldos ─────────────────────────────────────────────────────────────────

async function asignaciones(anio: number, partyNumber?: string): Promise<Map<string, AsignacionSaldo>> {
  let q = tabla("saldo").select("*").eq("anio", anio);
  if (partyNumber) q = q.eq("party_number", partyNumber);
  const { data, error } = await q;
  if (error) fallo(error);
  return new Map(
    (data as { party_number: string; dias_asignados: number; dias_transferidos: number; nota: string | null }[]).map((f) => [
      f.party_number,
      { asignados: Number(f.dias_asignados), transferidos: Number(f.dias_transferidos), nota: f.nota ?? "" },
    ]),
  );
}

/**
 * Saldo de cada vendedor activo en `anio` (más los que tienen ausencias ese año aunque ya no
 * estén activos). `vendedores` evita volver a pedir la lista a Oracle si ya se tiene.
 */
export async function calcularSaldos(anio: number, vendedores?: Vendedor[]): Promise<SaldoVendedor[]> {
  const [lista, periodos, tipos, asig, config, jornada] = await Promise.all([
    vendedores ?? listarVendedores(),
    listarPeriodos(`${anio}-01-01`, `${anio}-12-31`),
    mapaTipos(),
    asignaciones(anio),
    obtenerConfiguracion(),
    obtenerJornada(),
  ]);
  const nombres = new Map(lista.filter((v) => v.partyNumber).map((v) => [v.partyNumber, v.nombre]));
  for (const p of periodos) if (!nombres.has(p.partyNumber)) nombres.set(p.partyNumber, p.vendedorNombre);
  const hoy = hoyLima();
  return [...nombres]
    .map(([partyNumber, nombre]) =>
      calcularSaldo({ partyNumber, nombre, anio, hoy, periodos, tipos, asignacion: asig.get(partyNumber), config, jornada }),
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function guardarAsignacion(
  partyNumber: string,
  anio: number,
  a: AsignacionSaldo | null,
  usuario: string,
): Promise<void> {
  if (!partyNumber || !Number.isInteger(anio)) throw new Error("Vendedor o año no válido.");
  if (a === null) {
    const { error } = await tabla("saldo").delete().eq("party_number", partyNumber).eq("anio", anio);
    if (error) fallo(error);
    return;
  }
  if (!(a.asignados >= 0)) throw new Error("Los días asignados no pueden ser negativos.");
  if (!Number.isFinite(a.transferidos)) throw new Error("Los días transferidos no son válidos.");
  const { error } = await tabla("saldo").upsert(
    {
      party_number: partyNumber,
      anio,
      dias_asignados: a.asignados,
      dias_transferidos: a.transferidos,
      nota: a.nota.trim() || null,
      actualizado_por: usuario,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "party_number,anio" },
  );
  if (error) fallo(error);
}

// ── Reglas al programar ────────────────────────────────────────────────────

/**
 * Tipo activo, motivo si el tipo lo pide y, si descuenta saldo sin permitir negativo, que
 * alcance el saldo del año (o de cada año si cruza el 31 de diciembre).
 */
async function validarReglas(
  p: { partyNumber: string; vendedorNombre: string; tipoId: number; fechaInicio: string; fechaFin: string; nota: string },
  excluirId: number | null,
  tipoAnterior: number | null,
): Promise<void> {
  const tipos = await mapaTipos();
  const tipo = tipos.get(p.tipoId);
  if (!tipo) throw new Error("El tipo de ausencia no existe.");
  if (!tipo.activo && tipo.id !== tipoAnterior) throw new Error(`El tipo "${tipo.nombre}" está desactivado.`);
  if (tipo.motivoRequerido && !p.nota.trim()) throw new Error(`${tipo.nombre} requiere un motivo en la nota.`);
  if (!tipo.descuentaSaldo || tipo.permiteSaldoNegativo) return;

  const [config, jornada] = await Promise.all([obtenerConfiguracion(), obtenerJornada()]);
  const hoy = hoyLima();
  for (let anio = Number(p.fechaInicio.slice(0, 4)); anio <= Number(p.fechaFin.slice(0, 4)); anio++) {
    const usa = contarDias(p.fechaInicio, p.fechaFin, tipo.conteo, jornada, `${anio}-01-01`, `${anio}-12-31`);
    if (!usa) continue;
    const otros = (await listarPeriodos(`${anio}-01-01`, `${anio}-12-31`)).filter(
      (o) => o.partyNumber === p.partyNumber && o.id !== excluirId,
    );
    const saldo = calcularSaldo({
      partyNumber: p.partyNumber,
      nombre: p.vendedorNombre,
      anio,
      hoy,
      periodos: otros,
      tipos,
      asignacion: (await asignaciones(anio, p.partyNumber)).get(p.partyNumber),
      config,
      jornada,
    });
    if (usa > saldo.disponibleAnual) {
      throw new Error(
        `Saldo insuficiente en ${anio}: le quedan ${saldo.disponibleAnual} días y esta ausencia usa ${usa}. ` +
          `Ajusta la asignación en Saldos o permite saldo negativo en el tipo.`,
      );
    }
  }
}

export type NuevoPeriodo = { partyNumber: string; tipoId: number; fechaInicio: string; fechaFin: string; nota: string };

export async function crearPeriodo(input: NuevoPeriodo, usuario: string): Promise<Periodo> {
  validarFecha(input.fechaInicio, "Desde");
  validarFecha(input.fechaFin, "Hasta");
  if (input.fechaFin < input.fechaInicio) throw new Error("La fecha de fin no puede ser anterior a la de inicio.");
  // El nombre y correo salen de Oracle, no del navegador.
  const vendedor = (await listarVendedores()).find((v) => v.partyNumber === input.partyNumber);
  if (!vendedor) throw new Error("El vendedor no existe o ya no está activo en Oracle.");
  await validarReglas({ ...input, vendedorNombre: vendedor.nombre }, null, null);
  const { data, error } = await db()
    .insert({
      tipo_id: input.tipoId,
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

/**
 * PROGRAMADA: cambia tipo, fechas y nota. EN_CURSO: solo la fecha de fin (extender o acortar)
 * y la nota; el tipo no, porque decide si Oracle está marcado.
 */
export async function editarPeriodo(
  id: number,
  cambios: { tipoId: number; fechaInicio: string; fechaFin: string; nota: string },
  usuario: string,
): Promise<void> {
  validarFecha(cambios.fechaInicio, "Desde");
  validarFecha(cambios.fechaFin, "Hasta");
  if (cambios.fechaFin < cambios.fechaInicio) throw new Error("La fecha de fin no puede ser anterior a la de inicio.");
  const actual = await obtenerPeriodo(id);
  if (actual.estado !== "PROGRAMADA" && actual.estado !== "EN_CURSO") {
    throw new Error("Solo se pueden editar ausencias programadas o en curso.");
  }
  if (actual.estado === "EN_CURSO" && cambios.fechaInicio !== actual.fechaInicio) {
    throw new Error("La ausencia ya empezó: solo se puede cambiar la fecha de fin.");
  }
  if (actual.estado === "EN_CURSO" && cambios.tipoId !== actual.tipoId) {
    throw new Error("La ausencia ya empezó: no se puede cambiar el tipo.");
  }
  await validarReglas({ ...cambios, partyNumber: actual.partyNumber, vendedorNombre: actual.vendedorNombre }, id, actual.tipoId);
  const { error } = await db()
    .update({
      tipo_id: cambios.tipoId,
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

/** Cancela una ausencia que aún no empieza. */
export async function cancelarPeriodo(id: number, usuario: string): Promise<void> {
  const actual = await obtenerPeriodo(id);
  if (actual.estado !== "PROGRAMADA") throw new Error("Solo se pueden cancelar ausencias que aún no empiezan.");
  const { error } = await db()
    .update({ estado: "CANCELADA", actualizado_por: usuario, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "PROGRAMADA");
  if (error) fallo(error);
}

/**
 * El vendedor vuelve a trabajar hoy: el periodo termina ayer (la sincronización lo finaliza
 * en Oracle). Si empezó hoy mismo no queda ningún día, así que se cancela y se desmarca ya.
 * Si terminaba hoy o después (término anticipado) se deja constancia en la nota.
 */
export async function terminarPeriodo(id: number, usuario: string, motivo = ""): Promise<void> {
  const actual = await obtenerPeriodo(id);
  if (actual.estado !== "EN_CURSO") throw new Error("Solo se pueden terminar ausencias en curso.");
  const hoy = hoyLima();
  const ayer = sumarDias(hoy, -1);
  const ahora = new Date().toISOString();
  const constancia =
    actual.fechaFin >= hoy
      ? `Terminada anticipadamente el ${hoy} por ${usuario} (estaba hasta el ${actual.fechaFin})` +
        (motivo.trim() ? `: ${motivo.trim()}` : "")
      : "";
  const nota = [actual.nota, constancia].filter(Boolean).join("\n") || null;
  if (actual.fechaInicio <= ayer) {
    const { error } = await db()
      .update({ fecha_fin: ayer, nota, actualizado_por: usuario, updated_at: ahora })
      .eq("id", id)
      .eq("estado", "EN_CURSO");
    if (error) fallo(error);
    return;
  }
  if ((await mapaTipos()).get(actual.tipoId)?.marcaOracle ?? true) await actualizarVacaciones(actual.partyNumber, false);
  const { error } = await db()
    .update({ estado: "CANCELADA", error: null, nota, actualizado_por: usuario, updated_at: ahora })
    .eq("id", id)
    .eq("estado", "EN_CURSO");
  if (error) fallo(error);
}

export type ResumenSincronizacion = { iniciados: string[]; finalizados: string[]; errores: string[] };

export async function sincronizarPeriodos(origen: string): Promise<ResumenSincronizacion> {
  const hoy = hoyLima();
  const [{ data, error }, tipos] = await Promise.all([
    db().select("*").in("estado", ["PROGRAMADA", "EN_CURSO"]).lte("fecha_inicio", hoy).order("fecha_inicio"),
    mapaTipos(),
  ]);
  if (error) fallo(error);
  const periodos = (data as FilaPeriodo[]).map(aPeriodo);
  const marca = (p: Periodo) => tipos.get(p.tipoId)?.marcaOracle ?? true;
  const vigentesHoy = new Set(periodos.filter((p) => p.fechaFin >= hoy && marca(p)).map((p) => p.partyNumber));
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
      // Si otro periodo del vendedor que marca Oracle cubre hoy, Oracle debe seguir en true.
      const oracle = p.estado === "EN_CURSO" && marca(p) && !vigentesHoy.has(p.partyNumber) ? false : null;
      await pasar(p, "FINALIZADA", oracle);
    } else if (p.estado === "PROGRAMADA") {
      await pasar(p, "EN_CURSO", marca(p) ? true : null);
    }
  }
  return resumen;
}
