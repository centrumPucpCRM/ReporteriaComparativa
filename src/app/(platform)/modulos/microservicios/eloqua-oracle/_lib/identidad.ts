/**
 * Pasos de identidad (Validar DNI / Validar RUC) ejecutados desde la plataforma sobre una solicitud
 * de la cola (server-only). La lógica de cada paso vive en `src/lib/identidad/pasos.ts`; acá solo se
 * toma la solicitud, se registran los eventos y se deja en el estado que corresponde:
 *
 *   pasa      → PENDIENTE en ES_CORRECCION: el worker la retoma desde ahí con `payload._identidad`.
 *   no pasa   → EN_ESPERA en NOTIFICAR_DNI / NOTIFICAR_RUC (la notificación al cliente es del worker).
 *   error     → ERROR en el paso que falló (Storage, Oracle o la fuente externa no respondieron).
 */
import { campoPayload, normalizarDni, type Ambiente, type Solicitud } from "@/lib/eloqua-oracle";
import { TELEFONO_PRUEBA } from "@/lib/identidad/contacto";
import { ejecutarIdentidad, type LeadIdentidad, type QuePrueba, type ResultadoIdentidad } from "@/lib/identidad/pasos";
import { demoDetalles } from "./demo";
import * as repo from "./repo";

export type PasoInicio = "VALIDAR_CORREO" | "VALIDAR_TELEFONO" | "VALIDAR_DNI" | "VALIDAR_RUC";

/**
 * Desde dónde se ejecuta → qué corre. Desde Validar correo o Validar teléfono, todo lo que sigue
 * (contacto + DNI + RUC); desde Validar teléfono se reutiliza el correo_valido que ya tenía.
 */
const QUE_DESDE: Record<PasoInicio, QuePrueba> = { VALIDAR_CORREO: "TODO", VALIDAR_TELEFONO: "TODO", VALIDAR_DNI: "AMBOS", VALIDAR_RUC: "RUC" };

/** Paso que sigue a una prueba unitaria de correo o teléfono. */
const SIGUIENTE_MARCA: Partial<Record<string, string>> = { VALIDAR_CORREO: "VALIDAR_TELEFONO", VALIDAR_TELEFONO: "CONTACTO_VALIDO" };

/** En Test y Demo el WhatsApp de prueba va siempre al número de prueba, nunca al del lead. */
export const telefonoPruebaDe = (ambiente: Ambiente) => (ambiente === "prod" ? undefined : TELEFONO_PRUEBA);

/** Datos de identidad del payload de Eloqua. Las llaves de RUC y empresa siguen "por confirmar" en el contrato. */
export function leadDePayload(payload: Record<string, unknown>, dni: string): LeadIdentidad {
  return {
    dni: campoPayload(payload, "dni") || dni,
    nombre: [campoPayload(payload, "FirstName"), campoPayload(payload, "LastName")].filter(Boolean).join(" "),
    ruc: campoPayload(payload, "ruc", "RUC", "CTRRUC_c"),
    empresa: campoPayload(payload, "empresa", "razon_social", "CTRCompania_c"),
    correo: campoPayload(payload, "EmailAddress"),
    celular: campoPayload(payload, "MobileNumber"),
  };
}

/** Lo que el worker necesita para seguir: datos oficiales y las marcas que van a Oracle (CAMPOS_CALCULADOS). */
function identidadValidada(r: ResultadoIdentidad, previa: unknown) {
  const base = (previa && typeof previa === "object" ? previa : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base, fecha_validacion: new Date().toISOString() };
  if (r.dni && (r.dni.estado === "VALIDADO" || r.dni.estado === "CORREGIDO")) {
    Object.assign(out, {
      dni: r.dni.dni,
      dni_corregido: r.dni.estado === "CORREGIDO",
      apellido_paterno: r.dni.partido.apellidoPaterno,
      apellido_materno: r.dni.partido.apellidoMaterno,
      nombres: r.dni.partido.nombres,
      nombre_oficial: r.dni.nombreOficial,
      fuente_dni: r.dni.fuente,
      dni_validado: true,
      nombre_validado: true,
    });
  } else if (r.dni?.estado === "EXTRANJERO") {
    Object.assign(out, { extranjero: true, tipo_documento: r.dni.tipoDocumento, dni_validado: false, nombre_validado: false });
  }
  if (r.ruc && (r.ruc.estado === "VALIDADO" || r.ruc.estado === "CORREGIDO")) {
    Object.assign(out, { ruc: r.ruc.ruc, razon_social: r.ruc.razonSocial, ruc_corregido: r.ruc.estado === "CORREGIDO", ruc_validado: true });
  } else if (r.ruc?.estado === "SIN_RUC") {
    out.ruc_validado = false;
  }
  return out;
}

