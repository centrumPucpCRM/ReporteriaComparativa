/**
 * Núcleo puro del servicio de identidad (DNI / RUC): normalización, comparación de nombres,
 * dígito verificador y claves de shard.
 *
 * SIN IMPORTS a propósito: lo usan el servidor de Next (`src/lib/identidad/*`), la UI y el script
 * de ingesta (`scripts/identidad/ingestar.ts`, que corre con Node directo). Las claves de shard
 * que calcula la ingesta y las que calcula la búsqueda TIENEN que salir de la misma función: si
 * divergen, la búsqueda lee el archivo equivocado y no encuentra nada, sin ningún error.
 *
 * La comparación de nombres está portada de B2B-System (`src/lib/sunat/nombres.ts`), que a su vez
 * porta `datossunat/lib_nombres.py` del proyecto DatosSunat: mismos umbrales, mismo algoritmo de
 * parecido (`difflib.SequenceMatcher.ratio`). Ver allá el porqué de cada valor.
 */

/* ── Normalización ───────────────────────────────────────────────────────── */

/** Palabras que aparecen como ruido en nombres de personas. */
const RUIDO = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "DA", "DI", "VDA", "VIUDA"]);

/** MAYÚSCULAS, sin tildes (Ñ → N), sin puntuación, sin espacios extra. */
export function normalizar(texto: string | null | undefined): string {
  if (texto == null) return "";
  return String(texto)
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras significativas de un nombre de persona (sin dígitos ni partículas). */
export function tokens(texto: string | null | undefined): string[] {
  const todas = normalizar(texto).replace(/[0-9]+/g, " ").split(" ").filter(Boolean);
  const sinRuido = todas.filter((p) => !RUIDO.has(p));
  // Si el nombre entero era ruido ("DE LA CRUZ"), vale más comparar el ruido que comparar contra vacío.
  return sinRuido.length ? sinRuido : todas;
}

/**
 * Formas societarias y relleno que no identifican a una empresa: "S.A.C." contra "SAC" o su
 * ausencia no debe bajar el parecido.
 */
const RUIDO_EMPRESA = new Set([
  "S", "A", "C", "R", "L", "E", "I", "SA", "SAC", "SAA", "SRL", "EIRL", "SCRL", "SAS", "SCR", "SOC",
  "SOCIEDAD", "ANONIMA", "CERRADA", "ABIERTA", "RESPONSABILIDAD", "LIMITADA", "COMERCIAL",
  "EMPRESA", "INDIVIDUAL", "DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "EN", "E", "THE", "AND", "OF",
]);

/**
 * Palabras de empresa tan comunes que no sirven para encontrarla (decenas de miles de razones
 * sociales las llevan). Sí cuentan para comparar; solo no se usan como clave del índice, salvo
 * que la razón social no tenga otra cosa.
 */
const GENERICAS_EMPRESA = new Set([
  "SERVICIOS", "SERVICIO", "INVERSIONES", "INVERSION", "GRUPO", "CORPORACION", "CORPORATIVO",
  "NEGOCIACIONES", "NEGOCIOS", "INDUSTRIAS", "INDUSTRIAL", "COMPANIA", "CIA", "PERU", "PERUANA",
  "PERUANO", "GENERALES", "GENERAL", "MULTISERVICIOS", "CONSTRUCTORA", "CONSTRUCCION",
  "CONSTRUCCIONES", "CONSULTORES", "CONSULTORIA", "CONSULTING", "IMPORTACIONES", "EXPORTACIONES",
  "IMPORT", "EXPORT", "TRANSPORTES", "TRANSPORTE", "DISTRIBUIDORA", "DISTRIBUCIONES", "INGENIERIA",
  "SOLUCIONES", "ASOCIACION", "CONTRATISTAS", "INMOBILIARIA", "AGROINDUSTRIAL", "NACIONAL",
  "INTERNACIONAL", "INTERNATIONAL", "GROUP", "SOLUTIONS", "PERU", "SUR", "NORTE", "CENTRO",
]);

/** Palabras significativas de una razón social (sin formas societarias). */
export function tokensEmpresa(texto: string | null | undefined): string[] {
  const todas = normalizar(texto).split(" ").filter(Boolean);
  const utiles = todas.filter((p) => !RUIDO_EMPRESA.has(p));
  return utiles.length ? utiles : todas;
}

/* ── Parecido entre dos palabras (difflib.SequenceMatcher.ratio) ──────────── */

export function parecido(a: string, b: string): number {
  const total = a.length + b.length;
  if (!total) return 1;

  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const arr = b2j.get(b[j]);
    if (arr) arr.push(j);
    else b2j.set(b[j], [j]);
  }

  function bloqueMasLargo(alo: number, ahi: number, blo: number, bhi: number) {
    let besti = alo,
      bestj = blo,
      bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const nuevo = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        nuevo.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = nuevo;
    }
    return { i: besti, j: bestj, k: bestsize };
  }

  let calzados = 0;
  const cola: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (cola.length) {
    const [alo, ahi, blo, bhi] = cola.pop()!;
    const { i, j, k } = bloqueMasLargo(alo, ahi, blo, bhi);
    if (!k) continue;
    calzados += k;
    if (alo < i && blo < j) cola.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) cola.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * calzados) / total;
}

