"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { METODO_LABEL, hoyLima, type Configuracion, type SaldoVendedor } from "@/lib/vacaciones";
import { guardarSaldo, obtenerSaldos } from "../actions";
import { Aviso, BOTON_PRIMARIO, BOTON_SECUNDARIO, ErrorCaja, INPUT, IconoDescarga, descargarCsv } from "../_components/comun";

const BASE = "/modulos/microservicios/sistema-vacaciones";

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

type Edicion = { saldo: SaldoVendedor; asignados: string; transferidos: string; nota: string };

export default function SaldosClient() {
  const anioHoy = Number(hoyLima().slice(0, 4));
  const [anio, setAnio] = useState(anioHoy);
  const [saldos, setSaldos] = useState<SaldoVendedor[]>([]);
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async (a: number) => {
    const n = ++ultimaCarga.current;
    setCargando(true);
    setError(null);
    const r = await obtenerSaldos(a);
    if (n !== ultimaCarga.current) return;
    if (r.ok) {
      setSaldos(r.data.saldos);
      setConfig(r.data.config);
    } else {
      setError(r.error);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga del año desde Supabase y Oracle
    void cargar(anio);
  }, [cargar, anio]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda);
    return saldos.filter((s) => !q || normalizar(s.nombre).includes(q));
  }, [saldos, busqueda]);

  function abrir(s: SaldoVendedor) {
    setErrorEdicion(null);
    setEdicion({ saldo: s, asignados: String(s.asignado), transferidos: String(s.transferido), nota: s.nota });
  }

  async function guardar(restablecer: boolean) {
    if (!edicion) return;
    const asignados = Number(edicion.asignados);
    const transferidos = Number(edicion.transferidos || 0);
    if (!restablecer && (!edicion.asignados.trim() || !(asignados >= 0))) return setErrorEdicion("Los días asignados deben ser 0 o más.");
    if (!restablecer && !Number.isFinite(transferidos)) return setErrorEdicion("Los días transferidos no son válidos.");
    setGuardando(true);
    setErrorEdicion(null);
    const r = await guardarSaldo(edicion.saldo.partyNumber, anio, restablecer ? null : { asignados, transferidos, nota: edicion.nota });
    setGuardando(false);
    if (!r.ok) return setErrorEdicion(r.error);
    setAviso(`Saldo ${anio} de ${edicion.saldo.nombre} ${restablecer ? "restablecido" : "actualizado"}.`);
    setEdicion(null);
    void cargar(anio);
  }

  function exportar() {
    descargarCsv(`saldos-vacaciones-${anio}.csv`, [
      ["Vendedor", "Party Number", "Año", "Asignado", "Adquirido", "Transferido", "Tomado", "Programado", "Saldo", "Nota"],
      ...visibles.map((s) => [s.nombre, s.partyNumber, s.anio, s.asignado, s.adquirido, s.transferido, s.tomado, s.programado, s.saldo, s.nota]),
    ]);
  }

  const anios = Array.from({ length: 5 }, (_, i) => anioHoy + 1 - i);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Saldos de vacaciones</h2>
          <p className="mt-1 text-sm text-gray-500">
            Días por vendedor y año. Solo descuentan los tipos de ausencia marcados así.
            {config && (
              <>
                {" "}
                Por defecto: {config.diasPorAnio} días al año · {METODO_LABEL[config.metodoAdquisicion].toLowerCase()} (
                <Link href={`${BASE}/configuracion`} className="font-semibold text-emerald-700 hover:underline">
                  cambiar
                </Link>
                ).
              </>
            )}
          </p>
        </div>
        <button onClick={exportar} disabled={!visibles.length} className={BOTON_SECUNDARIO}>
          <IconoDescarga /> Descargar CSV
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500">
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar vendedor…"
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {aviso && <Aviso texto={aviso} onCerrar={() => setAviso(null)} />}

      {error ? (
        <ErrorCaja>Error al cargar los saldos: {error}</ErrorCaja>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm">
            <span className="font-semibold text-gray-900">Total: {visibles.length}</span>
            {cargando && <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Vendedor</th>
                  <th className="px-3 py-3">Asignado</th>
                  <th className="hidden sm:table-cell px-3 py-3">Adquirido</th>
                  <th className="hidden md:table-cell px-3 py-3">Transferido</th>
                  <th className="px-3 py-3">Tomado</th>
                  <th className="hidden md:table-cell px-3 py-3">Programado</th>
                  <th className="px-3 py-3">Saldo</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-right">
                {visibles.map((s) => (
                  <tr key={s.partyNumber} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-left">
                      <Link
                        href={`${BASE}/movimientos?vendedor=${encodeURIComponent(s.partyNumber)}&anio=${anio}`}
                        className="font-semibold text-gray-900 hover:text-emerald-700 hover:underline"
                      >
                        {s.nombre}
                      </Link>
                      {s.personalizado && (
                        <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800" title={s.nota || undefined}>
                          Personalizado
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-700">{s.asignado}</td>
                    <td className="hidden sm:table-cell px-3 py-3 text-gray-700">{s.adquirido}</td>
                    <td className="hidden md:table-cell px-3 py-3 text-gray-700">{s.transferido}</td>
                    <td className="px-3 py-3 text-gray-700">{s.tomado}</td>
                    <td className="hidden md:table-cell px-3 py-3 text-sky-700">{s.programado}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                          s.saldo < 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {s.saldo} {Math.abs(s.saldo) === 1 ? "día" : "días"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => abrir(s)} className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                        Ajustar
                      </button>
                    </td>
                  </tr>
                ))}
                {!visibles.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                      {cargando ? "Cargando…" : "No hay vendedores."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
            Saldo = adquirido + transferido − tomado − programado. Programado son ausencias futuras ya registradas en {anio}.
          </div>
        </div>
      )}

      {edicion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && setEdicion(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Saldo {anio}</h3>
            <p className="mt-1 text-sm font-semibold text-gray-700">{edicion.saldo.nombre}</p>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Días asignados</span>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={edicion.asignados}
                    onChange={(e) => setEdicion({ ...edicion, asignados: e.target.value })}
                    className={`mt-1 ${INPUT}`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">Transferidos</span>
                  <input
                    type="number"
                    step="0.5"
                    value={edicion.transferidos}
                    onChange={(e) => setEdicion({ ...edicion, transferidos: e.target.value })}
                    className={`mt-1 ${INPUT}`}
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                Transferidos: días pendientes del año anterior (pueden ser negativos si se adelantaron).
              </p>
              <label className="block text-sm">
                <span className="font-semibold text-gray-700">Nota (opcional)</span>
                <input
                  value={edicion.nota}
                  onChange={(e) => setEdicion({ ...edicion, nota: e.target.value })}
                  placeholder="Ej.: ingresó en marzo, proporcional"
                  className={`mt-1 ${INPUT}`}
                />
              </label>
              {errorEdicion && <ErrorCaja>{errorEdicion}</ErrorCaja>}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <div>
                {edicion.saldo.personalizado && (
                  <button
                    onClick={() => void guardar(true)}
                    disabled={guardando}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                    title={config ? `Volver a ${config.diasPorAnio} días y 0 transferidos` : undefined}
                  >
                    Usar valores por defecto
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEdicion(null)} disabled={guardando} className={BOTON_SECUNDARIO}>
                  Cancelar
                </button>
                <button onClick={() => void guardar(false)} disabled={guardando} className={BOTON_PRIMARIO}>
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
