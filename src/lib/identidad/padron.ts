/**
 * Lectura del padrón de SUNAT cargado en Supabase Storage (bucket `identidad`, server-only).
 *
 * Lo carga `scripts/identidad/ingestar.ts` (ver ahí el formato de cada prefijo). Cada consulta baja
 * solo el shard que le toca (~80-300 KB gzip): un DNI o un RUC = 1 archivo; una búsqueda por nombre
 * = un archivo por cada par de palabras del nombre. Los shards leídos quedan en memoria mientras la
 * función esté tibia, así una prueba repetida no vuelve a bajarlos.
 *
 * Límites del padrón (heredados de DatosSunat / B2B-System, no romperlos sin releerlos):
 *  - Solo cubre a quien alguna vez sacó RUC. Que un DNI no esté NO significa que sea inválido: para
 *    esos está la fuente externa (`externa.ts`).
 *  - `estado` / `condicion` son el estado TRIBUTARIO del RUC ("BAJA DE OFICIO" = dejó de facturar),
 *    no dicen nada del DNI. Son informativos: no hacen fallar una validación.
 */
import { gunzipSync } from "node:zlib";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clavesBusquedaEmpresa,
  clavesBusquedaPersona,
  clavesIndiceEmpresa,
  clavesIndicePersona,
  dniValido,
  rucValido,
  shardDni,
  shardEmpresa,
  shardNombre,
  shardRuc,
  similitud,
  similitudEmpresa,
} from "./texto";

export const BUCKET_IDENTIDAD = "identidad";

export interface ManifestPadron {
  fecha_fuente: string | null;
  generado_en: string | null;
  estados: string[];
  condiciones: string[];
  conteos?: Record<string, number>;
}

export interface FichaDni {
  dni: string;
  /** Formato SUNAT: PATERNO MATERNO NOMBRES. */
  nombre: string;
  estado: string | null;
  condicion: string | null;
}

export interface FichaRuc {
  ruc: string;
  razonSocial: string;
  estado: string | null;
  condicion: string | null;
  /** RUC 10 = persona natural (sale del padrón por DNI). */
  tipo: "PERSONA" | "EMPRESA";
}

export interface Candidato {
  /** DNI (personas) o RUC (empresas). */
  documento: string;
  nombre: string;
  /** 0 a 1. */
  similitud: number;
}

/* ── Cache en memoria (vive mientras la función esté tibia) ──────────────── */

const MAX_SHARDS_EN_MEMORIA = 300;
const shards = new Map<string, string[]>();
let manifest: { valor: ManifestPadron | null; leido: number } | null = null;

