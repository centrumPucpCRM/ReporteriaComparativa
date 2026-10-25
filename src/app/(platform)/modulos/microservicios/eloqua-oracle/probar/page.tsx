import { leerAmbiente } from "../_lib/repo";
import { estadoServicioIdentidad } from "../actions";
import { Encabezado } from "../_components/ui";
import ProbarIdentidad from "./ProbarIdentidad";

export const dynamic = "force-dynamic";

export default async function ProbarPage() {
  const [ambiente, estado] = await Promise.all([leerAmbiente(), estadoServicioIdentidad()]);
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <Encabezado
        titulo="Probar Validar DNI / Validar RUC"
        descripcion="Prueba unitaria de los pasos de identidad con un lead escrito a mano. Para mover una solicitud atorada a uno de estos pasos, ábrela y haz clic en el paso en su lienzo."
      />
      <ProbarIdentidad ambiente={ambiente} estado={estado} />
    </div>
  );
}
