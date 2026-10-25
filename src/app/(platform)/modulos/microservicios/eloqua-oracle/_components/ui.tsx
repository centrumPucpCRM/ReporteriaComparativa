import Link from "next/link";
import type { ReactNode } from "react";
import {
  ESTADO_ESTILO,
  campoPayload,
  etiquetaPaso,
  formatoFecha,
  type EstadoSolicitud,
  type Solicitud,
  type SolicitudPrograma,
} from "@/lib/eloqua-oracle";
import { IrADemo } from "./controles";

export const BASE = "/modulos/microservicios/eloqua-oracle";

export function EstadoBadge({ estado }: { estado: EstadoSolicitud }) {
  const e = ESTADO_ESTILO[estado];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clase}`}>
      {e.label}
    </span>
  );
}

export function Encabezado({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{titulo}</h2>
        {descripcion && <p className="mt-1 text-sm text-gray-500">{descripcion}</p>}
      </div>
      {children}
    </div>
  );
}

export function AvisoError({ mensaje }: { mensaje: string }) {
  // Sin tablas en Supabase todavía: ofrecer el ambiente Demo ahí mismo.
  const sinEsquema = mensaje.includes("Exposed schemas");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span className="min-w-0 flex-1">{mensaje}</span>
      {sinEsquema && <IrADemo />}
    </div>
  );
}

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

export function nombreContacto(s: Solicitud): string {
  const p = s.payload ?? {};
  return [campoPayload(p, "FirstName"), campoPayload(p, "LastName")].filter(Boolean).join(" ") || "—";
}

/** Tabla de solicitudes de solo lectura (procesados, buscador por DNI). */
export function TablaSolicitudes({
  filas,
  vacio,
  mostrarResuelta = false,
}: {
  filas: (Solicitud & { programas: SolicitudPrograma[] })[];
  vacio: string;
  mostrarResuelta?: boolean;
}) {
  return (
    <Tarjeta className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Recibido</th>
              <th className="px-4 py-3">DNI</th>
              <th className="hidden md:table-cell px-4 py-3">Contacto</th>
              <th className="px-4 py-3">Programas</th>
              <th className="px-4 py-3">Estado</th>
              <th className="hidden lg:table-cell px-4 py-3">Paso / motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`${BASE}/solicitud/${s.id}`} className="font-mono font-semibold text-violet-700 hover:underline">
                    {s.id}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatoFecha(s.recibido_at)}</td>
                <td className="px-4 py-3 font-mono text-gray-900">{s.dni}</td>
                <td className="hidden md:table-cell px-4 py-3 text-gray-700">
                  {nombreContacto(s)}
                  {s.contacto_party_number && <div className="font-mono text-xs text-gray-400">Party {s.contacto_party_number}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {s.programas.length ? (
                      s.programas.map((p) => (
                        <span key={p.id} className="whitespace-nowrap font-mono text-xs text-gray-700">
                          {p.codigo_crm}
                          {p.accion && <span className="ml-1 text-gray-400">· {p.accion === "CREADO" ? "creado" : "actualizado"}</span>}
                          {p.lead_number && <span className="ml-1 text-gray-400">· lead {p.lead_number}</span>}
                        </span>
                      ))
                    ) : (
                      <span className="font-mono text-xs text-gray-400">{campoPayload(s.payload, "CTRSalesPrograma_c") || "—"}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <EstadoBadge estado={s.estado} />
                  {mostrarResuelta && s.resuelta_por_id && (
                    <div className="mt-1 text-xs text-emerald-700">
                      Resuelta por{" "}
                      <Link href={`${BASE}/solicitud/${s.resuelta_por_id}`} className="font-mono underline">
                        #{s.resuelta_por_id}
                      </Link>
                    </div>
                  )}
                </td>
                <td className="hidden lg:table-cell px-4 py-3 text-xs text-gray-600">
                  {s.error_paso ? (
                    <>
                      <span className="font-semibold text-red-700">{etiquetaPaso(s.error_paso)}</span>
                      <div className="max-w-xs truncate" title={s.error_motivo ?? ""}>{s.error_motivo}</div>
                    </>
                  ) : (
                    etiquetaPaso(s.paso_actual)
                  )}
                </td>
              </tr>
            ))}
            {!filas.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">{vacio}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

export function Paginador({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (p: number) => string }) {
  const paginas = Math.max(1, Math.ceil(total / pageSize));
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
      <span>
        Página {page} de {paginas} · {total} registros
      </span>
      {page > 1 && (
        <Link href={href(page - 1)} className="rounded-lg border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50">
          Anterior
        </Link>
      )}
      {page < paginas && (
        <Link href={href(page + 1)} className="rounded-lg border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50">
          Siguiente
        </Link>
      )}
    </div>
  );
}