/* ── Puntaje entre dos nombres ───────────────────────────────────────────── */

/** Cuánto baja el puntaje por cada palabra que sobra en el nombre registrado (el del lead). */
const PENALIDAD: Record<number, number> = { 0: 0.0, 1: 0.04, 2: 0.15 };
/** Con al menos estas palabras en el lead, que la fuente oficial tenga de más no penaliza (nombre abreviado). */
const PALABRAS_MINIMAS = 2;

const redondear = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Parecido de 0 a 1 entre lo que registró el lead y el nombre oficial. Ignora el orden de las
 * palabras. NO es simétrica: el primer argumento es el del lead, el segundo el oficial.
 */
function evaluar(ta: string[], tb: string[]): { puntaje: number; peorPalabra: number } {
  if (!ta.length || !tb.length) return { puntaje: 0, peorPalabra: 0 };
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const disponibles = [...largo];
  const puntajes: number[] = [];
  for (const palabra of corto) {
    if (!disponibles.length) break;
    let mejorI = 0,
      mejor = -1;
    for (let i = 0; i < disponibles.length; i++) {
      const p = parecido(palabra, disponibles[i]);
      if (p > mejor) {
        mejor = p;
        mejorI = i;
      }
    }
    disponibles.splice(mejorI, 1);
    puntajes.push(mejor);
  }
  const base = puntajes.reduce((a, b) => a + b, 0) / puntajes.length;
  const sobrantes = largo.length - corto.length;
  const sobranEnOficial = tb.length > ta.length;
  const penalidad =
    sobranEnOficial && ta.length >= PALABRAS_MINIMAS ? 0 : (PENALIDAD[sobrantes] ?? 0.15 + 0.11 * (sobrantes - 2));
  return { puntaje: redondear(Math.max(base - penalidad, 0)), peorPalabra: redondear(Math.min(...puntajes)) };
}

/** Parecido entre el nombre del lead y el oficial (persona), de 0 a 1. */
export function similitud(nombreLead: string, nombreOficial: string): number {
  const a = tokens(nombreLead);
  const b = tokens(nombreOficial);
  // Mismas palabras aunque cambie el orden o se repita una: es la misma persona.
  const sa = new Set(a),
    sb = new Set(b);
  if (sa.size && sa.size === sb.size && [...sa].every((t) => sb.has(t))) return 1;
  return evaluar(a, b).puntaje;
}

/**
 * Cuánto de `de` aparece en `en`: promedio del mejor parecido de cada palabra, pesado por su largo.
 * `faltantes` = palabras de `de` sin ninguna parecida en `en` (ni con un error de tipeo).
 */
function cobertura(de: string[], en: string[]): { valor: number; faltantes: number } {
  let suma = 0,
    peso = 0,
    faltantes = 0;
  for (const p of de) {
    let mejor = 0;
    for (const q of en) mejor = Math.max(mejor, parecido(p, q));
    if (mejor < 0.8) faltantes++;
    suma += mejor * p.length;
    peso += p.length;
  }
  return { valor: peso ? suma / peso : 0, faltantes };
}

/** Cada palabra del lead que no está en la razón social multiplica el puntaje por esto. */
const FACTOR_FALTANTE_EMPRESA = 0.8;

