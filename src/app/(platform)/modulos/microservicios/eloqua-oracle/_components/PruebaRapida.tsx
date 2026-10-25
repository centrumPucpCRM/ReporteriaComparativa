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
const RAMA_CONTACTO: PasoId[] = ["CONTACTO_VALIDO", "SIN_CONTACTO_VALIDO"];

/** CORREO y TELEFONO son pruebas unitarias de su paso; CONTACTO prueba los dos y la decisión. */
export type Rama = "CORREO" | "TELEFONO" | "CONTACTO" | "DNI" | "RUC";

const TITULO: Record<Rama, string> = {
  CORREO: "Validar correo",
  TELEFONO: "Validar teléfono",
  CONTACTO: "¿Correo o teléfono válido?",
  DNI: "Validar DNI",
  RUC: "Validar RUC",
};

/** A qué rama de validación pertenece un paso del lienzo (null = ninguna). */
export function ramaIdentidad(paso: PasoId): Rama | null {
  if (paso === "VALIDAR_CORREO") return "CORREO";
  if (paso === "VALIDAR_TELEFONO") return "TELEFONO";
  return RAMA_CONTACTO.includes(paso) ? "CONTACTO" : RAMA_DNI.includes(paso) ? "DNI" : RAMA_RUC.includes(paso) ? "RUC" : null;
}

const input =
  "w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100";

/** Prueba de una rama (contacto, DNI o RUC) dentro del panel del lienzo, sin guardar nada. */
export default function PruebaRapida({ rama }: { rama: Rama }) {
  const [f, setF] = useState({ dni: "", nombre: "", ruc: "", empresa: "", correo: "andre.zambrano.cueva@gmail.com", celular: "991967975" });
  const [pendiente, startTransition] = useTransition();
  const [r, setR] = useState<ResultadoIdentidad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const probar = () =>
    startTransition(async () => {
      setError(null);
      const res = await probarIdentidad(
        { ...f, nombres: f.nombre, apellidos: "", programa: "" },
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
      <div className="text-xs font-semibold text-violet-900">Probar {TITULO[rama]} aquí (no guarda nada)</div>
      {rama === "CORREO" || rama === "TELEFONO" || rama === "CONTACTO" ? (
        <>
          <input value={f.nombre} onChange={set("nombre")} placeholder="Nombre (va en el mensaje)" className={input} />
          {rama !== "TELEFONO" && (
            <>
              <input value={f.correo} onChange={set("correo")} placeholder="Correo" className={input} />
              <p className="text-[10px] text-violet-800">Envía un correo real de confirmación y espera el rebote unos segundos.</p>
            </>
          )}
          {rama !== "CORREO" && (
            <>
              <input value={f.celular} onChange={set("celular")} placeholder="Celular" className={`${input} font-mono`} />
              <p className="text-[10px] text-violet-800">Envía un WhatsApp real a este número; válido solo si WhatsApp confirma la entrega.</p>
            </>
          )}
        </>
      ) : rama === "DNI" ? (
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
        {pendiente ? "Ejecutando…" : `▶ Probar ${TITULO[rama]}`}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {r && (
        <div className="space-y-1.5 border-t border-violet-100 pt-2">
          <p className={`text-xs font-bold ${r.final === "PASA" || (r.final === "MARCA" && (r.contacto?.correoValido ?? r.contacto?.telefonoValido)) ? "text-emerald-700" : r.final === "EN_ESPERA" ? "text-amber-700" : "text-red-700"}`}>
            {r.final === "MARCA" ? (r.contacto?.correoValido != null ? `correo_valido = ${r.contacto.correoValido}` : `telefono_valido = ${r.contacto?.telefonoValido}`) : r.final === "PASA" ? "Pasa" : r.final === "EN_ESPERA" ? "No pasa: se notificaría al cliente" : r.final === "SIN_CONTACTO" ? "Ningún campo válido: sale de la cola" : "Error técnico"}
            {r.contacto && r.final !== "MARCA" && ` · correo ${r.contacto.correoValido} / teléfono ${r.contacto.telefonoValido}`}
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
