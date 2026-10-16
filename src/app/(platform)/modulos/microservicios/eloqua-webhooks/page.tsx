import { headers } from "next/headers";
import { serviceAccountEmail } from "@/lib/google-sheets";
import ProbarForm from "./ProbarForm";

const BODY_ELOQUA = `{
"dni": "@{C_NUmero_de_Documento1}@",
"correo": "@{C_EmailAddress}@",
"PartyNumber": "@{C_OSC___Contact_Registry_ID1}@",
"OptyNumber": "@{C_Campo_Aleatorio1}@",
"utm_excel": "@{C_UTM_Campaign_Name1}@",
"utm_hoja": "@{C_UTM_Campaign_Medium1}@"
}`;

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-base font-bold text-gray-900 mb-3">{titulo}</h3>
      <div className="text-sm text-gray-700 space-y-3">{children}</div>
    </section>
  );
}

export default async function EloquaWebhooksPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "<dominio>";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/api/eloqua-webhooks/google-sheets`;
  const email = serviceAccountEmail();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Eloqua → Google Sheets</h2>
        <p className="mt-1 text-sm text-gray-500">
          Webhook outbound que agrega cada contacto como una fila en el Google Sheet indicado por sus UTM.
        </p>
      </div>

      <Bloque titulo="1. Configurar los UTM del contacto (obligatorios)">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>UTM Campaign Name</b> (<code>utm_excel</code>): ID del Google Sheet (también se acepta la URL completa).
          </li>
          <li>
            <b>UTM Campaign Medium</b> (<code>utm_hoja</code>): nombre exacto de la pestaña donde se escribirá.
          </li>
        </ul>
        <p>Si alguno de los dos llega vacío, el webhook responde error 400 y no escribe nada.</p>
        <p>
          El Google Sheet debe estar compartido con permisos de <b>edición</b> con:{" "}
          {email ? (
            <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-900 select-all">{email}</code>
          ) : (
            <span className="text-red-600 font-semibold">GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY no configuradas</span>
          )}
        </p>
        <p className="text-gray-500">
          Ejemplo: en <code>docs.google.com/spreadsheets/d/<b>1AbC…xyz</b>/edit</code> el ID es <code>1AbC…xyz</code>.
        </p>
      </Bloque>

      <Bloque titulo="2. Configurar el webhook en Eloqua">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
          <dt className="font-semibold">Request Type</dt>
          <dd>POST · Outbound · Contact</dd>
          <dt className="font-semibold">Webhook URL</dt>
          <dd>
            <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-900 break-all select-all">{url}</code>
          </dd>
          <dt className="font-semibold">Headers</dt>
          <dd>
            <code>Content-Type: application/json</code>
            <br />
            <code>Authorization: Bearer &lt;ELOQUA_WEBHOOKS_API_KEY&gt;</code>
          </dd>
          <dt className="font-semibold">Body (Raw JSON)</dt>
          <dd>
            <pre className="mt-1 p-3 rounded-lg bg-gray-900 text-gray-100 text-xs overflow-x-auto">{BODY_ELOQUA}</pre>
          </dd>
        </dl>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code>utm_excel</code> y <code>utm_hoja</code> son <b>obligatorios</b>: indican dónde escribir y no se
            guardan como columna.
          </li>
          <li>
            Todos los demás campos son <b>opcionales y libres</b>: cada uno se escribe como una columna, desde la A,{" "}
            <b>en el mismo orden en que aparecen en el body</b>. Al final se agrega <code>fecha_creacion</code> (hora de
            Lima).
          </li>
          <li>
            Si la pestaña está vacía, la fila 1 se llena con los nombres de los campos como encabezados. Si ya tiene
            datos, se escribe por posición: el body debe mantener el mismo orden que las columnas de la hoja.
          </li>
        </ul>
      </Bloque>

      <Bloque titulo="3. Probar un Google Sheet">
        <p className="text-gray-500">
          Ejecuta la misma lógica del webhook: si el sheet no está compartido o la pestaña no existe, verás el error aquí.
        </p>
        <ProbarForm />
      </Bloque>
    </div>
  );
}
