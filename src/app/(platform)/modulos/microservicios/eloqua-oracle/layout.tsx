import type { ReactNode } from "react";
import ModuleShell from "@/components/ModuleShell";
import { leerAmbiente } from "./_lib/repo";
import { AmbienteSelector } from "./_components/controles";

const BASE = "/modulos/microservicios/eloqua-oracle";

const icon = (d: string) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
  </svg>
);

const ICON_MODULO = icon("M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4");
const ICON_RESUMEN = icon("M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z");
const ICON_OK = icon("M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z");
const ICON_ERROR = icon("M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z");
const ICON_SIN_CONTACTO = icon("M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636");
const ICON_ESPERA = icon("M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z");
const ICON_DNI =icon("M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2");
const ICON_DUPLICADOS = icon("M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z");

const ICON_PROBAR = icon("M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.47 4.41a2.25 2.25 0 01-2.133 1.59H8.603a2.25 2.25 0 01-2.134-1.59L5 14.5m14 0H5");
const ICON_CONTRATO =icon("M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z");

const AVISO_AMBIENTE = {
  prod: null,
  test: "Ambiente de pruebas: los datos vienen del sandbox de Oracle.",
  demo: "Datos de ejemplo para recorrer el módulo. No son reales y las acciones no guardan nada.",
} as const;

export default async function EloquaOracleLayout({ children }: { children: ReactNode }) {
  const ambiente = await leerAmbiente();
  const aviso = AVISO_AMBIENTE[ambiente];
  return (
    <ModuleShell
      info={{
        title: "Eloqua → Oracle",
        subtitle: "Cola de leads de Eloqua",
        icon: ICON_MODULO,
        iconBg: "bg-violet-50 text-violet-600",
      }}
      back={{ href: "/modulos/microservicios", label: "Microservicios" }}
      sections={[
        {
          label: "PRINCIPAL",
          views: [{ label: "Resumen", href: BASE, icon: ICON_RESUMEN }],
        },
        {
          label: "SOLICITUDES",
          views: [
            { label: "Procesados", href: `${BASE}/procesados`, icon: ICON_OK },
            { label: "Errores", href: `${BASE}/errores`, icon: ICON_ERROR },
            { label: "En espera del cliente", href: `${BASE}/en-espera`, icon: ICON_ESPERA },
            { label: "Ningún campo válido", href: `${BASE}/sin-contacto`, icon: ICON_SIN_CONTACTO },
            { label: "Buscar por DNI", href: `${BASE}/dni`, icon: ICON_DNI },
            { label: "Duplicados", href: `${BASE}/duplicados`, icon: ICON_DUPLICADOS },
          ],
        },
        {
          label: "PRUEBAS",
          views: [{ label: "Probar DNI / RUC", href: `${BASE}/probar`, icon: ICON_PROBAR }],
        },
        {
          label: "CONFIGURACIÓN",
          views: [{ label: "Contrato Eloqua", href: `${BASE}/contrato`, icon: ICON_CONTRATO }],
        },
      ]}
    >
      <div className="border-b border-gray-200 bg-white px-4 py-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <span className={`text-xs ${ambiente === "prod" ? "text-gray-400" : "font-semibold text-amber-700"}`}>
            {aviso ?? "Producción"}
          </span>
          <AmbienteSelector actual={ambiente} />
        </div>
      </div>
      {children}
    </ModuleShell>
  );
}
