"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vendedor } from "@/lib/oracle-crm";
import {
  ESTADO_LABEL,
  contarDias,
  formatoFecha,
  hoyLima,
  sumarDias,
  type EstadoPeriodo,
  type Jornada,
  type Periodo,
  type TipoAusencia,
} from "@/lib/vacaciones";
import { obtenerMovimientos, obtenerVendedores } from "../actions";
import { BOTON_SECUNDARIO, ErrorCaja, INPUT, IconoDescarga, TipoChip, descargarCsv } from "../_components/comun";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const ESTADOS: EstadoPeriodo[] = ["PROGRAMADA", "EN_CURSO", "FINALIZADA", "CANCELADA"];

const BADGE: Record<EstadoPeriodo, string> = {
  PROGRAMADA: "bg-sky-100 text-sky-800",
  EN_CURSO: "bg-amber-100 text-amber-800",
  FINALIZADA: "bg-gray-100 text-gray-600",
  CANCELADA: "bg-gray-100 text-gray-400 line-through",
};

type Filtros = { anio: number; mes: number | null; tipoId: number | null; estado: EstadoPeriodo | null; partyNumber: string };

function rango(f: Filtros): { desde: string; hasta: string } {
  if (f.mes === null) return { desde: `${f.anio}-01-01`, hasta: `${f.anio}-12-31` };
  const desde = `${f.anio}-${String(f.mes + 1).padStart(2, "0")}-01`;
  const siguiente = f.mes === 11 ? `${f.anio + 1}-01-01` : `${f.anio}-${String(f.mes + 2).padStart(2, "0")}-01`;
  return { desde, hasta: sumarDias(siguiente, -1) };
}

