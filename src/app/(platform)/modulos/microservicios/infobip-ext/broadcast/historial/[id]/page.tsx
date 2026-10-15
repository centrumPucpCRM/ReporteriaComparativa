import { notFound } from "next/navigation";
import HistorialDetalle from "./HistorialDetalle";

// "Continuar envío" corre los lotes desde esta página.
export const maxDuration = 60;

export default async function BroadcastDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return <HistorialDetalle id={n} />;
}
