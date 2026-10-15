"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  enviarLote,
  exportarDestinatarios,
  finalizarBroadcast,
  idsPendientes,
  listarDestinatarios,
  obtenerBroadcast,
  reintentarFallidos,
  verificarEntregas,
  type ConteoEstados,
  type FiltroDestinatario,
} from "../../actions";
import type { Mapeo, ResultadoDestinatario } from "@/lib/broadcast";
import {
  Badge,
  BarraProgreso,
  EstadoBroadcast,
  EstadoFilaBadge,
  LeyendaProgreso,
  Spinner,
  UltimaActualizacion,
  descargarCsv,
  estaActivo,
  formatoFecha,
} from "../../ui";

const BASE = "/modulos/microservicios/infobip-ext/broadcast";
const PAGE_SIZE = 50;
const LOTE = 10;
const REFRESCO_MS = 4000;
/** Cada cuánto se consulta la entrega mientras haya mensajes por confirmar. */
const VERIFICAR_ENTREGA_MS = 8000;
/** Tope de consultas automáticas por visita (los logs pueden no traer todo). */
const MAX_VERIFICACIONES_AUTO = 12;

type Detalle = Extract<Awaited<ReturnType<typeof obtenerBroadcast>>, { success: true }>["data"];
type Fila = ResultadoDestinatario & { parametros: Record<string, string> };

const FILTROS: { value: FiltroDestinatario; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "OK", label: "Enviados" },
  { value: "ERROR", label: "Con error" },
  { value: "NO_ENTREGADO", label: "No entregados" },
  { value: "ADVERTENCIA", label: "Con advertencia" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "ENVIANDO", label: "Sin confirmar" },
];

function describirMapeo(mapeo: Mapeo | null, variables: number[]): string {
  if (!variables.length) return "Sin variables";
  return variables
    .map((n) => {
      const f = mapeo?.[n];
      if (!f) return `{{${n}}}: ?`;
      return f.tipo === "fijo" ? `{{${n}}}: "${f.valor}"` : `{{${n}}}: columna ${f.columna}`;
    })
    .join(" · ");
}

