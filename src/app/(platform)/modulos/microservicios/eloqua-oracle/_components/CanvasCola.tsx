"use client";

import { useState } from "react";
import Link from "next/link";
import { DESCRIPCION_PASO, PASOS, etiquetaPaso, formatoFecha, type Cola, type PasoId } from "@/lib/eloqua-oracle";
import { ejecutarDesde, reintentarPaso } from "../actions";
import Canvas, { type Seleccion, type VistaNodo } from "./Canvas";
import { BotonAccion } from "./controles";
import PruebaRapida, { ramaIdentidad } from "./PruebaRapida";

const BASE = "/modulos/microservicios/eloqua-oracle";

/** El flujo completo con lo que hay en cada paso ahora: en curso (azul) y detenidas con error (rojo). */
export default function CanvasCola({ cola }: { cola: Cola }) {
  const nodos = Object.fromEntries(
    PASOS.map(({ id }) => {
      const c = cola.porPaso[id];
      const insignias: NonNullable<VistaNodo["insignias"]> = [];
      if (c?.enCurso) insignias.push({ texto: String(c.enCurso), tono: "azul" });
      if (c?.errores) insignias.push({ texto: String(c.errores), tono: "rojo" });
      if (c?.enEspera) insignias.push({ texto: String(c.enEspera), tono: "ambar" });
      if (c?.fuera) insignias.push({ texto: String(c.fuera), tono: "gris" });
      const sub = [
        c?.enCurso ? `${c.enCurso} en curso` : "",
        c?.errores ? `${c.errores} con error` : "",
        c?.enEspera ? `${c.enEspera} esperando al cliente` : "",
        c?.fuera ? `${c.fuera} salieron hoy` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return [id, { estado: c?.errores ? "ERROR" : c?.enCurso ? "ACTUAL" : "NEUTRO", sub: sub || undefined, insignias } satisfies VistaNodo];
    }),
  ) as Record<PasoId, VistaNodo>;

  const primerError = PASOS.find((p) => cola.porPaso[p.id]?.errores || cola.porPaso[p.id]?.enEspera)?.id ?? null;
  const [seleccion, setSeleccion] = useState<Seleccion | null>(primerError);

  let contenido;
  if (seleccion === "ENTRADA") {
    contenido = (
      <>
        <h4 className="font-bold text-gray-900">En cola</h4>
        <p className="text-sm text-gray-600">
          Recibidas de Eloqua que esperan su turno. El worker las toma de la más antigua a la más nueva, nunca dos del mismo DNI a la vez.
        </p>
        <div className="rounded-lg bg-gray-50 p-2 text-center">
          <div className="text-xl font-bold text-gray-900">{cola.pendientes}</div>
          <div className="text-[11px] text-gray-500">pendientes</div>
        </div>
        {cola.enCola.length ? (
          <ul className="divide-y divide-gray-100 text-sm">
            {cola.enCola.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-2 py-1.5">
                <Link href={`${BASE}/solicitud/${s.id}`} className="font-mono text-xs font-semibold text-violet-700 hover:underline">
                  #{s.id} · DNI {s.dni}
                </Link>
                <span className="text-[11px] text-gray-400">{formatoFecha(s.recibido_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No hay nada esperando.</p>
        )}
      </>
    );
  } else if (seleccion) {
    const c = cola.porPaso[seleccion];
    const rama = ramaIdentidad(seleccion);
    // Una atorada en la rama RUC se mueve a Validar RUC (el DNI ya pasó); cualquier otra, a Validar DNI.
    const destino = rama === "RUC" ? "VALIDAR_RUC" : "VALIDAR_DNI";
    contenido = (
      <>
        <h4 className="font-bold text-gray-900">{etiquetaPaso(seleccion)}</h4>
        <p className="text-sm text-gray-600">{DESCRIPCION_PASO[seleccion]}</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-sky-50 p-2 text-center">
            <div className="text-xl font-bold text-sky-800">{c?.enCurso ?? 0}</div>
            <div className="text-[11px] text-sky-700">en curso</div>
          </div>
          <div className="rounded-lg bg-red-50 p-2 text-center">
            <div className="text-xl font-bold text-red-700">{c?.errores ?? 0}</div>
            <div className="text-[11px] text-red-700">con error</div>
          </div>
          <div className="rounded-lg bg-amber-50 p-2 text-center">
            <div className="text-xl font-bold text-amber-800">{c?.enEspera ?? 0}</div>
            <div className="text-[11px] text-amber-700">esperan al cliente</div>
          </div>
        </div>
        {c?.muestras.length ? (
          <ul className="divide-y divide-gray-100 text-sm">
            {c.muestras.map((m) => (
              <li key={m.id} className="py-1.5">
                <Link href={`${BASE}/solicitud/${m.id}`} className="font-mono text-xs font-semibold text-violet-700 hover:underline">
                  #{m.id} · DNI {m.dni}
                </Link>
                {m.estado === "SIN_CONTACTO" && <span className="ml-2 rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-800">fuera de la cola</span>}
                {m.estado === "EN_ESPERA" && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">en espera</span>}
                {m.motivo && <div className="line-clamp-2 text-xs text-gray-500">{m.motivo}</div>}
                <div className="mt-1">
                  <BotonAccion
                    accion={() => ejecutarDesde(m.id, destino)}
                    label={`▶ Pasar a ${etiquetaPaso(destino)}`}
                    variante="secundario"
                    confirmar={`¿Mover la solicitud #${m.id} a «${etiquetaPaso(destino)}» y ejecutarla desde ahí?`}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {c?.fuera ? (
          <p className="text-xs text-rose-800">
            {c.fuera} salieron de la cola hoy por no tener correo ni teléfono válidos.{" "}
            <Link href={`${BASE}/sin-contacto`} className="font-semibold text-violet-700 hover:underline">
              Ver lista →
            </Link>
          </p>
        ) : null}
        {c?.errores ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <BotonAccion
              accion={() => reintentarPaso(seleccion)}
              label={`↻ Reintentar las ${c.errores}`}
              confirmar={`¿Volver a encolar las ${c.errores} solicitudes detenidas en "${etiquetaPaso(seleccion)}"?`}
            />
            <Link href={`${BASE}/errores?paso=${seleccion}`} className="text-sm font-semibold text-violet-700 hover:underline">
              Ver lista →
            </Link>
          </div>
        ) : c?.fuera ? null : (
          <p className="text-xs text-gray-400">Nada detenido en este paso.</p>
        )}
        {rama && <PruebaRapida key={rama} rama={rama} />}
      </>
    );
  } else {
    contenido = <p className="text-sm text-gray-500">Haz clic en un paso para ver qué solicitudes están ahí y reintentarlas o pasarlas a Validar DNI / RUC, o en la entrada para ver la cola. En los pasos de DNI y RUC puedes probar un caso ahí mismo.</p>;
  }

  return (
    <Canvas
      nodos={nodos}
      seleccion={seleccion}
      onSeleccion={setSeleccion}
      todasActivas
      panel={<div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">{contenido}</div>}
      entrada={cola.pendientes ? `Eloqua · ${cola.pendientes} en cola` : "Eloqua · cola vacía"}
    />
  );
}
