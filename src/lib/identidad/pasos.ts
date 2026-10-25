/**
 * Pasos de identidad del flujo Eloqua → Oracle (server-only): la rama DNI y la rama RUC del lienzo.
 *
 *   VALIDAR_DNI ── sí ─────────────────────────────────────────────┐
 *     └ no → DNI_EXTRANJERO_ORACLE ── sí (se salta la regla) ──────┤
 *              └ no → BUSCAR_DNI_POR_NOMBRE → CONFIRMAR_DNI_ORACLE ┤ sí (sigue con ese DNI)
 *                                                └ no → NOTIFICAR_DNI → EN ESPERA
 *   TIENE_RUC ── no ───────────────────────────────────────────────┐
 *     └ sí → VALIDAR_RUC ── sí ────────────────────────────────────┤
 *              └ no → BUSCAR_RUC_POR_NOMBRE → CONFIRMAR_RUC_ORACLE ┤ sí
 *                                                └ no → NOTIFICAR_RUC → EN ESPERA
 *
 * Cada paso devuelve un evento con el mismo formato que escribe el worker en `evento` (y que
 * dibuja el lienzo): las decisiones son resultado OK con la respuesta en `detalle`; ERROR es solo un
 * fallo técnico (Storage, Oracle o la fuente externa no respondieron) y se puede reintentar.
 *
 * Fuentes: padrón de SUNAT en Storage (`padron.ts`), respaldo externo para DNIs sin RUC
 * (`externa.ts`) y Oracle CRM (solo lectura) para "¿extranjero?" y "¿ya está en Oracle?".
 * NOTIFICAR_* todavía no envía nada (correo + WhatsApp con id de seguimiento es del worker): queda
 * OMITIDO con el motivo y la solicitud pasa a EN ESPERA.
 */
import { variantesDni, type PasoId, type ResultadoEvento } from "@/lib/eloqua-oracle";
import { contactosPorDocumento, contactosPorRuc, type ContactoOracle } from "@/lib/oracle-crm";
import { buscarDniExterno } from "./externa";
import { buscarDni, buscarEmpresasPorNombre, buscarPersonasPorNombre, buscarRuc, type Candidato } from "./padron";
import { UMBRAL_IDENTIDAD, dividirNombre, dniValido, rucValido, similitud, similitudEmpresa, type NombrePartido } from "./texto";

export interface LeadIdentidad {
  /** Documento tal como vino (DNI, carné de extranjería, pasaporte…). */
  dni: string;
  /** Nombres + apellidos tal como los registró el lead. */
  nombre: string;
  ruc: string;
  empresa: string;
}

export interface EventoPaso {
  paso: PasoId;
  resultado: ResultadoEvento;
  duracion_ms: number;
  detalle: Record<string, unknown>;
}

export type SalidaDni =
  | {
      estado: "VALIDADO" | "CORREGIDO";
      dni: string;
      nombreOficial: string;
      partido: NombrePartido;
      coincidencia: number;
      fuente: string;
    }
  | { estado: "EXTRANJERO"; documento: string; tipoDocumento: string; partyNumber: string }
  | { estado: "NO_PASA"; motivo: string }
  | { estado: "ERROR"; paso: PasoId; motivo: string };

export type SalidaRuc =
  | { estado: "SIN_RUC" }
  | { estado: "VALIDADO" | "CORREGIDO"; ruc: string; razonSocial: string; coincidencia: number | null; estadoSunat: string | null }
  | { estado: "NO_PASA"; motivo: string }
  | { estado: "ERROR"; paso: PasoId; motivo: string };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Corre un paso midiendo su duración. Si lanza, el evento queda en ERROR con el motivo. */
async function correr<T>(
  eventos: EventoPaso[],
  paso: PasoId,
  fn: () => Promise<{ detalle: Record<string, unknown>; resultado?: ResultadoEvento; valor: T }>,
): Promise<{ ok: true; valor: T } | { ok: false; motivo: string }> {
  const t0 = Date.now();
  try {
    const r = await fn();
    eventos.push({ paso, resultado: r.resultado ?? "OK", duracion_ms: Date.now() - t0, detalle: r.detalle });
    return { ok: true, valor: r.valor };
  } catch (e) {
    eventos.push({ paso, resultado: "ERROR", duracion_ms: Date.now() - t0, detalle: { error: mensaje(e) } });
    return { ok: false, motivo: mensaje(e) };
  }
}

