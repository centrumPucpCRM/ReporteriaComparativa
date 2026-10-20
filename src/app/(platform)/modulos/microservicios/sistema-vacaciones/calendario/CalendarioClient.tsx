"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vendedor } from "@/lib/oracle-crm";
import {
  ESTADO_LABEL,
  diaSemana,
  diasEntre,
  formatoFecha,
  hoyLima,
  sumarDias,
  type EstadoPeriodo,
  type Periodo,
} from "@/lib/vacaciones";
import {
  cancelarVacaciones,
  guardarPeriodo,
  obtenerCalendario,
  obtenerVendedores,
  programarVacaciones,
  terminarVacaciones,
} from "../actions";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const ESTILO: Record<EstadoPeriodo, { barra: string; badge: string; punto: string }> = {
  PROGRAMADA: {
    barra: "bg-sky-100 text-sky-900 border border-dashed border-sky-400 hover:bg-sky-200",
    badge: "bg-sky-100 text-sky-800",
    punto: "bg-sky-500",
  },
  EN_CURSO: {
    barra: "bg-amber-400 text-amber-950 border border-amber-500 hover:bg-amber-500",
    badge: "bg-amber-100 text-amber-800",
    punto: "bg-amber-500",
  },
  FINALIZADA: {
    barra: "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200",
    badge: "bg-gray-100 text-gray-600",
    punto: "bg-gray-400",
  },
  CANCELADA: {
    barra: "bg-white text-gray-400 border border-gray-200 line-through",
    badge: "bg-gray-100 text-gray-500",
    punto: "bg-gray-300",
  },
};

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function moverMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Semanas completas (lunes a domingo) que cubren el mes. */
function rangoMes(mes: string): { desde: string; hasta: string; finMes: string } {
  const finMes = sumarDias(moverMes(mes, 1), -1);
  return { desde: sumarDias(mes, -diaSemana(mes)), hasta: sumarDias(finMes, 6 - diaSemana(finMes)), finMes };
}

type Barra = { periodo: Periodo; col: number; span: number; carril: number; sigueAntes: boolean; sigueDespues: boolean };
type Semana = { inicio: string; dias: string[]; barras: Barra[]; carriles: number };

/** Corta cada periodo por semana y lo acomoda en el primer carril libre. */
function armarSemanas(mes: string, periodos: Periodo[]): Semana[] {
  const { desde, hasta } = rangoMes(mes);
  const semanas: Semana[] = [];
  for (let inicio = desde; inicio <= hasta; inicio = sumarDias(inicio, 7)) {
    const fin = sumarDias(inicio, 6);
    const finCarril: number[] = [];
    const barras = periodos
      .filter((p) => p.fechaInicio <= fin && p.fechaFin >= inicio)
      .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio) || b.fechaFin.localeCompare(a.fechaFin))
      .map((p) => {
        const col = p.fechaInicio < inicio ? 0 : diaSemana(p.fechaInicio);
        const ultima = p.fechaFin > fin ? 6 : diaSemana(p.fechaFin);
        let carril = finCarril.findIndex((c) => c < col);
        if (carril === -1) carril = finCarril.push(ultima) - 1;
        else finCarril[carril] = ultima;
        return { periodo: p, col, span: ultima - col + 1, carril, sigueAntes: p.fechaInicio < inicio, sigueDespues: p.fechaFin > fin };
      });
    semanas.push({ inicio, dias: Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i)), barras, carriles: finCarril.length });
  }
  return semanas;
}

