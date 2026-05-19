import Link from "next/link";
import ModuleShell from "@/components/ModuleShell";

const ICON_MICROSERVICIOS = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const ICON_INICIO = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
  </svg>
);

const SUBMODULOS = [
  {
    slug: "sistema-vacaciones",
    titulo: "Sistema de Vacaciones",
    subtitulo: "Gestión de descansos",
    descripcion: "Solicitudes, aprobaciones y saldo de vacaciones del equipo.",
    iconColor: "bg-emerald-50 text-emerald-600",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    slug: "infobip-ext",
    titulo: "Infobip Ext",
    subtitulo: "Extensión Infobip",
    descripcion: "Utilidades para integraciones y envíos vía Infobip.",
    iconColor: "bg-sky-50 text-sky-600",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
];

export default function MicroserviciosPage() {
  return (
    <ModuleShell
      info={{
        title: "Microservicios",
        subtitle: "Herramientas internas",
        icon: ICON_MICROSERVICIOS,
        iconBg: "bg-orange-50 text-orange-600",
      }}
      sections={[
        {
          label: "PRINCIPAL",
          views: [
            { label: "Inicio", href: "/modulos/microservicios", icon: ICON_INICIO },
          ],
        },
      ]}
    >
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900">
            Selecciona un <span className="text-orange-500">microservicio</span>
          </h2>
          <p className="mt-2 text-sm text-gray-500">Herramientas y utilidades operativas.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {SUBMODULOS.map((m) => (
            <Link
              key={m.slug}
              href={`/modulos/microservicios/${m.slug}`}
              className="group bg-white rounded-2xl border border-gray-200 shadow-sm p-6 transition-all hover:shadow-md hover:border-gray-300 hover:-translate-y-0.5"
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${m.iconColor} mb-4`}>
                {m.icon}
              </div>
              <h3 className="text-lg font-bold text-gray-900">{m.titulo}</h3>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mt-0.5">{m.subtitulo}</p>
              <p className="text-sm text-gray-600 mt-3">{m.descripcion}</p>
              <div className="mt-4 inline-flex items-center text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                Entrar
                <svg className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </ModuleShell>
  );
}
