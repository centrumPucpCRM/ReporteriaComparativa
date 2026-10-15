"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listarBroadcasts, type BroadcastResumen } from "../actions";
import { BarraProgreso, EstadoBroadcast, estaActivo, formatoFecha } from "../ui";

const PAGE_SIZE = 25;
const BASE = "/modulos/microservicios/infobip-ext/broadcast";
/** Mientras haya algún envío activo en pantalla se refresca solo. */
const REFRESCO_MS = 5000;

export default function HistorialLista() {
  const router = useRouter();
  const [rows, setRows] = useState<BroadcastResumen[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busquedaInput, setBusquedaInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(busquedaInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await listarBroadcasts({ page, pageSize: PAGE_SIZE, busqueda });
      if (cancelled) return;
      if (r.success) {
        setRows(r.data.rows);
        setTotal(r.data.total);
        setError(null);
      } else {
        setError(r.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [page, busqueda, tick]);

  const hayActivos = rows.some(estaActivo);
  useEffect(() => {
    if (!hayActivos) return;
    const t = setInterval(() => setTick((n) => n + 1), REFRESCO_MS);
    return () => clearInterval(t);
  }, [hayActivos]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historial de broadcasts</h1>
          <p className="mt-1 text-sm text-gray-600">
            Todos los envíos masivos y cómo van. Se actualiza solo mientras hay envíos en curso.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTick((n) => n + 1)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Actualizar
          </button>
          <Link
            href={BASE}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            Nuevo broadcast
          </Link>
        </div>
      </div>

      <input
        value={busquedaInput}
        onChange={(e) => setBusquedaInput(e.target.value)}
        placeholder="Buscar por campaña, plantilla, cola, asesor o usuario..."
        className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Campaña</th>
              <th className="px-3 py-2">Plantilla</th>
              <th className="px-3 py-2">Cola / Asesor</th>
              <th className="px-3 py-2">Línea</th>
              <th className="px-3 py-2 min-w-[180px]">Progreso</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const procesados = b.enviados + b.fallidos;
              return (
                <tr
                  key={b.id}
                  onClick={() => router.push(`${BASE}/historial/${b.id}`)}
                  className="cursor-pointer border-t border-gray-100 align-top hover:bg-sky-50/50"
                >
                  <td className="px-3 py-2 font-mono text-gray-500">{b.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                    {formatoFecha(b.created_at)}
                    <p className="text-[11px] text-gray-400">{b.creado_por}</p>
                  </td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{b.campana}</td>
                  <td className="px-3 py-2 text-gray-700">
                    <span className="break-all">{b.template_nombre}</span>
                    <p className="text-[11px] text-gray-400">{b.template_idioma}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {b.queue_nombre ?? b.queue_id}
                    <p className="text-[11px] text-gray-400">{b.agent_nombre ?? "Sin asesor"}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-700">{b.sender}</td>
                  <td className="px-3 py-2">
                    <BarraProgreso
                      total={b.total}
                      ok={b.enviados - b.no_entregados}
                      error={b.fallidos + b.no_entregados}
                    />
                    <p className="mt-1 text-[11px] text-gray-600">
                      {procesados} / {b.total} ·{" "}
                      <span className="text-emerald-700">{b.entregados} entregados</span>
                      {b.no_entregados ? <span className="text-red-600"> · {b.no_entregados} no entregados</span> : null}
                      {b.fallidos ? <span className="text-red-600"> · {b.fallidos} error</span> : null}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <EstadoBroadcast b={b} />
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                  {busqueda ? "Ningún broadcast coincide con la búsqueda." : "Todavía no se ha enviado ningún broadcast."}
                </td>
              </tr>
            ) : null}
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                  Cargando...
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{total} broadcast(s)</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
