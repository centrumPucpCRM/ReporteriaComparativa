import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkApiKey } from "@/lib/api-auth";
import { resolveTable } from "../../_tables";

type Ctx = { params: Promise<{ table: string; id: string }> };

function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[infobip-ext API]", message);
  return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const auth = checkApiKey(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { table: slug, id } = await params;
    const target = resolveTable(slug);
    if (!target) {
      return NextResponse.json({ error: `Tabla "${slug}" no encontrada.` }, { status: 404 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema(target.schema)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(target.table as any)
      .select("*")
      .eq(target.primaryKey, id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });

    return NextResponse.json({ data });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const auth = checkApiKey(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { table: slug, id } = await params;
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
      .update(body as any)
      .eq(target.primaryKey, id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ data });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const auth = checkApiKey(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { table: slug, id } = await params;
    const target = resolveTable(slug);
    if (!target) {
      return NextResponse.json({ error: `Tabla "${slug}" no encontrada.` }, { status: 404 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .schema(target.schema)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(target.table as any)
      .delete()
      .eq(target.primaryKey, id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
