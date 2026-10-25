"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/components/data-table/createTableActions";
import { COOKIE_AMBIENTE, type Ambiente } from "@/lib/eloqua-oracle";
import { ejecutarIdentidad, type QuePrueba, type ResultadoIdentidad } from "@/lib/identidad/pasos";
import { leerManifest } from "@/lib/identidad/padron";
import { apiReniecConfigurada } from "@/lib/identidad/externa";
import * as repo from "./_lib/repo";
import { crearYEjecutar, ejecutarDesdePaso, resumen, type LeadPrueba, type PasoInicio } from "./_lib/identidad";

const BASE = "/modulos/microservicios/eloqua-oracle";

type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

async function ejecutar(fn: (ambiente: Ambiente, usuario: string) => Promise<string>): Promise<Resultado> {
  try {
    const user = await requireUser();
    const ambiente = await repo.leerAmbiente();
    const mensaje = await fn(ambiente, user.email ?? user.id);
    revalidatePath(BASE, "layout");
    return { ok: true, mensaje: ambiente === "demo" ? `${mensaje} (Demo: no se guardó nada)` : mensaje };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cambiarAmbiente(ambiente: Ambiente): Promise<void> {
  await requireUser();
  (await cookies()).set(COOKIE_AMBIENTE, ambiente, { path: BASE, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath(BASE, "layout");
}

export async function reintentarSolicitudes(ids: number[]): Promise<Resultado> {
  return ejecutar(async (amb) => `${await repo.reintentar(amb, ids)} solicitud(es) vuelven a la cola`);
}

export async function reintentarPaso(paso: string): Promise<Resultado> {
  return ejecutar(async (amb) => `${await repo.reintentarPorPaso(amb, paso)} solicitud(es) detenidas en ese paso vuelven a la cola`);
}

export async function descartarSolicitudes(ids: number[]): Promise<Resultado> {
  return ejecutar(async (amb) => `${await repo.descartar(amb, ids)} solicitud(es) descartadas`);
}

export async function marcarRevisado(id: number): Promise<Resultado> {
  return ejecutar(async (amb, usuario) => {
    await repo.marcarDuplicadoRevisado(amb, id, usuario);
    return "Duplicado marcado como revisado";
  });
}

export async function reanudar(): Promise<Resultado> {
  return ejecutar(async (amb, usuario) => {
    await repo.reanudarCola(amb, usuario);
    return "Cola reanudada";
  });
}

// ─── Pasos de identidad (Validar DNI / Validar RUC) ──────────────────────────

/** Mueve una solicitud atorada a Validar DNI o Validar RUC y ejecuta los pasos desde ahí. */
export async function ejecutarDesde(id: number, paso: PasoInicio): Promise<Resultado> {
  return ejecutar(async (amb, usuario) => resumen(await ejecutarDesdePaso(amb, id, paso, usuario)));
}

export type ResultadoPrueba =
  | { ok: true; r: ResultadoIdentidad; solicitudId: number | null }
  | { ok: false; error: string };

/**
 * Prueba unitaria de los pasos con un lead escrito a mano. `guardar` crea además una solicitud de
 * prueba en la cola de Test (para verla en el lienzo); sin guardar no escribe nada.
 */
export async function probarIdentidad(lead: LeadPrueba, que: QuePrueba, guardar: boolean): Promise<ResultadoPrueba> {
  try {
    const user = await requireUser();
    if (!lead.dni.trim() && que !== "RUC") return { ok: false, error: "Falta el DNI" };
    if (!lead.ruc.trim() && que === "RUC") return { ok: false, error: "Falta el RUC" };
    if (guardar) {
      const ambiente = await repo.leerAmbiente();
      const { id, r } = await crearYEjecutar(ambiente, lead, que, user.email ?? user.id);
      revalidatePath(BASE, "layout");
      return { ok: true, r, solicitudId: id };
    }
    return { ok: true, r: await ejecutarIdentidad(lead, que), solicitudId: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface EstadoServicioIdentidad {
  cargado: boolean;
  fechaFuente: string | null;
  generadoEn: string | null;
  personas: number | null;
  empresas: number | null;
  fuenteExterna: string;
}

export async function estadoServicioIdentidad(): Promise<EstadoServicioIdentidad> {
  await requireUser();
  const m = await leerManifest().catch(() => null);
  return {
    cargado: !!m,
    fechaFuente: m?.fecha_fuente ?? null,
    generadoEn: m?.generado_en ?? null,
    personas: m?.conteos?.dni ?? null,
    empresas: m?.conteos?.ruc ?? null,
    fuenteExterna: apiReniecConfigurada() ? process.env.DNI_API_NOMBRE || "API RENIEC" : "eldni.com (no responde desde Vercel)",
  };
}
