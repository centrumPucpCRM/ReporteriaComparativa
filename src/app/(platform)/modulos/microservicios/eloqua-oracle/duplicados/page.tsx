import Link from "next/link";
import { formatoFecha } from "@/lib/eloqua-oracle";
import { leerAmbiente, listarDuplicados } from "../_lib/repo";
import { marcarRevisado } from "../actions";
import { BotonAccion } from "../_components/controles";
import { AvisoError, BASE, Encabezado, Tarjeta } from "../_components/ui";

export const dynamic = "force-dynamic";

const ESTADO_UNIFICACION = {
  UNIFICADO: { label: "Unificado", clase: "bg-emerald-100 text-emerald-800" },
  PARCIAL: { label: "Parcial: revisar", clase: "bg-amber-100 text-amber-800" },
  ERROR: { label: "Error al unificar", clase: "bg-red-100 text-red-700" },
} as const;

export default async function DuplicadosPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const todos = (await searchParams).todos === "1";
  const ambiente = await leerAmbiente();
  let filas: Awaited<ReturnType<typeof listarDuplicados>> | null = null;
  let error: string | null = null;
  try {
    filas = await listarDuplicados(ambiente, !todos);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <Encabezado
        titulo="Duplicados por DNI"
        descripcion="DNI con más de un contacto en Oracle. La búsqueda es exacta, con y sin ceros a la izquierda (3040421 = 03040421). El servicio los unifica: se queda el del lead más reciente, le pasa los leads y actividades de los otros y elimina los que quedan vacíos. Pendientes = algún contacto no se pudo eliminar o la unificación falló."
      >
        <Link href={todos ? `${BASE}/duplicados` : `${BASE}/duplicados?todos=1`} className="text-sm font-semibold text-violet-700 hover:underline">
          {todos ? "Solo pendientes" : "Ver también revisados"}
        </Link>
      </Encabezado>
      {error && <AvisoError mensaje={error} />}
      {filas?.map((d) => (
        <Tarjeta key={d.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-mono text-lg font-bold text-gray-900">DNI {d.dni}</div>
              <div className="text-xs text-gray-500">
                Detectado {formatoFecha(d.detectado_at)}
                {d.solicitud_id && (
                  <>
                    {" "}· solicitud{" "}
                    <Link href={`${BASE}/solicitud/${d.solicitud_id}`} className="font-mono text-violet-700 hover:underline">
                      #{d.solicitud_id}
                    </Link>
                  </>
                )}
                {d.revisado && <> · revisado por {d.revisado_por}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {d.estado && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_UNIFICACION[d.estado].clase}`}>{ESTADO_UNIFICACION[d.estado].label}</span>}
              {!d.revisado && <BotonAccion accion={marcarRevisado.bind(null, d.id)} label="Marcar revisado" variante="secundario" />}
            </div>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2">Contacto</th>
                <th className="py-2">DNI en Oracle</th>
                <th className="py-2">Party</th>
                <th className="py-2 text-right">Leads</th>
                <th className="py-2 text-right">Último lead</th>
                <th className="py-2">Unificación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {d.candidatos.map((c) => {
                const elegido = c.party_id === d.elegido_party_id;
                return (
                  <tr key={c.party_id} className={elegido ? "bg-emerald-50/60" : ""}>
                    <td className="py-2 text-gray-800">{c.nombre ?? "—"}</td>
                    <td className="py-2 font-mono text-xs text-gray-800">{c.dni ?? d.dni}</td>
                    <td className="py-2 font-mono text-xs text-gray-600">
                      {c.party_number ?? "—"} <span className="text-gray-400">({c.party_id})</span>
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900">{c.n_leads}</td>
                    <td className="py-2 text-right text-gray-600">{formatoFecha(c.ultimo_lead_at)}</td>
                    <td className="py-2 text-xs">
                      {elegido ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Se queda</span>
                      ) : (
                        <span className="text-gray-600">
                          {c.leads_movidos ?? 0} leads y {c.actividades_movidas ?? 0} actividades movidos ·{" "}
                          {c.eliminado ? (
                            <span className="font-semibold text-gray-800">eliminado</span>
                          ) : (
                            <span className="font-semibold text-amber-700">{c.no_eliminado_motivo ?? "no eliminado"}</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Tarjeta>
      ))}
      {filas && !filas.length && <p className="text-sm text-gray-500">No hay duplicados {todos ? "" : "pendientes "}de revisión.</p>}
    </div>
  );
}
