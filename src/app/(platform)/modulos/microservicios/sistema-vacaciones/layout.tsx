import type { ReactNode } from "react";
import ModuleShell from "@/components/ModuleShell";

const BASE = "/modulos/microservicios/sistema-vacaciones";

function icono(d: string) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

const ICON_VACACIONES = icono("M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z");
const ICON_INICIO = icono("M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10");
const ICON_HORARIO = icono("M3 6h18M3 12h18M3 18h18M8 3v18");
const ICON_MOVIMIENTOS = icono("M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z");
const ICON_SALDOS = icono("M9 7h6m0 10v-3m-3 3v-6m-3 6v-1M6 21h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z");
const ICON_TIPOS = icono("M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z");
const ICON_FERIADOS = icono("M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z");
const ICON_CONFIG = icono(
  "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
);

export default function SistemaVacacionesLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleShell
      info={{
        title: "Sistema de Vacaciones",
        subtitle: "Vendedores en Oracle CRM",
        icon: ICON_VACACIONES,
        iconBg: "bg-emerald-50 text-emerald-600",
      }}
      back={{ href: "/modulos/microservicios", label: "Microservicios" }}
      sections={[
        {
          label: "PRINCIPAL",
          views: [
            { label: "Vendedores", href: BASE, icon: ICON_INICIO },
            { label: "Calendario", href: `${BASE}/calendario`, icon: ICON_VACACIONES },
            { label: "Horario", href: `${BASE}/horario`, icon: ICON_HORARIO },
          ],
        },
        {
          label: "INFORMES",
          views: [
            { label: "Movimientos", href: `${BASE}/movimientos`, icon: ICON_MOVIMIENTOS },
            { label: "Saldos", href: `${BASE}/saldos`, icon: ICON_SALDOS },
          ],
        },
        {
          label: "CONFIGURACIÓN",
          views: [
            { label: "Tipos de ausencia", href: `${BASE}/tipos`, icon: ICON_TIPOS },
            { label: "Feriados", href: `${BASE}/feriados`, icon: ICON_FERIADOS },
            { label: "Configuración", href: `${BASE}/configuracion`, icon: ICON_CONFIG },
          ],
        },
      ]}
    >
      {children}
    </ModuleShell>
  );
}
