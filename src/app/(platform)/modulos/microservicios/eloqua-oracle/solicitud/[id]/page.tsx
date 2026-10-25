import Link from "next/link";
import { notFound } from "next/navigation";
import { etiquetaPaso, formatoFecha, type DetalleSolicitud } from "@/lib/eloqua-oracle";
import { leerAmbiente, obtenerDetalle } from "../../_lib/repo";
import { descartarSolicitudes, reintentarSolicitudes } from "../../actions";
import { BotonAccion } from "../../_components/controles";
import FlujoSolicitud from "../../_components/FlujoSolicitud";
import { AvisoError, BASE, EstadoBadge, Tarjeta, nombreContacto } from "../../_components/ui";

export const dynamic = "force-dynamic";

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export default async function SolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const ambiente = await leerAmbiente();
  let detalle: DetalleSolicitud | null = null;
  let error: string | null = null;
  try {
    detalle = await obtenerDetalle(ambiente, id);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (!error && !detalle) notFound();

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8">
      <Link href={`${BASE}/errores`} className="text-sm font-semibold text-gray-500 hover:text-violet-700">
        ← Volver
      </Link>
      {error && <AvisoError mensaje={error} />}
      {detalle && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-3 text-2xl font-bold text-gray-900">
                Solicitud #{detalle.solicitud.id} <EstadoBadge estado={detalle.solicitud.estado} />
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                DNI <span className="font-mono">{detalle.solicitud.dni}</span> · {nombreContacto(detalle.solicitud)} · recibida{" "}
                {formatoFecha(detalle.solicitud.recibido_at)}
              </p>
            </div>
            {(detalle.solicitud.estado === "ERROR" || detalle.solicitud.estado === "PARCIAL") && (
              <div className="flex gap-2">
                <BotonAccion accion={reintentarSolicitudes.bind(null, [detalle.solicitud.id])} label="Reintentar desde el paso fallido" />
                <BotonAccion
                  accion={descartarSolicitudes.bind(null, [detalle.solicitud.id])}
                  label="Descartar"
                  variante="peligro"
                  confirmar="¿Descartar esta solicitud? No se volverá a procesar."
                />
              </div>
            )}
          </div>

          {detalle.solicitud.error_paso && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span className="font-semibold">Se detuvo en {etiquetaPaso(detalle.solicitud.error_paso)}</span>
              {detalle.solicitud.error_tipo && <span className="ml-2 text-xs">({detalle.solicitud.error_tipo})</span>}: {detalle.solicitud.error_motivo}
            </div>
          )}

          {detalle.solicitud.resuelta_por_id && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Una solicitud posterior del mismo DNI quedó OK:{" "}
              <Link href={`${BASE}/solicitud/${detalle.solicitud.resuelta_por_id}`} className="font-mono font-semibold underline">
                #{detalle.solicitud.resuelta_por_id}
              </Link>
            </div>
          )}

          {detalle.duplicado && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              El DNI tenía {detalle.duplicado.candidatos.length} contactos en Oracle; se eligió el party {detalle.duplicado.elegido_party_id}.{" "}
              <Link href={`${BASE}/duplicados?todos=1`} className="font-semibold underline">
                Ver duplicados
              </Link>
            </div>
          )}

          <Tarjeta className="p-5">
            <h3 className="mb-4 font-bold text-gray-900">Lienzo de la solicitud</h3>
            <FlujoSolicitud detalle={detalle} />
          </Tarjeta>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta className="p-5">
              <h3 className="mb-3 font-bold text-gray-900">Datos</h3>
              <dl className="grid grid-cols-2 gap-3">
                <Dato label="Contacto (party number)">{detalle.solicitud.contacto_party_number ?? "—"}</Dato>
                <Dato label="Contacto (party id)">{detalle.solicitud.contacto_party_id ?? "—"}</Dato>
                <Dato label="Intentos">{detalle.solicitud.intentos}</Dato>
                <Dato label="Procesada">{formatoFecha(detalle.solicitud.procesado_at)}</Dato>
              </dl>
              <h4 className="mt-5 mb-2 text-sm font-bold text-gray-900">Programas</h4>
              <ul className="space-y-1 text-sm">
                {detalle.programas.map((p) => (
                  <li key={p.id} className="font-mono text-xs text-gray-700">
                    {p.codigo_crm} · {p.estado}
                    {p.accion && ` · ${p.accion.toLowerCase()}`}
                    {p.lead_number && ` · lead ${p.lead_number}`}
                    {p.rdv_party_number && ` · RDV ${p.rdv_party_number}`}
                    {p.conversacion_infobip_id && ` · conv ${p.conversacion_infobip_id}`}
                  </li>
                ))}
                {!detalle.programas.length && <li className="text-gray-500">Aún sin programas procesados.</li>}
              </ul>
            </Tarjeta>
            <Tarjeta className="p-5">
              <h3 className="mb-3 font-bold text-gray-900">Payload recibido de Eloqua</h3>
              <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                {JSON.stringify(detalle.solicitud.payload, null, 2)}
              </pre>
            </Tarjeta>
          </div>
        </>
      )}
    </div>
  );
}
