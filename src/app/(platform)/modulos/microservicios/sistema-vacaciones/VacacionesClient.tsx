"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Vendedor } from "@/lib/oracle-crm";
import { cambiarVacaciones, obtenerVendedores } from "./actions";

type Filtro = "todos" | "vacaciones" | "trabajando";

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

function EstadoBadge({ enVacaciones }: { enVacaciones: boolean }) {
  return enVacaciones ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
      <span className="h-2 w-2 rounded-full bg-amber-500" /> En vacaciones
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Trabajando
    </span>
  );
}

export default function VacacionesClient() {
  const [vendedores, setVendedores] = useState<Vendedor[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [confirmar, setConfirmar] = useState<Vendedor | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorCambio, setErrorCambio] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const r = await obtenerVendedores();
    if (r.ok) setVendedores(r.data);
    else setError(r.error);
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Oracle
    void cargar();
  }, [cargar]);

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

  function abrirConfirmacion(v: Vendedor) {
    setErrorCambio(null);
    setConfirmar(v);
  }

  async function aplicarCambio() {
    if (!confirmar) return;
    setGuardando(true);
    setErrorCambio(null);
    const nuevoEstado = !confirmar.enVacaciones;
    const r = await cambiarVacaciones(confirmar.partyNumber, nuevoEstado);
    setGuardando(false);
    if (!r.ok) {
      setErrorCambio(r.error);
      return;
    }
    setVendedores((lista) =>
      (lista ?? []).map((v) => (v.partyNumber === confirmar.partyNumber ? { ...v, enVacaciones: r.data.enVacaciones } : v)),
    );
    setAviso(`Vacaciones ${nuevoEstado ? "iniciadas" : "finalizadas"} para ${confirmar.nombre}.`);
    setConfirmar(null);
    setTimeout(() => setAviso(null), 4000);
  }

  const FILTROS: { id: Filtro; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "trabajando", label: "Trabajando" },
    { id: "vacaciones", label: "En vacaciones" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Vacaciones de vendedores</h2>
          <p className="mt-1 text-sm text-gray-500">
            Marca a un vendedor como en vacaciones en Oracle CRM (<code>CTREnVacaciones_c</code>).
          </p>
        </div>
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
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</div>
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
                {visibles.map((v) => (
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
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => abrirConfirmacion(v)}
                        disabled={!v.partyNumber}
                        className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 ${
                          v.enVacaciones ? "bg-gray-700 hover:bg-gray-800" : "bg-amber-500 hover:bg-amber-600"
                        }`}
                      >
                        {v.enVacaciones ? "Finalizar vacaciones" : "Iniciar vacaciones"}
                      </button>
                    </td>
                  </tr>
                ))}
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

      {confirmar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !guardando && setConfirmar(null)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">
              {confirmar.enVacaciones ? "Finalizar vacaciones" : "Iniciar vacaciones"}
            </h3>
            <dl className="mt-3 space-y-1 text-sm">
              <div>
                <dt className="inline text-gray-500">Vendedor: </dt>
                <dd className="inline font-semibold text-gray-900">{confirmar.nombre}</dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Party Number: </dt>
                <dd className="inline font-mono text-gray-900">{confirmar.partyNumber}</dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Estado actual: </dt>
                <dd className="inline">
                  <EstadoBadge enVacaciones={confirmar.enVacaciones} />
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-gray-600">
              {confirmar.enVacaciones
                ? "El vendedor volverá a figurar como trabajando en Oracle CRM."
                : "El vendedor quedará marcado como en vacaciones en Oracle CRM."}
            </p>
            {errorCambio && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorCambio}</div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmar(null)}
                disabled={guardando}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={() => void aplicarCambio()}
                disabled={guardando}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
