import BroadcastClient from "./BroadcastClient";

// Las server actions de esta página (cada lote de envío) heredan este límite.
export const maxDuration = 60;

/**
 * `?cola=` y `?asesor=` preseleccionan la cola / el asesor (por id o por
 * nombre exacto), para poder abrir el broadcast ya apuntado desde otro lado.
 */
export default async function BroadcastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return <BroadcastClient colaInicial={first(params.cola)} asesorInicial={first(params.asesor)} />;
}
