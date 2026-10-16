"use server";

import { requireUser } from "@/components/data-table/createTableActions";
import { actualizarVacaciones, listarVendedores, type Vendedor } from "@/lib/oracle-crm";

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
