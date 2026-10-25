"use client";

import { useMemo, useState } from "react";
import {
  DESCRIPCION_PASO,
  PASOS,
  campoPayload,
  etiquetaPaso,
  formatoFecha,
  type DetalleSolicitud,
  type Evento,
  type PasoId,
} from "@/lib/eloqua-oracle";
import { descartarSolicitudes, ejecutarDesde, reintentarSolicitudes } from "../actions";
import Canvas, { type EstadoNodo, type Seleccion, type VistaNodo } from "./Canvas";
import { BotonAccion } from "./controles";

const RAMA_CREAR: PasoId[] = [
  "OBTENER_RDV",
  "CREAR_LEAD",
  "CREAR_ACTIVIDAD",
  "PRIORIDAD",
  "INFOBIP_PERSONA",
  "INFOBIP_CONVERSACION",
  "INFOBIP_PLANTILLA",
  "INFOBIP_VINCULAR",
  "INFOBIP_ETIQUETAS",
];
const RAMA_ACTUALIZAR: PasoId[] = ["ACTUALIZAR_LEAD"];
const MARCA: PasoId[] = ["VALIDAR_CORREO", "VALIDAR_TELEFONO"];
/** Pasos a los que se puede mover una solicitud atorada para ejecutarlos desde la plataforma. */
const EJECUTABLES: Partial<Record<PasoId, "VALIDAR_DNI" | "VALIDAR_RUC">> = { VALIDAR_DNI: "VALIDAR_DNI", VALIDAR_RUC: "VALIDAR_RUC" };
const ESTADOS_MOVIBLES = ["PENDIENTE", "ERROR", "PARCIAL", "EN_ESPERA", "SIN_CONTACTO", "DESCARTADO"];

const NIVEL = Object.fromEntries(PASOS.map((p) => [p.id, p.nivel])) as Record<PasoId, "solicitud" | "programa">;
const ORDEN = Object.fromEntries(PASOS.map((p, i) => [p.id, i])) as Record<PasoId, number>;

const ETIQUETA_ESTADO: Record<EstadoNodo, string> = {
  OK: "OK",
  ERROR: "Error",
  ACTUAL: "En curso",
  OMITIDO: "Omitido / no aplica",
  PENDIENTE: "Pendiente",
  NEUTRO: "",
};

const LEYENDA: { clase: string; label: string }[] = [
  { clase: "bg-emerald-500", label: "OK" },
  { clase: "bg-red-500", label: "Error" },
  { clase: "bg-sky-500", label: "En curso" },
  { clase: "border-2 border-dashed border-gray-300 bg-white", label: "No aplica" },
  { clase: "border-2 border-violet-300 bg-white", label: "Pendiente" },
];

type FilaPrograma = { id: number | null; codigo: string; accion: string | null; lead: string | null; rdv: string | null; estado: string };

