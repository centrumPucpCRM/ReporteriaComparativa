"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { DESCRIPCION_PASO, etiquetaPaso, type Ambiente } from "@/lib/eloqua-oracle";
import type { EventoPaso, QuePrueba, ResultadoIdentidad } from "@/lib/identidad/pasos";
import { probarIdentidad, type EstadoServicioIdentidad } from "../actions";
import { BASE, Tarjeta } from "../_components/ui";

const VACIO = { dni: "", nombres: "", apellidos: "", ruc: "", empresa: "", correo: "", celular: "991967975", programa: "" };

const OPCIONES: { id: QuePrueba; label: string; ayuda: string }[] = [
  {
    id: "CORREO",
    label: "Validar correo",
    ayuda: "Solo este paso: revisa el correo y le envía un correo de confirmación; si en los siguientes segundos llega un rebote (dirección inexistente), no es válido.",
  },
  {
    id: "TELEFONO",
    label: "Validar teléfono",
    ayuda: "Solo este paso: envía un WhatsApp de confirmación (plantilla contacto1_alerta_ventas_v1) y consulta la entrega cada segundo.",
  },
  { id: "DNI", label: "Validar DNI", ayuda: "DNI + nombre: padrón SUNAT, ¿extranjero en Oracle?, búsqueda por nombre y ¿alguno ≥75% en Oracle?" },
  { id: "RUC", label: "Validar RUC", ayuda: "¿Tiene RUC?, RUC + razón social, búsqueda por empresa y ¿alguno ≥75% en Oracle?" },
  { id: "AMBOS", label: "DNI y RUC", ayuda: "Las dos ramas en orden, como en la cola: el RUC solo se valida si el DNI pasó." },
  { id: "TODO", label: "Todo el flujo", ayuda: "Correo y teléfono, luego DNI y RUC, en el orden del lienzo." },
];

const ESTILO_RESULTADO: Record<EventoPaso["resultado"], string> = {
  OK: "bg-emerald-100 text-emerald-800",
  ERROR: "bg-red-100 text-red-700",
  OMITIDO: "bg-gray-100 text-gray-600",
};

