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

// Tolera errores típicos al pegar en Vercel: prefijo `NOMBRE=` y comillas alrededor.
function leerEnv(name: string): string {
  const raw = (process.env[name] || "").trim();
  const valor = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;
  return valor.replace(/^['"]|['"],?$/g, "").trim();
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
    const detalle = data.error_description || `HTTP ${res.status}`;
    const pista = /account not found/i.test(detalle)
      ? ` GOOGLE_CLIENT_EMAIL ("${sa.client_email}") no corresponde a ningún service account: revisar el valor.`
      : /signature/i.test(detalle)
        ? " GOOGLE_PRIVATE_KEY no corresponde a GOOGLE_CLIENT_EMAIL: revisar que esté completa."
        : "";
    throw new GoogleSheetsError(`No se pudo autenticar el service account en Google: ${detalle}.${pista}`, 502);
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
function rango(hoja: string, celdas: string): string {
  return `'${hoja.replace(/'/g, "''")}'!${celdas}`;
}

/** Letra de columna A1: 1 → "A", 26 → "Z", 27 → "AA". */
function letraColumna(n: number): string {
  let letra = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) letra = String.fromCharCode(65 + ((n - 1) % 26)) + letra;
  return letra;
}

async function sheetsFetch(
  spreadsheetId: string,
  hoja: string,
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

type Celda = string | number;

// Escrituras en curso por documento+pestaña: dentro de un mismo proceso se encolan para
// que dos webhooks simultáneos no calculen la misma "primera fila libre".
const escrituras = new Map<string, Promise<unknown>>();

async function enCola<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const actual = (escrituras.get(clave) ?? Promise.resolve()).catch(() => undefined).then(fn);
  escrituras.set(clave, actual);
  try {
    return await actual;
  } finally {
    if (escrituras.get(clave) === actual) escrituras.delete(clave);
  }
}

function mismaFila(a: unknown[] | undefined, b: Celda[]): boolean {
  const norm = (f: unknown[]) => {
    const t = f.map((v) => String(v ?? ""));
    while (t.length && t[t.length - 1] === "") t.pop();
    return JSON.stringify(t);
  };
  return norm(a ?? []) === norm(b);
}

/**
 * Escribe `fila` debajo de la última fila con datos en las columnas que ocupa (A:E si son
 * 5 valores). Si esas columnas están vacías, escribe antes los `encabezados` en la fila 1.
 *
 * - No usa `values:append`: su detección de "tabla" incluye columnas vecinas, y en una
 *   pestaña con fórmulas pre-cargadas a la derecha (p. ej. F2:F307) escribía después de la
 *   última fórmula. Aquí la fila libre se calcula solo con A:<última columna> y se escribe
 *   sobre ella, así las fórmulas de la derecha quedan alineadas con su fila.
 * - Tras escribir se relee la fila: si otra escritura simultánea (otra instancia) la pisó,
 *   se reintenta en la siguiente fila libre.
 * - valueInputOption=RAW: los textos se guardan tal cual (un "=" no se evalúa como
 *   fórmula). Para que un valor quede como número hay que mandarlo como number.
 */
export async function agregarFila(params: {
  spreadsheetId: string;
  hoja: string;
  encabezados: string[];
  fila: Celda[];
}): Promise<{ rangoActualizado: string; conEncabezados: boolean }> {
  const { spreadsheetId, hoja, encabezados, fila } = params;
  const ultima = letraColumna(Math.max(fila.length, encabezados.length, 1));
  const leer = async (celdas: string) =>
    (
      (await sheetsFetch(
        spreadsheetId,
        hoja,
        `/values/${encodeURIComponent(rango(hoja, celdas))}?valueRenderOption=UNFORMATTED_VALUE`,
      )) as { values?: unknown[][] }
    ).values ?? [];

  return enCola(`${spreadsheetId}|${hoja}`, async () => {
    for (let intento = 0; intento < 3; intento++) {
      const ocupadas = (await leer(`A:${ultima}`)).length;
      const conEncabezados = ocupadas === 0;
      const destino = conEncabezados ? 2 : ocupadas + 1;
      const inicio = conEncabezados ? 1 : destino;

      await sheetsFetch(
        spreadsheetId,
        hoja,
        `/values/${encodeURIComponent(rango(hoja, `A${inicio}:${ultima}${destino}`))}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: conEncabezados ? [encabezados, fila] : [fila] }) },
      );

      if (mismaFila((await leer(`A${destino}:${ultima}${destino}`))[0], fila)) {
        return { rangoActualizado: `${hoja}!A${destino}:${ultima}${destino}`, conEncabezados };
      }
    }
    throw new GoogleSheetsError(
      "No se pudo escribir la fila: otras escrituras simultáneas ocuparon la fila libre. Reintentar.",
      409,
    );
  });
}