/** Guarda el resultado en la solicitud ya tomada (EN_PROCESO). */
async function cerrar(ambiente: Exclude<Ambiente, "demo">, s: Solicitud, r: ResultadoIdentidad, usuario: string) {
  await repo.registrarEventos(
    ambiente,
    s.id,
    r.eventos.map((e) => ({ ...e, detalle: { ...e.detalle, ejecutado_desde: "plataforma", por: usuario } })),
  );
  if (r.contacto) {
    // null = ese paso no corrió ahora: no se pisa lo que ya tenía.
    const c = r.contacto;
    await repo.actualizarSolicitud(ambiente, s.id, {
      ...(c.correoValido !== null ? { correo_valido: c.correoValido } : {}),
      ...(c.telefonoValido !== null ? { telefono_valido: c.telefonoValido, telefono_prueba_id: c.telefonoPruebaId } : {}),
    });
  }
  if (r.final === "MARCA") {
    await repo.actualizarSolicitud(ambiente, s.id, {
      estado: "PENDIENTE",
      paso_actual: SIGUIENTE_MARCA[r.pasoFinal] ?? r.pasoFinal,
      error_paso: null,
      error_tipo: null,
      error_motivo: null,
      error_detalle: null,
    });
  } else if (r.final === "SIN_CONTACTO") {
    await repo.actualizarSolicitud(ambiente, s.id, {
      estado: "SIN_CONTACTO",
      paso_actual: r.pasoFinal,
      error_paso: null,
      error_tipo: null,
      error_motivo: r.motivo,
      error_detalle: null,
    });
  } else if (r.final === "PASA") {
    const _identidad = identidadValidada(r, s.payload?._identidad);
    const dni = typeof _identidad.dni === "string" ? _identidad.dni : s.dni;
    await repo.actualizarSolicitud(ambiente, s.id, {
      estado: "PENDIENTE",
      paso_actual: r.pasoFinal,
      error_paso: null,
      error_tipo: null,
      error_motivo: null,
      error_detalle: null,
      dni: normalizarDni(dni),
      payload: { ...s.payload, _identidad },
    });
  } else if (r.final === "EN_ESPERA") {
    await repo.actualizarSolicitud(ambiente, s.id, {
      estado: "EN_ESPERA",
      paso_actual: r.pasoFinal,
      error_paso: null,
      error_tipo: null,
      error_motivo: `${r.motivo} · notificación al cliente pendiente (la envía el worker)`,
      error_detalle: null,
    });
  } else {
    await repo.actualizarSolicitud(ambiente, s.id, {
      estado: "ERROR",
      paso_actual: r.pasoFinal,
      error_paso: r.pasoFinal,
      error_tipo: "TEMPORAL",
      error_motivo: r.motivo,
      error_detalle: null,
    });
  }
}

export function resumen(r: ResultadoIdentidad): string {
  if (r.final === "PASA") return "La identidad pasó: la solicitud queda PENDIENTE en «¿Es corrección?» para que el worker continúe";
  if (r.final === "SIN_CONTACTO") return "Ni el correo ni el teléfono son válidos: sale de la cola (Ningún campo válido)";
  if (r.final === "MARCA") {
    const c = r.contacto;
    return c?.correoValido !== null && c?.correoValido !== undefined ? `correo_valido = ${c.correoValido}` : `telefono_valido = ${c?.telefonoValido}`;
  }
  if (r.final === "EN_ESPERA") return `No pasó (${r.motivo}): queda EN ESPERA del cliente`;
  return `Falló ${r.pasoFinal}: ${r.motivo}`;
}

