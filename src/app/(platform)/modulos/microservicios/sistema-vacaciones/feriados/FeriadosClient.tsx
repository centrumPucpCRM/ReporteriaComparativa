"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatoFecha, hoyLima, type Feriado } from "@/lib/vacaciones";
import { eliminarFeriadoAccion, guardarFeriadoAccion, obtenerFeriados } from "../actions";
import { Aviso, BOTON_PRIMARIO, ErrorCaja, Flechas, INPUT } from "../_components/comun";

export default function FeriadosClient() {
  const [anio, setAnio] = useState(() => Number(hoyLima().slice(0, 4)));
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ fecha: "", nombre: "" });
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [porEliminar, setPorEliminar] = useState<string | null>(null);
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async (a: number) => {
    const n = ++ultimaCarga.current;
    setCargando(true);
    setError(null);
    const r = await obtenerFeriados(a);
    if (n !== ultimaCarga.current) return;
    if (r.ok) setFeriados(r.data);
    else setError(r.error);
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga del año desde Supabase
    void cargar(anio);
  }, [cargar, anio]);

  async function agregar() {
    if (!nuevo.fecha || !nuevo.nombre.trim()) return setErrorForm("Indica la fecha y el nombre.");
    setGuardando(true);
    setErrorForm(null);
    const r = await guardarFeriadoAccion(nuevo.fecha, nuevo.nombre);
    setGuardando(false);
    if (!r.ok) return setErrorForm(r.error);
    setAviso(`Feriado del ${formatoFecha(nuevo.fecha, { day: "numeric", month: "long", year: "numeric" })} guardado.`);
    const anioNuevo = Number(nuevo.fecha.slice(0, 4));
    setNuevo({ fecha: "", nombre: "" });
    if (anioNuevo !== anio) setAnio(anioNuevo);
    else void cargar(anio);
  }

  async function eliminar(fecha: string) {
    if (porEliminar !== fecha) return setPorEliminar(fecha);
    setPorEliminar(null);
    const r = await eliminarFeriadoAccion(fecha);
    if (!r.ok) return setError(r.error);
    void cargar(anio);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Feriados</h2>
        <p className="mt-1 text-sm text-gray-500">
          No cuentan como días de ausencia en los tipos de días laborales y se marcan en el calendario y el horario.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <label className="block text-sm">
            <span className="font-semibold text-gray-700">Fecha</span>
            <input type="date" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-gray-700">Nombre</span>
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void agregar()}
              placeholder="Ej.: Fiestas Patrias"
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <button onClick={() => void agregar()} disabled={guardando} className={`${BOTON_PRIMARIO} justify-center`}>
            {guardando ? "Guardando…" : "Agregar"}
          </button>
        </div>
        {errorForm && <div className="mt-3"><ErrorCaja>{errorForm}</ErrorCaja></div>}
      </div>

      {aviso && <Aviso texto={aviso} onCerrar={() => setAviso(null)} />}

      <div className="flex items-center gap-2">
        <Flechas etiqueta="Año" onAnterior={() => setAnio((a) => a - 1)} onSiguiente={() => setAnio((a) => a + 1)} />
        <h3 className="text-lg font-bold text-gray-900">{anio}</h3>
        {cargando && <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />}
      </div>

      {error ? (
        <ErrorCaja>Error al cargar los feriados: {error}</ErrorCaja>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Total: {feriados.length}</div>
          <ul className="divide-y divide-gray-100">
            {feriados.map((f) => (
              <li key={f.fecha} className="flex items-center gap-4 px-4 py-3">
                <span className="w-40 shrink-0 text-sm font-semibold capitalize text-red-600">
                  {formatoFecha(f.fecha, { weekday: "short", day: "numeric", month: "long" })}
                </span>
                <span className="flex-1 text-sm text-gray-900">{f.nombre}</span>
                <button
                  onClick={() => void eliminar(f.fecha)}
                  onBlur={() => setPorEliminar(null)}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                    porEliminar === f.fecha ? "bg-red-600 text-white hover:bg-red-700" : "text-red-700 hover:bg-red-50"
                  }`}
                >
                  {porEliminar === f.fecha ? "¿Eliminar?" : "Eliminar"}
                </button>
              </li>
            ))}
            {!feriados.length && (
              <li className="px-4 py-10 text-center text-sm text-gray-500">{cargando ? "Cargando…" : `No hay feriados registrados en ${anio}.`}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
