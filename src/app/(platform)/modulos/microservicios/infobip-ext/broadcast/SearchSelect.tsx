"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizarTexto } from "@/lib/broadcast";

export interface SearchOption {
  value: string;
  label: string;
  /** Texto secundario (rol, idioma, etc.). */
  hint?: string;
  disabled?: boolean;
}

interface Props {
  label: string;
  placeholder: string;
  options: SearchOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  /** Muestra la opción "Ninguno" para limpiar la selección. */
  clearLabel?: string;
  disabled?: boolean;
  loading?: boolean;
}

const MAX_VISIBLES = 80;

/**
 * Buscador por nombre: filtra sin tildes ni mayúsculas y pone primero la
 * coincidencia exacta, luego las que empiezan con el texto y al final el resto.
 */
export default function SearchSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  required,
  clearLabel,
  disabled,
  loading,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtradas = useMemo(() => {
    const q = normalizarTexto(query);
    if (!q) return options;
    const rank = (o: SearchOption) => {
      const l = normalizarTexto(o.label);
      if (l === q) return 0;
      if (l.startsWith(q)) return 1;
      if (l.includes(q)) return 2;
      return -1;
    };
    return options
      .map((o) => ({ o, r: rank(o) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.o);
  }, [options, query]);

  function elegir(v: string | null) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
      >
        <span className={`truncate ${selected ? "text-gray-900 font-semibold" : "text-gray-400"}`}>
          {loading ? "Cargando..." : selected ? selected.label : placeholder}
        </span>
        <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const primera = filtradas.find((o) => !o.disabled);
                  if (primera) elegir(primera.value);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Buscar por nombre..."
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {filtradas.length} de {options.length}
            </p>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {clearLabel ? (
              <li>
                <button
                  type="button"
                  onClick={() => elegir(null)}
                  className="w-full px-3 py-1.5 text-left text-sm italic text-gray-500 hover:bg-gray-50"
                >
                  {clearLabel}
                </button>
              </li>
            ) : null}
            {filtradas.slice(0, MAX_VISIBLES).map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onClick={() => elegir(o.value)}
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 ${
                    o.value === value ? "bg-sky-50 font-semibold text-sky-800" : "text-gray-900"
                  }`}
                >
                  <span className="block truncate">{o.label}</span>
                  {o.hint ? <span className="block truncate text-[11px] text-gray-500">{o.hint}</span> : null}
                </button>
              </li>
            ))}
            {filtradas.length > MAX_VISIBLES ? (
              <li className="px-3 py-1.5 text-[11px] text-gray-400">
                Hay {filtradas.length - MAX_VISIBLES} más: escribe para acotar.
              </li>
            ) : null}
            {filtradas.length === 0 ? (
              <li className="px-3 py-3 text-center text-sm text-gray-500">Sin resultados.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