/** Mueve una solicitud atorada a Validar correo, Validar DNI o Validar RUC y ejecuta desde ahí. */
export async function ejecutarDesdePaso(ambiente: Ambiente, id: number, paso: PasoInicio, usuario: string): Promise<ResultadoIdentidad> {
  const que = QUE_DESDE[paso];
  const opciones: { telefonoPrueba?: string; correoPrevio?: boolean } = { telefonoPrueba: telefonoPruebaDe(ambiente) };
  if (ambiente === "demo") {
    const d = demoDetalles().find((x) => x.solicitud.id === id);
    if (!d) throw new Error("Solicitud no encontrada");
    return ejecutarIdentidad(leadDePayload(d.solicitud.payload, d.solicitud.dni), que, opciones);
  }
  const s = await repo.tomarSolicitud(ambiente, id, paso);
  if (!s) throw new Error("La solicitud no se puede mover: está en proceso, ya terminó OK o no existe.");
  let r: ResultadoIdentidad;
  try {
    const lead = leadDePayload(s.payload, s.dni);
    // Desde Validar RUC el DNI ya pasó antes: se usa el validado si lo hay.
    const previa = s.payload?._identidad as { nombre_oficial?: string } | undefined;
    if (paso === "VALIDAR_RUC" && previa?.nombre_oficial) lead.nombre = previa.nombre_oficial;
    if (paso === "VALIDAR_TELEFONO" && typeof s.correo_valido === "boolean") opciones.correoPrevio = s.correo_valido;
    r = await ejecutarIdentidad(lead, que, opciones);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await repo.actualizarSolicitud(ambiente, s.id, { estado: "ERROR", paso_actual: paso, error_paso: paso, error_tipo: "TEMPORAL", error_motivo: motivo });
    throw e;
  }
  await cerrar(ambiente, s, r, usuario);
  return r;
}

export interface LeadPrueba extends LeadIdentidad {
  nombres: string;
  apellidos: string;
  correo: string;
  celular: string;
  programa: string;
}

/**
 * Crea una solicitud de prueba con los datos del formulario y le ejecuta los pasos. Solo en Test:
 * en Prod ensuciaría la cola real. Los pasos previos (validar, correo, teléfono) quedan registrados
 * como no aplicados para que el lienzo muestre desde dónde arrancó.
 */
export async function crearYEjecutar(ambiente: Ambiente, lead: LeadPrueba, que: QuePrueba, usuario: string): Promise<{ id: number; r: ResultadoIdentidad }> {
  if (ambiente !== "test") throw new Error("Las solicitudes de prueba solo se crean en el ambiente Test.");
  const dni = normalizarDni(lead.dni);
  const payload: Record<string, unknown> = {
    dni: lead.dni,
    FirstName: lead.nombres,
    LastName: lead.apellidos,
    ...(lead.correo ? { EmailAddress: lead.correo } : {}),
    MobileNumber: lead.celular || TELEFONO_PRUEBA,
    CTRSalesPrograma_c: lead.programa || "PRUEBA",
    ...(lead.ruc ? { ruc: lead.ruc } : {}),
    ...(lead.empresa ? { empresa: lead.empresa } : {}),
    _prueba: { creada_por: usuario, desde: "plataforma" },
  };
  const contacto = ["CORREO", "TELEFONO", "CONTACTO", "TODO"].includes(que);
  const inicio: PasoInicio = que === "TELEFONO" ? "VALIDAR_TELEFONO" : contacto ? "VALIDAR_CORREO" : que === "RUC" ? "VALIDAR_RUC" : "VALIDAR_DNI";
  const s = await repo.crearSolicitudPrueba(ambiente, dni, payload, inicio);
  // Los pasos de contacto se ejecutan de verdad si se pidieron; si no, quedan como no ejecutados.
  const previos = (contacto ? (["VALIDAR"] as const) : (["VALIDAR", "VALIDAR_CORREO", "VALIDAR_TELEFONO", "CONTACTO_VALIDO"] as const)).map((paso) => ({
    paso,
    resultado: (paso === "VALIDAR" ? "OK" : "OMITIDO") as "OK" | "OMITIDO",
    duracion_ms: 0,
    detalle: paso === "VALIDAR" ? { dni_normalizado: dni } : { motivo: "Solicitud de prueba creada desde la plataforma: este paso no se ejecutó" },
  }));
  await repo.registrarEventos(ambiente, s.id, previos);
  let r: ResultadoIdentidad;
  try {
    r = await ejecutarIdentidad({ ...lead, celular: lead.celular || TELEFONO_PRUEBA }, que, { telefonoPrueba: TELEFONO_PRUEBA });
  } catch (e) {
    await repo.actualizarSolicitud(ambiente, s.id, {
      estado: "ERROR",
      error_paso: inicio,
      error_tipo: "TEMPORAL",
      error_motivo: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
  await cerrar(ambiente, s, r, usuario);
  return { id: s.id, r };
}
