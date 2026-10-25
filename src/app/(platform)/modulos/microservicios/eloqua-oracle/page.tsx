import Link from "next/link";
import { ESTADO_ESTILO, type Cola, type EstadoSolicitud, type Resumen } from "@/lib/eloqua-oracle";
import { leerAmbiente, obtenerCola, obtenerResumen } from "./_lib/repo";
import { reanudar } from "./actions";
import { BotonAccion } from "./_components/controles";
import CanvasCola from "./_components/CanvasCola";
import { AvisoError, BASE, Encabezado, TablaSolicitudes, Tarjeta } from "./_components/ui";

export const dynamic = "force-dynamic";

const ORDEN: EstadoSolicitud[] = ["PENDIENTE", "EN_PROCESO", "OK", "PARCIAL", "ERROR", "EN_ESPERA", "SIN_CONTACTO", "DESCARTADO"];

export default async function ResumenPage() {
  const ambiente = await leerAmbiente();
  let resumen: Resumen | null = null;
  let cola: Cola | null = null;
  let error: string | null = null;
  try {
    [resumen, cola] = await Promise.all([obtenerResumen(ambiente), obtenerCola(ambiente)]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <Encabezado
        titulo="Eloqua → Oracle Sales Cloud"
        descripcion="Registros que envía Eloqua: se encolan en el EC2 y se procesan uno por uno hasta crear o actualizar el lead."
      />

      {error && <AvisoError mensaje={error} />}

      {resumen && cola && (
        <>
          {resumen.control.pausado && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
              <div className="text-sm text-red-800">
                <span className="font-semibold">La cola está pausada.</span> {resumen.control.motivo ?? ""}
              </div>
              <BotonAccion accion={reanudar} label="Reanudar cola" confirmar="¿Reanudar el procesamiento de la cola?" variante="peligro" />
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Recibidos hoy</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9">
              {ORDEN.map((e) => (
                <Tarjeta key={e} className="p-4">
                  <div className="text-xs font-semibold text-gray-500">{ESTADO_ESTILO[e].label}</div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">{resumen.hoy[e]}</div>
                </Tarjeta>
              ))}
              <Link href={`${BASE}/duplicados`} className="block">
                <Tarjeta className="h-full p-4 transition hover:border-amber-300">
                  <div className="text-xs font-semibold text-amber-700">Duplicados DNI</div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">{resumen.duplicadosPendientes}</div>
                </Tarjeta>
              </Link>
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-bold text-gray-900">Lienzo de la integración</h3>
              <span className="text-xs text-gray-500">Azul = en curso · Rojo = detenidas con error · Ámbar = esperan al cliente · Gris = salieron hoy · clic en un paso para reintentar</span>
            </div>
            <CanvasCola cola={cola} />
          </div>

          <div>
            <h3 className="mb-2 font-bold text-gray-900">Últimas solicitudes</h3>
            <TablaSolicitudes filas={resumen.recientes.map((s) => ({ ...s, programas: [] }))} vacio="Todavía no llegan solicitudes." />
          </div>
        </>
      )}
    </div>
  );
}
