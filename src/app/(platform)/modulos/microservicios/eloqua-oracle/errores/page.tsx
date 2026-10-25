import Link from "next/link";
import { etiquetaPaso } from "@/lib/eloqua-oracle";
import { leerAmbiente, listarSolicitudes } from "../_lib/repo";
import { AvisoError, BASE, Encabezado, Paginador } from "../_components/ui";
import ErroresTabla from "./ErroresTabla";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ErroresPage({ searchParams }: { searchParams: Promise<{ page?: string; paso?: string }> }) {
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const paso = sp.paso || null;
  const ambiente = await leerAmbiente();
  let datos: Awaited<ReturnType<typeof listarSolicitudes>> | null = null;
  let error: string | null = null;
  try {
    datos = await listarSolicitudes(ambiente, { estados: ["ERROR", "PARCIAL"], paso, page, pageSize: PAGE_SIZE });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <Encabezado
        titulo="Errores"
        descripcion="Solicitudes que se detuvieron en algún paso. Reintentar las devuelve a la cola y el worker retoma desde el paso que falló."
      >
        {paso && (
          <Link href={`${BASE}/errores`} className="rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-100">
            Paso: {etiquetaPaso(paso)} ✕
          </Link>
        )}
      </Encabezado>
      {error && <AvisoError mensaje={error} />}
      {datos && (
        <>
          <ErroresTabla filas={datos.filas} />
          <Paginador
            page={page}
            total={datos.total}
            pageSize={PAGE_SIZE}
            href={(p) => `${BASE}/errores?page=${p}${paso ? `&paso=${paso}` : ""}`}
          />
        </>
      )}
    </div>
  );
}