function Campo({
  label,
  valor,
  onChange,
  placeholder,
  mono = false,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

/** Lo que decidió el paso, en una línea (las decisiones son OK con la respuesta en el detalle). */
export function decision(e: EventoPaso): { texto: string; tono: "verde" | "rojo" | "ambar" | "gris" } | null {
  const d = e.detalle as Record<string, unknown>;
  if (e.resultado === "ERROR") return { texto: String(d.error ?? "Falló"), tono: "rojo" };
  if (e.resultado === "OMITIDO") return { texto: String(d.motivo ?? "No aplica"), tono: "gris" };
  switch (e.paso) {
    case "VALIDAR_CORREO": {
      if (!d.valido) {
        const rebote = (d.rebote as Record<string, unknown> | undefined)?.detalle ?? (d.error as Record<string, unknown> | undefined)?.detalle;
        return {
          texto: `Inválido · false · ${d.motivo ?? ""}${d.sugerencia ? ` (¿quiso decir ${d.sugerencia}?)` : ""}${rebote ? ` — ${rebote}` : ""}`,
          tono: d.rebote || d.error ? "rojo" : "ambar",
        };
      }
      return d.enviado_a
        ? { texto: `Válido · true · correo enviado a ${d.correo}, sin rebote en ${d.segundos_esperando ?? "?"} s`, tono: "verde" }
        : { texto: `Válido · true · ${d.correo}${Array.isArray(d.mx) && d.mx.length ? ` (MX ${d.mx[0]})` : ""}`, tono: "verde" };
    }
    case "VALIDAR_TELEFONO": {
      if (!d.valido) {
        const err = d.error as Record<string, unknown> | undefined;
        const extra = err ? [err.nombre, err.detalle].filter(Boolean).join(" · ") : "";
        return { texto: `Inválido · false · ${d.motivo ?? ""}${extra ? ` — ${extra}` : ""}`, tono: "rojo" };
      }
      return d.entrega_confirmada
        ? { texto: `Válido · true · WhatsApp entregado a ${d.enviado_a} en ${d.segundos_esperando} s`, tono: "verde" }
        : { texto: `Válido · true · enviado a ${d.enviado_a} sin error; entrega aún sin confirmar tras ${d.segundos_esperando} s`, tono: "verde" };
    }
    case "CONTACTO_VALIDO":
      return d.alguno_valido
        ? { texto: `Sí · correo ${d.correo_valido} / teléfono ${d.telefono_valido}: sigue con Validar DNI`, tono: "verde" }
        : { texto: "No · ninguno es válido", tono: "rojo" };
    case "SIN_CONTACTO_VALIDO":
      return { texto: String(d.motivo ?? "Sale de la cola"), tono: "rojo" };
    case "VALIDAR_DNI":
    case "VALIDAR_RUC":
      return d.valido
        ? { texto: `Sí · coincide ${d.coincidencia_nombre ?? d.coincidencia ?? ""}`.trim(), tono: "verde" }
        : { texto: `No · ${d.motivo ?? ""}`, tono: "ambar" };
    case "DNI_EXTRANJERO_ORACLE":
      return d.extranjero
        ? { texto: `Sí · ${d.tipo_documento} en Oracle (party ${d.party_number}): se salta la regla`, tono: "verde" }
        : { texto: d.mismo_documento_en_oracle ? "No · el documento está en Oracle como DNI" : "No · el documento no está en Oracle", tono: "ambar" };
    case "BUSCAR_DNI_POR_NOMBRE":
    case "BUSCAR_RUC_POR_NOMBRE":
      return { texto: `${d.coincidencias} coincidencia(s)${d.mejor ? ` · la mejor ${d.mejor}` : ""}`, tono: "gris" };
    case "CONFIRMAR_DNI_ORACLE":
    case "CONFIRMAR_RUC_ORACLE": {
      const m = d.mejor as Record<string, unknown> | undefined;
      if (m?.en_oracle) return { texto: `Sí · ${m.dni ?? m.ruc} (${m.coincidencia}) ya está en Oracle: sigue con ese documento`, tono: "verde" };
      return { texto: d.ninguna_mayor_a ? `No · ninguna llega a ${d.ninguna_mayor_a}` : "No · ninguna de las ≥75% está en Oracle", tono: "ambar" };
    }
    case "TIENE_RUC":
      return d.tiene_ruc ? { texto: `Sí · ${d.ruc}`, tono: "gris" } : { texto: "No · sigue sin validar RUC", tono: "gris" };
    default:
      return null;
  }
}

export const TONO = {
  verde: "text-emerald-700",
  rojo: "text-red-700",
  ambar: "text-amber-700",
  gris: "text-gray-600",
};

function TablaTop({ filas }: { filas: { documento: string; nombre: string; coincidencia: string }[] }) {
  if (!filas.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-left font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Documento</th>
            <th className="px-3 py-2">Nombre oficial</th>
            <th className="px-3 py-2 text-right">Coincidencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filas.map((f) => (
            <tr key={f.documento}>
              <td className="px-3 py-1.5 font-mono text-gray-900">{f.documento}</td>
              <td className="px-3 py-1.5 text-gray-700">{f.nombre}</td>
              <td className={`px-3 py-1.5 text-right font-semibold ${parseInt(f.coincidencia) >= 75 ? "text-emerald-700" : "text-gray-500"}`}>{f.coincidencia}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lo que pasó con el WhatsApp de confirmación: a quién, desde dónde, cada consulta de entrega y el error. */
function DetalleTelefono({ d }: { d: Record<string, unknown> }) {
  const err = d.error as Record<string, unknown> | undefined;
  const entrega = d.entrega as Record<string, unknown> | undefined;
  const filas: [string, unknown][] = [
    ["Registrado por el lead", d.telefono_registrado],
    ["Normalizado", d.telefono ? `${d.telefono}${d.correccion ? ` (${d.correccion})` : ""}` : null],
    ["Enviado a", d.enviado_a ? `${d.enviado_a}${d.numero_de_prueba ? " · número de prueba (ambiente Test)" : ""}` : null],
    ["Plantilla / remitente", d.plantilla ? `${d.plantilla} · ${d.remitente}` : null],
    ["message_id", d.message_id],
    ["Entrega", entrega ? `${entrega.estado} ${entrega.nombre ?? ""}` : null],
  ];
  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1">
        {filas
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-400">{k}</dt>
              <dd className="break-all font-mono text-gray-800">{String(v)}</dd>
            </div>
          ))}
      </dl>
      {Array.isArray(d.consultas) && d.consultas.length > 0 && (
        <div className="text-gray-500">Consultas cada segundo: {(d.consultas as string[]).join(" → ")}</div>
      )}
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">
          <div className="font-semibold">Error del envío</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono">{JSON.stringify(err, null, 2)}</pre>
        </div>
      )}
      {typeof d.nota === "string" && <div className="text-gray-500">{d.nota}</div>}
    </div>
  );
}

/** Lo que pasó con el correo de confirmación: a quién, desde dónde, cada revisión del buzón y el rebote. */
function DetalleCorreo({ d }: { d: Record<string, unknown> }) {
  const rebote = d.rebote as Record<string, unknown> | undefined;
  const err = d.error as Record<string, unknown> | undefined;
  const filas: [string, unknown][] = [
    ["Servidores MX", Array.isArray(d.mx) ? d.mx.join(", ") : null],
    ["Enviado a", d.enviado_a],
    ["Remitente", d.remitente],
    ["Token", d.token],
    ["message_id", d.message_id],
  ];
  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1">
        {filas
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-400">{k}</dt>
              <dd className="break-all font-mono text-gray-800">{String(v)}</dd>
            </div>
          ))}
      </dl>
      {Array.isArray(d.consultas) && d.consultas.length > 0 && (
        <div className="text-gray-500">Revisión del buzón cada segundo: {(d.consultas as string[]).join(" → ")}</div>
      )}
      {(rebote || err) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">
          <div className="font-semibold">{rebote ? "Rebote recibido" : "Error del envío"}</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono">{JSON.stringify(rebote ?? err, null, 2)}</pre>
        </div>
      )}
      {typeof d.nota === "string" && <div className="text-gray-500">{d.nota}</div>}
    </div>
  );
}

