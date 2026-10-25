"use client";

import { useEffect, useState } from "react";
import { DIAS_SEMANA, METODO_LABEL, type Configuracion, type MetodoAdquisicion } from "@/lib/vacaciones";
import { guardarConfiguracionAccion, obtenerConfiguracionAccion } from "../actions";
import { Aviso, BOTON_PRIMARIO, ErrorCaja, INPUT } from "../_components/comun";

const AYUDA_METODO: Record<MetodoAdquisicion, string> = {
  INMEDIATO: "Todos los días del año están disponibles desde el 1 de enero.",
  MENSUAL: "Se gana 1/12 de los días por cada mes cumplido del año (ej.: a fin de marzo, 3/12).",
};

export default function ConfiguracionClient() {
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [diasPorAnio, setDiasPorAnio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void obtenerConfiguracionAccion().then((r) => {
      if (!r.ok) return setError(r.error);
      setConfig(r.data);
      setDiasPorAnio(String(r.data.diasPorAnio));
    });
  }, []);

  function alternarDia(d: number) {
    if (!config) return;
    const dias = config.diasLaborales.includes(d) ? config.diasLaborales.filter((x) => x !== d) : [...config.diasLaborales, d].sort();
    setConfig({ ...config, diasLaborales: dias });
  }

  async function guardar() {
    if (!config) return;
    const dias = Number(diasPorAnio);
    if (!diasPorAnio.trim() || !(dias >= 0)) return setError("Los días por año deben ser 0 o más.");
    if (!config.diasLaborales.length) return setError("Marca al menos un día laboral.");
    setGuardando(true);
    setError(null);
    const r = await guardarConfiguracionAccion({ ...config, diasPorAnio: dias });
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    setAviso("Configuración guardada.");
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Configuración</h2>
        <p className="mt-1 text-sm text-gray-500">Jornada laboral y política de días de vacaciones que usan los saldos.</p>
      </div>

      {aviso && <Aviso texto={aviso} onCerrar={() => setAviso(null)} />}
      {error && <ErrorCaja>{error}</ErrorCaja>}

      {!config ? (
        !error && (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600" />
            Cargando…
          </div>
        )
      ) : (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Días laborales</h3>
            <p className="mt-1 text-sm text-gray-600">
              Los días sin marcar (y los feriados) no cuentan en los tipos de ausencia por días laborales y se ven en gris en el horario.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {DIAS_SEMANA.map((nombre, d) => {
                const activo = config.diasLaborales.includes(d);
                return (
                  <button
                    key={nombre}
                    onClick={() => alternarDia(d)}
                    aria-pressed={activo}
                    className={`w-16 rounded-lg border py-2 text-sm font-semibold transition-colors ${
                      activo ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {nombre}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Política de vacaciones</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-semibold text-gray-700">Días por año</span>
                <input type="number" min={0} step="0.5" value={diasPorAnio} onChange={(e) => setDiasPorAnio(e.target.value)} className={`mt-1 ${INPUT}`} />
                <span className="mt-1 block text-xs text-gray-500">Se puede ajustar por vendedor en Saldos.</span>
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-gray-700">Método de adquisición</span>
                <select
                  value={config.metodoAdquisicion}
                  onChange={(e) => setConfig({ ...config, metodoAdquisicion: e.target.value as MetodoAdquisicion })}
                  className={`mt-1 ${INPUT}`}
                >
                  {(Object.keys(METODO_LABEL) as MetodoAdquisicion[]).map((m) => (
                    <option key={m} value={m}>
                      {METODO_LABEL[m]}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">{AYUDA_METODO[config.metodoAdquisicion]}</span>
              </label>
            </div>
          </section>

          <div className="flex justify-end">
            <button onClick={() => void guardar()} disabled={guardando} className={BOTON_PRIMARIO}>
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