export default function MovimientosClient({ vendedorInicial, anioInicial }: { vendedorInicial: string; anioInicial: number | null }) {
  const anioHoy = Number(hoyLima().slice(0, 4));
  const [filtros, setFiltros] = useState<Filtros>({
    anio: anioInicial ?? anioHoy,
    mes: null,
    tipoId: null,
    estado: null,
    partyNumber: vendedorInicial,
  });
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [jornada, setJornada] = useState<Jornada>({ diasLaborales: [0, 1, 2, 3, 4], feriados: [] });
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async (f: Filtros) => {
    const n = ++ultimaCarga.current;
    setCargando(true);
    setError(null);
    const r = await obtenerMovimientos({
      ...rango(f),
      tipoId: f.tipoId ?? undefined,
      estado: f.estado ?? undefined,
      partyNumber: f.partyNumber || undefined,
    });
    if (n !== ultimaCarga.current) return;
    if (r.ok) {
      setPeriodos(r.data.periodos);
      setTipos(r.data.tipos);
      setJornada(r.data.jornada);
    } else {
      setError(r.error);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar filtros
    void cargar(filtros);
  }, [cargar, filtros]);

  useEffect(() => {
    void obtenerVendedores().then((r) => r.ok && setVendedores(r.data));
  }, []);

  const tipoPorId = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const { desde, hasta } = rango(filtros);

  /** Días de la ausencia dentro del rango filtrado, según el conteo del tipo. */
  const dias = useCallback(
    (p: Periodo) => contarDias(p.fechaInicio, p.fechaFin, tipoPorId.get(p.tipoId)?.conteo ?? "CALENDARIO", jornada, desde, hasta),
    [tipoPorId, jornada, desde, hasta],
  );

  const totalDias = periodos.filter((p) => p.estado !== "CANCELADA").reduce((n, p) => n + dias(p), 0);

  // Vendedores de Oracle más los que aparecen en el resultado (pueden estar inactivos).
  const opcionesVendedor = useMemo(() => {
    const mapa = new Map(vendedores.filter((v) => v.partyNumber).map((v) => [v.partyNumber, v.nombre]));
    for (const p of periodos) if (!mapa.has(p.partyNumber)) mapa.set(p.partyNumber, p.vendedorNombre);
    return [...mapa].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [vendedores, periodos]);

  function exportar() {
    const nombreRango = filtros.mes === null ? String(filtros.anio) : desde.slice(0, 7);
    descargarCsv(`movimientos-vacaciones-${nombreRango}.csv`, [
      ["Vendedor", "Party Number", "Correo", "Tipo", "Desde", "Hasta", `Días en ${nombreRango}`, "Estado", "Nota", "Creado por", "Último cambio"],
      ...periodos.map((p) => [
        p.vendedorNombre,
        p.partyNumber,
        p.vendedorCorreo,
        tipoPorId.get(p.tipoId)?.nombre ?? "",
        p.fechaInicio,
        p.fechaFin,
        p.estado === "CANCELADA" ? 0 : dias(p),
        ESTADO_LABEL[p.estado],
        p.nota,
        p.creadoPor,
        p.actualizadoPor,
      ]),
    ]);
  }

  const anios = Array.from({ length: 6 }, (_, i) => anioHoy + 1 - i);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Movimientos</h2>
          <p className="mt-1 text-sm text-gray-500">Todas las ausencias registradas, incluidas las canceladas. Descárgalas en CSV.</p>
        </div>
        <button onClick={exportar} disabled={!periodos.length} className={BOTON_SECUNDARIO}>
          <IconoDescarga /> Descargar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <label className="block text-xs font-semibold text-gray-600">
          Año
          <select value={filtros.anio} onChange={(e) => setFiltros({ ...filtros, anio: Number(e.target.value) })} className={`mt-1 ${INPUT}`}>
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-600">
          Mes
          <select
            value={filtros.mes ?? ""}
            onChange={(e) => setFiltros({ ...filtros, mes: e.target.value === "" ? null : Number(e.target.value) })}
            className={`mt-1 ${INPUT}`}
          >
            <option value="">Todo el año</option>
            {MESES.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-600">
          Tipo
          <select
            value={filtros.tipoId ?? ""}
            onChange={(e) => setFiltros({ ...filtros, tipoId: e.target.value ? Number(e.target.value) : null })}
            className={`mt-1 ${INPUT}`}
          >
            <option value="">Todos</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-600">
          Estado
          <select
            value={filtros.estado ?? ""}
            onChange={(e) => setFiltros({ ...filtros, estado: (e.target.value || null) as EstadoPeriodo | null })}
            className={`mt-1 ${INPUT}`}
          >
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ESTADO_LABEL[e]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block text-xs font-semibold text-gray-600 md:col-span-1">
          Vendedor
          <select value={filtros.partyNumber} onChange={(e) => setFiltros({ ...filtros, partyNumber: e.target.value })} className={`mt-1 ${INPUT}`}>
            <option value="">Todos</option>
            {opcionesVendedor.map(([pn, nombre]) => (
              <option key={pn} value={pn}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <ErrorCaja>Error al cargar los movimientos: {error}</ErrorCaja>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm">
            <span className="font-semibold text-gray-900">Total: {periodos.length}</span>
            <span className="text-gray-500">· {totalDias} días de ausencia en el periodo</span>
            {cargando && <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Fechas</th>
                  <th className="px-4 py-3 text-right">Días</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="hidden lg:table-cell px-4 py-3">Registrado por</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {periodos.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{p.vendedorNombre}</div>
                      {p.nota && <div className="whitespace-pre-line text-xs text-gray-500">{p.nota}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <TipoChip tipo={tipoPorId.get(p.tipoId)} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {formatoFecha(p.fechaInicio, { day: "numeric", month: "short", year: "numeric" })} –{" "}
                      {formatoFecha(p.fechaFin, { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{p.estado === "CANCELADA" ? "—" : dias(p)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[p.estado]}`}>{ESTADO_LABEL[p.estado]}</span>
                      {p.error && <div className="mt-1 text-xs font-semibold text-red-600">Oracle con error</div>}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-xs text-gray-500">{p.creadoPor || "—"}</td>
                  </tr>
                ))}
                {!periodos.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      {cargando ? "Cargando…" : "No hay movimientos con estos filtros."}
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
