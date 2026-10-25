import { headers } from "next/headers";
import { CAMPOS_CALCULADOS, CAMPOS_ELOQUA } from "@/lib/eloqua-oracle";
import { Encabezado, Tarjeta } from "../_components/ui";

type Campo = { llave: string; obligatorio?: boolean; nota?: string; lead?: string };

const GRUPOS: { titulo: string; descripcion: string; campos: readonly Campo[] }[] = [
  { titulo: "Identidad", descripcion: "El DNI es la llave para encontrar el contacto en Oracle.", campos: CAMPOS_ELOQUA.identidad },
  { titulo: "Programa y asignación", descripcion: "Un lead por cada código de programa.", campos: CAMPOS_ELOQUA.programa },
  {
    titulo: "Datos del lead",
    descripcion: "Al crear se copian todos; al actualizar solo los que vienen con valor (observaciones solo si el lead no tiene).",
    campos: CAMPOS_ELOQUA.lead,
  },
  {
    titulo: "Datos de admisión (opcional)",
    descripcion:
      "Solo si CTREloquaTipoDeFormulario_c = ADMISION. No se escriben en Oracle: van en el correo al cliente del final del flujo (plantilla de admisión).",
    campos: CAMPOS_ELOQUA.admision,
  },
  {
    titulo: "Calculados por el servicio (no los manda Eloqua)",
    descripcion:
      "Resultado de las validaciones. Correo y teléfono: marca en el contacto y el lead. DNI, nombre y RUC: marca en el contacto; una vez validados, Oracle los bloquea para que no se vuelvan a editar. Nombres de campo por confirmar.",
    campos: CAMPOS_CALCULADOS,
  },
];

const EJEMPLO = {
  dni: "70000012",
  FirstName: "Lucia",
  LastName: "Pérez Gómez",
  EmailAddress: "lucia@ejemplo.com",
  MobileNumber: "+51999999999",
  CTRSalesPrograma_c: "300000200001::300000200003",
  CTRTipoDeAccion_c: "TR_MARKETING",
  CTREloquaTipoDeFormulario_c: "MASINFO",
  EloquaUTMCampaignSource_c: "facebook",
  EloquaUTMCampaignMedium_c: "cpc",
  EloquaUTMCampaignName_c: "mba-2027",
};

export default async function ContratoPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "<dominio>";
  const base = `https://${host}/api/eloqua-oracle`;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <Encabezado
        titulo="Contrato con Eloqua"
        descripcion="Endpoint y llaves que Eloqua debe enviar. Las llaves son los mismos atributos del contacto que Eloqua escribe hoy en Oracle. Propuesta: pendiente de validar con Eloqua."
      />

      <Tarjeta className="space-y-3 p-5">
        <h3 className="font-bold text-gray-900">Endpoint</h3>
        <div className="space-y-1 font-mono text-sm">
          <div>
            <span className="mr-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">PROD</span>POST {base}/prod/solicitudes
          </div>
          <div>
            <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">TEST</span>POST {base}/test/solicitudes
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            Header <code className="font-mono">Authorization: Bearer &lt;ELOQUA_ORACLE_API_KEY&gt;</code>.
          </li>
          <li>Body: un objeto (unitario) o un array de hasta 500 objetos (lote).</li>
          <li>Responde 202 al instante con los ids encolados; el procesamiento ocurre después y se ve en este módulo.</li>
          <li>401 = token inválido · 400 = JSON inválido · 502 = el servidor de procesamiento no respondió (Eloqua debe reintentar).</li>
        </ul>
      </Tarjeta>

      {GRUPOS.map((g) => (
        <Tarjeta key={g.titulo} className="p-5">
          <h3 className="font-bold text-gray-900">{g.titulo}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{g.descripcion}</p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2">Llave</th>
                <th className="py-2">Campo del lead</th>
                <th className="py-2">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {g.campos.map((c) => (
                <tr key={c.llave}>
                  <td className="py-2 font-mono text-xs text-gray-900">
                    {c.llave}
                    {c.obligatorio && <span className="ml-1.5 rounded bg-red-50 px-1 text-[10px] font-semibold text-red-700">obligatorio</span>}
                  </td>
                  <td className="py-2 font-mono text-xs text-gray-600">{c.lead ?? "—"}</td>
                  <td className="py-2 text-gray-600">{c.nota ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      ))}

      <Tarjeta className="p-5">
        <h3 className="mb-2 font-bold text-gray-900">Ejemplo</h3>
        <pre className="overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(EJEMPLO, null, 2)}</pre>
      </Tarjeta>
    </div>
  );
}
