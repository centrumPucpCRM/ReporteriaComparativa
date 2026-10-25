/**
 * Respaldo para los DNIs que el padrón de SUNAT no tiene (gente que nunca sacó RUC). Server-only.
 *
 * Orden: 1) cache en Storage (`identidad/cache/dni/<dni>.json`) · 2) API de RENIEC si está
 * configurada · 3) eldni.com. Lo que responde 2 o 3 se guarda en 1, así un DNI se consulta afuera
 * una sola vez. Los "no encontrado" también se guardan y se revalidan a los 90 días.
 *
 * Portado de B2B-System (`src/lib/sunat/apiReniec.ts`, `eldni.ts`, `api/inhouse/padron-dni/_lib/cache.ts`).
 * Lo que allá se aprendió y sigue valiendo:
 *  - eldni.com NO atiende a Vercel (responde 404 "Not Found" a IPs de datacenter); desde una conexión
 *    doméstica (npm run dev) sí. En producción hace falta la API.
 *  - La API (Decolecta, APIs.net.pe, API Perú…) se configura solo con variables:
 *      DNI_API_URL    = https://api.decolecta.com/v1/reniec/dni
 *      DNI_API_TOKEN  = token1,token2        (varios separados por coma: si uno da 429/401/403/5xx se pasa al siguiente)
 *      DNI_API_PARAM  = numero               (opcional; nombre del parámetro del DNI)
 *      DNI_API_NOMBRE = Decolecta            (opcional; qué decir en "fuente")
 *  - Nada de acá lanza por culpa de la fuente: un fallo vuelve como `{ error }` y quien llama decide.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_IDENTIDAD } from "./padron";
import { dividirNombre } from "./texto";

export interface FichaExterna {
  dni: string;
  /** Rearmado en el orden de SUNAT: PATERNO MATERNO NOMBRES. */
  nombre: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  fuente: string;
}

export type ResultadoExterno =
  | { encontrado: true; ficha: FichaExterna; desdeCache: boolean }
  | { encontrado: false; fuente: string; desdeCache: boolean }
  | { error: string };

const DIAS_REVALIDAR = 90;

interface FilaCache {
  encontrado: boolean;
  ficha: FichaExterna | null;
  fuente: string;
  verificado_en: string;
}

const rutaCache = (dni: string) => `cache/dni/${dni}.json`;

async function leerCache(dni: string): Promise<FilaCache | null> {
  try {
    const { data } = await createAdminClient().storage.from(BUCKET_IDENTIDAD).download(rutaCache(dni));
    if (!data) return null;
    const f = JSON.parse(await data.text()) as FilaCache;
    if (!f.encontrado && Date.now() - new Date(f.verificado_en).getTime() > DIAS_REVALIDAR * 864e5) return null;
    return f;
  } catch {
    return null; // que el cache falle no puede romper la consulta
  }
}

async function escribirCache(dni: string, fila: Omit<FilaCache, "verificado_en">): Promise<void> {
  try {
    const cuerpo = JSON.stringify({ ...fila, verificado_en: new Date().toISOString() });
    await createAdminClient()
      .storage.from(BUCKET_IDENTIDAD)
      .upload(rutaCache(dni), Buffer.from(cuerpo, "utf8"), { contentType: "application/json", upsert: true });
  } catch (e) {
    console.error("[identidad] no se pudo guardar el cache del DNI:", e);
  }
}

/* ── API de RENIEC (con token) ───────────────────────────────────────────── */

const ALIAS = {
  nombres: ["nombres", "first_name", "firstName", "name", "pre_nombres"],
  paterno: ["apellidoPaterno", "apellido_paterno", "first_last_name", "surname", "apePaterno"],
  materno: ["apellidoMaterno", "apellido_materno", "second_last_name", "lastName", "apeMaterno"],
  completo: ["nombreCompleto", "nombre_completo", "full_name", "fullName"],
};

const leer = (obj: Record<string, unknown>, alias: string[]) => {
  for (const k of alias) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim();
  }
  return "";
};

export const apiReniecConfigurada = () => !!process.env.DNI_API_URL && !!process.env.DNI_API_TOKEN;
const nombreProveedor = () => process.env.DNI_API_NOMBRE || "API RENIEC";

