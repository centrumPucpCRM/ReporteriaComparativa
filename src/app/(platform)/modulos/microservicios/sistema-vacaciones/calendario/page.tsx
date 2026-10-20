import CalendarioClient from "./CalendarioClient";

// El mes inicial sale de la fecha de hoy (Lima): no se puede prerenderizar en el build.
export const dynamic = "force-dynamic";

export default function CalendarioVacacionesPage() {
  return <CalendarioClient />;
}
