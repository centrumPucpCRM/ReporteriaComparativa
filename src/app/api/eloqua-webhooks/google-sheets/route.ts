import { NextRequest, NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { exportarContactoASheet, type ContactoEloqua } from "@/lib/eloqua-webhooks";

/**
 * POST /api/eloqua-webhooks/google-sheets
 *
 * Webhook outbound de Eloqua (objeto Contact). Agrega una fila al Google Sheet que
 * indican los UTM del contacto:
 *  - utm_excel → ID del Google Sheet (UTM Campaign Name)
 *  - utm_hoja  → nombre de la pestaña (UTM Campaign Medium); vacío = primera pestaña
 *
 * Body:
 *  { "dni", "correo", "PartyNumber", "OptyNumber", "utm_excel", "utm_hoja" }
 *
 * El Google Sheet debe estar compartido (edición) con el service account de
 * GOOGLE_CLIENT_EMAIL (credenciales: GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY).
 */

export async function POST(req: NextRequest) {
  try {
    const auth = checkApiKey(req, "ELOQUA_WEBHOOKS_API_KEY");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let body: ContactoEloqua;
    try {
      body = (await req.json()) as ContactoEloqua;
    } catch {
      return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "El body debe ser un objeto JSON." }, { status: 400 });
    }

    const r = await exportarContactoASheet(body);
    if (!r.ok) {
      console.warn("[eloqua-webhooks/google-sheets]", r.error);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[eloqua-webhooks/google-sheets]", message);
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
  }
}