async function consultarApi(dni: string): Promise<{ ficha: FichaExterna | null } | { error: string }> {
  const tokens = (process.env.DNI_API_TOKEN ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const url = new URL(process.env.DNI_API_URL!);
  url.searchParams.set(process.env.DNI_API_PARAM || "numero", dni);
  let ultimo = "";
  for (const token of tokens) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
    } catch (e) {
      return { error: `la API no respondió: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Cuota agotada, token inválido o gateway caído: no es culpa del DNI, probar con el siguiente token.
    if ([401, 403, 429].includes(res.status) || res.status >= 500) {
      ultimo = `la API respondió ${res.status}`;
      continue;
    }
    if (res.status === 404) return { ficha: null };
    if (!res.ok) return { error: `la API respondió ${res.status}` };
    const cuerpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!cuerpo) return { ficha: null };
    const datos = (cuerpo.data && typeof cuerpo.data === "object" ? cuerpo.data : cuerpo) as Record<string, unknown>;
    let nombres = leer(datos, ALIAS.nombres);
    let paterno = leer(datos, ALIAS.paterno);
    let materno = leer(datos, ALIAS.materno);
    if (!nombres && !paterno) {
      const completo = leer(datos, ALIAS.completo);
      if (!completo) return { ficha: null };
      ({ nombres, apellidoPaterno: paterno, apellidoMaterno: materno } = dividirNombre(completo));
    }
    return {
      ficha: {
        dni,
        nombres,
        apellidoPaterno: paterno,
        apellidoMaterno: materno,
        nombre: [paterno, materno, nombres].filter(Boolean).join(" "),
        fuente: nombreProveedor(),
      },
    };
  }
  return { error: `${ultimo || "sin respuesta"} con todos los tokens configurados (cuota agotada o token rechazado)` };
}

/* ── eldni.com (sin token; no funciona desde Vercel) ─────────────────────── */

const URL_ELDNI = "https://eldni.com/pe/buscar-datos-por-dni";
const CABECERAS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
};

function cookiesDe(h: Headers): string {
  const varias = h.getSetCookie?.();
  if (varias?.length) return varias.map((c) => c.split(";")[0]).join("; ");
  return (h.get("set-cookie") ?? "").split(";")[0];
}

async function consultarEldni(dni: string): Promise<{ ficha: FichaExterna | null } | { error: string }> {
  try {
    // GET para el token CSRF de Laravel y la cookie; luego un POST con el DNI.
    const g = await fetch(URL_ELDNI, { headers: CABECERAS, cache: "no-store" });
    if (!g.ok) {
      return {
        error:
          g.status === 404
            ? "eldni.com respondió 404 (bloquea IPs de servidor como Vercel; configurar DNI_API_URL y DNI_API_TOKEN)"
            : `eldni.com respondió ${g.status}`,
      };
    }
    const html = await g.text();
    const token = /name="_token"\s+value="([^"]+)"/.exec(html)?.[1];
    if (!token) return { error: "eldni.com cambió: no se encontró el token del formulario" };
    const form = new FormData();
    form.append("_token", token);
    form.append("dni", dni);
    const p = await fetch(URL_ELDNI, {
      method: "POST",
      headers: { ...CABECERAS, Referer: URL_ELDNI, Cookie: cookiesDe(g.headers) },
      body: form,
      cache: "no-store",
    });
    if (p.status === 429) return { error: "eldni.com está limitando las consultas (HTTP 429)" };
    if (!p.ok) return { error: `eldni.com respondió ${p.status}` };
    // Tabla DNI | Nombres | Ap. Paterno | Ap. Materno. La primera celda tiene que ser el DNI consultado.
    const celdas = [...(await p.text()).matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
    if (celdas.length < 4 || celdas[0].replace(/\D/g, "") !== dni) return { ficha: null };
    const [, nombres, paterno, materno] = celdas;
    return {
      ficha: { dni, nombres, apellidoPaterno: paterno, apellidoMaterno: materno, nombre: [paterno, materno, nombres].filter(Boolean).join(" "), fuente: "eldni.com" },
    };
  } catch (e) {
    return { error: `eldni.com no respondió: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Resuelve un DNI que no está en el padrón. */
export async function buscarDniExterno(dni: string): Promise<ResultadoExterno> {
  const cache = await leerCache(dni);
  if (cache) {
    return cache.encontrado && cache.ficha
      ? { encontrado: true, ficha: cache.ficha, desdeCache: true }
      : { encontrado: false, fuente: cache.fuente, desdeCache: true };
  }
  const r = apiReniecConfigurada() ? await consultarApi(dni) : await consultarEldni(dni);
  if ("error" in r) return r;
  const fuente = apiReniecConfigurada() ? nombreProveedor() : "eldni.com";
  await escribirCache(dni, { encontrado: !!r.ficha, ficha: r.ficha, fuente });
  return r.ficha ? { encontrado: true, ficha: r.ficha, desdeCache: false } : { encontrado: false, fuente, desdeCache: false };
}