function Paso({ e, n }: { e: EventoPaso; n: number }) {
  const dec = decision(e);
  const d = e.detalle as Record<string, unknown>;
  const top = Array.isArray(d.top) ? (d.top as { documento: string; nombre: string; coincidencia: string }[]) : [];
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">{n}</span>
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4 className="font-bold text-gray-900">{etiquetaPaso(e.paso)}</h4>
          <span className="flex items-center gap-2 text-xs text-gray-400">
            {e.duracion_ms} ms
            <span className={`rounded-full px-2 py-0.5 font-semibold ${ESTILO_RESULTADO[e.resultado]}`}>{e.resultado}</span>
          </span>
        </div>
        {dec && <p className={`text-sm font-semibold ${TONO[dec.tono]}`}>{dec.texto}</p>}
        {typeof d.nombre_oficial === "string" && (
          <p className="text-sm text-gray-700">
            Nombre oficial: <span className="font-semibold">{d.nombre_oficial}</span>
            {typeof d.fuente === "string" && <span className="text-gray-400"> · {d.fuente}</span>}
          </p>
        )}
        {typeof d.razon_social === "string" && (
          <p className="text-sm text-gray-700">
            Razón social SUNAT: <span className="font-semibold">{d.razon_social}</span>
            {typeof d.estado_sunat === "string" && <span className="text-gray-400"> · {d.estado_sunat}</span>}
          </p>
        )}
        {e.paso === "VALIDAR_TELEFONO" && <DetalleTelefono d={d} />}
        {e.paso === "VALIDAR_CORREO" && <DetalleCorreo d={d} />}
        <TablaTop filas={top} />
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600">Qué hace este paso y respuesta completa</summary>
          <p className="mt-2 text-gray-600">{DESCRIPCION_PASO[e.paso]}</p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-gray-900 p-3 text-gray-100">{JSON.stringify(e.detalle, null, 2)}</pre>
        </details>
      </div>
    </li>
  );
}