const tablaCandidatos = (cs: Candidato[]) => cs.map((c) => ({ documento: c.documento, nombre: c.nombre, coincidencia: pct(c.similitud) }));

const NOTIFICACION_PENDIENTE =
  "La notificación al cliente (correo + WhatsApp con id de seguimiento) la hará el worker; desde la plataforma no se envía nada. La solicitud queda EN ESPERA.";

/* ── Rama DNI ────────────────────────────────────────────────────────────── */

export async function validarDni(lead: LeadIdentidad): Promise<{ eventos: EventoPaso[]; salida: SalidaDni }> {
  const eventos: EventoPaso[] = [];
  const nombreLead = lead.nombre.replace(/\s+/g, " ").trim();

  // 1. VALIDAR_DNI: padrón de SUNAT y, si no está, la fuente externa.
  const v = await correr(eventos, "VALIDAR_DNI", async () => {
    const dni = dniValido(lead.dni);
    if (!dni) {
      return { detalle: { documento: lead.dni, valido: false, motivo: "No es un DNI peruano (8 dígitos)" }, valor: null };
    }
    let oficial: { nombre: string; partido: NombrePartido; fuente: string; estado_sunat?: string | null } | null = null;
    const ficha = await buscarDni(dni);
    let externa: Record<string, unknown> | undefined;
    if (ficha) {
      oficial = { nombre: ficha.nombre, partido: dividirNombre(ficha.nombre), fuente: "Padrón SUNAT", estado_sunat: ficha.estado };
    } else {
      const r = await buscarDniExterno(dni);
      if ("error" in r) {
        // Sin fuente no se puede concluir que el DNI no exista: es un fallo técnico, se reintenta.
        throw new Error(`El DNI ${dni} no está en el padrón de SUNAT y la consulta externa falló: ${r.error}`);
      }
      externa = { fuente: r.encontrado ? r.ficha.fuente : r.fuente, desde_cache: r.desdeCache };
      if (r.encontrado) {
        const f = r.ficha;
        oficial = {
          nombre: f.nombre,
          partido: { apellidoPaterno: f.apellidoPaterno, apellidoMaterno: f.apellidoMaterno, nombres: f.nombres },
          fuente: f.fuente,
        };
      }
    }
    if (!oficial) {
      return {
        detalle: { dni, valido: false, dni_existe: false, motivo: `El DNI ${dni} no existe en el servicio de identidad`, consulta_externa: externa },
        valor: null,
      };
    }
    const s = similitud(nombreLead, oficial.nombre);
    const valido = s >= UMBRAL_IDENTIDAD;
    return {
      detalle: {
        dni,
        valido,
        dni_existe: true,
        coincidencia_nombre: pct(s),
        nombre_registrado: nombreLead,
        nombre_oficial: oficial.nombre,
        ...(valido ? { limpieza: oficial.partido } : { motivo: `El nombre no coincide con el DNI (${pct(s)} < ${pct(UMBRAL_IDENTIDAD)})` }),
        fuente: oficial.fuente,
        estado_sunat: oficial.estado_sunat ?? undefined,
        consulta_externa: externa,
      },
      valor: valido ? { dni, ...oficial, coincidencia: s } : null,
    };
  });
  if (!v.ok) return { eventos, salida: { estado: "ERROR", paso: "VALIDAR_DNI", motivo: v.motivo } };
  if (v.valor) {
    const o = v.valor;
    return { eventos, salida: { estado: "VALIDADO", dni: o.dni, nombreOficial: o.nombre, partido: o.partido, coincidencia: o.coincidencia, fuente: o.fuente } };
  }

  // 2. DNI_EXTRANJERO_ORACLE: el mismo documento en Oracle con un tipo que no es DNI → se salta la regla.
  const documento = lead.dni.trim().toUpperCase();
  const ext = await correr(eventos, "DNI_EXTRANJERO_ORACLE", async () => {
    const variantes = /^\d+$/.test(documento) ? variantesDni(documento) : [documento];
    const contactos = await contactosPorDocumento(variantes);
    const extranjero = contactos.find((c) => c.tipoDocumento && c.tipoDocumento.toUpperCase() !== "DNI");
    return {
      detalle: {
        busqueda_exacta: variantes,
        mismo_documento_en_oracle: contactos.length > 0,
        ...(contactos.length ? { contactos: contactos.map((c) => ({ party_number: c.partyNumber, tipo_documento: c.tipoDocumento, nombre: c.nombre })) } : {}),
        extranjero: !!extranjero,
        ...(extranjero ? { tipo_documento: extranjero.tipoDocumento, party_number: extranjero.partyNumber, se_salta_la_regla: true } : {}),
      },
      valor: extranjero ?? null,
    };
  });
  if (!ext.ok) return { eventos, salida: { estado: "ERROR", paso: "DNI_EXTRANJERO_ORACLE", motivo: ext.motivo } };
  if (ext.valor) {
    return { eventos, salida: { estado: "EXTRANJERO", documento, tipoDocumento: ext.valor.tipoDocumento, partyNumber: ext.valor.partyNumber } };
  }

  // 3. BUSCAR_DNI_POR_NOMBRE: las 10 mejores del padrón.
  const b = await correr(eventos, "BUSCAR_DNI_POR_NOMBRE", async () => {
    const cands = await buscarPersonasPorNombre(nombreLead, 10);
    return {
      detalle: { busqueda: nombreLead, coincidencias: cands.length, mejor: cands[0] ? pct(cands[0].similitud) : null, top: tablaCandidatos(cands) },
      valor: cands,
    };
  });
  if (!b.ok) return { eventos, salida: { estado: "ERROR", paso: "BUSCAR_DNI_POR_NOMBRE", motivo: b.motivo } };

  // 4. CONFIRMAR_DNI_ORACLE: la mejor ≥75% cuyo DNI ya esté en Oracle (sin "no contactar").
  const c = await correr(eventos, "CONFIRMAR_DNI_ORACLE", async () => {
    const aptos = b.valor.filter((x) => x.similitud >= UMBRAL_IDENTIDAD);
    if (!aptos.length) {
      return { detalle: { ninguna_mayor_a: pct(UMBRAL_IDENTIDAD), mejor: b.valor[0] ? tablaCandidatos([b.valor[0]])[0] : null }, valor: null };
    }
    const enOracle = await Promise.all(aptos.map((x) => contactosPorDocumento(variantesDni(x.documento))));
    const descartados: Record<string, unknown>[] = [];
    const sinOracle: string[] = [];
    for (let i = 0; i < aptos.length; i++) {
      const cs = enOracle[i];
      const x = aptos[i];
      if (!cs.length) {
        sinOracle.push(x.documento);
        continue;
      }
      const contactable = cs.find((k) => !k.noContactar);
      if (!contactable) {
        descartados.push({ dni: x.documento, coincidencia: pct(x.similitud), motivo: "DoNotContactFlag = Y" });
        continue;
      }
      return {
        detalle: {
          evaluados: aptos.length,
          descartados_no_contactar: descartados,
          no_estan_en_oracle: sinOracle,
          mejor: { dni: x.documento, coincidencia: pct(x.similitud), en_oracle: true, party_number: contactable.partyNumber },
          nombre_oficial: x.nombre,
        },
        valor: { cand: x, contacto: contactable },
      };
    }
    return {
      detalle: { evaluados: aptos.length, ninguno_en_oracle: true, descartados_no_contactar: descartados, no_estan_en_oracle: sinOracle },
      valor: null as { cand: Candidato; contacto: ContactoOracle } | null,
    };
  });
  if (!c.ok) return { eventos, salida: { estado: "ERROR", paso: "CONFIRMAR_DNI_ORACLE", motivo: c.motivo } };
  if (c.valor) {
    const x = c.valor.cand;
    return {
      eventos,
      salida: { estado: "CORREGIDO", dni: x.documento, nombreOficial: x.nombre, partido: dividirNombre(x.nombre), coincidencia: x.similitud, fuente: "Padrón SUNAT (búsqueda por nombre)" },
    };
  }

  // 5. NOTIFICAR_DNI: lo envía el worker.
  const motivo = String((eventos[0].detalle.motivo as string | undefined) ?? "El DNI no pasó la validación");
  eventos.push({ paso: "NOTIFICAR_DNI", resultado: "OMITIDO", duracion_ms: 0, detalle: { motivo: NOTIFICACION_PENDIENTE } });
  return { eventos, salida: { estado: "NO_PASA", motivo } };
}