async function descargar(ruta: string): Promise<Buffer | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET_IDENTIDAD).download(ruta);
  if (error || !data) {
    // "Object not found" es un shard sin registros: normal. Cualquier otra cosa es un fallo real.
    const msg = (error as { message?: string } | null)?.message ?? "";
    const status = (error as { status?: number; statusCode?: string } | null)?.status;
    if (status === 400 || status === 404 || /not.?found/i.test(msg) || msg === "{}" || !msg) return null;
    throw new Error(`No se pudo leer ${ruta} del padrón en Storage: ${msg}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

async function leerShard(ruta: string): Promise<string[]> {
  const ya = shards.get(ruta);
  if (ya) return ya;
  const crudo = await descargar(ruta);
  const lineas = crudo ? gunzipSync(crudo).toString("utf8").split("\n").filter(Boolean) : [];
  if (shards.size >= MAX_SHARDS_EN_MEMORIA) shards.delete(shards.keys().next().value!);
  shards.set(ruta, lineas);
  return lineas;
}

export async function leerManifest(): Promise<ManifestPadron | null> {
  if (manifest && Date.now() - manifest.leido < 10 * 60_000) return manifest.valor;
  const crudo = await descargar("manifest.json");
  let valor: ManifestPadron | null = null;
  if (crudo) {
    const m = JSON.parse(crudo.toString("utf8")) as Partial<ManifestPadron>;
    valor = {
      fecha_fuente: m.fecha_fuente ?? null,
      generado_en: m.generado_en ?? null,
      estados: m.estados ?? [],
      condiciones: m.condiciones ?? [],
      conteos: m.conteos,
    };
  }
  manifest = { valor, leido: Date.now() };
  return valor;
}

async function manifestObligatorio(): Promise<ManifestPadron> {
  const m = await leerManifest();
  if (!m) {
    throw new Error(
      "El padrón de SUNAT no está cargado en Storage (bucket identidad). Correr `node scripts/identidad/ingestar.ts`.",
    );
  }
  return m;
}

/* ── Lookups ─────────────────────────────────────────────────────────────── */

/** Busca una línea "clave|..." en un shard (las líneas están ordenadas, pero son pocas: recorrido lineal). */
function lineaDe(lineas: string[], clave: string): string[] | null {
  const prefijo = clave + "|";
  const l = lineas.find((x) => x.startsWith(prefijo));
  return l ? l.split("|") : null;
}

/** DNI → nombre según el padrón. null = no está (nunca sacó RUC), que no es lo mismo que inválido. */
export async function buscarDni(valor: string): Promise<FichaDni | null> {
  const dni = dniValido(valor);
  if (!dni) return null;
  const m = await manifestObligatorio();
  const p = lineaDe(await leerShard(`dni/${shardDni(dni)}.txt.gz`), dni);
  if (!p) return null;
  return { dni, nombre: p[1], estado: m.estados[Number(p[2])] ?? null, condicion: m.condiciones[Number(p[3])] ?? null };
}

/** RUC → razón social. RUC 10 se resuelve con el padrón de personas (10 + DNI + verificador). */
export async function buscarRuc(valor: string): Promise<FichaRuc | null> {
  const ruc = rucValido(valor);
  if (!ruc) return null;
  if (ruc.startsWith("10")) {
    const f = await buscarDni(ruc.slice(2, 10));
    return f ? { ruc, razonSocial: f.nombre, estado: f.estado, condicion: f.condicion, tipo: "PERSONA" } : null;
  }
  const m = await manifestObligatorio();
  const p = lineaDe(await leerShard(`ruc/${shardRuc(ruc)}.txt.gz`), ruc);
  if (!p) return null;
  return { ruc, razonSocial: p[1], estado: m.estados[Number(p[2])] ?? null, condicion: m.condiciones[Number(p[3])] ?? null, tipo: "EMPRESA" };
}

/** Lee varios shards con concurrencia acotada. */
async function leerVarios(rutas: string[]): Promise<string[][]> {
  const unicas = [...new Set(rutas)];
  const salida: string[][] = [];
  const cola = [...unicas];
  await Promise.all(
    Array.from({ length: Math.min(8, cola.length) }, async () => {
      for (let r = cola.shift(); r; r = cola.shift()) salida.push(await leerShard(r));
    }),
  );
  return salida;
}

function mejores(cands: Map<string, Candidato>, limite: number): Candidato[] {
  return [...cands.values()].sort((a, b) => b.similitud - a.similitud || a.documento.localeCompare(b.documento)).slice(0, limite);
}

/**
 * Personas del padrón cuyo nombre se parece al del lead, de mayor a menor coincidencia.
 * Solo encuentra a quien comparta con el lead al menos un apellido escrito igual más la inicial de
 * otra palabra (ver `clavesIndicePersona`): no es una búsqueda difusa sobre los 15 M de registros.
 */
export async function buscarPersonasPorNombre(nombreLead: string, limite = 10): Promise<Candidato[]> {
  await manifestObligatorio();
  const claves = new Set(clavesBusquedaPersona(nombreLead));
  if (!claves.size) return [];
  const archivos = await leerVarios([...claves].map((c) => `nombres/${shardNombre(c)}.txt.gz`));
  const cands = new Map<string, Candidato>();
  for (const lineas of archivos) {
    for (const l of lineas) {
      const corte = l.indexOf("|");
      const dni = l.slice(0, corte);
      if (cands.has(dni)) continue;
      const nombre = l.slice(corte + 1);
      // El shard mezcla claves de otras palabras (colisiones del hash): solo cuentan las que calzan.
      if (!clavesIndicePersona(nombre).some((c) => claves.has(c))) continue;
      cands.set(dni, { documento: dni, nombre, similitud: similitud(nombreLead, nombre) });
    }
  }
  return mejores(cands, limite);
}

/** Empresas (RUC 20) cuya razón social se parece a la del lead, de mayor a menor coincidencia. */
export async function buscarEmpresasPorNombre(empresaLead: string, limite = 10): Promise<Candidato[]> {
  await manifestObligatorio();
  const palabras = new Set(clavesBusquedaEmpresa(empresaLead));
  if (!palabras.size) return [];
  const archivos = await leerVarios([...palabras].map((p) => `empresas/${shardEmpresa(p)}.txt.gz`));
  const cands = new Map<string, Candidato>();
  for (const lineas of archivos) {
    for (const l of lineas) {
      const corte = l.indexOf("|");
      const ruc = l.slice(0, corte);
      if (cands.has(ruc)) continue;
      const razon = l.slice(corte + 1);
      if (!clavesIndiceEmpresa(razon).some((p) => palabras.has(p))) continue;
      cands.set(ruc, { documento: ruc, nombre: razon, similitud: similitudEmpresa(empresaLead, razon) });
    }
  }
  return mejores(cands, limite);
}