export default function FlujoSolicitud({ detalle }: { detalle: DetalleSolicitud }) {
  const { solicitud, programas, eventos } = detalle;

  // Programas: los registrados por el worker o, si aún no hay, los del payload (separados por "::").
  const filas: FilaPrograma[] = programas.length
    ? programas.map((p) => ({ id: p.id, codigo: p.codigo_crm, accion: p.accion, lead: p.lead_number, rdv: p.rdv_party_number, estado: p.estado }))
    : campoPayload(solicitud.payload, "CTRSalesPrograma_c")
        .split("::")
        .filter(Boolean)
        .map((codigo) => ({ id: null, codigo, accion: null, lead: null, rdv: null, estado: "PENDIENTE" }));

  const [progIdx, setProgIdx] = useState(() => Math.max(0, filas.findIndex((f) => f.estado === "ERROR")));
  const prog = filas[progIdx] ?? null;

  // Último evento por (paso, programa): un reintento deja varios y manda el más reciente.
  const ultimo = useMemo(() => {
    const m = new Map<string, Evento>();
    for (const e of eventos) m.set(`${e.paso}|${e.programa_id ?? ""}`, e);
    return m;
  }, [eventos]);

  const evento = (paso: PasoId): Evento | undefined =>
    ultimo.get(`${paso}|${NIVEL[paso] === "programa" ? (prog?.id ?? "") : ""}`);

  const progRegistrado = programas.find((p) => p.id === prog?.id);
  const existe = (evento("EXISTE_LEAD")?.detalle as { existe?: boolean } | null | undefined)?.existe;
  const rama: "crear" | "actualizar" | null =
    prog?.accion === "ACTUALIZADO" || existe === true ? "actualizar" : prog?.accion === "CREADO" || existe === false ? "crear" : null;

  // Último paso de solicitud que tiene evento: lo anterior sin evento se saltó (no aplicaba).
  const ultimoOrdenSolicitud = Math.max(
    -1,
    ...eventos.filter((e) => e.programa_id == null && e.paso in ORDEN).map((e) => ORDEN[e.paso as PasoId]),
  );
  const hayEventosPrograma = eventos.some((e) => e.programa_id != null);

  function estado(paso: PasoId): EstadoNodo {
    const e = evento(paso);
    if (e) return e.resultado;
    if (solicitud.estado === "EN_PROCESO") {
      const actual = NIVEL[paso] === "programa" ? progRegistrado?.paso_actual : solicitud.paso_actual;
      if (actual === paso) return "ACTUAL";
    }
    // Paso de solicitud sin evento: se saltó si ya hay eventos posteriores. Los de después de los leads
    // (notificar admisión, finalizar) solo se saltan si hay un evento de solicitud posterior.
    const despuesDeLeads = ORDEN[paso] > ORDEN.EXISTE_LEAD;
    if (NIVEL[paso] === "solicitud" && (ORDEN[paso] < ultimoOrdenSolicitud || (hayEventosPrograma && !despuesDeLeads))) return "OMITIDO";
    return "PENDIENTE";
  }

  // El flujo termina antes de Finalizar si una corrección desatoró a su original (el resto lo sigue la
  // original) o si no hubo correo ni teléfono válidos (salió de la cola).
  const corte = (["DESATORAR_ORIGINAL", "SIN_CONTACTO_VALIDO"] as const).find((p) => evento(p)?.resultado === "OK");

  const nodos = Object.fromEntries(
    PASOS.map(({ id }) => {
      const e = evento(id);
      const est = estado(id);
      const tenue =
        (rama === "crear" && RAMA_ACTUALIZAR.includes(id)) ||
        (rama === "actualizar" && RAMA_CREAR.includes(id)) ||
        (corte !== undefined && ORDEN[id] > ORDEN[corte]);
      // Correo y teléfono no fallan: el resultado es la marca true/false que va a Oracle.
      const valido = MARCA.includes(id) && est === "OK" ? (e?.detalle as { valido?: boolean } | null)?.valido : undefined;
      const sub =
        valido !== undefined
          ? valido
            ? "válido · true"
            : "inválido · false"
          : est === "ACTUAL"
          ? "en curso…"
          : est === "OMITIDO"
            ? "no aplica"
            : e?.duracion_ms != null
              ? `${est === "ERROR" ? "falló · " : ""}${(e.duracion_ms / 1000).toFixed(1)} s`
              : tenue
                ? "rama no tomada"
                : undefined;
      const insignias: VistaNodo["insignias"] =
        est === "ERROR" ? [{ texto: "!", tono: "rojo" }] : valido === false ? [{ texto: "✗", tono: "ambar" }] : undefined;
      return [id, { estado: est, sub, tenue, insignias } satisfies VistaNodo];
    }),
  ) as Record<PasoId, VistaNodo>;

  const enEspera = solicitud.estado === "EN_ESPERA";
  const fuera = solicitud.estado === "SIN_CONTACTO";
  const pasoEspera =
    (enEspera || fuera) && solicitud.paso_actual && solicitud.paso_actual in ORDEN ? (solicitud.paso_actual as PasoId) : null;
  const inicial =
    pasoEspera ?? (PASOS.find((p) => nodos[p.id].estado === "ERROR") ?? PASOS.find((p) => nodos[p.id].estado === "ACTUAL"))?.id ?? null;
  const [seleccion, setSeleccion] = useState<Seleccion | null>(inicial);

  const reintentable = solicitud.estado === "ERROR" || solicitud.estado === "PARCIAL";

  const accionesPaso = (seleccion: PasoId) =>
    nodos[seleccion].estado === "ERROR" && reintentable ? (
      <div className="flex flex-wrap gap-2 pt-1">
        <BotonAccion accion={() => reintentarSolicitudes([solicitud.id])} label="↻ Reintentar desde aquí" />
        <BotonAccion
          accion={() => descartarSolicitudes([solicitud.id])}
          label="Descartar"
          variante="peligro"
          confirmar="¿Descartar esta solicitud? No se volverá a procesar."
        />
      </div>
    ) : fuera && seleccion === pasoEspera ? (
      <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-900">
        <span className="font-semibold">Fuera de la cola.</span> Ni el correo ni el teléfono resultaron válidos, así que no hay cómo contactar al
        cliente y no se creó nada en Oracle. Si Eloqua la vuelve a mandar con datos corregidos, entra como una solicitud nueva.
      </div>
    ) : enEspera && seleccion === pasoEspera ? (
      <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        <p>
          <span className="font-semibold">En espera del cliente.</span> Se reanuda sola cuando el cliente vuelve a llenar el formulario con su id
          de seguimiento y la identidad pasa.
        </p>
        <BotonAccion
          accion={() => descartarSolicitudes([solicitud.id])}
          label="Descartar"
          variante="peligro"
          confirmar="¿Descartar esta solicitud? Una corrección posterior ya no la desatorará."
        />
      </div>
    ) : null;

  const moverAqui = (paso: PasoId) => {
    const d = EJECUTABLES[paso];
    if (!d || !ESTADOS_MOVIBLES.includes(solicitud.estado)) return null;
    return (
      <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
        <p>
          <span className="font-semibold">Mover aquí y ejecutar.</span> Corre {etiquetaPaso(d)} y sus pasos siguientes de identidad con los datos del
          payload. Si pasa, la solicitud queda pendiente en «¿Es corrección?» para que el worker continúe; si no, en espera del cliente.
        </p>
        <BotonAccion
          accion={() => ejecutarDesde(solicitud.id, d)}
          label={`▶ Ejecutar desde ${etiquetaPaso(d)}`}
          confirmar={`¿Mover la solicitud #${solicitud.id} a «${etiquetaPaso(d)}» y ejecutarla desde ahí?`}
        />
      </div>
    );
  };

  const panel = (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {seleccion === "ENTRADA" ? (
        <>
          <h4 className="font-bold text-gray-900">Lo que mandó Eloqua</h4>
          <p className="text-xs text-gray-500">Recibida {formatoFecha(solicitud.recibido_at)} · intento {solicitud.intentos}</p>
          <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(solicitud.payload, null, 2)}</pre>
        </>
      ) : seleccion ? (
        <PanelPaso
          paso={seleccion}
          estado={nodos[seleccion].estado}
          evento={evento(seleccion)}
          acciones={<>{accionesPaso(seleccion)}{moverAqui(seleccion)}</>}
        />
      ) : (
        <p className="text-sm text-gray-500">
          Haz clic en un paso del lienzo para ver qué hizo, la respuesta del servicio y reintentar si falló. Desde Validar DNI o Validar RUC puedes mover la solicitud a ese paso y ejecutarla. En la entrada está lo que mandó Eloqua.
        </p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
        {LEYENDA.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-full ${l.clase}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {filas.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Programa</span>
          {filas.map((f, i) => (
            <button
              key={f.codigo}
              type="button"
              onClick={() => setProgIdx(i)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs font-semibold ${
                i === progIdx ? "border-violet-500 bg-violet-50 text-violet-800" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${f.estado === "OK" ? "bg-emerald-500" : f.estado === "ERROR" ? "bg-red-500" : f.estado === "EN_PROCESO" ? "bg-sky-500" : "bg-gray-300"}`}
              />
              {f.codigo}
            </button>
          ))}
        </div>
      )}
      {prog && (
        <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
          {filas.length === 1 && <span className="font-mono font-semibold text-gray-800">{prog.codigo}</span>}
          {prog.accion && <span>Lead {prog.accion === "CREADO" ? "creado" : "actualizado"}</span>}
          {prog.lead && <span>LeadNumber {prog.lead}</span>}
          {prog.rdv && <span>RDV {prog.rdv}</span>}
          {!rama && !corte && <span className="italic">La rama depende de si el lead ya existe</span>}
        </div>
      )}
      <Canvas
        nodos={nodos}
        seleccion={seleccion}
        onSeleccion={setSeleccion}
        panel={panel}
        entrada={`Solicitud #${solicitud.id} · DNI ${solicitud.dni}`}
      />
    </div>
  );
}

function PanelPaso({
  paso,
  estado,
  evento,
  acciones,
}: {
  paso: PasoId;
  estado: EstadoNodo;
  evento: Evento | undefined;
  acciones: React.ReactNode;
}) {
  const color =
    estado === "OK" ? "bg-emerald-100 text-emerald-800" : estado === "ERROR" ? "bg-red-100 text-red-700" : estado === "ACTUAL" ? "bg-sky-100 text-sky-800" : "bg-gray-100 text-gray-600";
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-bold text-gray-900">{etiquetaPaso(paso)}</h4>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{ETIQUETA_ESTADO[estado]}</span>
      </div>
      <p className="text-sm text-gray-600">{DESCRIPCION_PASO[paso]}</p>
      {evento ? (
        <div className="text-xs text-gray-500">
          {formatoFecha(evento.created_at)} · {evento.duracion_ms ?? 0} ms
        </div>
      ) : (
        <div className="text-xs text-gray-400">Sin ejecutar.</div>
      )}
      {evento?.detalle != null && (
        <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(evento.detalle, null, 2)}</pre>
      )}
      {acciones}
    </>
  );
}
