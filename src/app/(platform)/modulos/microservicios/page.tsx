import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

export default function MicroserviciosPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/modulos"
              className="inline-flex items-center text-sm font-semibold text-gray-600 hover:text-gray-900"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Módulos
            </Link>
            <span className="text-gray-300">/</span>
            <h1 className="text-xl font-bold text-gray-800">Microservicios</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-50 text-orange-600 mb-6">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Próximamente</h2>
        <p className="mt-3 text-gray-600">
          El módulo de microservicios está en construcción. Vuelve pronto para conocer las herramientas disponibles.
        </p>
        <Link
          href="/modulos"
          className="mt-8 inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
        >
          Volver al selector
        </Link>
      </main>
    </div>
  );
}
