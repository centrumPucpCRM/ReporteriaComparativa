import { leerAmbiente, listarSolicitudes } from "../_lib/repo";
import { AvisoError, BASE, Encabezado, Paginador, TablaSolicitudes } from "../_components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function EnEsperaPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Number((await searchParams).page) || 1;
  const ambiente = await leerAmbiente();
  let datos: Awaited<ReturnType<typeof listarSolicitudes>> | null = null;
  let error: string | null = null;
  try {
    datos = await listarSolicitudes(ambiente, { estados: ["EN_ESPERA"], page, pageSize: PAGE_SIZE });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <Encabezado
        titulo="En espera del cliente"
        descripcion="El DNI o RUC no coincidió al menos 75% con lo registrado. Se notificó al cliente con un id de seguimiento (1.º: correo + WhatsApp, 2.º: correo + último WhatsApp, desde el 3.º: solo correo). Cuando corrige y la identidad pasa, la solicitud se desatora sola."
      />
      {error && <AvisoError mensaje={error} />}
      {datos && (
        <>
          <TablaSolicitudes filas={datos.filas} vacio="Nadie está esperando corrección." />
          <Paginador page={page} total={datos.total} pageSize={PAGE_SIZE} href={(p) => `${BASE}/en-espera?page=${p}`} />
        </>
      )}
    </div>
  );
}
