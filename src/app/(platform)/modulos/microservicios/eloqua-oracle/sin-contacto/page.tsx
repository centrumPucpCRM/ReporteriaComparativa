import { leerAmbiente, listarSolicitudes } from "../_lib/repo";
import { AvisoError, BASE, Encabezado, Paginador, TablaSolicitudes } from "../_components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function SinContactoPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Number((await searchParams).page) || 1;
  const ambiente = await leerAmbiente();
  let datos: Awaited<ReturnType<typeof listarSolicitudes>> | null = null;
  let error: string | null = null;
  try {
    datos = await listarSolicitudes(ambiente, { estados: ["SIN_CONTACTO"], page, pageSize: PAGE_SIZE });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <Encabezado
        titulo="Ningún campo válido"
        descripcion="Ni el correo ni el teléfono pasaron la prueba: no hay cómo contactar al cliente, así que la solicitud salió de la cola y no se creó nada en Oracle. Si Eloqua la vuelve a mandar con datos corregidos, entra como una solicitud nueva."
      />
      {error && <AvisoError mensaje={error} />}
      {datos && (
        <>
          <TablaSolicitudes filas={datos.filas} vacio="Ninguna solicitud salió por falta de correo y teléfono válidos." />
          <Paginador page={page} total={datos.total} pageSize={PAGE_SIZE} href={(p) => `${BASE}/sin-contacto?page=${p}`} />
        </>
      )}
    </div>
  );
}
