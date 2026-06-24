import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkApiKey } from "@/lib/api-auth";

/**
 * POST /api/infobip-ext/decidir-cola
 *
 * Decide a qué cola de Infobip enrutar un inbound, a partir de:
 *  - NT: número telefónico del contacto
 *  - NI: número telefónico de Infobip que recibió el inbound
 *
 * Criterio:
 *  - ¿Existe "última atención" (sender_last_rdv) para ese contacto?
 *      · SÍ → cola GEN del NI  (la regla de ventas asigna el RDV)
 *      · NO → cola ING del NI  (el chatbot se encarga)
 *
 * El par de colas (ING/GEN) sale de la tabla `colas`, llaveada por NI.
 */

type Body = { nt?: unknown; ni?: unknown };

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function POST(req: NextRequest) {
  try {
    const auth = checkApiKey(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
    }

    const nt = asText(body.nt);
    const ni = asText(body.ni);

    if (!nt || !ni) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: "nt" (teléfono contacto) y "ni" (teléfono Infobip).' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const db = admin.schema("Infobip_ext");

    // 1) Colas del NI (par ING/GEN)
    const { data: cola, error: colaError } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("colas" as any)
      .select("ni, programa, ing_queue_id, gen_queue_id")
      .eq("ni", ni)
      .maybeSingle();

    if (colaError) {
      return NextResponse.json({ error: colaError.message }, { status: 500 });
    }
    if (!cola) {
      return NextResponse.json(
        { error: `No hay colas configuradas para el NI "${ni}". Registrarlo en /modulos/microservicios/infobip-ext/colas.` },
        { status: 404 },
      );
    }

    // 2) ¿Existe última atención para este contacto?
    const { data: ultimaAtencion, error: uaError } = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("sender_last_rdv" as any)
      .select("ultimo_rdv_number, lead_id, fecha_actualizacion")
      .eq("telefono_contacto", nt)
      .order("fecha_actualizacion", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (uaError) {
      return NextResponse.json({ error: uaError.message }, { status: 500 });
    }

    const encontrado = !!ultimaAtencion;
    const tipo = encontrado ? "GEN" : "IN";
    const queue_id = encontrado
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (cola as any).gen_queue_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (cola as any).ing_queue_id;

    return NextResponse.json({
      nt,
      ni,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      programa: (cola as any).programa ?? null,
      encontrado,
      tipo,
      queue_id,
      // Datos de la última atención (útiles aguas abajo para la regla de ventas en GEN)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lead_id: encontrado ? (ultimaAtencion as any).lead_id ?? null : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ultimo_rdv_number: encontrado ? (ultimaAtencion as any).ultimo_rdv_number ?? null : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[decidir-cola]", message);
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
  }
}
