import { NextRequest, NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { sincronizarPeriodos } from "@/lib/vacaciones-server";

/**
 * GET /api/sistema-vacaciones/sincronizar
 *
 * Cron diario de Vercel (vercel.json, 00:00–01:00 hora Lima): inicia en Oracle CRM las
 * vacaciones programadas que empiezan hoy y finaliza las que terminaron ayer.
 * Vercel manda `Authorization: Bearer <CRON_SECRET>` cuando la variable está definida.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = checkApiKey(req, "CRON_SECRET");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const r = await sincronizarPeriodos("cron");
    if (r.errores.length) console.warn("[sistema-vacaciones/sincronizar]", r.errores.join(" · "));
    return NextResponse.json(r);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sistema-vacaciones/sincronizar]", message);
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
  }
}