function Veredicto({ r, solicitudId }: { r: ResultadoIdentidad; solicitudId: number | null }) {
  if (r.final === "MARCA") {
    const c = r.contacto;
    const [campo, valor] = c?.correoValido != null ? ["correo_valido", c.correoValido] : ["telefono_valido", c?.telefonoValido];
    return (
      <div className={`rounded-xl border px-4 py-3 text-sm ${valor ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
        <div className="font-bold">
          {etiquetaPaso(r.pasoFinal)}: <span className="font-mono">{campo} = {String(valor)}</span>
        </div>
        <div>Este paso no detiene el flujo: solo deja la marca que se envía a Oracle. «¿Correo o teléfono válido?» decide con las dos.</div>
      </div>
    );
  }
  const estilo =
    r.final === "SIN_CONTACTO"
      ? "border-rose-300 bg-rose-50 text-rose-900"
      : r.final === "PASA"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : r.final === "EN_ESPERA"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-900";
  const titulo =
    r.final === "SIN_CONTACTO"
      ? "Ningún campo válido: la solicitud saldría de la cola"
      : r.final === "PASA"
      ? r.pasoFinal === "VALIDAR_DNI"
        ? "Pasa: al menos un medio de contacto es válido, seguiría a «Validar DNI»"
        : "Pasa: la solicitud seguiría a «¿Es corrección?»"
      : r.final === "EN_ESPERA"
        ? `No pasa: se notificaría al cliente (${etiquetaPaso(r.pasoFinal)}) y quedaría en espera`
        : `Error técnico en ${etiquetaPaso(r.pasoFinal)}: se reintentaría`;
  const dni = r.dni;
  const ruc = r.ruc;
  return (
    <div className={`space-y-2 rounded-xl border px-4 py-3 text-sm ${estilo}`}>
      <div className="font-bold">{titulo}</div>
      {r.motivo && <div>{r.motivo}</div>}
      {r.contacto && (
        <div>
          correo_valido = <span className="font-mono font-semibold">{String(r.contacto.correoValido)}</span> · telefono_valido ={" "}
          <span className="font-mono font-semibold">{String(r.contacto.telefonoValido)}</span>
        </div>
      )}
      {dni && (dni.estado === "VALIDADO" || dni.estado === "CORREGIDO") && (
        <div>
          DNI {dni.estado === "CORREGIDO" ? "corregido" : "validado"}: <span className="font-mono font-semibold">{dni.dni}</span> · {dni.partido.nombres} /{" "}
          {dni.partido.apellidoPaterno} {dni.partido.apellidoMaterno} ({Math.round(dni.coincidencia * 100)}%, {dni.fuente})
        </div>
      )}
      {dni?.estado === "EXTRANJERO" && (
        <div>
          Documento extranjero ({dni.tipoDocumento}) en Oracle: se salta la regla y no se marca como validado.
        </div>
      )}
      {ruc && (ruc.estado === "VALIDADO" || ruc.estado === "CORREGIDO") && (
        <div>
          RUC {ruc.estado === "CORREGIDO" ? "corregido" : "validado"}: <span className="font-mono font-semibold">{ruc.ruc}</span> · {ruc.razonSocial}
        </div>
      )}
      {solicitudId && (
        <Link href={`${BASE}/solicitud/${solicitudId}`} className="inline-block font-semibold underline">
          Ver la solicitud de prueba #{solicitudId} en el lienzo →
        </Link>
      )}
    </div>
  );
}

export default function ProbarIdentidad({ ambiente, estado }: { ambiente: Ambiente; estado: EstadoServicioIdentidad }) {
  const [f, setF] = useState(VACIO);
  const [que, setQue] = useState<QuePrueba>("DNI");
  const [pendiente, startTransition] = useTransition();
  const [res, setRes] = useState<{ r: ResultadoIdentidad; solicitudId: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof VACIO) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const correr = (guardar: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await probarIdentidad({ ...f, nombre: `${f.nombres} ${f.apellidos}`.trim() }, que, guardar);
      if (r.ok) setRes({ r: r.r, solicitudId: r.solicitudId });
      else {
        setRes(null);
        setError(r.error);
      }
    });

  const usaCorreo = ["CORREO", "CONTACTO", "TODO"].includes(que);
  const usaTelefono = ["TELEFONO", "CONTACTO", "TODO"].includes(que);
  const usaDni = ["DNI", "AMBOS", "TODO"].includes(que);
  const usaRuc = ["RUC", "AMBOS", "TODO"].includes(que);

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Tarjeta className="space-y-4 p-5">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Paso a probar</div>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-gray-300 bg-white p-0.5">
              {OPCIONES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setQue(o.id)}
                  className={`rounded-md px-2 py-1.5 text-xs font-semibold ${que === o.id ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">{OPCIONES.find((o) => o.id === que)!.ayuda}</p>
          </div>

          {usaCorreo && <Campo label="Correo" valor={f.correo} onChange={set("correo")} placeholder="EmailAddress" />}
          {usaTelefono && (
            <>
              <Campo label="Celular" valor={f.celular} onChange={set("celular")} placeholder="991967975 (se le agrega el 51)" mono />
              <p className="-mt-2 text-xs text-gray-400">
                {ambiente === "prod"
                  ? "En Prod el WhatsApp de confirmación se envía a este número."
                  : "En Test el WhatsApp de confirmación siempre va al número de prueba 51991967975."}
              </p>
            </>
          )}
          {usaDni && <Campo label="DNI / documento" valor={f.dni} onChange={set("dni")} placeholder="45215942" mono />}
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Nombres" valor={f.nombres} onChange={set("nombres")} placeholder="FirstName" />
            <Campo label="Apellidos" valor={f.apellidos} onChange={set("apellidos")} placeholder="LastName" />
          </div>
          {usaRuc && (
            <>
              <Campo label="RUC" valor={f.ruc} onChange={set("ruc")} placeholder="20xxxxxxxxx (vacío = no tiene RUC)" mono />
              <Campo label="Razón social" valor={f.empresa} onChange={set("empresa")} placeholder="Como la escribió el lead" />
            </>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-gray-500">Datos para la solicitud de prueba (opcional)</summary>
            <div className="mt-3 space-y-3">
              <Campo label="Programa (CTRSalesPrograma_c)" valor={f.programa} onChange={set("programa")} mono />
            </div>
          </details>

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              disabled={pendiente}
              onClick={() => correr(false)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {pendiente ? "Ejecutando…" : "▶ Probar paso (no guarda nada)"}
            </button>
            <button
              type="button"
              disabled={pendiente || ambiente !== "test"}
              onClick={() => correr(true)}
              title={ambiente !== "test" ? "Cambia al ambiente Test para crear solicitudes de prueba" : undefined}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Crear solicitud de prueba en la cola
            </button>
            {ambiente !== "test" && <p className="text-xs text-gray-400">Crear solicitudes de prueba solo está disponible en el ambiente Test.</p>}
          </div>
        </Tarjeta>

        <Tarjeta className="space-y-1 p-4 text-xs text-gray-600">
          <div className="font-semibold uppercase tracking-wide text-gray-400">Servicio de identidad</div>
          {estado.cargado ? (
            <>
              <div>
                Padrón SUNAT del <span className="font-semibold text-gray-900">{estado.fechaFuente ? new Date(estado.fechaFuente).toLocaleDateString("es-PE") : "—"}</span>
                {estado.personas != null && ` · ${(estado.personas / 1e6).toFixed(1)} M personas con RUC`}
                {estado.empresas != null && ` · ${(estado.empresas / 1e6).toFixed(1)} M RUC de empresas`}
              </div>
              <div>DNIs que no están en el padrón: {estado.fuenteExterna}</div>
              <div>Oracle CRM: solo lectura (contactos por documento y por RUC)</div>
            </>
          ) : (
            <div className="text-red-700">El padrón no está cargado en Storage. Correr scripts/identidad/ingestar.ts.</div>
          )}
        </Tarjeta>
      </div>

      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        {!res && !error && (
          <Tarjeta className="p-8 text-center text-sm text-gray-500">
            Escribe los datos del lead como llegarían de Eloqua y ejecuta el paso. Verás cada decisión del lienzo con la respuesta del servicio de
            identidad y de Oracle.
          </Tarjeta>
        )}
        {res && (
          <>
            <Veredicto r={res.r} solicitudId={res.solicitudId} />
            <ol className="space-y-3">
              {res.r.eventos.map((e, i) => (
                <Paso key={`${e.paso}-${i}`} e={e} n={i + 1} />
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
