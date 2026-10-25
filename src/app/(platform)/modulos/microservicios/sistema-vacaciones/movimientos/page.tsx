import MovimientosClient from "./MovimientosClient";

export const dynamic = "force-dynamic";

/** `?vendedor=<party number>&anio=<año>` preselecciona los filtros (enlaces desde Saldos y Horario). */
export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const vendedor = typeof params.vendedor === "string" ? params.vendedor : "";
  const anio = typeof params.anio === "string" && /^\d{4}$/.test(params.anio) ? Number(params.anio) : null;
  return <MovimientosClient vendedorInicial={vendedor} anioInicial={anio} />;
}
