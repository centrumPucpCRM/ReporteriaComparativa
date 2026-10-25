import { buscarPorDni, leerAmbiente } from "../_lib/repo";
import { AvisoError, Encabezado, TablaSolicitudes } from "../_components/ui";

export const dynamic = "force-dynamic";

export default async function DniPage({ searchParams }: { searchParams: Promise<{ dni?: string }> }) {
  const dni = ((await searchParams).dni ?? "").trim();
  const ambiente = await leerAmbiente();
  let filas: Awaited<ReturnType<typeof buscarPorDni>> | null = null;
  let error: string | null = null;
  if (dni) {
    try {
      filas = await buscarPorDni(ambiente, dni);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <Encabezado
        titulo="Buscar por DNI"
        descripcion="Todas las solicitudes de un DNI, de la más reciente a la más antigua. Coincidencia exacta, con y sin ceros a la izquierda (3040421 encuentra 03040421). Si un error se resolvió con una solicitud posterior, se indica cuál."
      />
      <form className="flex gap-2" action="">
        <input
          name="dni"
          defaultValue={dni}
          inputMode="numeric"
          placeholder="Número de documento"
          className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">Buscar</button>
      </form>
      {error && <AvisoError mensaje={error} />}
      {filas && <TablaSolicitudes filas={filas} vacio={`No hay solicitudes para el DNI ${dni}.`} mostrarResuelta />}
      {!dni && <p className="text-sm text-gray-500">En Demo prueba con 70000007 (un error resuelto por una solicitud posterior).</p>}
    </div>
  );
}
