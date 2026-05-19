import type { ReactNode } from "react";
import ModuleShell from "@/components/ModuleShell";

const ICON_INFOBIP = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const ICON_INICIO = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
  </svg>
);

const ICON_CONVERSACIONES = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const ICON_CLOCK_USER = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ICON_LOCK_QUEUE = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const ICON_USERS_QUEUE = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

export default function InfobipExtLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleShell
      info={{
        title: "Infobip Ext",
        subtitle: "Extensión Infobip",
        icon: ICON_INFOBIP,
        iconBg: "bg-sky-50 text-sky-600",
      }}
      back={{ href: "/modulos/microservicios", label: "Microservicios" }}
      sections={[
        {
          label: "PRINCIPAL",
          views: [
            {
              label: "Inicio",
              href: "/modulos/microservicios/infobip-ext",
              icon: ICON_INICIO,
            },
          ],
        },
        {
          label: "TABLAS",
          views: [
            {
              label: "Conversaciones ↔ Leads",
              href: "/modulos/microservicios/infobip-ext/conversation-lead-relation",
              icon: ICON_CONVERSACIONES,
            },
            {
              label: "Último RDV por Sender",
              href: "/modulos/microservicios/infobip-ext/sender-last-rdv",
              icon: ICON_CLOCK_USER,
            },
            {
              label: "Cola Privada de RDVs",
              href: "/modulos/microservicios/infobip-ext/sender-rdv-private-queue",
              icon: ICON_LOCK_QUEUE,
            },
            {
              label: "Cola General de Senders",
              href: "/modulos/microservicios/infobip-ext/sender-general-queue",
              icon: ICON_USERS_QUEUE,
            },
          ],
        },
      ]}
    >
      {children}
    </ModuleShell>
  );
}