/* ── Rama RUC ────────────────────────────────────────────────────────────── */

export async function validarRuc(lead: LeadIdentidad): Promise<{ eventos: EventoPaso[]; salida: SalidaRuc }> {
  const eventos: EventoPaso[] = [];
  const crudo = lead.ruc.trim();
  const empresa = lead.empresa.replace(/\s+/g, " ").trim();

  eventos.push({ paso: "TIENE_RUC", resultado: "OK", duracion_ms: 0, detalle: { tiene_ruc: !!crudo, ...(crudo ? { ruc: crudo } : {}) } });
  if (!crudo) return { eventos, salida: { estado: "SIN_RUC" } };

  // 1. VALIDAR_RUC: dígito verificador + padrón + razón social ≥75%.
  const v = await correr(eventos, "VALIDAR_RUC", async () => {
    const ruc = rucValido(crudo);
    if (!ruc) {
      return { detalle: { ruc: crudo, valido: false, motivo: "RUC con formato o dígito verificador inválido" }, valor: null };
    }
    const ficha = await buscarRuc(ruc);
    if (!ficha) return { detalle: { ruc, valido: false, ruc_existe: false, motivo: `El RUC ${ruc} no está en el padrón de SUNAT` }, valor: null };
    // RUC 10 = persona: si el lead no trae razón social se compara con su nombre.
    const comparar = empresa || (ficha.tipo === "PERSONA" ? lead.nombre.trim() : "");
    const s = comparar ? (ficha.tipo === "PERSONA" ? similitud(comparar, ficha.razonSocial) : similitudEmpresa(comparar, ficha.razonSocial)) : null;
    const valido = s == null || s >= UMBRAL_IDENTIDAD;
    return {
      detalle: {
        ruc,
        valido,
        ruc_existe: true,
        tipo: ficha.tipo === "PERSONA" ? "Persona natural (RUC 10)" : "Empresa",
        razon_social: ficha.razonSocial,
        razon_social_registrada: comparar || null,
        coincidencia: s == null ? null : pct(s),
        estado_sunat: ficha.estado,
        condicion_sunat: ficha.condicion,
        ...(s == null ? { nota: "El lead no trae razón social: se toma la de SUNAT" } : {}),
        ...(!valido ? { motivo: `La razón social no coincide con el RUC (${pct(s!)} < ${pct(UMBRAL_IDENTIDAD)})` } : {}),
      },
      valor: valido ? { ruc, razonSocial: ficha.razonSocial, coincidencia: s, estadoSunat: ficha.estado } : null,
    };
  });
  if (!v.ok) return { eventos, salida: { estado: "ERROR", paso: "VALIDAR_RUC", motivo: v.motivo } };
  if (v.valor) return { eventos, salida: { estado: "VALIDADO", ...v.valor } };

  // 2. BUSCAR_RUC_POR_NOMBRE.
  if (!empresa) {
    eventos.push({ paso: "BUSCAR_RUC_POR_NOMBRE", resultado: "OMITIDO", duracion_ms: 0, detalle: { motivo: "El lead no trae razón social para buscar" } });
    eventos.push({ paso: "CONFIRMAR_RUC_ORACLE", resultado: "OMITIDO", duracion_ms: 0, detalle: { motivo: "Sin candidatos" } });
  } else {
    const b = await correr(eventos, "BUSCAR_RUC_POR_NOMBRE", async () => {
      const cands = await buscarEmpresasPorNombre(empresa, 10);
      return {
        detalle: { busqueda: empresa, coincidencias: cands.length, mejor: cands[0] ? pct(cands[0].similitud) : null, top: tablaCandidatos(cands) },
        valor: cands,
      };
    });
    if (!b.ok) return { eventos, salida: { estado: "ERROR", paso: "BUSCAR_RUC_POR_NOMBRE", motivo: b.motivo } };

    // 3. CONFIRMAR_RUC_ORACLE: la mejor ≥75% que ya esté en Oracle (algún contacto con ese RUC).
    const c = await correr(eventos, "CONFIRMAR_RUC_ORACLE", async () => {
      const aptos = b.valor.filter((x) => x.similitud >= UMBRAL_IDENTIDAD);
      if (!aptos.length) {
        return { detalle: { ninguna_mayor_a: pct(UMBRAL_IDENTIDAD), mejor: b.valor[0] ? tablaCandidatos([b.valor[0]])[0] : null }, valor: null };
      }
      const enOracle = await Promise.all(aptos.map((x) => contactosPorRuc(x.documento)));
      const i = enOracle.findIndex((cs) => cs.length > 0);
      if (i < 0) return { detalle: { evaluados: aptos.length, ninguno_en_oracle: true, candidatos: tablaCandidatos(aptos) }, valor: null };
      const x = aptos[i];
      return {
        detalle: { evaluados: aptos.length, mejor: { ruc: x.documento, razon_social: x.nombre, coincidencia: pct(x.similitud), en_oracle: true, contactos_con_ese_ruc: enOracle[i].length } },
        valor: x,
      };
    });
    if (!c.ok) return { eventos, salida: { estado: "ERROR", paso: "CONFIRMAR_RUC_ORACLE", motivo: c.motivo } };
    if (c.valor) {
      return { eventos, salida: { estado: "CORREGIDO", ruc: c.valor.documento, razonSocial: c.valor.nombre, coincidencia: c.valor.similitud, estadoSunat: null } };
    }
  }

  // 4. NOTIFICAR_RUC: lo envía el worker.
  const motivo = String((eventos[1]?.detalle.motivo as string | undefined) ?? "El RUC no pasó la validación");
  eventos.push({ paso: "NOTIFICAR_RUC", resultado: "OMITIDO", duracion_ms: 0, detalle: { motivo: NOTIFICACION_PENDIENTE } });
  return { eventos, salida: { estado: "NO_PASA", motivo } };
}

