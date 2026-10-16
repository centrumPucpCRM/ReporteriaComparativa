"use server";

import { requireUser } from "@/components/data-table/createTableActions";
import { exportarContactoASheet, type ContactoEloqua, type ResultadoExport } from "@/lib/eloqua-webhooks";

/** Ejecuta la misma lógica del webhook desde la UI, para validar un Google Sheet sin pasar por Eloqua. */
export async function probarEnvio(body: ContactoEloqua): Promise<ResultadoExport> {
  try {
    await requireUser();
    return await exportarContactoASheet(body);
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}
