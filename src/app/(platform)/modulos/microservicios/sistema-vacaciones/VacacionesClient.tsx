"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Vendedor } from "@/lib/oracle-crm";
import { diasEntre, formatoFecha, sumarDias, type Periodo } from "@/lib/vacaciones";
import { cambiarVacaciones, obtenerPanelVendedores, programarVacaciones, terminarVacaciones } from "./actions";
import ImportarExportar from "./_components/ImportarExportar";

type Filtro = "todos" | "vacaciones" | "trabajando";

/** "iniciar" crea un periodo con fechas; "finalizar" lo termina hoy (o desmarca a mano si no hay periodo). */
type Modal =
  | { tipo: "iniciar"; vendedor: Vendedor; fechaInicio: string; fechaFin: string; nota: string }
  | { tipo: "finalizar"; vendedor: Vendedor; periodo: Periodo | null; motivo: string };

const FECHA_LARGA: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : Math.min(diag, prev[j], prev[j - 1]) + 1;
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Cada palabra buscada debe aparecer en el nombre: como substring, o (desde 3 letras)
 * parecida en ≥70% a alguna palabra del nombre, para tolerar errores de tipeo.
 */
function coincide(nombre: string, tokens: string[]): boolean {
  const n = normalizar(nombre);
  const palabras = n.split(/\s+/);
  return tokens.every(
    (t) =>
      n.includes(t) ||
      (t.length >= 3 &&
        palabras.some((p) => {
          const largo = Math.max(t.length, p.length);
          return (largo - levenshtein(t, p)) / largo >= 0.7;
        })),
  );
}

function rangoTexto(p: Periodo): string {
  return p.fechaInicio === p.fechaFin
    ? formatoFecha(p.fechaInicio)
    : `${formatoFecha(p.fechaInicio)} – ${formatoFecha(p.fechaFin)}`;
}

function EstadoBadge({ enVacaciones }: { enVacaciones: boolean }) {
  return enVacaciones ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
      <span className="h-2 w-2 rounded-full bg-amber-500" /> En vacaciones
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Trabajando
    </span>
  );
}

