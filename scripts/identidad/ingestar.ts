/**
 * Carga el padrón reducido del RUC de SUNAT en Supabase Storage (bucket `identidad`), repartido en
 * shards que el servicio de identidad (`src/lib/identidad/`) lee de a uno.
 *
 *   node scripts/identidad/ingestar.ts                      # descarga el padrón del día y lo sube
 *   node scripts/identidad/ingestar.ts --zip ruta.zip       # usa un zip ya descargado
 *   node scripts/identidad/ingestar.ts --solo-subir         # resube lo que quedó en la carpeta temporal
 *
 * Corre en local (Node 24, que ejecuta TypeScript directo), NO en Vercel: baja ~390 MB, procesa
 * 17,8 M de líneas y sube ~8.000 archivos (unos minutos). Lee NEXT_PUBLIC_SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY de `.env.local`. Conviene correrlo de vez en cuando (SUNAT publica a
 * diario; para validar identidad basta refrescarlo cada semana o mes).
 *
 * Qué sube (todo gzip, una línea por registro, separador "|"):
 *   dni/NNN.txt.gz       dni|nombre|iEstado|iCondicion       RUC tipo 10 = personas (DNI → nombre).
 *   ruc/NNN.txt.gz       ruc|razon_social|iEstado|iCondicion RUC 20/15/16/17 = empresas y otros.
 *   nombres/NNNN.txt.gz  dni|nombre                          índice para buscar personas por nombre.
 *   empresas/NNNN.txt.gz ruc|razon_social                    índice para buscar empresas por nombre (RUC 20).
 *   manifest.json        fecha del padrón, catálogos de estado/condición y conteos. Va ÚLTIMO: si
 *                        algo falla a mitad, sigue marcando la tanda anterior.
 *
 * Por qué el padrón del RUC sirve como tabla de DNIs: el RUC de una persona natural es
 * 10 + DNI + verificador, así que sus 15 M de filas tipo 10 son DNI → nombre completo. Solo cubre a
 * quien alguna vez sacó RUC; el resto se resuelve con la fuente externa (ver `src/lib/identidad/externa.ts`).
 * Diseño tomado de B2B-System (`src/lib/sunat/ingesta.ts`) y DatosSunat (`actualizar_padron.py`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInflateRaw, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import {
  clavesIndiceEmpresa,
  clavesIndicePersona,
  shardDni,
  shardEmpresa,
  shardNombre,
  shardRuc,
} from "../../src/lib/identidad/texto.ts";

const URL_PADRON = "https://www2.sunat.gob.pe/padron_reducido_ruc.zip";
const BUCKET = "identidad";
const CONCURRENCIA = 16;
const PREFIJOS = ["dni", "ruc", "nombres", "empresas"] as const;

const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const TMP = arg("--tmp") ?? path.join(os.tmpdir(), "centrum-identidad");
const SOLO_SUBIR = args.includes("--solo-subir");

function leerEnv(): Record<string, string> {
  const raiz = path.resolve(import.meta.dirname, "../..");
  const texto = fs.readFileSync(path.join(raiz, ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const l of texto.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString("es-PE"), ...a);

/* ── Descarga ────────────────────────────────────────────────────────────── */

