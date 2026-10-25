import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { ejecutarIdentidad, type QuePrueba } from "@/lib/identidad/pasos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Servicio de identidad para el worker del EC2 (Eloqua → Oracle): ejecuta Validar DNI y/o Validar
 * RUC con sus pasos siguientes y devuelve los eventos (mismo formato que la tabla `evento`) y la
 * salida de cada rama. No escribe nada en la cola: eso lo hace el worker.
 *
 *   POST /api/identidad/validar   Authorization: Bearer <IDENTIDAD_API_KEY>
 *   { "dni": "45215942", "nombre": "Carlos Garcia", "ruc": "", "empresa": "", "correo": "", "celular": "", "que": "AMBOS" }
 *   que: CORREO · TELEFONO (unitarios) · CONTACTO (los dos + decisión) · DNI · RUC · AMBOS · TODO
 */
export async function POST(req: Request) {
  const auth = checkApiKey(req, "IDENTIDAD_API_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  const texto = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const que = (["CORREO", "TELEFONO", "CONTACTO", "DNI", "RUC", "AMBOS", "TODO"].includes(texto("que")) ? texto("que") : "AMBOS") as QuePrueba;
  if (["DNI", "AMBOS", "TODO"].includes(que) && !texto("dni")) return NextResponse.json({ error: "Falta dni" }, { status: 400 });

  try {
    const lead = {
      dni: texto("dni"),
      nombre: texto("nombre"),
      ruc: texto("ruc"),
      empresa: texto("empresa"),
      correo: texto("correo"),
      celular: texto("celular"),
    };
    const r = await ejecutarIdentidad(lead, que);
    return NextResponse.json(r);
  } catch (e) {
    console.error("[identidad] validar:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