export default function VacacionesClient() {
  const [vendedores, setVendedores] = useState<Vendedor[] | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [hoy, setHoy] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [modal, setModal] = useState<Modal | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorCambio, setErrorCambio] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const r = await obtenerPanelVendedores();
    if (r.ok) {
      setVendedores(r.data.vendedores);
      setPeriodos(r.data.periodos);
      setHoy(r.data.hoy);
      if (r.data.aviso) setAviso(r.data.aviso);
    } else {
      setError(r.error);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Oracle
    void cargar();
  }, [cargar]);

  /** Por vendedor: el periodo en curso y el próximo programado. */
  const periodosPorVendedor = useMemo(() => {
    const mapa = new Map<string, { enCurso: Periodo | null; proximo: Periodo | null }>();
    for (const p of periodos) {
      const actual = mapa.get(p.partyNumber) ?? { enCurso: null, proximo: null };
      if (p.estado === "EN_CURSO") actual.enCurso = p;
      else if (p.estado === "PROGRAMADA" && (!actual.proximo || p.fechaInicio < actual.proximo.fechaInicio)) actual.proximo = p;
      mapa.set(p.partyNumber, actual);
    }
    return mapa;
  }, [periodos]);

  const totales = useMemo(() => {
    const lista = vendedores ?? [];
    const vacaciones = lista.filter((v) => v.enVacaciones).length;
    return { todos: lista.length, vacaciones, trabajando: lista.length - vacaciones };
  }, [vendedores]);

  const visibles = useMemo(() => {
    const tokens = normalizar(busqueda).split(/\s+/).filter(Boolean);
    return (vendedores ?? []).filter(
      (v) =>
        (filtro === "todos" || (filtro === "vacaciones") === v.enVacaciones) &&
        (!tokens.length || coincide(v.nombre, tokens)),
    );
  }, [vendedores, busqueda, filtro]);

  function abrir(m: Modal) {
    setErrorCambio(null);
    setModal(m);
  }

  async function aplicar() {
    if (!modal) return;
    let r: { ok: true; data: unknown } | { ok: false; error: string };
    let exito: string;
    if (modal.tipo === "iniciar") {
      if (!modal.fechaInicio || !modal.fechaFin) return setErrorCambio("Indica desde y hasta cuándo.");
      if (modal.fechaFin < modal.fechaInicio) return setErrorCambio("La fecha de fin no puede ser anterior a la de inicio.");
      if (modal.fechaFin < hoy) return setErrorCambio("La fecha de fin ya pasó: para registrar vacaciones pasadas usa el calendario.");
      setGuardando(true);
      setErrorCambio(null);
      r = await programarVacaciones({
        partyNumber: modal.vendedor.partyNumber,
        fechaInicio: modal.fechaInicio,
        fechaFin: modal.fechaFin,
        nota: modal.nota,
      });
      exito =
        modal.fechaInicio > hoy
          ? `Vacaciones programadas para ${modal.vendedor.nombre} (${formatoFecha(modal.fechaInicio)} – ${formatoFecha(modal.fechaFin)}).`
          : `${modal.vendedor.nombre} está de vacaciones hasta el ${formatoFecha(modal.fechaFin, FECHA_LARGA)}.`;
    } else {
      setGuardando(true);
      setErrorCambio(null);
      r = modal.periodo
        ? await terminarVacaciones(modal.periodo.id, modal.motivo)
        : await cambiarVacaciones(modal.vendedor.partyNumber, false);
      exito = `${modal.vendedor.nombre} vuelve a figurar como trabajando.`;
    }
    setGuardando(false);
    if (!r.ok) {
      setErrorCambio(r.error);
      return;
    }
    setModal(null);
    setAviso(exito);
    void cargar();
  }

  const FILTROS: { id: Filtro; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "trabajando", label: "Trabajando" },
    { id: "vacaciones", label: "En vacaciones" },
  ];

  /** Días de vacaciones que se pierden al terminar hoy (hoy incluido); 0 si no es anticipado. */
  const diasRestantes =
    modal?.tipo === "finalizar" && modal.periodo && modal.periodo.fechaFin >= hoy ? diasEntre(hoy, modal.periodo.fechaFin) : 0;

  const fechasModalValidas =
    modal?.tipo === "iniciar" && !!modal.fechaInicio && !!modal.fechaFin && modal.fechaFin >= modal.fechaInicio;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Vacaciones de vendedores</h2>
          <p className="mt-1 text-sm text-gray-500">
            Cada vacación tiene fecha de regreso: al terminar, el vendedor vuelve solo a &quot;Trabajando&quot; en Oracle CRM
            (<code>CTREnVacaciones_c</code>). Ver también el{" "}
            <Link href="/modulos/microservicios/sistema-vacaciones/calendario" className="font-semibold text-emerald-700 hover:underline">
              calendario
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportarExportar />
          <button
            onClick={() => void cargar()}
            disabled={cargando}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <svg className={`w-4 h-4 ${cargando ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar vendedor por nombre…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                filtro === f.id ? "bg-emerald-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {f.label} <span className="opacity-75">({totales[f.id]})</span>
            </button>
          ))}
        </div>
      </div>

      {aviso && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-emerald-700 hover:text-emerald-900">
            ✕
          </button>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Error al cargar los vendedores: {error}
        </div>
      ) : cargando && !vendedores ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />
          Cargando vendedores desde Oracle…
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="hidden md:table-cell px-4 py-3">Party ID</th>
                  <th className="hidden sm:table-cell px-4 py-3">Party Number</th>
                  <th className="hidden lg:table-cell px-4 py-3">Correo</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibles.map((v) => {
                  const { enCurso, proximo } = periodosPorVendedor.get(v.partyNumber) ?? { enCurso: null, proximo: null };
                  const sinFecha = v.enVacaciones && !enCurso;
                  return (
                    <tr key={v.partyNumber || v.partyId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{v.nombre || "—"}</div>
                        <div className="lg:hidden text-xs text-gray-500 break-all">{v.correo}</div>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 font-mono text-gray-600">{v.partyId || "—"}</td>
                      <td className="hidden sm:table-cell px-4 py-3 font-mono text-gray-900">{v.partyNumber || "—"}</td>
                      <td className="hidden lg:table-cell px-4 py-3 text-gray-600">{v.correo || "—"}</td>
                      <td className="px-4 py-3">
                        <EstadoBadge enVacaciones={v.enVacaciones} />
                        {enCurso && (
                          <div className="mt-1 text-xs text-gray-600">
                            Vuelve el {formatoFecha(sumarDias(enCurso.fechaFin, 1), FECHA_LARGA)}
                          </div>
                        )}
                        {sinFecha && <div className="mt-1 text-xs font-semibold text-red-600">Sin fecha de regreso</div>}
                        {proximo && <div className="mt-1 text-xs text-sky-700">Programadas: {rangoTexto(proximo)}</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {sinFecha && (
                            <button
                              onClick={() =>
                                abrir({ tipo: "iniciar", vendedor: v, fechaInicio: hoy, fechaFin: "", nota: "" })
                              }
                              className="whitespace-nowrap rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                            >
                              Poner fecha de regreso
                            </button>
                          )}
                          {v.enVacaciones || enCurso ? (
                            <button
                              onClick={() => abrir({ tipo: "finalizar", vendedor: v, periodo: enCurso, motivo: "" })}
                              disabled={!v.partyNumber}
                              className="whitespace-nowrap rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
                            >
                              Finalizar vacaciones
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                abrir({ tipo: "iniciar", vendedor: v, fechaInicio: hoy, fechaFin: "", nota: "" })
                              }
                              disabled={!v.partyNumber}
                              className="whitespace-nowrap rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
                            >
                              Iniciar vacaciones
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visibles.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      No se encontraron vendedores.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
            Mostrando {visibles.length} de {totales.todos} vendedores activos
          </div>
        </div>
      )}

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !guardando && setModal(null)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">
              {modal.tipo === "finalizar"
                ? diasRestantes
                  ? "Terminar vacaciones antes de tiempo"
                  : "Finalizar vacaciones"
                : modal.vendedor.enVacaciones
                  ? "Fecha de regreso"
                  : "Iniciar vacaciones"}
            </h3>
            <dl className="mt-3 space-y-1 text-sm">
              <div>
                <dt className="inline text-gray-500">Vendedor: </dt>
                <dd className="inline font-semibold text-gray-900">{modal.vendedor.nombre}</dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Party Number: </dt>
                <dd className="inline font-mono text-gray-900">{modal.vendedor.partyNumber}</dd>
              </div>
            </dl>

            {modal.tipo === "iniciar" ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="font-semibold text-gray-700">Desde</span>
                    <input
                      type="date"
                      value={modal.fechaInicio}
                      onChange={(e) => setModal({ ...modal, fechaInicio: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-gray-700">Hasta (último día)</span>
                    <input
                      type="date"
                      value={modal.fechaFin}
                      min={modal.fechaInicio > hoy ? modal.fechaInicio : hoy}
                      onChange={(e) => setModal({ ...modal, fechaFin: e.target.value })}
                      autoFocus
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </label>
                </div>
                {modal.vendedor.enVacaciones && (
                  <p className="text-xs text-gray-500">
                    Ya está marcado en Oracle sin fechas. Si empezó antes, puedes poner la fecha real de inicio.
                  </p>
                )}
                {fechasModalValidas && modal.fechaFin >= hoy && (
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{diasEntre(modal.fechaInicio, modal.fechaFin)} días</span> ·{" "}
                    {modal.fechaInicio <= hoy
                      ? `Queda en vacaciones desde ya y vuelve solo a "Trabajando" el ${formatoFecha(sumarDias(modal.fechaFin, 1), FECHA_LARGA)}.`
                      : `Se activa solo el ${formatoFecha(modal.fechaInicio, FECHA_LARGA)} y vuelve a "Trabajando" el ${formatoFecha(sumarDias(modal.fechaFin, 1), FECHA_LARGA)}.`}
                  </p>
                )}
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Nota (opcional)</span>
                  <input
                    value={modal.nota}
                    onChange={(e) => setModal({ ...modal, nota: e.target.value })}
                    placeholder="Ej.: reemplazo, motivo…"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
              </div>
            ) : diasRestantes && modal.periodo ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <div className="font-semibold">⚠ Término anticipado</div>
                  <p className="mt-1">
                    Sus vacaciones eran del {rangoTexto(modal.periodo)} y debía volver el{" "}
                    {formatoFecha(sumarDias(modal.periodo.fechaFin, 1), FECHA_LARGA)}. Si confirmas, vuelve a figurar como
                    trabajando <strong>hoy</strong> y se pierden{" "}
                    <strong>
                      {diasRestantes} {diasRestantes === 1 ? "día" : "días"}
                    </strong>{" "}
                    de vacaciones (hoy incluido).
                  </p>
                </div>
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Motivo (opcional)</span>
                  <input
                    value={modal.motivo}
                    onChange={(e) => setModal({ ...modal, motivo: e.target.value })}
                    placeholder="Ej.: regresó antes por cierre de campaña"
                    autoFocus
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <p className="text-xs text-gray-500">Queda anotado en las vacaciones quién las terminó y por qué.</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-600">Volverá a figurar como trabajando en Oracle CRM.</p>
            )}

            {errorCambio && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorCambio}</div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                disabled={guardando}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={() => void aplicar()}
                disabled={guardando}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                  diasRestantes ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {guardando ? "Guardando…" : diasRestantes ? "Terminar antes" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
