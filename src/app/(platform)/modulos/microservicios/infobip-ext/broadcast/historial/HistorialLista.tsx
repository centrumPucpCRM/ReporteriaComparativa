"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { listarBroadcasts, verificarEntregas, type BroadcastResumen } from "../actions";
import {
  Badge,
  BarraProgreso,
  EstadoBroadcast,
  LeyendaProgreso,
  Spinner,
  UltimaActualizacion,
  estaActivo,
  formatoFecha,
} from "../ui";

const PAGE_SIZE = 20;
const BASE = "/modulos/microservicios/infobip-ext/broadcast";
/** Mientras haya algún envío activo en pantalla se refresca solo. */
const REFRESCO_MS = 5000;

/** Mensajes aceptados por Infobip cuya entrega en WhatsApp aún no se confirmó. */
function sinConfirmarEntrega(b: BroadcastResumen): number {
  return Math.max(0, b.enviados - b.entregados - b.no_entregados);
}

export default function HistorialLista() {
  const [rows, setRows] = useState<BroadcastResumen[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busquedaInput, setBusquedaInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [actualizando, setActualizando] = useState(false);
  const [ultimaCarga, setUltimaCarga] = useState<Date | null>(null);
  /** Broadcasts cuya entrega ya se consultó en esta visita (una vez cada uno). */
  const verificados = useRef(new Set<number>());

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
      setActualizando(false);
      setUltimaCarga(new Date());
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

  // Confirma la entrega de los broadcasts de la página que la tengan pendiente
  // (sin esperar a que alguien abra el detalle) y recarga si algo cambió.
  useEffect(() => {
    const porVerificar = rows.filter(
      (b) => sinConfirmarEntrega(b) > 0 && !estaActivo(b) && !verificados.current.has(b.id),
    );
    if (porVerificar.length === 0) return;
    for (const b of porVerificar) verificados.current.add(b.id);
    let cancelled = false;
    (async () => {
      let cambios = false;
      for (const b of porVerificar) {
        const r = await verificarEntregas(b.id);
        if (cancelled) return;
        if (r.success && r.data.actualizados.length) cambios = true;
      }
      if (cambios) setTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historial de broadcasts</h1>
          <p className="mt-1 text-sm text-gray-600">Todos los envíos masivos y cómo van.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UltimaActualizacion fecha={ultimaCarga} automatico={hayActivos} />
          <button
            type="button"
            disabled={actualizando}
            onClick={() => {
              setActualizando(true);
              setTick((n) => n + 1);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {actualizando ? <Spinner /> : null}
            {actualizando ? "Actualizando..." : "Actualizar"}
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
        className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <LeyendaProgreso />

      <div className="space-y-3">
        {rows.map((b) => (
          <TarjetaBroadcast key={b.id} b={b} />
        ))}
        {!loading && rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-500">
            {busqueda ? "Ningún broadcast coincide con la búsqueda." : "Todavía no se ha enviado ningún broadcast."}
          </p>
        ) : null}
        {loading && rows.length === 0 ? (
          <p className="inline-flex w-full items-center justify-center gap-2 py-12 text-sm text-gray-500">
            <Spinner /> Cargando...
          </p>
        ) : null}
      </div>

      {total > 0 ? (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{total} broadcast(s)</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 disabled:opacity-40"
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
              className="rounded-md border border-gray-300 bg-white px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TarjetaBroadcast({ b }: { b: BroadcastResumen }) {
  const procesados = b.enviados + b.fallidos;
  const confirmando = sinConfirmarEntrega(b);
  const pct = b.total ? Math.round((procesados / b.total) * 100) : 0;

  return (
    <Link
      href={`${BASE}/historial/${b.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-sky-300 hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-gray-900">
            <span className="mr-2 font-mono text-sm font-semibold text-gray-400">#{b.id}</span>
            {b.campana}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {formatoFecha(b.created_at)}
            {b.creado_por ? ` · ${b.creado_por}` : ""}
          </p>
        </div>
        <EstadoBroadcast b={b} />
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Plantilla" titulo={b.template_nombre}>
          {b.template_nombre}
          <span className="ml-1 text-xs font-normal text-gray-400">({b.template_idioma})</span>
        </Campo>
        <Campo label="Cola" titulo={b.queue_nombre ?? b.queue_id}>
          {b.queue_nombre ?? b.queue_id}
        </Campo>
        <Campo label="Asesor">{b.agent_nombre ?? <span className="font-normal text-gray-400">Sin asesor</span>}</Campo>
        <Campo label="Línea">
          <span className="font-mono">{b.sender}</span>
        </Campo>
      </dl>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1">
          <BarraProgreso
            total={b.total}
            entregados={b.entregados}
            fallidos={b.fallidos + b.no_entregados}
            confirmando={confirmando}
          />
        </div>
        <span className="w-24 shrink-0 text-right text-xs font-semibold text-gray-600">
          {procesados} / {b.total} · {pct}%
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {b.entregados || !confirmando ? <Badge color="emerald">{b.entregados} entregados</Badge> : null}
        {b.no_entregados ? <Badge color="red">{b.no_entregados} no entregados</Badge> : null}
        {confirmando ? <Badge color="sky">{confirmando} confirmando entrega</Badge> : null}
        {b.fallidos ? <Badge color="red">{b.fallidos} con error al enviar</Badge> : null}
      </div>
    </Link>
  );
}

function Campo({ label, titulo, children }: { label: string; titulo?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="truncate font-semibold text-gray-800" title={titulo}>
        {children}
      </dd>
    </div>
  );
}
