import { NextRequest, NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";

/**
 * POST /api/eloqua-oracle/{prod|test}/solicitudes
 *
 * Puente HTTPS entre Eloqua y el servicio eloqua-oracle del EC2 (que no tiene dominio).
 * No procesa ni guarda nada: valida el Bearer de Eloqua (ELOQUA_ORACLE_API_KEY), reenvía
 * el body tal cual al EC2 del ambiente y devuelve su respuesta (202 + ids encolados).
 *
 * Env:
 *  - ELOQUA_ORACLE_API_KEY          → token que usa Eloqua
 *  - EC2_ELOQUA_ORACLE_URL_PROD/TEST → base del API en el EC2 (http://ip:puerto)
 *  - EC2_ELOQUA_ORACLE_TOKEN_PROD/TEST → token interno que valida el EC2
 */

const TIMEOUT_MS = 15_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ ambiente: string }> }) {
  const { ambiente } = await params;
  if (ambiente !== "prod" && ambiente !== "test") {
    return NextResponse.json({ error: "Ambiente inválido: usa prod o test." }, { status: 404 });
  }

  const auth = checkApiKey(req, "ELOQUA_ORACLE_API_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sufijo = ambiente.toUpperCase();
  const base = process.env[`EC2_ELOQUA_ORACLE_URL_${sufijo}`]?.trim();
  const token = process.env[`EC2_ELOQUA_ORACLE_TOKEN_${sufijo}`]?.trim();
  if (!base || !token) {
    console.error(`[eloqua-oracle/${ambiente}] Falta EC2_ELOQUA_ORACLE_URL_${sufijo} o EC2_ELOQUA_ORACLE_TOKEN_${sufijo}`);
    return NextResponse.json({ error: `Servicio ${ambiente} no configurado.` }, { status: 503 });
  }

  const body = await req.text();
  try {
    JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/v1/solicitudes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const texto = await res.text();
    return new NextResponse(texto, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[eloqua-oracle/${ambiente}] EC2 no responde:`, message);
    return NextResponse.json({ error: "El servicio de procesamiento no responde. Reintentar." }, { status: 502 });
  }
}
