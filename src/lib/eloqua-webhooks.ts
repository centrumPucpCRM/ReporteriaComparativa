import { agregarFila, extraerSpreadsheetId, GoogleSheetsError } from "@/lib/google-sheets";

/**
 * Lógica del webhook de Eloqua → Google Sheets (server-only).
 *
 * Obligatorios (definen el destino, no se escriben como columna):
 *  - utm_excel (UTM Campaign Name)   → ID (o URL) del Google Sheet
 *  - utm_hoja  (UTM Campaign Medium) → nombre de la pestaña
 *
 * Todos los demás campos del body son opcionales y se escriben como columnas en el
 * orden en que llegan, más `fecha_creacion` (hora Lima) al final. Si la hoja está
 * vacía, la fila 1 se llena con los nombres de los campos como encabezados.
 */

export type BodyEloqua = Record<string, unknown>;

export const CAMPOS_DESTINO = ["utm_excel", "utm_hoja"] as const;
const CAMPO_FECHA = "fecha_creacion";

export type ResultadoExport =
  | {
      ok: true;
      spreadsheetId: string;
      hoja: string;
      columnas: string[];
      rango: string;
      conEncabezados: boolean;
    }
  | { ok: false; status: number; error: string };

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

/**
 * Los valores puramente numéricos (DNI, PartyNumber, OptyNumber…) se escriben como número,
 * igual que el resto de la data del sheet, para que los cruces (BUSCARV/COINCIDIR) contra
 * columnas numéricas sigan funcionando. Con cero a la izquierda o más de 15 dígitos se
 * dejan como texto para no perder precisión.
 */
function celda(v: unknown): string | number {
  const t = asText(v);
  return /^[1-9]\d{0,14}$/.test(t) ? Number(t) : t;
}

function fechaLima(): string {
  // sv-SE da formato "YYYY-MM-DD HH:mm:ss"
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Lima" });
}

export async function exportarContactoASheet(body: BodyEloqua): Promise<ResultadoExport> {
  const spreadsheetId = extraerSpreadsheetId(asText(body.utm_excel));
  const hoja = asText(body.utm_hoja);

  const faltan = [!spreadsheetId && '"utm_excel" (ID del Google Sheet)', !hoja && '"utm_hoja" (nombre de la pestaña)']
    .filter(Boolean)
    .join(" y ");
  if (faltan) {
    return { ok: false, status: 400, error: `Falta ${faltan}. Ambos campos son obligatorios.` };
  }

  // Object.entries respeta el orden en que llegaron los campos en el JSON.
  const datos = Object.entries(body).filter(([k]) => !(CAMPOS_DESTINO as readonly string[]).includes(k));
  if (!datos.some(([k]) => k === CAMPO_FECHA)) datos.push([CAMPO_FECHA, fechaLima()]);

  const columnas = datos.map(([k]) => k);
  const fila = datos.map(([, v]) => celda(v));

  try {
    const r = await agregarFila({ spreadsheetId, hoja, encabezados: columnas, fila });
    return { ok: true, spreadsheetId, hoja, columnas, rango: r.rangoActualizado, conEncabezados: r.conEncabezados };
  } catch (e) {
    if (e instanceof GoogleSheetsError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}
