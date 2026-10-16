import type { ReactNode } from "react";
import ModuleShell from "@/components/ModuleShell";

const ICON_ELOQUA = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const ICON_SHEETS = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
  </svg>
);

export default function EloquaWebhooksLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleShell
      info={{
        title: "Eloqua Webhooks",
        subtitle: "Integraciones Eloqua",
        icon: ICON_ELOQUA,
        iconBg: "bg-violet-50 text-violet-600",
      }}
      back={{ href: "/modulos/microservicios", label: "Microservicios" }}
      sections={[
        {
          label: "WEBHOOKS",
          views: [
            {
              label: "Google Sheets",
              href: "/modulos/microservicios/eloqua-webhooks",
              icon: ICON_SHEETS,
            },
          ],
        },
      ]}
    >
      {children}
    </ModuleShell>
  );
}
