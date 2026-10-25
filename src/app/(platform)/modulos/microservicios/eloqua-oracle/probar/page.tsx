import { leerAmbiente } from "../_lib/repo";
import { estadoServicioIdentidad } from "../actions";
import { Encabezado } from "../_components/ui";
import ProbarIdentidad from "./ProbarIdentidad";

export const dynamic = "force-dynamic";
// Las acciones de prueba esperan la entrega del WhatsApp (hasta 25 s) más los pasos de identidad.
export const maxDuration = 60;

export default async function ProbarPage() {
  const [ambiente, estado] = await Promise.all([leerAmbiente(), estadoServicioIdentidad()]);
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <Encabezado
        titulo="Probar pasos de validación"
        descripcion="Prueba unitaria de Validar correo / teléfono, Validar DNI y Validar RUC con un lead escrito a mano. Para mover una solicitud atorada a uno de estos pasos, ábrela y haz clic en el paso en su lienzo."
      />
      <ProbarIdentidad ambiente={ambiente} estado={estado} />
    </div>
  );
}
