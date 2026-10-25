"use client";

import { useCallback, useEffect, useState } from "react";
import { CONTEO_LABEL, type Conteo, type TipoAusencia } from "@/lib/vacaciones";
import { eliminarTipoAusencia, guardarTipoAusencia, obtenerTipos } from "../actions";
import { Aviso, BOTON_PRIMARIO, BOTON_SECUNDARIO, ErrorCaja, INPUT } from "../_components/comun";

type Form = Omit<TipoAusencia, "id"> & { id: number | null };

const NUEVO: Form = {
  id: null,
  codigo: "",
  nombre: "",
  color: "#10b981",
  activo: true,
  conteo: "CALENDARIO",
  descuentaSaldo: false,
  permiteSaldoNegativo: false,
  motivoRequerido: false,
  marcaOracle: true,
  orden: 0,
};

function Interruptor({
  etiqueta,
  ayuda,
  valor,
  onChange,
  deshabilitado,
}: {
  etiqueta: string;
  ayuda: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  deshabilitado?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 py-2 ${deshabilitado ? "opacity-50" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-semibold text-gray-800">{etiqueta}</span>
        <span className="block text-xs text-gray-500">{ayuda}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={valor}
        disabled={deshabilitado}
        onClick={() => onChange(!valor)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${valor ? "bg-emerald-600" : "bg-gray-300"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${valor ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/** Tonos 500 de Tailwind: los mismos de los badges y estados del resto de la plataforma. */
const PALETA = [
  { nombre: "Rojo", hex: "#ef4444" },
  { nombre: "Naranja", hex: "#f97316" },
  { nombre: "Ámbar", hex: "#f59e0b" },
  { nombre: "Verde", hex: "#10b981" },
  { nombre: "Turquesa", hex: "#14b8a6" },
  { nombre: "Celeste", hex: "#0ea5e9" },
  { nombre: "Azul", hex: "#3b82f6" },
  { nombre: "Violeta", hex: "#8b5cf6" },
  { nombre: "Rosa", hex: "#ec4899" },
  { nombre: "Gris", hex: "#6b7280" },
];

function SelectorColor({ valor, onChange }: { valor: string; onChange: (hex: string) => void }) {
  const propio = !PALETA.some((c) => c.hex === valor.toLowerCase());
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {PALETA.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.nombre}
          aria-label={c.nombre}
          aria-pressed={valor.toLowerCase() === c.hex}
          onClick={() => onChange(c.hex)}
          className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
            valor.toLowerCase() === c.hex ? "ring-2 ring-gray-900 ring-offset-2" : ""
          }`}
          style={{ backgroundColor: c.hex }}
        />
      ))}
      <label
        title="Otro color"
        className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-gray-400 text-xs text-gray-500 hover:bg-gray-50 ${
          propio ? "ring-2 ring-gray-900 ring-offset-2" : ""
        }`}
        style={propio ? { backgroundColor: valor, borderStyle: "solid", borderColor: valor } : undefined}
      >
        {!propio && "+"}
        <input type="color" value={valor} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

function Etiqueta({ children, color = "bg-gray-100 text-gray-700" }: { children: React.ReactNode; color?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{children}</span>;
}

export default function TiposClient() {
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const r = await obtenerTipos();
    if (r.ok) setTipos(r.data);
    else setError(r.error);
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Supabase
    void cargar();
  }, [cargar]);

  function abrir(f: Form) {
    setErrorForm(null);
    setConfirmarEliminar(false);
    setForm(f);
  }

  async function guardar() {
    if (!form) return;
    if (!form.codigo.trim() || !form.nombre.trim()) return setErrorForm("Código y nombre son obligatorios.");
    setGuardando(true);
    setErrorForm(null);
    const { id, ...datos } = form;
    const r = await guardarTipoAusencia(datos, id);
    setGuardando(false);
    if (!r.ok) return setErrorForm(r.error);
    setAviso(id === null ? `Tipo "${form.nombre}" creado.` : "Cambios guardados.");
    setForm(null);
    void cargar();
  }

  async function eliminar() {
    if (!form || form.id === null) return;
    if (!confirmarEliminar) return setConfirmarEliminar(true);
    setGuardando(true);
    const r = await eliminarTipoAusencia(form.id);
    setGuardando(false);
    if (!r.ok) {
      setConfirmarEliminar(false);
      return setErrorForm(r.error);
    }
    setAviso(`Tipo "${form.nombre}" eliminado.`);
    setForm(null);
    void cargar();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tipos de ausencia</h2>
          <p className="mt-1 text-sm text-gray-500">Vacaciones, descanso médico, licencias… cada uno con sus reglas de conteo y saldo.</p>
        </div>
        <button onClick={() => abrir({ ...NUEVO, orden: tipos.length + 1 })} className={BOTON_PRIMARIO}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo tipo
        </button>
      </div>

      {aviso && <Aviso texto={aviso} onCerrar={() => setAviso(null)} />}

      {error ? (
        <ErrorCaja>Error al cargar los tipos: {error}</ErrorCaja>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Total: {tipos.length}</div>
          <ul className="divide-y divide-gray-100">
            {tipos.map((t) => (
              <li key={t.id}>
                <button onClick={() => abrir({ ...t })} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`font-semibold ${t.activo ? "text-gray-900" : "text-gray-400 line-through"}`}>{t.nombre}</span>
                      <span className="font-mono text-xs text-gray-500">{t.codigo}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Etiqueta>{CONTEO_LABEL[t.conteo]}</Etiqueta>
                      {t.descuentaSaldo && <Etiqueta color="bg-emerald-100 text-emerald-800">Descuenta saldo</Etiqueta>}
                      {t.descuentaSaldo && t.permiteSaldoNegativo && <Etiqueta color="bg-amber-100 text-amber-800">Saldo negativo</Etiqueta>}
                      {t.motivoRequerido && <Etiqueta color="bg-sky-100 text-sky-800">Motivo obligatorio</Etiqueta>}
                      {!t.marcaOracle && <Etiqueta color="bg-gray-200 text-gray-700">No marca Oracle</Etiqueta>}
                      {!t.activo && <Etiqueta color="bg-red-100 text-red-700">Inactivo</Etiqueta>}
                    </span>
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </li>
            ))}
            {!tipos.length && <li className="px-4 py-10 text-center text-sm text-gray-500">{cargando ? "Cargando…" : "No hay tipos."}</li>}
          </ul>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">{form.id === null ? "Nuevo tipo de ausencia" : form.nombre}</h3>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-sm">
                  <span className="font-semibold text-gray-700">
                    Código <span className="text-red-600">*</span>
                  </span>
                  <input
                    value={form.codigo}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
                    maxLength={10}
                    placeholder="VAC"
                    className={`mt-1 font-mono ${INPUT}`}
                  />
                </label>
                <label className="col-span-2 block text-sm">
                  <span className="font-semibold text-gray-700">
                    Nombre <span className="text-red-600">*</span>
                  </span>
                  <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Vacaciones" className={`mt-1 ${INPUT}`} />
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-semibold text-gray-700">Conteo de días</span>
                <select value={form.conteo} onChange={(e) => setForm({ ...form, conteo: e.target.value as Conteo })} className={`mt-1 ${INPUT}`}>
                  {(Object.keys(CONTEO_LABEL) as Conteo[]).map((c) => (
                    <option key={c} value={c}>
                      {CONTEO_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm">
                <span className="font-semibold text-gray-700">Color</span>
                <SelectorColor valor={form.color} onChange={(color) => setForm({ ...form, color })} />
              </div>
              <p className="text-xs text-gray-500">
                Días laborales no cuenta los días no laborables ni los feriados (ver Configuración y Feriados).
              </p>

              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-3">
                <Interruptor etiqueta="Activo" ayuda="Si no, no aparece al programar." valor={form.activo} onChange={(v) => setForm({ ...form, activo: v })} />
                <Interruptor
                  etiqueta="Descuenta saldo"
                  ayuda="Los días se restan del saldo anual del vendedor."
                  valor={form.descuentaSaldo}
                  onChange={(v) => setForm({ ...form, descuentaSaldo: v, permiteSaldoNegativo: v && form.permiteSaldoNegativo })}
                />
                <Interruptor
                  etiqueta="Permitir saldo negativo"
                  ayuda="Deja programar aunque no le queden días."
                  valor={form.permiteSaldoNegativo}
                  deshabilitado={!form.descuentaSaldo}
                  onChange={(v) => setForm({ ...form, permiteSaldoNegativo: v })}
                />
                <Interruptor
                  etiqueta="Motivo obligatorio"
                  ayuda="Pide una nota al programar (ej.: certificado médico)."
                  valor={form.motivoRequerido}
                  onChange={(v) => setForm({ ...form, motivoRequerido: v })}
                />
                <Interruptor
                  etiqueta="Marca en Oracle CRM"
                  ayuda="Mientras dure, el vendedor figura en vacaciones (CTREnVacaciones_c) y no recibe leads."
                  valor={form.marcaOracle}
                  onChange={(v) => setForm({ ...form, marcaOracle: v })}
                />
              </div>

              <label className="block w-32 text-sm">
                <span className="font-semibold text-gray-700">Orden</span>
                <input
                  type="number"
                  value={form.orden}
                  onChange={(e) => setForm({ ...form, orden: Number(e.target.value) })}
                  className={`mt-1 ${INPUT}`}
                />
              </label>

              {errorForm && <ErrorCaja>{errorForm}</ErrorCaja>}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <div>
                {form.id !== null && (
                  <button
                    onClick={() => void eliminar()}
                    disabled={guardando}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                      confirmarEliminar ? "bg-red-600 text-white hover:bg-red-700" : "text-red-700 hover:bg-red-50"
                    }`}
                  >
                    {confirmarEliminar ? "¿Confirmar eliminación?" : "Eliminar"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)} disabled={guardando} className={BOTON_SECUNDARIO}>
                  Cancelar
                </button>
                <button onClick={() => void guardar()} disabled={guardando} className={BOTON_PRIMARIO}>
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