export default function HistorialDetalle({ id }: { id: number }) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [totalFilas, setTotalFilas] = useState(0);
  const [filtro, setFiltro] = useState<FiltroDestinatario>("TODOS");
  const [telInput, setTelInput] = useState("");
  const [telefono, setTelefono] = useState("");
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [verificacionesAuto, setVerificacionesAuto] = useState(0);
  const [actualizando, setActualizando] = useState(false);
  const [ultimaCarga, setUltimaCarga] = useState<Date | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setTelefono(telInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [telInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, f] = await Promise.all([
        obtenerBroadcast(id),
        listarDestinatarios({ broadcastId: id, filtro, telefono, page, pageSize: PAGE_SIZE }),
      ]);
      if (cancelled) return;
      setActualizando(false);
      setUltimaCarga(new Date());
      if (!d.success) {
        setError(d.error);
        return;
      }
      setDetalle(d.data);
      setError(null);
      if (f.success) {
        setFilas(f.data.rows);
        setTotalFilas(f.data.total);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, filtro, telefono, page, tick]);

  const activo = enviando || (detalle ? estaActivo(detalle.broadcast) : false);
  useEffect(() => {
    if (!activo) return;
    const t = setInterval(() => setTick((n) => n + 1), REFRESCO_MS);
    return () => clearInterval(t);
  }, [activo]);

  // Confirmación de entrega: WhatsApp la resuelve segundos después del envío.
  const entregaPendiente = detalle?.conteo.entregaPendiente ?? 0;
  useEffect(() => {
    if (!entregaPendiente || enviando || verificacionesAuto >= MAX_VERIFICACIONES_AUTO) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await verificarEntregas(id);
      if (cancelled) return;
      setVerificacionesAuto((n) => n + 1);
      if (r.success && r.data.actualizados.length) setTick((n) => n + 1);
    }, VERIFICAR_ENTREGA_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [id, entregaPendiente, enviando, verificacionesAuto]);

  async function verificarAhora() {
    setVerificando(true);
    const r = await verificarEntregas(id);
    setVerificando(false);
    if (!r.success) return setMensaje(r.error);
    setVerificacionesAuto(0);
    setMensaje(null);
    actualizar();
  }

  function actualizar() {
    setActualizando(true);
    setTick((n) => n + 1);
  }

  async function correrLotes(ids: number[]) {
    setEnviando(true);
    setMensaje(null);
    for (let i = 0; i < ids.length; i += LOTE) {
      const r = await enviarLote(id, ids.slice(i, i + LOTE));
      if (!r.success) {
        setMensaje(`Se interrumpió el envío: ${r.error}`);
        break;
      }
      setTick((n) => n + 1);
    }
    await finalizarBroadcast(id);
    setEnviando(false);
    setTick((n) => n + 1);
  }

  async function continuar() {
    const r = await idsPendientes(id);
    if (!r.success) return setMensaje(r.error);
    if (!r.data.length) return setMensaje("No quedan contactos pendientes.");
    await correrLotes(r.data);
  }

  async function reintentar() {
    const r = await reintentarFallidos(id);
    if (!r.success) return setMensaje(r.error);
    await correrLotes(r.data);
  }

  async function descargar() {
    setDescargando(true);
    const r = await exportarDestinatarios(id);
    setDescargando(false);
    if (!r.success) return setMensaje(r.error);
    descargarCsv(
      `broadcast_${id}_resultados.csv`,
      r.data.map((f) => ({
        fila: f.fila,
        telefono: f.telefono,
        estado: f.estado,
        entrega: f.entrega ?? "",
        detalle_entrega: f.entregaDetalle ?? "",
        conversacion: f.conversationId ?? "",
        reutilizada: f.reutilizada ? "si" : "no",
        error: f.error ?? "",
        advertencia: f.advertencia ?? "",
        ...f.parametros,
      })),
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <Volver />
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!detalle) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <Volver />
        <p className="py-12 text-center text-sm text-gray-500">Cargando...</p>
      </div>
    );
  }

  const { broadcast: b, conteo } = detalle;
  const totalDest = conteo.ok + conteo.error + conteo.pendientes + conteo.sinConfirmar;
  const procesados = conteo.ok + conteo.error + conteo.sinConfirmar;
  const pct = totalDest ? Math.round((procesados / totalDest) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil(totalFilas / PAGE_SIZE));
  const otroEnviando = !enviando && estaActivo(b);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <Volver />

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Broadcast #{b.id}</p>
            <h1 className="text-2xl font-bold text-gray-900">{b.campana}</h1>
          </div>
          <div className="flex items-center gap-3">
            <EstadoBroadcast
              b={{
                ...b,
                enviados: conteo.ok,
                fallidos: conteo.error,
                entregados: conteo.entregados,
                no_entregados: conteo.noEntregados,
              }}
            />
            <span className="text-2xl font-bold text-gray-900">{pct}%</span>
          </div>
        </div>

        <BarraProgreso
          total={totalDest}
          entregados={conteo.entregados}
          fallidos={conteo.error + conteo.noEntregados}
          confirmando={conteo.entregaPendiente}
          sinConfirmar={conteo.sinConfirmar}
          alto="h-3"
        />
        <LeyendaProgreso />

        <Conteos conteo={conteo} total={totalDest} />

        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <Dato label="Creado">
            {formatoFecha(b.created_at)}
            {b.creado_por ? ` · ${b.creado_por}` : ""}
          </Dato>
          <Dato label="Última actividad">{formatoFecha(b.updated_at)}</Dato>
          <Dato label="Cola">{b.queue_nombre ?? b.queue_id}</Dato>
          <Dato label="Asesor">{b.agent_nombre ?? "Sin asesor (queda en la cola)"}</Dato>
          <Dato label="Línea">{b.sender}</Dato>
          <Dato label="Plantilla">
            {b.template_nombre} ({b.template_idioma})
          </Dato>
          <div className="sm:col-span-2">
            <Dato label="Variables">{describirMapeo(b.mapeo, b.template_variables ?? [])}</Dato>
          </div>
        </dl>

        {enviando ? (
          <p className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            <Spinner />
            Enviando por lotes desde esta pestaña. No la cierres hasta que termine.
          </p>
        ) : null}
        {otroEnviando ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            Este broadcast se está enviando desde otra pestaña. El avance se actualiza solo.
          </p>
        ) : null}
        {!activo && conteo.pendientes > 0 ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            El envío se detuvo con {conteo.pendientes} contacto(s) pendiente(s) (probablemente se cerró la pestaña).
            Puedes continuarlo desde aquí.
          </p>
        ) : null}
        {conteo.sinConfirmar > 0 && !activo ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {conteo.sinConfirmar} contacto(s) sin confirmar: el envío se cortó mientras se procesaban y no se sabe si
            la plantilla salió. No se reintentan solos para no duplicar; revísalos en Infobip.
          </p>
        ) : null}
        {conteo.noEntregados > 0 ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {conteo.noEntregados} mensaje(s) los aceptó Infobip pero WhatsApp no los entregó. Mira el motivo en el
            filtro &quot;No entregados&quot;. No se reintentan: suele ser un bloqueo de Meta (por ejemplo, demasiadas
            plantillas de marketing al mismo contacto) que se repetiría.
          </p>
        ) : null}
        {mensaje ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{mensaje}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!activo && conteo.pendientes > 0 ? (
            <button
              type="button"
              onClick={continuar}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Continuar envío ({conteo.pendientes})
            </button>
          ) : null}
          {!activo && conteo.error > 0 ? (
            <button
              type="button"
              onClick={reintentar}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Reintentar {conteo.error} con error
            </button>
          ) : null}
          {entregaPendiente > 0 ? (
            <button
              type="button"
              disabled={verificando}
              onClick={verificarAhora}
              className="inline-flex items-center gap-2 rounded-lg border border-sky-300 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-60"
            >
              {verificando ? <Spinner /> : null}
              {verificando ? "Consultando a Infobip..." : `Verificar entregas (${entregaPendiente})`}
            </button>
          ) : null}
          <button
            type="button"
            disabled={descargando}
            onClick={descargar}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {descargando ? "Preparando..." : "Descargar resultados"}
          </button>
          <button
            type="button"
            disabled={actualizando}
            onClick={actualizar}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {actualizando ? <Spinner /> : null}
            {actualizando ? "Actualizando..." : "Actualizar"}
          </button>
          <UltimaActualizacion fecha={ultimaCarga} automatico={activo || (entregaPendiente > 0 && verificacionesAuto < MAX_VERIFICACIONES_AUTO)} />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
          {FILTROS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setFiltro(f.value);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filtro === f.value ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
          <input
            value={telInput}
            onChange={(e) => setTelInput(e.target.value)}
            placeholder="Buscar teléfono..."
            className="ml-auto w-48 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2">Fila</th>
                <th className="px-3 py-2">Teléfono</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Variables</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-1.5 text-gray-500">{f.fila}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-900">{f.telefono}</td>
                  <td className="px-3 py-1.5">
                    <EstadoFilaBadge estado={f.estado} reutilizada={f.reutilizada} entrega={f.entrega} />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">
                    {Object.entries(f.parametros)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">
                    {f.error ? <p className="text-red-600">{f.error}</p> : null}
                    {f.entregaDetalle ? <p className="text-red-600">{f.entregaDetalle}</p> : null}
                    {f.advertencia ? <p className="text-amber-700">{f.advertencia}</p> : null}
                    {f.conversationId ? <p className="font-mono text-gray-400">{f.conversationId}</p> : null}
                  </td>
                </tr>
              ))}
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                    Sin contactos para este filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2 text-sm text-gray-600">
          <span>{totalFilas} contacto(s)</span>
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
      </section>
    </div>
  );
}

function Volver() {
  return (
    <Link href={`${BASE}/historial`} className="text-sm font-semibold text-sky-700 hover:underline">
      ← Historial de broadcasts
    </Link>
  );
}

function Conteos({ conteo, total }: { conteo: ConteoEstados; total: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge color="gray">{total} contactos</Badge>
      <Badge color="emerald">{conteo.entregados} entregados</Badge>
      {conteo.noEntregados ? <Badge color="red">{conteo.noEntregados} no entregados</Badge> : null}
      {conteo.entregaPendiente ? <Badge color="sky">{conteo.entregaPendiente} confirmando entrega</Badge> : null}
      {conteo.error ? <Badge color="red">{conteo.error} con error al enviar</Badge> : null}
      {conteo.pendientes ? <Badge color="sky">{conteo.pendientes} pendientes</Badge> : null}
      {conteo.sinConfirmar ? <Badge color="amber">{conteo.sinConfirmar} sin confirmar</Badge> : null}
    </div>
  );
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-gray-500">{label}</dt>
      <dd className="font-semibold text-gray-900 break-words">{children}</dd>
    </div>
  );
}
