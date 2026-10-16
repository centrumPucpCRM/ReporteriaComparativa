import { agregarFila, extraerSpreadsheetId, GoogleSheetsError } from "@/lib/google-sheets";

/**
 * Lógica del webhook de Eloqua "ReplicarInfo-GoogleSheet" (server-only).
 *
 * Eloqua envía un contacto con sus UTM; el destino sale de los propios UTM:
 *  - utm_excel (UTM Campaign Name)   → ID (o URL) del Google Sheet
 *  - utm_hoja  (UTM Campaign Medium) → nombre de la pestaña; vacío = primera pestaña
 */

export type ContactoEloqua = {
  dni?: unknown;
  correo?: unknown;
  PartyNumber?: unknown;
  OptyNumber?: unknown;
  utm_excel?: unknown;
  utm_hoja?: unknown;
};

// Mismo orden que la pestaña "Eloqua" del sheet de reportería (fecha al final).
export const ENCABEZADOS_SHEET = ["dni", "correo", "PartyNumber", "OptyNumber", "fecha_creacion"];

export type ResultadoExport =
  | { ok: true; spreadsheetId: string; hoja: string | null; rango: string | null; conEncabezados: boolean }
  | { ok: false; status: number; error: string };

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/**
 * Los identificadores puramente numéricos (DNI, PartyNumber, OptyNumber) se escriben como
 * número, igual que el resto de la data del sheet, para que los cruces (BUSCARV/COINCIDIR)
 * contra columnas numéricas sigan funcionando. Con cero a la izquierda o más de 15 dígitos
 * se dejan como texto para no perder precisión.
 */
function celda(v: unknown): string | number {
  const t = asText(v);
  return /^[1-9]\d{0,14}$/.test(t) ? Number(t) : t;
}

function fechaLima(): string {
  // sv-SE da formato "YYYY-MM-DD HH:mm:ss"
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Lima" });
}

export async function exportarContactoASheet(body: ContactoEloqua): Promise<ResultadoExport> {
  const spreadsheetId = extraerSpreadsheetId(asText(body.utm_excel));
  const hoja = asText(body.utm_hoja) || null;

  if (!spreadsheetId) {
    return {
      ok: false,
      status: 400,
      error: 'Falta "utm_excel" (UTM Campaign Name del contacto) con el ID del Google Sheet.',
    };
  }

  const fila = [celda(body.dni), asText(body.correo), celda(body.PartyNumber), celda(body.OptyNumber), fechaLima()];

  try {
    const r = await agregarFila({ spreadsheetId, hoja, encabezados: ENCABEZADOS_SHEET, fila });
    return { ok: true, spreadsheetId, hoja, rango: r.rangoActualizado, conEncabezados: r.conEncabezados };
  } catch (e) {
    if (e instanceof GoogleSheetsError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}
