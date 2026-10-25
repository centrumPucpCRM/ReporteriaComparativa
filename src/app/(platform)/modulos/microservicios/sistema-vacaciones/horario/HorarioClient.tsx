"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Vendedor } from "@/lib/oracle-crm";
import {
  ESTADO_LABEL,
  contarDias,
  diaSemana,
  esLaborable,
  formatoFecha,
  hoyLima,
  sumarDias,
  type EstadoPeriodo,
  type Jornada,
  type Periodo,
  type TipoAusencia,
} from "@/lib/vacaciones";
import { obtenerHorario } from "../actions";
import { Aviso, BOTON_SECUNDARIO, ErrorCaja, Flechas } from "../_components/comun";

const INICIAL = ["L", "M", "X", "J", "V", "S", "D"];
const BASE = "/modulos/microservicios/sistema-vacaciones";

/** Las programadas se ven más tenues que las que están en curso o ya pasaron. */
const OPACIDAD: Record<EstadoPeriodo, number> = { EN_CURSO: 1, FINALIZADA: 0.75, PROGRAMADA: 0.45, CANCELADA: 0 };

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function moverMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

type Fila = { partyNumber: string; nombre: string; periodos: Periodo[] };

export default function HorarioClient() {
  const [mes, setMes] = useState(() => `${hoyLima().slice(0, 7)}-01`);
  const [hoy, setHoy] = useState(hoyLima);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [jornada, setJornada] = useState<Jornada>({ diasLaborales: [0, 1, 2, 3, 4], feriados: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [todos, setTodos] = useState(false);
  const ultimaCarga = useRef(0);

  const finMes = sumarDias(moverMes(mes, 1), -1);

  const cargar = useCallback(async (desde: string, hasta: string) => {
    const n = ++ultimaCarga.current;
    setCargando(true);
    setError(null);
    const r = await obtenerHorario(desde, hasta);
    if (n !== ultimaCarga.current) return; // ya se pidió otro mes
    if (r.ok) {
      setPeriodos(r.data.periodos);
      setVendedores(r.data.vendedores);
      setTipos(r.data.tipos);
      setJornada(r.data.jornada);
      setHoy(r.data.hoy);
      if (r.data.aviso) setAviso(r.data.aviso);
    } else {
      setError(r.error);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga del mes desde Supabase y Oracle
    void cargar(mes, finMes);
  }, [cargar, mes, finMes]);

  const dias = useMemo(() => {
    const lista: string[] = [];
    for (let d = mes; d <= finMes; d = sumarDias(d, 1)) lista.push(d);
    return lista;
  }, [mes, finMes]);

  const tipoPorId = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const feriadoPorFecha = useMemo(() => new Map(jornada.feriados.map((f) => [f.fecha, f.nombre])), [jornada]);
  const feriados = useMemo(() => new Set(feriadoPorFecha.keys()), [feriadoPorFecha]);

  const filas = useMemo<Fila[]>(() => {
    const mapa = new Map<string, Fila>();
    if (todos) for (const v of vendedores) if (v.partyNumber) mapa.set(v.partyNumber, { partyNumber: v.partyNumber, nombre: v.nombre, periodos: [] });
    for (const p of periodos) {
      const fila = mapa.get(p.partyNumber) ?? { partyNumber: p.partyNumber, nombre: p.vendedorNombre, periodos: [] };
      fila.periodos.push(p);
      mapa.set(p.partyNumber, fila);
    }
    const q = normalizar(busqueda);
    return [...mapa.values()]
      .filter((f) => !q || normalizar(f.nombre).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [vendedores, periodos, todos, busqueda]);

  const tiposDelMes = tipos.filter((t) => periodos.some((p) => p.tipoId === t.id));
  const tituloMes = formatoFecha(mes, { month: "long", year: "numeric" });

  function diasEnMes(f: Fila): number {
    return f.periodos.reduce((n, p) => {
      const tipo = tipoPorId.get(p.tipoId);
      return n + contarDias(p.fechaInicio, p.fechaFin, tipo?.conteo ?? "CALENDARIO", jornada, mes, finMes);
    }, 0);
  }

  function fondoDia(d: string): string {
    if (d === hoy) return "bg-emerald-50";
    return esLaborable(d, jornada.diasLaborales, feriados) ? "" : "bg-gray-200/70";
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Horario de ausencias</h2>
          <p className="mt-1 text-sm text-gray-500">
            Quién está ausente cada día del mes. En gris, días no laborables y feriados. Para programar usa el{" "}
            <Link href={`${BASE}/calendario`} className="font-semibold text-emerald-700 hover:underline">
              calendario
            </Link>
            .
          </p>
        </div>
        <button onClick={() => window.print()} className={BOTON_SECUNDARIO}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Imprimir
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Flechas etiqueta="Mes" onAnterior={() => setMes((m) => moverMes(m, -1))} onSiguiente={() => setMes((m) => moverMes(m, 1))} />
          <h3 className="min-w-40 text-lg font-bold capitalize text-gray-900">{tituloMes}</h3>
          <button
            onClick={() => setMes(`${hoy.slice(0, 7)}-01`)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Hoy
          </button>
          {cargando && <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            Todos los vendedores
          </label>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Filtrar por vendedor…"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:w-64"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
        {tiposDelMes.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded" style={{ backgroundColor: t.color }} /> {t.nombre}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded bg-gray-400 opacity-45" /> Programada (tenue)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded bg-gray-200" /> No laborable / feriado
        </span>
      </div>

      {aviso && <Aviso texto={aviso} onCerrar={() => setAviso(null)} />}

      {error ? (
        <ErrorCaja>Error al cargar el horario: {error}</ErrorCaja>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="sticky left-0 z-10 min-w-48 bg-gray-50 px-3 py-2 text-left font-semibold uppercase tracking-wide">
                    Vendedor
                  </th>
                  {dias.map((d) => (
                    <th
                      key={d}
                      title={feriadoPorFecha.get(d)}
                      className={`w-7 min-w-7 border-l border-gray-100 py-1 text-center font-semibold ${fondoDia(d)} ${
                        d === hoy ? "text-emerald-700" : feriadoPorFecha.has(d) ? "text-red-600" : ""
                      }`}
                    >
                      <div>{Number(d.slice(8))}</div>
                      <div className="font-normal">{INICIAL[diaSemana(d)]}</div>
                    </th>
                  ))}
                  <th className="border-l border-gray-100 px-2 py-2 text-right font-semibold uppercase tracking-wide">Días</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-gray-700">Feriados y días libres</td>
                  {dias.map((d) => (
                    <td
                      key={d}
                      title={feriadoPorFecha.get(d)}
                      className={`h-7 border-l border-gray-100 ${feriadoPorFecha.has(d) ? "bg-red-200" : fondoDia(d)}`}
                    />
                  ))}
                  <td className="border-l border-gray-100" />
                </tr>
                {filas.map((f) => (
                  <tr key={f.partyNumber} className="hover:bg-gray-50/60">
                    <td className="sticky left-0 z-10 max-w-56 truncate bg-white px-3 py-2">
                      <Link
                        href={`${BASE}/movimientos?vendedor=${encodeURIComponent(f.partyNumber)}&anio=${mes.slice(0, 4)}`}
                        className="font-semibold text-gray-900 hover:text-emerald-700 hover:underline"
                        title="Ver movimientos del vendedor"
                      >
                        {f.nombre}
                      </Link>
                    </td>
                    {dias.map((d) => {
                      const p = f.periodos.find((x) => x.fechaInicio <= d && x.fechaFin >= d);
                      const tipo = p ? tipoPorId.get(p.tipoId) : undefined;
                      return (
                        <td
                          key={d}
                          className={`h-7 border-l border-gray-100 p-0.5 ${fondoDia(d)}`}
                          title={p ? `${f.nombre} · ${tipo?.nombre ?? "Ausencia"} · ${ESTADO_LABEL[p.estado]}${p.nota ? ` · ${p.nota}` : ""}` : undefined}
                        >
                          {p && (
                            <div
                              className="h-full w-full rounded-sm"
                              style={{ backgroundColor: tipo?.color ?? "#9ca3af", opacity: OPACIDAD[p.estado] }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="border-l border-gray-100 px-2 text-right font-semibold text-gray-700">{diasEnMes(f) || ""}</td>
                  </tr>
                ))}
                {!filas.length && (
                  <tr>
                    <td colSpan={dias.length + 2} className="px-4 py-10 text-center text-sm text-gray-500">
                      {cargando ? "Cargando…" : "Nadie tiene ausencias este mes."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
