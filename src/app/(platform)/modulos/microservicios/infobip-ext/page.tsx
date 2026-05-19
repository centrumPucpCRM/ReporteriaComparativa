export default function InfobipExtPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-20 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-50 text-sky-600 mb-6">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      </div>
      <h2 className="text-3xl font-bold text-gray-900">Infobip Ext</h2>
      <p className="mt-3 text-gray-600">
        Módulo en construcción. Aquí se alojarán utilidades para integraciones y envíos a través de Infobip.
      </p>
    </div>
  );
}