/**
 * Parecido entre la razón social del lead y la oficial, de 0 a 1.
 *
 * NO usa la fórmula de personas: ahí una palabra de más del lead casi no penaliza, y "Hochschild
 * Mining Peru" contra "PERU MINING E.I.R.L." daba 96%. Acá manda cuánto de lo que escribió el lead
 * está en la razón social (85%), pesando cada palabra por su largo — las distintivas suelen ser las
 * largas (HOCHSCHILD) y las que se repiten en miles de empresas, cortas (PERU) —, más un poco de
 * cuánto de la oficial aparece en lo del lead (15%) para desempatar a favor del nombre más completo.
 * Cada palabra del lead que no aparece en la oficial castiga fuerte ("Universidad de Lima" contra
 * "UNIVERSIDAD NACIONAL DE INGENIERIA" no puede pasar por compartir la palabra larga).
 * Que el lead abrevie ("Constructora Andes" por "CONSTRUCTORA E INMOBILIARIA LOS ANDES") no penaliza.
 */
export function similitudEmpresa(empresaLead: string, empresaOficial: string): number {
  const a = tokensEmpresa(empresaLead);
  const b = tokensEmpresa(empresaOficial);
  if (!a.length || !b.length) return 0;
  const sa = new Set(a),
    sb = new Set(b);
  if (sa.size === sb.size && [...sa].every((t) => sb.has(t))) return 1;
  const delLead = cobertura(a, b);
  const base = 0.85 * delLead.valor + 0.15 * cobertura(b, a).valor;
  return redondear(base * FACTOR_FALTANTE_EMPRESA ** delLead.faltantes);
}

/** Umbral del flujo Eloqua → Oracle: el nombre (o razón social) tiene que coincidir al menos 75%. */
export const UMBRAL_IDENTIDAD = 0.75;

/* ── Partir un nombre oficial en apellidos y nombres ─────────────────────── */

const PARTICULAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "DA", "DI", "VDA", "SAN", "SANTA", "Y"]);

export interface NombrePartido {
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombres: string;
}

/**
 * Separa "PATERNO MATERNO NOMBRES" (formato del padrón de SUNAT) en sus tres partes, absorbiendo
 * las partículas de los apellidos compuestos ("NIÑO DE GUZMAN", "DE LA CRUZ"). Es una heurística:
 * cuando la fuente ya trae los campos separados (eldni, API RENIEC) se usan esos.
 * Portado de `dividirNombreSunat` de B2B-System.
 */
