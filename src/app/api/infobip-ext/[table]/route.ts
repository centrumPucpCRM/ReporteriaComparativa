import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkApiKey } from "@/lib/api-auth";
import { resolveTable } from "../_tables";

type Ctx = { params: Promise<{ table: string }> };

function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[infobip-ext API]", message);
  return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
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

    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = admin.schema(target.schema).from(target.table as any).select("*", { count: "exact" });
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
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Body debe ser un objeto JSON." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema(target.schema)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(target.table as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(body as any)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