async function descargar(destino: string): Promise<string | null> {
  log("Descargando", URL_PADRON);
  const res = await fetch(URL_PADRON);
  if (!res.ok || !res.body) throw new Error(`SUNAT respondió ${res.status}`);
  const lm = res.headers.get("last-modified");
  const total = Number(res.headers.get("content-length") ?? 0);
  const out = fs.createWriteStream(destino);
  let bajado = 0,
    aviso = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    bajado += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    if (bajado - aviso > 50e6) {
      aviso = bajado;
      log(`  ${(bajado / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
    }
  }
  await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())));
  return lm && !isNaN(new Date(lm).getTime()) ? new Date(lm).toISOString() : null;
}

/* ── Shardeo a disco ─────────────────────────────────────────────────────── */

/** Acumula líneas por archivo y las vuelca a disco por tandas: 45 M de líneas no entran en RAM. */
class Escritor {
  private buffers = new Map<string, string[]>();
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  add(archivo: string, linea: string) {
    const b = this.buffers.get(archivo);
    if (!b) this.buffers.set(archivo, [linea]);
    else {
      b.push(linea);
      if (b.length >= 1000) this.volcar(archivo, b);
    }
  }
  private volcar(archivo: string, b: string[]) {
    fs.appendFileSync(path.join(this.dir, archivo), b.join("\n") + "\n", "utf8");
    b.length = 0;
  }
  cerrar() {
    for (const [a, b] of this.buffers) if (b.length) this.volcar(a, b);
    this.buffers.clear();
  }
}

const VACIOS = new Set(["-", "--", "NO DISPONIBLE", "SIN DATO", ""]);
function limpio(v: string | undefined): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (VACIOS.has(s.toUpperCase())) return "";
  // SUNAT publica en mayúsculas pero a veces con la ñ en minúscula ("PIñA").
  return (/[a-z]/.test(s) ? s : s.toUpperCase()).replace(/\|/g, " ");
}

interface Conteos {
  lineas: number;
  dni: number;
  ruc: number;
  nombres: number;
  empresas: number;
  malFormadas: number;
}

async function shardear(zip: string, escritor: Escritor, estados: string[], condiciones: string[]): Promise<Conteos> {
  const idx = (cat: string[], v: string | undefined) => {
    const t = limpio(v);
    if (!t) return -1;
    const i = cat.indexOf(t);
    return i >= 0 ? i : cat.push(t) - 1;
  };
  const c: Conteos = { lineas: 0, dni: 0, ruc: 0, nombres: 0, empresas: 0, malFormadas: 0 };

  const procesar = (buf: Buffer) => {
    c.lineas++;
    if (c.lineas === 1) return; // cabecera
    if (buf.indexOf(0x7c) !== 11) return;
    const p = buf.toString("latin1").split("|"); // el padrón reducido viene en latin-1
    const ruc = p[0];
    if (!/^\d{11}$/.test(ruc)) return void c.malFormadas++;
    const nombre = limpio(p[1]);
    if (!nombre) return void c.malFormadas++;
    const iE = idx(estados, p[2]);
    const iC = idx(condiciones, p[3]);
    if (ruc.startsWith("10")) {
      const dni = ruc.slice(2, 10);
      escritor.add(`dni-${shardDni(dni)}`, `${dni}|${nombre}|${iE}|${iC}`);
      c.dni++;
      for (const clave of clavesIndicePersona(nombre)) {
        escritor.add(`nombres-${shardNombre(clave)}`, `${dni}|${nombre}`);
        c.nombres++;
      }
    } else {
      escritor.add(`ruc-${shardRuc(ruc)}`, `${ruc}|${nombre}|${iE}|${iC}`);
      c.ruc++;
      if (ruc.startsWith("20")) {
        for (const palabra of clavesIndiceEmpresa(nombre)) {
          escritor.add(`empresas-${shardEmpresa(palabra)}`, `${ruc}|${nombre}`);
          c.empresas++;
        }
      }
    }
    if (c.lineas % 2_000_000 === 0) log(`  ${(c.lineas / 1e6).toFixed(0)} M líneas`);
  };

  // El zip de SUNAT es de UNA entrada deflate: se infla desde la cabecera local sin leer el
  // directorio central del final.
  const fd = fs.openSync(zip, "r");
  const cab = Buffer.alloc(512);
  fs.readSync(fd, cab, 0, 512, 0);
  fs.closeSync(fd);
  if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error("El archivo no es un .zip válido");
  if (cab.readUInt16LE(8) !== 8) throw new Error("El zip no viene con deflate; cambió el formato de SUNAT");
  const inicio = 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);

  let resto: Buffer = Buffer.alloc(0);
  const inflate = createInflateRaw();
  inflate.on("data", (chunk: Buffer) => {
    const buf = resto.length ? Buffer.concat([resto, chunk]) : chunk;
    let ini = 0,
      nl: number;
    while ((nl = buf.indexOf(0x0a, ini)) !== -1) {
      let fin = nl;
      if (fin > ini && buf[fin - 1] === 0x0d) fin--;
      procesar(buf.subarray(ini, fin));
      ini = nl + 1;
    }
    resto = Buffer.from(buf.subarray(ini));
  });
  const fin = new Promise<void>((ok, fail) => {
    inflate.on("end", ok);
    inflate.on("error", fail);
  });
  for await (const chunk of fs.createReadStream(zip, { start: inicio, highWaterMark: 1 << 20 })) {
    if (!inflate.write(chunk)) await new Promise((r) => inflate.once("drain", r));
  }
  inflate.end();
  await fin;
  if (resto.length) procesar(resto);
  escritor.cerrar();
  return c;
}

/* ── Subida ──────────────────────────────────────────────────────────────── */

async function subir(env: Record<string, string>, dir: string, manifest: Record<string, unknown>) {
  const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: buckets, error: eb } = await supa.storage.listBuckets();
  if (eb) throw new Error(`No se pudo listar los buckets: ${eb.message}`);
  if (!buckets.some((b) => b.name === BUCKET)) {
    const { error } = await supa.storage.createBucket(BUCKET, { public: false });
    if (error) throw new Error(`No se pudo crear el bucket ${BUCKET}: ${error.message}`);
    log(`Bucket ${BUCKET} creado (privado)`);
  }

  const archivos = fs.readdirSync(dir).filter((f) => PREFIJOS.some((p) => f.startsWith(`${p}-`)));
  const cola = [...archivos].sort();
  let hechos = 0,
    bytes = 0;
  const fallos: string[] = [];
  const worker = async () => {
    for (;;) {
      const f = cola.shift();
      if (!f) return;
      const [prefijo, shard] = f.split("-");
      // Ordenadas y sin repetidos: un mismo registro puede caer dos veces en un shard de nombres
      // (dos claves con el mismo hash), y ordenadas comprimen mucho mejor.
      const lineas = [...new Set(fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean))].sort();
      const cuerpo = gzipSync(Buffer.from(lineas.join("\n") + "\n", "utf8"), { level: 9 });
      bytes += cuerpo.length;
      let err = "";
      for (let intento = 1; intento <= 5; intento++) {
        const { error } = await supa.storage
          .from(BUCKET)
          .upload(`${prefijo}/${shard}.txt.gz`, cuerpo, { contentType: "application/gzip", upsert: true });
        if (!error) {
          err = "";
          break;
        }
        err = error.message;
        await new Promise((r) => setTimeout(r, 500 * 2 ** intento));
      }
      if (err) fallos.push(`${f}: ${err}`);
      else if (++hechos % 500 === 0) log(`  subidos ${hechos}/${archivos.length} (${(bytes / 1e6).toFixed(0)} MB)`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCIA }, worker));
  if (fallos.length) {
    throw new Error(`${fallos.length} archivos no subieron; el manifest no se tocó. Reintenta con --solo-subir. Primero: ${fallos[0]}`);
  }
  const conTamano = { ...manifest, bytes_comprimidos: bytes, archivos: archivos.length };
  const { error } = await supa.storage
    .from(BUCKET)
    .upload("manifest.json", Buffer.from(JSON.stringify(conTamano, null, 2), "utf8"), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`Los shards subieron pero el manifest falló: ${error.message}`);
  log(`Listo: ${archivos.length} archivos, ${(bytes / 1e6).toFixed(0)} MB comprimidos`);
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  const env = leerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  }
  const shards = path.join(TMP, "shards");
  const manifestLocal = path.join(TMP, "manifest.json");

  if (!SOLO_SUBIR) {
    fs.rmSync(shards, { recursive: true, force: true });
    fs.mkdirSync(shards, { recursive: true });
    const zip = arg("--zip") ?? path.join(TMP, "padron_reducido_ruc.zip");
    let fecha: string | null = null;
    if (arg("--zip")) fecha = fs.statSync(zip).mtime.toISOString();
    else fecha = await descargar(zip);

    log("Repartiendo en shards…");
    const t0 = Date.now();
    const estados: string[] = [];
    const condiciones: string[] = [];
    const conteos = await shardear(zip, new Escritor(shards), estados, condiciones);
    log(`Shardeo en ${((Date.now() - t0) / 1000).toFixed(0)} s`, conteos);
    fs.writeFileSync(
      manifestLocal,
      JSON.stringify(
        {
          fuente: "padron_reducido_ruc (SUNAT)",
          url: URL_PADRON,
          fecha_fuente: fecha,
          generado_en: new Date().toISOString(),
          formato: {
            dni: "dni|nombre|idx_estado|idx_condicion · shard = dni.slice(5,8)",
            ruc: "ruc|razon_social|idx_estado|idx_condicion · shard = ruc.slice(7,10)",
            nombres: "dni|nombre · shard = fnv1a(PALABRA/INICIAL) % 4096 (ver clavesIndicePersona)",
            empresas: "ruc|razon_social · shard = fnv1a(PALABRA) % 2048 (ver clavesIndiceEmpresa)",
          },
          estados,
          condiciones,
          conteos,
        },
        null,
        2,
      ),
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestLocal, "utf8"));
  log("Subiendo a Supabase Storage…");
  await subir(env, shards, manifest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
