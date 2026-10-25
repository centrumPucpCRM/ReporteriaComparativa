"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { etiquetaPaso, type PasoId } from "@/lib/eloqua-oracle";
import type { ResultadoIdentidad } from "@/lib/identidad/pasos";
import { probarIdentidad } from "../actions";
import { TONO, decision } from "../probar/ProbarIdentidad";

const BASE = "/modulos/microservicios/eloqua-oracle";

const RAMA_DNI: PasoId[] = ["VALIDAR_DNI", "DNI_EXTRANJERO_ORACLE", "BUSCAR_DNI_POR_NOMBRE", "CONFIRMAR_DNI_ORACLE", "NOTIFICAR_DNI"];
const RAMA_RUC: PasoId[] = ["TIENE_RUC", "VALIDAR_RUC", "BUSCAR_RUC_POR_NOMBRE", "CONFIRMAR_RUC_ORACLE", "NOTIFICAR_RUC"];

/** A qué rama de identidad pertenece un paso del lienzo (null = no es de identidad). */
export function ramaIdentidad(paso: PasoId): "DNI" | "RUC" | null {
  return RAMA_DNI.includes(paso) ? "DNI" : RAMA_RUC.includes(paso) ? "RUC" : null;
}

const input =
  "w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100";

/** Prueba de la rama DNI o RUC dentro del panel del lienzo, sin guardar nada. */
export default function PruebaRapida({ rama }: { rama: "DNI" | "RUC" }) {
  const [f, setF] = useState({ dni: "", nombre: "", ruc: "", empresa: "" });
  const [pendiente, startTransition] = useTransition();
  const [r, setR] = useState<ResultadoIdentidad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const probar = () =>
    startTransition(async () => {
      setError(null);
      const res = await probarIdentidad(
        { ...f, nombres: f.nombre, apellidos: "", correo: "", celular: "", programa: "" },
        rama,
        false,
      );
      if (res.ok) setR(res.r);
      else {
        setR(null);
        setError(res.error);
      }
    });

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
      <div className="text-xs font-semibold text-violet-900">Probar Validar {rama} aquí (no guarda nada)</div>
      {rama === "DNI" ? (
        <>
          <input value={f.dni} onChange={set("dni")} placeholder="DNI" className={`${input} font-mono`} />
          <input value={f.nombre} onChange={set("nombre")} placeholder="Nombres y apellidos" className={input} />
        </>
      ) : (
        <>
          <input value={f.ruc} onChange={set("ruc")} placeholder="RUC" className={`${input} font-mono`} />
          <input value={f.empresa} onChange={set("empresa")} placeholder="Razón social" className={input} />
        </>
      )}
      <button
        type="button"
        disabled={pendiente}
        onClick={probar}
        className="w-full rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {pendiente ? "Ejecutando…" : `▶ Probar Validar ${rama}`}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {r && (
        <div className="space-y-1.5 border-t border-violet-100 pt-2">
          <p className={`text-xs font-bold ${r.final === "PASA" ? "text-emerald-700" : r.final === "EN_ESPERA" ? "text-amber-700" : "text-red-700"}`}>
            {r.final === "PASA" ? "Pasa" : r.final === "EN_ESPERA" ? "No pasa: se notificaría al cliente" : "Error técnico"}
            {r.dni && (r.dni.estado === "VALIDADO" || r.dni.estado === "CORREGIDO") && ` · DNI ${r.dni.dni}`}
            {r.ruc && (r.ruc.estado === "VALIDADO" || r.ruc.estado === "CORREGIDO") && ` · RUC ${r.ruc.ruc}`}
          </p>
          <ol className="space-y-1">
            {r.eventos.map((e, i) => {
              const d = decision(e);
              return (
                <li key={`${e.paso}-${i}`} className="text-[11px] leading-snug">
                  <span className="font-semibold text-gray-800">{etiquetaPaso(e.paso)}</span>
                  {d && <span className={` ${TONO[d.tono]}`}> · {d.texto}</span>}
                </li>
              );
            })}
          </ol>
          <Link href={`${BASE}/probar`} className="text-[11px] font-semibold text-violet-700 hover:underline">
            Ver detalle completo y candidatos →
          </Link>
        </div>
      )}
    </div>
  );
}
