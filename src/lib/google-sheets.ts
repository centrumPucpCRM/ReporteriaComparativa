import { createSign } from "node:crypto";

/**
 * Cliente mínimo de Google Sheets autenticado con un service account (server-only).
 *
 * Firma el JWT con node:crypto y lo canjea por un access token (sin depender de
 * `googleapis`). El token se cachea en memoria del proceso hasta poco antes de
 * expirar, así las invocaciones "calientes" no vuelven a pedirlo.
 *
 * Credenciales (campos `client_email` y `private_key` del JSON del service account):
 *  - GOOGLE_CLIENT_EMAIL
 *  - GOOGLE_PRIVATE_KEY: se acepta con saltos de línea reales o con `\n` literales
 *    (tal como viene dentro del JSON).
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

type ServiceAccount = { client_email: string; private_key: string };

export class GoogleSheetsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function leerEnv(name: string): string {
  return (process.env[name] || "").trim().replace(/^['"]|['"]$/g, "");
}

function leerServiceAccount(): ServiceAccount {
  const client_email = leerEnv("GOOGLE_CLIENT_EMAIL");
  const private_key = leerEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!client_email || !private_key) {
    throw new GoogleSheetsError("GOOGLE_CLIENT_EMAIL o GOOGLE_PRIVATE_KEY no configuradas en el servidor.", 503);
  }
  return { client_email, private_key };
}

/** Correo del service account: es con quien hay que compartir cada Google Sheet. */
export function serviceAccountEmail(): string | null {
  try {
    return leerServiceAccount().client_email;
  } catch {
    return null;
  }
}

let tokenCache: { token: string; expiresAt: number } | null = null;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const sa = leerServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 }),
  );
  const firma = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  const assertion = `${header}.${claims}.${base64url(firma)}`;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new GoogleSheetsError(
      `No se pudo autenticar el service account en Google: ${data.error_description || res.status}`,
      502,
    );
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

/** Acepta el ID del documento o la URL completa (`.../spreadsheets/d/<id>/edit`). */
export function extraerSpreadsheetId(valor: string): string {
  const v = valor.trim();
  const match = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : v;
}

/** Rango A1 con el nombre de la hoja escapado (comillas simples, `'` → `''`). */
function rango(hoja: string | null, celdas: string): string {
  return hoja ? `'${hoja.replace(/'/g, "''")}'!${celdas}` : celdas;
}

async function sheetsFetch(
  spreadsheetId: string,
  hoja: string | null,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const token = await accessToken();
  const res = await fetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (res.ok) return data;

  const detalle = data.error?.message || `HTTP ${res.status}`;
  if (res.status === 403) {
    throw new GoogleSheetsError(
      `Sin permiso sobre el Google Sheet "${spreadsheetId}". Compártelo con ${serviceAccountEmail() ?? "el service account"} con permisos de edición.`,
      403,
    );
  }
  if (res.status === 404) {
    throw new GoogleSheetsError(`No existe el Google Sheet con ID "${spreadsheetId}".`, 404);
  }
  if (res.status === 400 && /Unable to parse range/i.test(detalle)) {
    throw new GoogleSheetsError(`No existe la hoja "${hoja}" en el Google Sheet "${spreadsheetId}".`, 400);
  }
  throw new GoogleSheetsError(`Error de Google Sheets: ${detalle}`, res.status >= 500 ? 502 : res.status);
}

/**
 * Agrega `fila` en la primera fila libre de las columnas que ocupan los `encabezados`
 * (A:E si son 5). Si la hoja está vacía, escribe antes los `encabezados`.
 * `hoja` null → primera pestaña del documento.
 *
 * - El rango del append se limita a esas columnas e `insertDataOption=OVERWRITE`: se
 *   escribe sobre filas vacías existentes sin insertar filas, así las fórmulas que la hoja
 *   tenga a la derecha (p. ej. columna F) siguen alineadas con su fila.
 * - valueInputOption=RAW: los textos se guardan tal cual (un "=" no se evalúa como
 *   fórmula). Para que un valor quede como número hay que mandarlo como number.
 */
export async function agregarFila(params: {
  spreadsheetId: string;
  hoja: string | null;
  encabezados: string[];
  fila: (string | number)[];
}): Promise<{ rangoActualizado: string | null; conEncabezados: boolean }> {
  const { spreadsheetId, hoja, encabezados, fila } = params;

  const primera = (await sheetsFetch(
    spreadsheetId,
    hoja,
    `/values/${encodeURIComponent(rango(hoja, "1:1"))}`,
  )) as { values?: string[][] };
  const conEncabezados = !primera.values?.length;

  const ultimaColumna = String.fromCharCode(64 + encabezados.length); // 5 → "E" (hasta 26 columnas)
  const query = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "OVERWRITE" });
  const res = (await sheetsFetch(
    spreadsheetId,
    hoja,
    `/values/${encodeURIComponent(rango(hoja, `A:${ultimaColumna}`))}:append?${query}`,
    { method: "POST", body: JSON.stringify({ values: conEncabezados ? [encabezados, fila] : [fila] }) },
  )) as { updates?: { updatedRange?: string } };

  return { rangoActualizado: res.updates?.updatedRange ?? null, conEncabezados };
}