function EstadoBadge({ estado }: { estado: EstadoPeriodo }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTILO[estado].badge}`}>
      <span className={`h-2 w-2 rounded-full ${ESTILO[estado].punto}`} /> {ESTADO_LABEL[estado]}
    </span>
  );
}

function rangoTexto(p: { fechaInicio: string; fechaFin: string }): string {
  return p.fechaInicio === p.fechaFin
    ? formatoFecha(p.fechaInicio)
    : `${formatoFecha(p.fechaInicio)} – ${formatoFecha(p.fechaFin)}`;
}

type Formulario = { periodo: Periodo | null; partyNumber: string; fechaInicio: string; fechaFin: string; nota: string };

export default function CalendarioClient() {
  const [mes, setMes] = useState(() => `${hoyLima().slice(0, 7)}-01`);
  const [hoy, setHoy] = useState(hoyLima);
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [vendedores, setVendedores] = useState<Vendedor[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [form, setForm] = useState<Formulario | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [confirmarFin, setConfirmarFin] = useState(false);
  const [motivoFin, setMotivoFin] = useState("");
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async (mesCargar: string) => {
    const n = ++ultimaCarga.current;
    setCargando(true);
    setError(null);
    const { desde, hasta } = rangoMes(mesCargar);
    const r = await obtenerCalendario(desde, hasta);
    if (n !== ultimaCarga.current) return; // ya se pidió otro mes
    if (r.ok) {
      setPeriodos(r.data.periodos);
      setHoy(r.data.hoy);
      if (r.data.aviso) setAviso(r.data.aviso);
    } else {
      setError(r.error);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga del mes desde Supabase
    void cargar(mes);
  }, [cargar, mes]);

  useEffect(() => {
    void obtenerVendedores().then((r) => (r.ok ? setVendedores(r.data) : setErrorForm(r.error)));
  }, []);

  const filtrados = useMemo(() => {
    const q = normalizar(busqueda);
    return (periodos ?? []).filter((p) => !q || normalizar(p.vendedorNombre).includes(q));
  }, [periodos, busqueda]);

  const semanas = useMemo(() => armarSemanas(mes, filtrados), [mes, filtrados]);
  const { finMes } = rangoMes(mes);
  const delMes = filtrados.filter((p) => p.fechaInicio <= finMes && p.fechaFin >= mes);
  const enVacacionesHoy = filtrados.filter((p) => p.fechaInicio <= hoy && p.fechaFin >= hoy && p.estado === "EN_CURSO");
  const tituloMes = formatoFecha(mes, { month: "long", year: "numeric" });

  function abrirNuevo(fecha: string) {
    setErrorForm(null);
    setConfirmarFin(false);
    setMotivoFin("");
    setForm({ periodo: null, partyNumber: "", fechaInicio: fecha, fechaFin: fecha, nota: "" });
  }

  function abrirPeriodo(p: Periodo) {
    setErrorForm(null);
    setConfirmarFin(false);
    setMotivoFin("");
    setForm({ periodo: p, partyNumber: p.partyNumber, fechaInicio: p.fechaInicio, fechaFin: p.fechaFin, nota: p.nota });
  }

  async function ejecutar(accion: () => Promise<{ ok: true; data: string | null } | { ok: false; error: string }>, exito: string) {
    setGuardando(true);
    setErrorForm(null);
    const r = await accion();
    setGuardando(false);
    if (!r.ok) {
      setErrorForm(r.error);
      setConfirmarFin(false);
      return;
    }
    setForm(null);
    setAviso(r.data ? `${exito} ${r.data}` : exito);
    void cargar(mes);
  }

  function guardar() {
    if (!form) return;
    if (!form.partyNumber) return setErrorForm("Elige un vendedor.");
    if (!form.fechaInicio || !form.fechaFin) return setErrorForm("Completa las fechas.");
    if (form.fechaFin < form.fechaInicio) return setErrorForm("La fecha de fin no puede ser anterior a la de inicio.");
    const datos = { fechaInicio: form.fechaInicio, fechaFin: form.fechaFin, nota: form.nota };
    void ejecutar(
      () => (form.periodo ? guardarPeriodo(form.periodo.id, datos) : programarVacaciones({ ...datos, partyNumber: form.partyNumber })),
      form.periodo ? "Cambios guardados." : "Vacaciones programadas.",
    );
  }

  function finalizar() {
    const p = form?.periodo;
    if (!p) return;
    if (!confirmarFin) return setConfirmarFin(true);
    void ejecutar(
      () => (p.estado === "EN_CURSO" ? terminarVacaciones(p.id, motivoFin) : cancelarVacaciones(p.id)),
      p.estado === "EN_CURSO" ? `${p.vendedorNombre} vuelve a trabajar hoy.` : "Vacaciones canceladas.",
    );
  }

  const editable = !form?.periodo || form.periodo.estado === "PROGRAMADA" || form.periodo.estado === "EN_CURSO";
  const fechasValidas = !!form?.fechaInicio && !!form.fechaFin && form.fechaFin >= form.fechaInicio;

  function explicacion(f: Formulario): string {
    const p = f.periodo;
    if (p?.estado === "FINALIZADA") return "Estas vacaciones ya terminaron.";
    if (p?.estado === "CANCELADA") return "Estas vacaciones se cancelaron.";
    if (!fechasValidas) return "";
    if (f.fechaFin < hoy) return "Fechas pasadas: quedará como registro, sin cambiar Oracle CRM.";
    const vuelve = formatoFecha(sumarDias(f.fechaFin, 1), { weekday: "long", day: "numeric", month: "long" });
    if (f.fechaInicio <= hoy) {
      return p?.estado === "EN_CURSO"
        ? `Está marcado en vacaciones en Oracle CRM. Volverá a figurar como trabajando el ${vuelve}.`
        : `Se marcará en vacaciones en Oracle CRM al guardar, y volverá a figurar como trabajando el ${vuelve}.`;
    }
    const empieza = formatoFecha(f.fechaInicio, { weekday: "long", day: "numeric", month: "long" });
    return `Oracle CRM lo marcará en vacaciones automáticamente el ${empieza} y lo desmarcará el ${vuelve}.`;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Calendario de vacaciones</h2>
          <p className="mt-1 text-sm text-gray-500">
            Programa vacaciones con fecha: se activan y se desactivan solas en Oracle CRM.
          </p>
        </div>
        <button
          onClick={() => abrirNuevo(hoy)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Programar vacaciones
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMes((m) => moverMes(m, -1))}
            aria-label="Mes anterior"
            className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setMes((m) => moverMes(m, 1))}
            aria-label="Mes siguiente"
            className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <h3 className="min-w-40 text-lg font-bold capitalize text-gray-900">{tituloMes}</h3>
          <button
            onClick={() => setMes(`${hoy.slice(0, 7)}-01`)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Hoy
          </button>
          {cargando && <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />}
        </div>
        <div className="relative sm:w-72">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Filtrar por vendedor…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
        {(["PROGRAMADA", "EN_CURSO", "FINALIZADA"] as const).map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-5 rounded ${ESTILO[e].barra}`} /> {ESTADO_LABEL[e]}
          </span>
        ))}
        {mes.slice(0, 7) === hoy.slice(0, 7) && (
          <span className="font-semibold text-gray-800">
            · {enVacacionesHoy.length} {enVacacionesHoy.length === 1 ? "vendedor" : "vendedores"} de vacaciones hoy
          </span>
        )}
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
          Error al cargar el calendario: {error}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
            {DIAS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          {semanas.map((s) => (
            <div key={s.inicio} className="relative min-h-24 border-b border-gray-100 last:border-b-0">
              <div className="absolute inset-0 grid grid-cols-7">
                {s.dias.map((d, i) => {
                  const fuera = d.slice(0, 7) !== mes.slice(0, 7);
                  return (
                    <button
                      key={d}
                      onClick={() => abrirNuevo(d)}
                      title={`Programar vacaciones desde el ${formatoFecha(d, { day: "numeric", month: "long" })}`}
                      className={`flex items-start justify-end p-1.5 hover:bg-emerald-50 ${i < 6 ? "border-r border-gray-100" : ""} ${
                        fuera ? "bg-gray-50" : ""
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          d === hoy ? "bg-emerald-600 text-white" : fuera ? "text-gray-300" : "text-gray-700"
                        }`}
                      >
                        {Number(d.slice(8))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div
                className="pointer-events-none relative grid grid-cols-7 gap-y-1 pb-2 pt-9"
                style={s.carriles ? { gridTemplateRows: `repeat(${s.carriles}, 1.375rem)` } : undefined}
              >
                {s.barras.map((b) => (
                  <button
                    key={b.periodo.id}
                    onClick={() => abrirPeriodo(b.periodo)}
                    title={`${b.periodo.vendedorNombre} · ${rangoTexto(b.periodo)} · ${ESTADO_LABEL[b.periodo.estado]}`}
                    style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.carril + 1 }}
                    className={`pointer-events-auto flex min-w-0 items-center gap-1 px-1.5 text-left text-xs font-semibold ${ESTILO[b.periodo.estado].barra} ${
                      b.sigueAntes ? "ml-0 rounded-l-none border-l-0" : "ml-1 rounded-l-md"
                    } ${b.sigueDespues ? "mr-0 rounded-r-none border-r-0" : "mr-1 rounded-r-md"}`}
                  >
                    {b.periodo.error && (
                      <span className="shrink-0 text-red-600" aria-label="Error al actualizar Oracle">
                        ⚠
                      </span>
                    )}
                    <span className="truncate">{b.periodo.vendedorNombre}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!error && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
            Vacaciones en <span className="capitalize">{tituloMes}</span>{" "}
            <span className="font-normal text-gray-500">({delMes.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3">Fechas</th>
                  <th className="hidden sm:table-cell px-4 py-3">Días</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {delMes.map((p) => (
                  <tr key={p.id} onClick={() => abrirPeriodo(p)} className="cursor-pointer hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{p.vendedorNombre}</div>
                      {p.nota && <div className="whitespace-pre-line text-xs text-gray-500">{p.nota}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">{rangoTexto(p)}</td>
                    <td className="hidden sm:table-cell px-4 py-3 text-gray-700">{diasEntre(p.fechaInicio, p.fechaFin)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EstadoBadge estado={p.estado} />
                        {p.error && <span className="text-xs font-semibold text-red-600">Oracle con error</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!delMes.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-gray-500">
                      {cargando ? "Cargando…" : "No hay vacaciones este mes. Haz clic en un día para programar."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !guardando && setForm(null)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold text-gray-900">
                {form.periodo ? `Vacaciones de ${form.periodo.vendedorNombre}` : "Programar vacaciones"}
              </h3>
              {form.periodo && <EstadoBadge estado={form.periodo.estado} />}
            </div>

            <div className="mt-4 space-y-4">
              {!form.periodo && (
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Vendedor</span>
                  <select
                    value={form.partyNumber}
                    onChange={(e) => setForm({ ...form, partyNumber: e.target.value })}
                    disabled={!vendedores}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50"
                  >
                    <option value="">{vendedores ? "Elige un vendedor…" : "Cargando vendedores desde Oracle…"}</option>
                    {(vendedores ?? [])
                      .filter((v) => v.partyNumber)
                      .map((v) => (
                        <option key={v.partyNumber} value={v.partyNumber}>
                          {v.nombre}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Desde</span>
                  <input
                    type="date"
                    value={form.fechaInicio}
                    onChange={(e) => {
                      const fechaInicio = e.target.value;
                      setForm({ ...form, fechaInicio, fechaFin: form.fechaFin < fechaInicio ? fechaInicio : form.fechaFin });
                    }}
                    disabled={!editable || form.periodo?.estado === "EN_CURSO"}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Hasta (inclusive)</span>
                  <input
                    type="date"
                    value={form.fechaFin}
                    min={form.fechaInicio}
                    onChange={(e) => setForm({ ...form, fechaFin: e.target.value })}
                    disabled={!editable}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </label>
              </div>

              {fechasValidas && (
                <p className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">
                    {diasEntre(form.fechaInicio, form.fechaFin)} {diasEntre(form.fechaInicio, form.fechaFin) === 1 ? "día" : "días"}
                  </span>{" "}
                  · {explicacion(form)}
                </p>
              )}

              <label className="block text-sm">
                <span className="font-semibold text-gray-700">Nota (opcional)</span>
                <textarea
                  value={form.nota}
                  onChange={(e) => setForm({ ...form, nota: e.target.value })}
                  disabled={!editable}
                  rows={2}
                  placeholder="Ej.: reemplazo, motivo…"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </label>

              {form.periodo?.error && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No se pudo actualizar Oracle CRM; se reintentará automáticamente. Detalle: {form.periodo.error}
                </div>
              )}
              {form.periodo && (form.periodo.creadoPor || form.periodo.actualizadoPor) && (
                <p className="text-xs text-gray-500">
                  Programado por {form.periodo.creadoPor || "—"}
                  {form.periodo.actualizadoPor && form.periodo.actualizadoPor !== form.periodo.creadoPor
                    ? ` · último cambio: ${form.periodo.actualizadoPor}`
                    : ""}
                </p>
              )}
              {confirmarFin && form.periodo?.estado === "EN_CURSO" && form.periodo.fechaFin >= hoy && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <div className="font-semibold">⚠ Término anticipado</div>
                  <p>
                    Debía volver el {formatoFecha(sumarDias(form.periodo.fechaFin, 1), { weekday: "long", day: "numeric", month: "long" })}.
                    Si confirmas, vuelve a figurar como trabajando <strong>hoy</strong> y se pierden{" "}
                    <strong>
                      {diasEntre(hoy, form.periodo.fechaFin)} {diasEntre(hoy, form.periodo.fechaFin) === 1 ? "día" : "días"}
                    </strong>{" "}
                    de vacaciones (hoy incluido).
                  </p>
                  <input
                    value={motivoFin}
                    onChange={(e) => setMotivoFin(e.target.value)}
                    placeholder="Motivo (opcional)"
                    autoFocus
                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}
              {errorForm && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorForm}</div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <div>
                {(form.periodo?.estado === "PROGRAMADA" || form.periodo?.estado === "EN_CURSO") && (
                  <button
                    onClick={finalizar}
                    disabled={guardando}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                      confirmarFin ? "bg-red-600 text-white hover:bg-red-700" : "text-red-700 hover:bg-red-50"
                    }`}
                  >
                    {confirmarFin
                      ? form.periodo.estado === "EN_CURSO"
                        ? "Terminar antes"
                        : "¿Confirmar cancelación?"
                      : form.periodo.estado === "EN_CURSO"
                        ? "Terminar hoy"
                        : "Cancelar vacaciones"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm(null)}
                  disabled={guardando}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cerrar
                </button>
                {editable && (
                  <button
                    onClick={guardar}
                    disabled={guardando}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {guardando ? "Guardando…" : form.periodo ? "Guardar" : "Programar"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
