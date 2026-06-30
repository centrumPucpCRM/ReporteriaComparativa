import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkApiKey } from "@/lib/api-auth";
import { resolveTable, type TableDef } from "../_tables";

// El batch procesa hasta 500 filas con concurrencia acotada; damos margen de tiempo.
export const maxDuration = 60;

type Ctx = { params: Promise<{ table: string }> };
type AdminClient = ReturnType<typeof createAdminClient>;

const BATCH_MAX = 500;
const BATCH_CONCURRENCY = 20;

function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[infobip-ext API]", message);
  return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
}

// Construye el payload de una fila:
//  - preserveOnNull: descarta claves null/undefined para que el upsert no pise un
//    valor existente con NULL (equivale a COALESCE(entrante, actual)).
//  - touch: sella la columna de "actualizado" con now(), SALVO que el caller haya
//    enviado un valor explícito (ej. migración histórica que preserva la fecha real).
function buildPayload(target: TableDef, body: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...body };
  if (target.preserveOnNull) {
    for (const key of Object.keys(payload)) {
      if (payload[key] === null || payload[key] === undefined) delete payload[key];
    }
  }
  if (target.touch && payload[target.touch] == null) {
    payload[target.touch] = new Date().toISOString();
  }
  return payload;
}

// Escribe una fila: UPSERT si la tabla declara `upsertOn`, INSERT si no.
async function writeRow(
  admin: AdminClient,
  target: TableDef,
  body: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  const payload = buildPayload(target, body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableRef = admin.schema(target.schema).from(target.table as any);
  const res = target.upsertOn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await tableRef.upsert(payload as any, { onConflict: target.upsertOn }).select().single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : await tableRef.insert(payload as any).select().single();
  return { data: res.data, error: res.error ? res.error.message : null };
}

// Identificador de la fila para el reporte por-fila del batch (columnas de upsertOn).
function rowKey(target: TableDef, row: Record<string, unknown>, index: number): Record<string, unknown> {
  if (!target.upsertOn) return { _index: index };
  const key: Record<string, unknown> = {};
  for (const c of target.upsertOn.split(",")) {
    const col = c.trim();
    key[col] = row[col] ?? null;
  }
  return key;
}

// Procesa un array de filas (hasta BATCH_MAX) con concurrencia acotada. Inserta las
// válidas y reporta por-fila éxito/error, para reintentar solo las fallidas.
async function handleBatch(
  admin: AdminClient,
  target: TableDef,
  rows: unknown[],
): Promise<NextResponse> {
  if (rows.length === 0) {
    return NextResponse.json({ error: "El array no puede estar vacío." }, { status: 400 });
  }
  if (rows.length > BATCH_MAX) {
    return NextResponse.json(
      { error: `Máximo ${BATCH_MAX} filas por lote (recibidas ${rows.length}).` },
      { status: 400 },
    );
  }

  type RowResult = { key: Record<string, unknown>; ok: boolean; error?: string };
  const results: RowResult[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i += BATCH_CONCURRENCY) {
    const chunk = rows.slice(i, i + BATCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async (row, j) => {
        const index = i + j;
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          results[index] = { key: { _index: index }, ok: false, error: "La fila debe ser un objeto JSON." };
          return;
        }
        const r = row as Record<string, unknown>;
        try {
          const { error } = await writeRow(admin, target, r);
          results[index] = error
            ? { key: rowKey(target, r, index), ok: false, error }
            : { key: rowKey(target, r, index), ok: true };
        } catch (e) {
          results[index] = {
            key: rowKey(target, r, index),
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json(
    { total: rows.length, ok: rows.length - failed, failed, results },
    { status: 200 },
  );
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const auth = checkApiKey(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { table: slug } = await params;
    const target = resolveTable(slug);
    if (!target) {
      return NextResponse.json({ error: `Tabla "${slug}" no encontrada.` }, { status: 404 });
    }

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      500,
      Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "25") || 25),
    );
    const offset = (page - 1) * pageSize;

    const incompletos = ["true", "1", "yes"].includes(
      (url.searchParams.get("incompletos") ?? "").toLowerCase(),
    );

    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = admin.schema(target.schema).from(target.table as any).select("*", { count: "exact" });
    // ?incompletos=true → solo filas con alguna columna de completitud en NULL.
    if (incompletos && target.incompleteColumns?.length) {
      query = query.or(target.incompleteColumns.map((c) => `${c}.is.null`).join(","));
    }
    query = query.order(target.primaryKey, { ascending: false });
    query = query.range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const auth = checkApiKey(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { table: slug } = await params;
    const target = resolveTable(slug);
    if (!target) {
      return NextResponse.json({ error: `Tabla "${slug}" no encontrada.` }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
    }

    if (!Array.isArray(body) && (typeof body !== "object" || body === null)) {
      return NextResponse.json({ error: "Body debe ser un objeto JSON o un array de objetos." }, { status: 400 });
    }

    const admin = createAdminClient();

    if (Array.isArray(body)) {
      return handleBatch(admin, target, body);
    }

    const { data, error } = await writeRow(admin, target, body as Record<string, unknown>);
    if (error) return NextResponse.json({ error }, { status: 400 });

    return NextResponse.json({ data }, { status: target.upsertOn ? 200 : 201 });
  } catch (e) {
    return serverError(e);
  }
}
