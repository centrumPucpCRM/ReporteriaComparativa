import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

const MODULOS = [
  {
    slug: "reporteria",
    titulo: "Reportería",
    subtitulo: "Dashboards comparativos",
    descripcion: "Comparativo de programas 2025 vs 2026",
    color: "from-blue-500 to-indigo-600",
    iconColor: "bg-blue-50 text-blue-600",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    ),
  },
  {
    slug: "microservicios",
    titulo: "Microservicios",
    subtitulo: "Próximamente",
    descripcion: "Herramientas y utilidades operativas",
    color: "from-orange-500 to-amber-600",
    iconColor: "bg-orange-50 text-orange-600",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
];

export default function ModulosPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">Centrum PUCP</h1>
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900">
            Selecciona un <span className="text-orange-500">módulo</span>
          </h2>
          <p className="mt-2 text-sm text-gray-500">¿Con qué área deseas trabajar hoy?</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {MODULOS.map((m) => (
            <Link
              key={m.slug}
              href={`/modulos/${m.slug}`}
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
      </main>
    </div>
  );
}
