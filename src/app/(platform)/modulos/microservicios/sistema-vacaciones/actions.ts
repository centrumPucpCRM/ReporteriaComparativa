"use server";

import { requireUser } from "@/components/data-table/createTableActions";
import { actualizarVacaciones, listarVendedores, type Vendedor } from "@/lib/oracle-crm";
import { hoyLima, type Periodo } from "@/lib/vacaciones";
import {
  cancelarPeriodo,
  crearPeriodo,
  editarPeriodo,
  listarPeriodos,
  sincronizarPeriodos,
  terminarPeriodo,
  type NuevoPeriodo,
  type ResumenSincronizacion,
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

/** Texto para la UI con lo que la sincronización hizo en Oracle, o null si no hizo nada. */
function avisoSincronizacion(r: ResumenSincronizacion): string | null {
  const partes: string[] = [];
  if (r.iniciados.length) partes.push(`Vacaciones iniciadas en Oracle: ${r.iniciados.join(", ")}.`);
  if (r.finalizados.length) partes.push(`Vacaciones finalizadas: ${r.finalizados.join(", ")}.`);
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

export type DatosVendedores = { hoy: string; vendedores: Vendedor[]; periodos: Periodo[]; aviso: string | null };

/**
 * Listado de Vendedores: sincroniza primero (así Oracle ya refleja quién volvió hoy) y trae
 * los periodos en curso o futuros para mostrar la fecha de regreso.
 */
export async function obtenerPanelVendedores(): Promise<Resultado<DatosVendedores>> {
  try {
    const user = await requireUser();
    const aviso = await sincronizarSinFallar(user.email ?? "usuario");
    const hoy = hoyLima();
    const [vendedores, periodos] = await Promise.all([listarVendedores(), listarPeriodos(hoy, "9999-12-31")]);
    return { ok: true, data: { hoy, vendedores, periodos, aviso } };
  } catch (e) {
    return fallo(e);
  }
}

export type DatosCalendario = { hoy: string; periodos: Periodo[]; aviso: string | null };

/** Sincroniza (por si el cron no corrió) y devuelve los periodos que se cruzan con [desde, hasta]. */
export async function obtenerCalendario(desde: string, hasta: string): Promise<Resultado<DatosCalendario>> {
  try {
    const user = await requireUser();
    const aviso = await sincronizarSinFallar(user.email ?? "usuario");
    return { ok: true, data: { hoy: hoyLima(), periodos: await listarPeriodos(desde, hasta), aviso } };
  } catch (e) {
    return fallo(e);
  }
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
  cambios: { fechaInicio: string; fechaFin: string; nota: string },
): Promise<Resultado<string | null>> {
  return escribir((usuario) => editarPeriodo(id, cambios, usuario));
}

export async function cancelarVacaciones(id: number): Promise<Resultado<string | null>> {
  return escribir((usuario) => cancelarPeriodo(id, usuario));
}

export async function terminarVacaciones(id: number, motivo = ""): Promise<Resultado<string | null>> {
  return escribir((usuario) => terminarPeriodo(id, usuario, motivo));
}
