"use server";

import { requireUser } from "@/components/data-table/createTableActions";
import { actualizarVacaciones, listarVendedores, type Vendedor } from "@/lib/oracle-crm";
import {
  hoyLima,
  type AsignacionSaldo,
  type Configuracion,
  type EstadoPeriodo,
  type Feriado,
  type Jornada,
  type Periodo,
  type SaldoVendedor,
  type TipoAusencia,
} from "@/lib/vacaciones";
import {
  buscarPeriodos,
  calcularSaldos,
  cancelarPeriodo,
  crearPeriodo,
  editarPeriodo,
  eliminarFeriado,
  eliminarTipo,
  guardarAsignacion,
  guardarConfiguracion,
  guardarFeriado,
  guardarTipo,
  listarFeriados,
  listarPeriodos,
  listarTipos,
  obtenerConfiguracion,
  obtenerJornada,
  sincronizarPeriodos,
  terminarPeriodo,
  type NuevoPeriodo,
  type ResumenSincronizacion,
  type TipoInput,
} from "@/lib/vacaciones-server";

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

function fallo(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export async function obtenerVendedores(): Promise<Resultado<Vendedor[]>> {
  try {
    await requireUser();
    return { ok: true, data: await listarVendedores() };
  } catch (e) {
    return fallo(e);
  }
}

export async function cambiarVacaciones(partyNumber: string, enVacaciones: boolean): Promise<Resultado<Vendedor>> {
  try {
    const user = await requireUser();
    if (!partyNumber) return { ok: false, error: "El vendedor no tiene Party Number." };
    const vendedor = await actualizarVacaciones(partyNumber, enVacaciones);
    // Rastro en los logs del servidor de quién cambió qué.
    console.info(
      `[sistema-vacaciones] ${user.email} → ${partyNumber} (${vendedor.nombre}) CTREnVacaciones_c=${enVacaciones}`,
    );
    return { ok: true, data: vendedor };
  } catch (e) {
    return fallo(e);
  }
}

// ── Calendario ──────────────────────────────────────────────────────────────

/** Texto para la UI con lo que la sincronización hizo, o null si no hizo nada. */
function avisoSincronizacion(r: ResumenSincronizacion): string | null {
  const partes: string[] = [];
  if (r.iniciados.length) partes.push(`Ausencias iniciadas: ${r.iniciados.join(", ")}.`);
  if (r.finalizados.length) partes.push(`Ausencias finalizadas: ${r.finalizados.join(", ")}.`);
  if (r.errores.length) partes.push(`No se pudo actualizar Oracle (se reintentará): ${r.errores.join(" · ")}`);
  return partes.length ? partes.join(" ") : null;
}

async function sincronizarSinFallar(origen: string): Promise<string | null> {
  try {
    return avisoSincronizacion(await sincronizarPeriodos(origen));
  } catch (e) {
    return `No se pudo sincronizar con Oracle: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export type DatosVendedores = {
  hoy: string;
  vendedores: Vendedor[];
  periodos: Periodo[];
  tipos: TipoAusencia[];
  saldos: SaldoVendedor[];
  jornada: Jornada;
  aviso: string | null;
};

/**
 * Listado de Vendedores: sincroniza primero (así Oracle ya refleja quién volvió hoy) y trae
 * los periodos en curso o futuros para mostrar la fecha de regreso, y el saldo del año.
 */
export async function obtenerPanelVendedores(): Promise<Resultado<DatosVendedores>> {
  try {
    const user = await requireUser();
    const aviso = await sincronizarSinFallar(user.email ?? "usuario");
    const hoy = hoyLima();
    const [vendedores, periodos, tipos, jornada] = await Promise.all([
      listarVendedores(),
      listarPeriodos(hoy, "9999-12-31"),
      listarTipos(),
      obtenerJornada(),
    ]);
    const saldos = await calcularSaldos(Number(hoy.slice(0, 4)), vendedores);
    return { ok: true, data: { hoy, vendedores, periodos, tipos, saldos, jornada, aviso } };
  } catch (e) {
    return fallo(e);
  }
}

export type DatosCalendario = { hoy: string; periodos: Periodo[]; tipos: TipoAusencia[]; jornada: Jornada; aviso: string | null };

/** Sincroniza (por si el cron no corrió) y devuelve los periodos que se cruzan con [desde, hasta]. */
export async function obtenerCalendario(desde: string, hasta: string): Promise<Resultado<DatosCalendario>> {
  try {
    const user = await requireUser();
    const aviso = await sincronizarSinFallar(user.email ?? "usuario");
    const [periodos, tipos, jornada] = await Promise.all([listarPeriodos(desde, hasta), listarTipos(), obtenerJornada()]);
    return { ok: true, data: { hoy: hoyLima(), periodos, tipos, jornada, aviso } };
  } catch (e) {
    return fallo(e);
  }
}

export type DatosHorario = DatosCalendario & { vendedores: Vendedor[] };

/** Horario: como el calendario, más la lista de vendedores para armar una fila por cada uno. */
export async function obtenerHorario(desde: string, hasta: string): Promise<Resultado<DatosHorario>> {
  const [cal, vend] = await Promise.all([obtenerCalendario(desde, hasta), obtenerVendedores()]);
  if (!cal.ok) return cal;
  if (!vend.ok) return vend;
  return { ok: true, data: { ...cal.data, vendedores: vend.data } };
}

async function escribir(accion: (usuario: string) => Promise<unknown>): Promise<Resultado<string | null>> {
  try {
    const user = await requireUser();
    const usuario = user.email ?? user.id;
    await accion(usuario);
    return { ok: true, data: await sincronizarSinFallar(usuario) };
  } catch (e) {
    return fallo(e);
  }
}

export async function programarVacaciones(input: NuevoPeriodo): Promise<Resultado<string | null>> {
  return escribir((usuario) => crearPeriodo(input, usuario));
}

export async function guardarPeriodo(
  id: number,
  cambios: { tipoId: number; fechaInicio: string; fechaFin: string; nota: string },
): Promise<Resultado<string | null>> {
  return escribir((usuario) => editarPeriodo(id, cambios, usuario));
}

export async function cancelarVacaciones(id: number): Promise<Resultado<string | null>> {
  return escribir((usuario) => cancelarPeriodo(id, usuario));
}

export async function terminarVacaciones(id: number, motivo = ""): Promise<Resultado<string | null>> {
  return escribir((usuario) => terminarPeriodo(id, usuario, motivo));
}

// ── Informes ────────────────────────────────────────────────────────────────

export type DatosMovimientos = { hoy: string; periodos: Periodo[]; tipos: TipoAusencia[]; jornada: Jornada };

export async function obtenerMovimientos(filtro: {
  desde: string;
  hasta: string;
  tipoId?: number;
  estado?: EstadoPeriodo;
  partyNumber?: string;
}): Promise<Resultado<DatosMovimientos>> {
  try {
    await requireUser();
    const [periodos, tipos, jornada] = await Promise.all([buscarPeriodos(filtro), listarTipos(), obtenerJornada()]);
    return { ok: true, data: { hoy: hoyLima(), periodos, tipos, jornada } };
  } catch (e) {
    return fallo(e);
  }
}

export type DatosSaldos = { hoy: string; saldos: SaldoVendedor[]; config: Configuracion };

export async function obtenerSaldos(anio: number): Promise<Resultado<DatosSaldos>> {
  try {
    await requireUser();
    const [saldos, config] = await Promise.all([calcularSaldos(anio), obtenerConfiguracion()]);
    return { ok: true, data: { hoy: hoyLima(), saldos, config } };
  } catch (e) {
    return fallo(e);
  }
}

/** `asignacion = null` vuelve a los días por año de la configuración. */
export async function guardarSaldo(
  partyNumber: string,
  anio: number,
  asignacion: AsignacionSaldo | null,
): Promise<Resultado<null>> {
  try {
    const user = await requireUser();
    await guardarAsignacion(partyNumber, anio, asignacion, user.email ?? user.id);
    return { ok: true, data: null };
  } catch (e) {
    return fallo(e);
  }
}

// ── Configuración ───────────────────────────────────────────────────────────

export async function obtenerTipos(): Promise<Resultado<TipoAusencia[]>> {
  try {
    await requireUser();
    return { ok: true, data: await listarTipos() };
  } catch (e) {
    return fallo(e);
  }
}

export async function guardarTipoAusencia(input: TipoInput, id: number | null): Promise<Resultado<null>> {
  try {
    await requireUser();
    await guardarTipo(input, id);
    return { ok: true, data: null };
  } catch (e) {
    return fallo(e);
  }
}

export async function eliminarTipoAusencia(id: number): Promise<Resultado<null>> {
  try {
    await requireUser();
    await eliminarTipo(id);
    return { ok: true, data: null };
  } catch (e) {
    return fallo(e);
  }
}

export async function obtenerFeriados(anio: number): Promise<Resultado<Feriado[]>> {
  try {
    await requireUser();
    return { ok: true, data: await listarFeriados(`${anio}-01-01`, `${anio}-12-31`) };
  } catch (e) {
    return fallo(e);
  }
}

export async function guardarFeriadoAccion(fecha: string, nombre: string): Promise<Resultado<null>> {
  try {
    await requireUser();
    await guardarFeriado(fecha, nombre);
    return { ok: true, data: null };
  } catch (e) {
    return fallo(e);
  }
}

export async function eliminarFeriadoAccion(fecha: string): Promise<Resultado<null>> {
  try {
    await requireUser();
    await eliminarFeriado(fecha);
    return { ok: true, data: null };
  } catch (e) {
    return fallo(e);
  }
}

export async function obtenerConfiguracionAccion(): Promise<Resultado<Configuracion>> {
  try {
    await requireUser();
    return { ok: true, data: await obtenerConfiguracion() };
  } catch (e) {
    return fallo(e);
  }
}

export async function guardarConfiguracionAccion(config: Configuracion): Promise<Resultado<null>> {
  try {
    const user = await requireUser();
    await guardarConfiguracion(config, user.email ?? user.id);
    return { ok: true, data: null };
  } catch (e) {
    return fallo(e);
  }
}
