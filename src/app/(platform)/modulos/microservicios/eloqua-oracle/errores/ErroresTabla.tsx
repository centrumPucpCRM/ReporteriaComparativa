"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { etiquetaPaso, formatoFecha, type Solicitud, type SolicitudPrograma } from "@/lib/eloqua-oracle";
import { descartarSolicitudes, reintentarSolicitudes } from "../actions";
import { BASE, EstadoBadge } from "../_components/ui";

type Fila = Solicitud & { programas: SolicitudPrograma[] };

const TIPO_ESTILO: Record<string, string> = {
  TEMPORAL: "bg-amber-100 text-amber-800",
  PERMANENTE: "bg-red-100 text-red-700",
  AUTENTICACION: "bg-purple-100 text-purple-800",
  VALIDACION: "bg-gray-100 text-gray-700",
};

export default function ErroresTabla({ filas }: { filas: Fila[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pendiente, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const todas = filas.length > 0 && sel.size === filas.length;

  function alternar(id: number) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function ejecutar(fn: typeof reintentarSolicitudes, ids: number[], confirmar?: string) {
    if (!ids.length || (confirmar && !window.confirm(confirmar))) return;
    startTransition(async () => {
      const r = await fn(ids);
      setMsg(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
      if (r.ok) {
        setSel(new Set());
        router.refresh();
      }
    });
  }

  const ids = [...sel];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={!ids.length || pendiente}
          onClick={() => ejecutar(reintentarSolicitudes, ids)}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Reintentar seleccionadas ({ids.length})
        </button>
        <button
          disabled={!ids.length || pendiente}
          onClick={() => ejecutar(descartarSolicitudes, ids, `¿Descartar ${ids.length} solicitud(es)? No se volverán a procesar.`)}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          Descartar
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.texto}</span>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={todas}
                    onChange={() => setSel(todas ? new Set() : new Set(filas.map((f) => f.id)))}
                    aria-label="Seleccionar todas"
                  />
                </th>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Recibido</th>
                <th className="px-4 py-3">DNI</th>
                <th className="px-4 py-3">Paso</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="hidden md:table-cell px-4 py-3">Intentos</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((s) => (
                <tr key={s.id} className={sel.has(s.id) ? "bg-violet-50/50" : "hover:bg-gray-50"}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => alternar(s.id)} aria-label={`Seleccionar ${s.id}`} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`${BASE}/solicitud/${s.id}`} className="font-mono font-semibold text-violet-700 hover:underline">
                      {s.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatoFecha(s.recibido_at)}</td>
                  <td className="px-4 py-3 font-mono text-gray-900">{s.dni}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-semibold text-red-700">{etiquetaPaso(s.error_paso)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {s.error_tipo && (
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${TIPO_ESTILO[s.error_tipo] ?? ""}`}>{s.error_tipo}</span>
                    )}
                    <span className="text-xs">{s.error_motivo ?? "—"}</span>
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-gray-600">{s.intentos}</td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={s.estado} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={pendiente}
                      onClick={() => ejecutar(reintentarSolicitudes, [s.id])}
                      className="whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      Reintentar
                    </button>
                  </td>
                </tr>
              ))}
              {!filas.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                    No hay solicitudes con error.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
