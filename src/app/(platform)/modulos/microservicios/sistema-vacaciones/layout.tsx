import type { ReactNode } from "react";
import ModuleShell from "@/components/ModuleShell";

const ICON_VACACIONES = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const ICON_INICIO = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
  </svg>
);

export default function SistemaVacacionesLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleShell
      info={{
        title: "Sistema de Vacaciones",
        subtitle: "Gestión de descansos",
        icon: ICON_VACACIONES,
        iconBg: "bg-emerald-50 text-emerald-600",
      }}
      back={{ href: "/modulos/microservicios", label: "Microservicios" }}
      sections={[
        {
          label: "PRINCIPAL",
          views: [
            {
              label: "Inicio",
              href: "/modulos/microservicios/sistema-vacaciones",
              icon: ICON_INICIO,
            },
          ],
        },
      ]}
    >
      {children}
    </ModuleShell>
  );
}