export function dividirNombre(completo: string): NombrePartido {
  const t = String(completo ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const esParticula = (w: string) => PARTICULAS.has(normalizar(w));
  if (!t.length) return { apellidoPaterno: "", apellidoMaterno: "", nombres: "" };
  if (t.length === 1) return { apellidoPaterno: t[0], apellidoMaterno: "", nombres: "" };

  const tomar = (i: number, limite: number): [string, number] => {
    const partes: string[] = [];
    let j = i;
    const arrancaConParticula = esParticula(t[j]);
    while (j < limite && esParticula(t[j])) partes.push(t[j++]);
    if (j < limite) partes.push(t[j++]);
    if (!arrancaConParticula) {
      for (;;) {
        if (j >= limite || !esParticula(t[j])) break;
        let m = j;
        while (m < limite && esParticula(t[m])) m++;
        if (m >= limite) break;
        for (let x = j; x <= m; x++) partes.push(t[x]);
        j = m + 1;
      }
    }
    return [partes.join(" "), j];
  };

  const limite = t.length - 1;
  const [apellidoPaterno, tras1] = tomar(0, limite);
  if (tras1 >= limite) return { apellidoPaterno, apellidoMaterno: "", nombres: t.slice(tras1).join(" ") };
  const [apellidoMaterno, tras2] = tomar(tras1, limite);
  return { apellidoPaterno, apellidoMaterno, nombres: t.slice(tras2).join(" ") };
}

/* ── DNI y RUC ───────────────────────────────────────────────────────────── */

/**
 * DNI peruano = 8 dígitos. Repone los ceros a la izquierda que se comió Excel ("3040421" →
 * "03040421"), pero no por debajo de 5 dígitos: completar más inventaría el documento de otra
 * persona. null = no es un DNI.
 */
export function dniValido(valor: unknown): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  if (!/^[\d\s.'-]+$/.test(s)) return null;
  const d = s.replace(/\D/g, "");
  if (d.length < 5 || d.length > 8) return null;
  return d.padStart(8, "0");
}

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

function digitoVerificador(base10: string): number {
  const suma = [...base10].reduce((a, d, i) => a + Number(d) * PESOS_RUC[i], 0);
  const dv = 11 - (suma % 11);
  return dv === 10 ? 0 : dv === 11 ? 1 : dv;
}

/** RUC con prefijo válido (10, 15, 16, 17, 20) y dígito verificador oficial de SUNAT. */
export function rucValido(valor: unknown): string | null {
  const ruc = String(valor ?? "").replace(/\D/g, "");
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return null;
  return digitoVerificador(ruc.slice(0, 10)) === Number(ruc[10]) ? ruc : null;
}

/** RUC de una persona natural: 10 + DNI + verificador. */
export function rucDeDni(dni: string): string {
  const base = "10" + dni.padStart(8, "0");
  return base + String(digitoVerificador(base));
}

/* ── Claves de shard (ingesta y búsqueda DEBEN coincidir) ────────────────── */

/** Shard del padrón por DNI: los últimos 3 dígitos (= ruc.slice(7,10) del RUC 10). Reparte parejo. */
export const shardDni = (dni: string) => dni.padStart(8, "0").slice(5, 8);
/** Shard del padrón por RUC: los 3 dígitos previos al verificador (medido en B2B-System: reparte parejo). */
export const shardRuc = (ruc: string) => ruc.slice(7, 10);

export const SHARDS_NOMBRES = 4096;
export const SHARDS_EMPRESAS = 2048;

/** FNV-1a de 32 bits: estable entre Node y el navegador, sin dependencias. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const claveNombre = (palabra: string, inicial: string) => `${palabra}/${inicial}`;
export const shardNombre = (clave: string) => String(hash(clave) % SHARDS_NOMBRES).padStart(4, "0");
export const shardEmpresa = (palabra: string) => String(hash(palabra) % SHARDS_EMPRESAS).padStart(4, "0");

/**
 * Bajo qué claves se indexa a una persona del padrón ("PATERNO MATERNO NOMBRES"):
 *   PATERNO + inicial del materno · MATERNO + inicial del paterno · PATERNO + inicial del 1er nombre.
 * Así se la encuentra aunque el lead traiga un apellido mal escrito (la otra clave calza) o solo
 * el paterno y el nombre ("Andre Zambrano" → ZAMBRANO/A). Una palabra sola sería un shard enorme
 * (QUISPE); con la inicial de otra palabra el shard queda chico.
 */
export function clavesIndicePersona(nombreOficial: string): string[] {
  const t = tokens(nombreOficial);
  if (t.length < 2) return t.length ? [claveNombre(t[0], "")] : [];
  const claves = [claveNombre(t[0], t[1][0]), claveNombre(t[1], t[0][0])];
  if (t.length >= 3) claves.push(claveNombre(t[0], t[2][0]));
  return [...new Set(claves)];
}

/** Claves a consultar para un nombre escrito por el lead (orden desconocido): todos los pares. */
export function clavesBusquedaPersona(nombreLead: string): string[] {
  const t = [...new Set(tokens(nombreLead))].slice(0, 6);
  if (t.length === 1) return [claveNombre(t[0], "")];
  const claves = new Set<string>();
  for (const a of t) for (const b of t) if (a !== b) claves.add(claveNombre(a, b[0]));
  return [...claves];
}

/** Palabras de una razón social que se usan como clave del índice (hasta 3, las no genéricas primero). */
export function clavesIndiceEmpresa(razonSocial: string): string[] {
  const t = [...new Set(tokensEmpresa(razonSocial))].filter((p) => p.length >= 2);
  const propias = t.filter((p) => !GENERICAS_EMPRESA.has(p));
  return (propias.length ? propias : t).slice(0, 3);
}

/** Palabras a consultar para una empresa escrita por el lead. */
export function clavesBusquedaEmpresa(empresaLead: string): string[] {
  const t = [...new Set(tokensEmpresa(empresaLead))].filter((p) => p.length >= 2);
  const propias = t.filter((p) => !GENERICAS_EMPRESA.has(p));
  return (propias.length ? propias : t).slice(0, 5);
}