/* ── Las dos ramas juntas ────────────────────────────────────────────────── */

export type QuePrueba = "DNI" | "RUC" | "AMBOS";

export interface ResultadoIdentidad {
  eventos: EventoPaso[];
  dni: SalidaDni | null;
  ruc: SalidaRuc | null;
  /** PASA = sigue el flujo · EN_ESPERA = se notifica al cliente · ERROR = fallo técnico (reintentable). */
  final: "PASA" | "EN_ESPERA" | "ERROR";
  /** Paso donde quedó la solicitud si no pasa. */
  pasoFinal: PasoId;
  motivo: string | null;
}

export async function ejecutarIdentidad(lead: LeadIdentidad, que: QuePrueba): Promise<ResultadoIdentidad> {
  const eventos: EventoPaso[] = [];
  let dni: SalidaDni | null = null;
  if (que !== "RUC") {
    const r = await validarDni(lead);
    eventos.push(...r.eventos);
    dni = r.salida;
    if (dni.estado === "ERROR") return { eventos, dni, ruc: null, final: "ERROR", pasoFinal: dni.paso, motivo: dni.motivo };
    if (dni.estado === "NO_PASA") return { eventos, dni, ruc: null, final: "EN_ESPERA", pasoFinal: "NOTIFICAR_DNI", motivo: dni.motivo };
  }
  let ruc: SalidaRuc | null = null;
  if (que !== "DNI") {
    const r = await validarRuc(lead);
    eventos.push(...r.eventos);
    ruc = r.salida;
    if (ruc.estado === "ERROR") return { eventos, dni, ruc, final: "ERROR", pasoFinal: ruc.paso, motivo: ruc.motivo };
    if (ruc.estado === "NO_PASA") return { eventos, dni, ruc, final: "EN_ESPERA", pasoFinal: "NOTIFICAR_RUC", motivo: ruc.motivo };
  }
  return { eventos, dni, ruc, final: "PASA", pasoFinal: "ES_CORRECCION", motivo: null };
}
