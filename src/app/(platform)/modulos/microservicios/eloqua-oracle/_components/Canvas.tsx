"use client";

/**
 * Lienzo del flujo al estilo del canvas de campañas de Eloqua: nodo de entrada, un nodo redondo con
 * ícono por paso, rombos para las decisiones y conectores en ángulo.
 *
 * - Eje central (x = 300): el camino normal.
 * - Validar correo y teléfono: marcan correo_valido / telefono_valido. Si ninguno es válido →
 *   "Ningún campo válido" y sale de la cola; si al menos uno lo es, sigue.
 * - Identidad DNI: si el DNI no existe o el nombre no coincide ≥75% → mini-camino a la derecha:
 *   ¿extranjero en Oracle? (sí: se salta la regla) → buscar por nombre → ¿alguno ≥75% en Oracle?
 *   (sí: vuelve al eje) → notificar al cliente con id de seguimiento → "en espera de corrección".
 * - ¿Tiene RUC? sí → validar RUC (mismo mini-camino, sin el paso de extranjero); no → desvío izquierdo.
 * - ¿Es corrección? (trae id de seguimiento) sí → desatorar la original → fin · no → sigue.
 * - Contacto: no existe → crearlo · ya existe → unificar duplicados (si hay 2+) y actualizarlo.
 * - "¿Existe lead?" abre la rama naranja (sí → actualizar) y la verde (no → crear); se juntan en
 *   "Notificar por correo" (al cliente, plantilla según formulario) y Finalizar.
 * - Infobip: una sola llamada a InfobipExt, desglosada en sus pasos internos dentro de un recuadro,
 *   con una nota de qué pasa si cada uno falla (dónde manda correo de error y dónde no avisa).
 *
 * Todo es un único SVG con viewBox: escala al ancho disponible sin desbordar. Es solo presentación:
 * quien lo usa decide estados, insignias y qué pasa al hacer clic (FlujoSolicitud = una solicitud;
 * CanvasCola = toda la cola).
 */

import type { KeyboardEvent, ReactNode } from "react";
import { etiquetaPaso, type PasoId } from "@/lib/eloqua-oracle";

export type EstadoNodo = "OK" | "ERROR" | "OMITIDO" | "ACTUAL" | "PENDIENTE" | "NEUTRO";
export type Seleccion = PasoId | "ENTRADA";

export interface VistaNodo {
  estado: EstadoNodo;
  /** Texto bajo el nombre (p. ej. "1.2 s" o "3 con error"). */
  sub?: string;
  /** Rama no tomada: se dibuja tenue. */
  tenue?: boolean;
  insignias?: { texto: string; tono: "rojo" | "azul" | "gris" | "ambar" }[];
}

const ANCHO = 760;
const ALTO = 3120;
const R = 24; // radio de los nodos
const D = 28; // media diagonal de los rombos
const EJE = 300; // x del eje central
const LADO = 480; // x de los mini-caminos y de la rama "crear"
const DESVIO = 150; // x del desvío "sin RUC" (por la izquierda)

type Pos = { x: number; y: number; decision?: boolean; etiqueta: "izq" | "der" };

const POS: Record<PasoId, Pos> = {
  VALIDAR: { x: EJE, y: 110, etiqueta: "izq" },
  VALIDAR_CORREO: { x: EJE, y: 195, etiqueta: "izq" },
  VALIDAR_TELEFONO: { x: EJE, y: 280, etiqueta: "izq" },
  CONTACTO_VALIDO: { x: EJE, y: 375, decision: true, etiqueta: "izq" },
  SIN_CONTACTO_VALIDO: { x: LADO, y: 375, etiqueta: "der" },
  VALIDAR_DNI: { x: EJE, y: 520, decision: true, etiqueta: "izq" },
  DNI_EXTRANJERO_ORACLE: { x: LADO, y: 590, decision: true, etiqueta: "der" },
  BUSCAR_DNI_POR_NOMBRE: { x: LADO, y: 680, etiqueta: "der" },
  CONFIRMAR_DNI_ORACLE: { x: LADO, y: 770, decision: true, etiqueta: "der" },
  NOTIFICAR_DNI: { x: LADO, y: 860, etiqueta: "der" },
  TIENE_RUC: { x: EJE, y: 1020, decision: true, etiqueta: "der" },
  VALIDAR_RUC: { x: EJE, y: 1110, decision: true, etiqueta: "izq" },
  BUSCAR_RUC_POR_NOMBRE: { x: LADO, y: 1180, etiqueta: "der" },
  CONFIRMAR_RUC_ORACLE: { x: LADO, y: 1270, decision: true, etiqueta: "der" },
  NOTIFICAR_RUC: { x: LADO, y: 1360, etiqueta: "der" },
  ES_CORRECCION: { x: EJE, y: 1520, decision: true, etiqueta: "izq" },
  DESATORAR_ORIGINAL: { x: LADO, y: 1590, etiqueta: "der" },
  BUSCAR_CONTACTO: { x: EJE, y: 1750, decision: true, etiqueta: "izq" },
  CREAR_CONTACTO: { x: LADO, y: 1850, etiqueta: "der" },
  UNIFICAR_CONTACTOS: { x: 120, y: 1850, etiqueta: "der" },
  ACTUALIZAR_CONTACTO: { x: 120, y: 1940, etiqueta: "der" },
  EXISTE_LEAD: { x: EJE, y: 2050, decision: true, etiqueta: "izq" },
  ACTUALIZAR_LEAD: { x: 120, y: 2170, etiqueta: "der" },
  OBTENER_RDV: { x: LADO, y: 2170, etiqueta: "der" },
  CREAR_LEAD: { x: LADO, y: 2255, etiqueta: "der" },
  CREAR_ACTIVIDAD: { x: LADO, y: 2340, etiqueta: "der" },
  PRIORIDAD: { x: LADO, y: 2425, etiqueta: "der" },
  INFOBIP_PERSONA: { x: LADO, y: 2530, etiqueta: "der" },
  INFOBIP_CONVERSACION: { x: LADO, y: 2620, etiqueta: "der" },
  INFOBIP_PLANTILLA: { x: LADO, y: 2710, etiqueta: "der" },
  INFOBIP_VINCULAR: { x: LADO, y: 2800, etiqueta: "der" },
  INFOBIP_ETIQUETAS: { x: LADO, y: 2890, etiqueta: "der" },
  NOTIFICAR_CORREO: { x: EJE, y: 2990, etiqueta: "izq" },
  FINALIZAR: { x: EJE, y: 3080, etiqueta: "izq" },
};

/** Los INFOBIP_* son una sola llamada a InfobipExt: se agrupan en un recuadro. */
const INFOBIP: PasoId[] = ["INFOBIP_PERSONA", "INFOBIP_CONVERSACION", "INFOBIP_PLANTILLA", "INFOBIP_VINCULAR", "INFOBIP_ETIQUETAS"];
const CAJA_INFOBIP = { x: LADO - 50, y: POS.INFOBIP_PERSONA.y - 44, ancho: ANCHO - 10 - (LADO - 50), alto: POS.INFOBIP_ETIQUETAS.y - POS.INFOBIP_PERSONA.y + 92 };

/** Nota fija bajo el nombre del nodo: qué pasa si falla (InfobipExt) o una regla clave del paso. */
const NOTA: Partial<Record<PasoId, { texto: string | string[]; correo?: boolean }>> = {
  ACTUALIZAR_CONTACTO: { texto: ["🔒 DNI/nombre validados no se editan", "falta un campo → de Oracle (sin «no deseo»)"] },
  CREAR_CONTACTO: { texto: "🔒 marca DNI/nombre como validados" },
  UNIFICAR_CONTACTOS: { texto: ["2+ con el DNI → al del lead más reciente", "el que queda vacío se elimina"] },
  CONFIRMAR_DNI_ORACLE: { texto: "excluye «no contactar»" },
  INFOBIP_PERSONA: { texto: "✉ si falla: correo al RDV (cc gestor CRM)", correo: true },
  INFOBIP_CONVERSACION: { texto: "si falla: se detiene, sin correo" },
  INFOBIP_PLANTILLA: { texto: "si falla: sigue sin avisar" },
  INFOBIP_VINCULAR: { texto: "si falla: sigue sin avisar" },
  INFOBIP_ETIQUETAS: { texto: "si falla: sigue sin avisar" },
};

/** Fin de un camino que no es Finalizar: espera del cliente o corrección aplicada. */
type Terminal = { de: PasoId; y: number; tipo: "espera" | "fin" | "salida"; texto: string };
const TERMINALES: Terminal[] = [
  { de: "SIN_CONTACTO_VALIDO", y: 451, tipo: "salida", texto: "✗ sale de la cola" },
  { de: "NOTIFICAR_DNI", y: 936, tipo: "espera", texto: "⏸ en espera de corrección" },
  { de: "NOTIFICAR_RUC", y: 1436, tipo: "espera", texto: "⏸ en espera de corrección" },
  { de: "DESATORAR_ORIGINAL", y: 1666, tipo: "fin", texto: "✓ fin · la original continúa" },
];

const TONO_TERMINAL = { espera: "ambar", fin: "verde", salida: "rojo" } as const;

type Tono = "base" | "naranja" | "verde" | "ambar" | "rojo";
type Etiqueta = { texto: string; x: number; y: number; ancla?: "start" | "middle" | "end" };
/** La arista solo se recorrió si en cada grupo algún nodo se usó (usada: true) o ninguno (false). */
type Condicion = { nodos: PasoId[]; usada: boolean };
type Arista = {
  id: string;
  de: PasoId;
  /** Destino; null = va a un terminal (espera / fin). */
  a: PasoId | null;
  tono: Tono;
  puntos: [number, number][];
  etiqueta?: Etiqueta;
  si?: Condicion[];
  /** Además, este nodo tiene que haber quedado OK (salidas "sí" de una decisión). */
  siOk?: PasoId;
};

const arriba = (p: PasoId) => POS[p].y - (POS[p].decision ? D : R);
const abajo = (p: PasoId) => POS[p].y + (POS[p].decision ? D : R);

function construirAristas(): Arista[] {
  const out: Arista[] = [];
  const recta = (de: PasoId, a: PasoId, tono: Tono = "base", extra: Partial<Arista> = {}) =>
    out.push({ id: `${de}-${a}`, de, a, tono, puntos: [[POS[de].x, abajo(de)], [POS[a].x, arriba(a)]], ...extra });
  /** Salida "sí" de una decisión lateral: vuelve al eje por la izquierda. */
  const vuelta = (de: PasoId, a: PasoId, texto: string, si: Condicion[]) => {
    const p = POS[de];
    out.push({
      id: `${de}-vuelta`, de, a, tono: "base", si, siOk: de,
      puntos: [[p.x - D, p.y], [EJE + 2, p.y]],
      etiqueta: { texto, x: (p.x - D + EJE) / 2, y: p.y - 8 },
    });
  };
  const terminal = (de: PasoId) => {
    const t = TERMINALES.find((x) => x.de === de)!;
    out.push({ id: `${de}-terminal`, de, a: null, tono: TONO_TERMINAL[t.tipo], puntos: [[POS[de].x, abajo(de)], [POS[de].x, t.y - 13]] });
  };

  /**
   * Bloque de identidad (DNI o RUC). `desde` = la validación en el eje; `hacia` = el siguiente nodo del
   * eje. `extranjero` (solo DNI) = decisión previa que salta la regla.
   */
  const identidad = (o: {
    desde: PasoId; hacia: PasoId; extranjero?: PasoId; buscar: PasoId; confirmar: PasoId; notificar: PasoId;
    noPasa: string; pasa: string; base?: Condicion[];
  }) => {
    const base = o.base ?? [];
    const mini = [o.extranjero, o.buscar, o.confirmar, o.notificar].filter(Boolean) as PasoId[];
    const trasExtranjero: PasoId[] = [o.buscar, o.confirmar, o.notificar];
    const d = POS[o.desde];
    const primero = mini[0];
    out.push({
      id: `${o.desde}-${primero}`, de: o.desde, a: primero, tono: "base", si: [...base, { nodos: mini, usada: true }],
      puntos: [[d.x + D, d.y], [LADO, d.y], [LADO, arriba(primero)]],
      etiqueta: { texto: o.noPasa, x: (d.x + LADO) / 2 + 14, y: d.y - 8 },
    });
    if (o.extranjero) {
      vuelta(o.extranjero, o.hacia, "sí · se salta la regla", [...base, { nodos: [o.extranjero], usada: true }, { nodos: trasExtranjero, usada: false }]);
      recta(o.extranjero, o.buscar, "base", {
        si: [...base, { nodos: trasExtranjero, usada: true }],
        etiqueta: { texto: "no", x: LADO + 10, y: (abajo(o.extranjero) + arriba(o.buscar)) / 2 + 4, ancla: "start" },
      });
    }
    recta(o.buscar, o.confirmar, "base", { si: [...base, { nodos: [o.buscar], usada: true }] });
    vuelta(o.confirmar, o.hacia, "sí · usa ese documento", [...base, { nodos: [o.confirmar], usada: true }, { nodos: [o.notificar], usada: false }]);
    recta(o.confirmar, o.notificar, "base", {
      si: [...base, { nodos: [o.notificar], usada: true }],
      etiqueta: { texto: "no · se avisa al cliente", x: LADO + 10, y: (abajo(o.confirmar) + arriba(o.notificar)) / 2 + 4, ancla: "start" },
    });
    terminal(o.notificar);
    recta(o.desde, o.hacia, "base", {
      id: `${o.desde}-${o.hacia}-directo`,
      si: [...base, { nodos: mini, usada: false }],
      // a la izquierda del eje: a la derecha llegan las vueltas del mini-camino
      etiqueta: { texto: o.pasa, x: EJE - 10, y: (abajo(o.desde) + arriba(o.hacia)) / 2, ancla: "end" },
    });
  };

  // Correo y teléfono: siempre siguen; solo dejan la marca true/false que va a Oracle.
  recta("VALIDAR", "VALIDAR_CORREO");
  const marca = (de: PasoId, a: PasoId, texto: string) =>
    recta(de, a, "base", { etiqueta: { texto, x: EJE + 10, y: (abajo(de) + arriba(a)) / 2 + 4, ancla: "start" } });
  marca("VALIDAR_CORREO", "VALIDAR_TELEFONO", "correo_valido = true / false");
  marca("VALIDAR_TELEFONO", "CONTACTO_VALIDO", "telefono_valido = true / false");

  // Ninguno de los dos válido: no hay cómo contactarlo → "Ningún campo válido" y sale de la cola.
  const cv = POS.CONTACTO_VALIDO;
  const sinContacto: Condicion[] = [{ nodos: ["SIN_CONTACTO_VALIDO"], usada: true }];
  out.push({
    id: "CONTACTO_VALIDO-SIN_CONTACTO_VALIDO", de: "CONTACTO_VALIDO", a: "SIN_CONTACTO_VALIDO", tono: "rojo", si: sinContacto,
    puntos: [[cv.x + D, cv.y], [LADO - R, cv.y]],
    etiqueta: { texto: "no · ninguno", x: (cv.x + D + LADO - R) / 2, y: cv.y - 8 },
  });
  terminal("SIN_CONTACTO_VALIDO");
  recta("CONTACTO_VALIDO", "VALIDAR_DNI", "base", {
    si: [{ nodos: ["SIN_CONTACTO_VALIDO"], usada: false }],
    // a la izquierda: a la derecha está el terminal de salida
    etiqueta: { texto: "sí · al menos uno", x: EJE - 10, y: (abajo("CONTACTO_VALIDO") + arriba("VALIDAR_DNI")) / 2 + 4, ancla: "end" },
  });
  identidad({
    desde: "VALIDAR_DNI", hacia: "TIENE_RUC", extranjero: "DNI_EXTRANJERO_ORACLE",
    buscar: "BUSCAR_DNI_POR_NOMBRE", confirmar: "CONFIRMAR_DNI_ORACLE", notificar: "NOTIFICAR_DNI",
    noPasa: "no existe o nombre <75%", pasa: "coincide ≥75%",
  });

  // ¿Tiene RUC? sí → validar por el eje · no → desvío por la izquierda hasta "¿Es corrección?".
  const conRuc: Condicion[] = [{ nodos: ["VALIDAR_RUC"], usada: true }];
  recta("TIENE_RUC", "VALIDAR_RUC", "base", {
    si: conRuc,
    etiqueta: { texto: "sí", x: EJE + 10, y: (abajo("TIENE_RUC") + arriba("VALIDAR_RUC")) / 2 + 4, ancla: "start" },
  });
  const t = POS.TIENE_RUC;
  const yUnion = arriba("ES_CORRECCION") - 20;
  out.push({
    id: "TIENE_RUC-sin-ruc", de: "TIENE_RUC", a: "ES_CORRECCION", tono: "base",
    si: [{ nodos: ["VALIDAR_RUC"], usada: false }],
    puntos: [[t.x - D, t.y], [DESVIO, t.y], [DESVIO, yUnion], [EJE, yUnion], [EJE, arriba("ES_CORRECCION")]],
    etiqueta: { texto: "no", x: (t.x - D + DESVIO) / 2, y: t.y - 8 },
  });
  identidad({
    desde: "VALIDAR_RUC", hacia: "ES_CORRECCION",
    buscar: "BUSCAR_RUC_POR_NOMBRE", confirmar: "CONFIRMAR_RUC_ORACLE", notificar: "NOTIFICAR_RUC",
    noPasa: "no existe o empresa <75%", pasa: "coincide ≥75%", base: conRuc,
  });

  // ¿Es corrección? sí → desatorar la original (fin) · no → sigue.
  const ec = POS.ES_CORRECCION;
  out.push({
    id: "ES_CORRECCION-DESATORAR_ORIGINAL", de: "ES_CORRECCION", a: "DESATORAR_ORIGINAL", tono: "verde",
    si: [{ nodos: ["DESATORAR_ORIGINAL"], usada: true }],
    puntos: [[ec.x + D, ec.y], [LADO, ec.y], [LADO, arriba("DESATORAR_ORIGINAL")]],
    etiqueta: { texto: "sí · trae id de seguimiento", x: (ec.x + LADO) / 2 + 20, y: ec.y - 8 },
  });
  terminal("DESATORAR_ORIGINAL");
  recta("ES_CORRECCION", "BUSCAR_CONTACTO", "base", {
    si: [{ nodos: ["DESATORAR_ORIGINAL"], usada: false }],
    etiqueta: { texto: "no", x: EJE + 10, y: (abajo("ES_CORRECCION") + arriba("BUSCAR_CONTACTO")) / 2 - 20, ancla: "start" },
  });

  // Contacto: no existe → crearlo (derecha) · ya existe → actualizarlo (izquierda). En los dos casos
  // solo con el correo y el celular que pasaron la prueba. Vuelven al eje en "¿Existe lead?".
  const bc = POS.BUSCAR_CONTACTO;
  const ac = POS.ACTUALIZAR_CONTACTO;
  const crear: Condicion[] = [{ nodos: ["CREAR_CONTACTO"], usada: true }];
  const actualizar: Condicion[] = [{ nodos: ["CREAR_CONTACTO"], usada: false }];
  const yContacto = arriba("EXISTE_LEAD") - 16;
  const yYaExiste = abajo("BUSCAR_CONTACTO") + 22;
  out.push({
    id: "BUSCAR_CONTACTO-CREAR_CONTACTO", de: "BUSCAR_CONTACTO", a: "CREAR_CONTACTO", tono: "base", si: crear,
    puntos: [[bc.x + D, bc.y], [LADO, bc.y], [LADO, arriba("CREAR_CONTACTO")]],
    etiqueta: { texto: "no existe", x: (bc.x + LADO) / 2 + 14, y: bc.y - 8 },
  });
  out.push({
    id: "BUSCAR_CONTACTO-UNIFICAR_CONTACTOS", de: "BUSCAR_CONTACTO", a: "UNIFICAR_CONTACTOS", tono: "base", si: actualizar,
    // sale por abajo: a la izquierda del rombo está su nombre
    puntos: [[bc.x, abajo("BUSCAR_CONTACTO")], [bc.x, yYaExiste], [ac.x, yYaExiste], [ac.x, arriba("UNIFICAR_CONTACTOS")]],
    etiqueta: { texto: "ya existe", x: (bc.x + ac.x) / 2, y: yYaExiste - 8 },
  });
  recta("UNIFICAR_CONTACTOS", "ACTUALIZAR_CONTACTO", "base", { si: actualizar });
  out.push({
    id: "CREAR_CONTACTO-EXISTE_LEAD", de: "CREAR_CONTACTO", a: "EXISTE_LEAD", tono: "base", si: crear,
    puntos: [[LADO, abajo("CREAR_CONTACTO")], [LADO, yContacto], [EJE, yContacto], [EJE, arriba("EXISTE_LEAD")]],
  });
  out.push({
    id: "ACTUALIZAR_CONTACTO-EXISTE_LEAD", de: "ACTUALIZAR_CONTACTO", a: "EXISTE_LEAD", tono: "base", si: actualizar,
    puntos: [[ac.x, abajo("ACTUALIZAR_CONTACTO")], [ac.x, yContacto], [EJE, yContacto], [EJE, arriba("EXISTE_LEAD")]],
  });

  const ex = POS.EXISTE_LEAD;
  const yRama = abajo("EXISTE_LEAD") + 26;
  out.push({
    id: "EXISTE_LEAD-ACTUALIZAR_LEAD", de: "EXISTE_LEAD", a: "ACTUALIZAR_LEAD", tono: "naranja",
    puntos: [[EJE, abajo("EXISTE_LEAD")], [EJE, yRama], [POS.ACTUALIZAR_LEAD.x, yRama], [POS.ACTUALIZAR_LEAD.x, arriba("ACTUALIZAR_LEAD")]],
    etiqueta: { texto: "sí existe → actualizar", x: (ex.x + POS.ACTUALIZAR_LEAD.x) / 2, y: yRama - 8 },
  });
  out.push({
    id: "EXISTE_LEAD-OBTENER_RDV", de: "EXISTE_LEAD", a: "OBTENER_RDV", tono: "verde",
    puntos: [[EJE, abajo("EXISTE_LEAD")], [EJE, yRama], [LADO, yRama], [LADO, arriba("OBTENER_RDV")]],
    etiqueta: { texto: "no existe → crear", x: (ex.x + LADO) / 2, y: yRama - 8 },
  });
  const cadena: PasoId[] = ["OBTENER_RDV", "CREAR_LEAD", "CREAR_ACTIVIDAD", "PRIORIDAD", ...INFOBIP];
  for (let i = 1; i < cadena.length; i++) recta(cadena[i - 1], cadena[i], "verde");

  // Las dos ramas se juntan en la notificación de admisión (solo formulario ADMISION) y luego Finalizar.
  const yFin = arriba("NOTIFICAR_CORREO") - 16;
  out.push({
    id: "INFOBIP_ETIQUETAS-NOTIFICAR_CORREO", de: "INFOBIP_ETIQUETAS", a: "NOTIFICAR_CORREO", tono: "verde",
    puntos: [[LADO, abajo("INFOBIP_ETIQUETAS")], [LADO, yFin], [EJE, yFin], [EJE, arriba("NOTIFICAR_CORREO")]],
  });
  out.push({
    id: "ACTUALIZAR_LEAD-NOTIFICAR_CORREO", de: "ACTUALIZAR_LEAD", a: "NOTIFICAR_CORREO", tono: "naranja",
    puntos: [[POS.ACTUALIZAR_LEAD.x, abajo("ACTUALIZAR_LEAD")], [POS.ACTUALIZAR_LEAD.x, yFin], [EJE, yFin], [EJE, arriba("NOTIFICAR_CORREO")]],
  });
  recta("NOTIFICAR_CORREO", "FINALIZAR");
  return out;
}

const ARISTAS = construirAristas();

const COLOR_ARISTA: Record<Tono, string> = { base: "#94a3b8", naranja: "#f59e0b", verde: "#10b981", ambar: "#d97706", rojo: "#e11d48" };

type Pinta = { relleno: string; borde: string; icono: string; halo?: string; punteado?: boolean };

const PINTA: Record<EstadoNodo, Pinta> = {
  OK: { relleno: "#10b981", borde: "#059669", icono: "#ffffff" },
  ERROR: { relleno: "#ef4444", borde: "#dc2626", icono: "#ffffff", halo: "#fecaca" },
  ACTUAL: { relleno: "#0ea5e9", borde: "#0284c7", icono: "#ffffff", halo: "#bae6fd" },
  OMITIDO: { relleno: "#ffffff", borde: "#d1d5db", icono: "#d1d5db", punteado: true },
  PENDIENTE: { relleno: "#ffffff", borde: "#c4b5fd", icono: "#8b5cf6" },
  NEUTRO: { relleno: "#8b5cf6", borde: "#7c3aed", icono: "#ffffff" },
};
const PINTA_DECISION_NEUTRO: Pinta = { relleno: "#fb7185", borde: "#f43f5e", icono: "#ffffff" };

const COLOR_INSIGNIA = { rojo: "#dc2626", azul: "#0284c7", gris: "#374151", ambar: "#d97706" };

const PINTA_TERMINAL = {
  espera: { relleno: "#fef3c7", borde: "#f59e0b", texto: "#92400e" },
  fin: { relleno: "#d1fae5", borde: "#10b981", texto: "#065f46" },
  salida: { relleno: "#ffe4e6", borde: "#e11d48", texto: "#9f1239" },
};

const IC_ID_CARD =
  "M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2";
const IC_DOC_CHECK = "M9 12l2 2 4-4M7 3h7.586a1 1 0 01.707.293l4.414 4.414A1 1 0 0120 8.414V19a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z";
const IC_BASE_DATOS =
  "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4";
const IC_BUSCAR_LISTA = "M4 6h16M4 12h7m-7 6h5m6.5-1a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm2.5-1l3 3";
const IC_CAMPANA =
  "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9";

const ICONO: Record<PasoId, string> = {
  VALIDAR: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  VALIDAR_CORREO: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  VALIDAR_TELEFONO: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z",
  CONTACTO_VALIDO: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  SIN_CONTACTO_VALIDO: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
  VALIDAR_DNI: IC_ID_CARD,
  DNI_EXTRANJERO_ORACLE:
    "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  BUSCAR_DNI_POR_NOMBRE: IC_BUSCAR_LISTA,
  CONFIRMAR_DNI_ORACLE: IC_BASE_DATOS,
  NOTIFICAR_DNI: IC_CAMPANA,
  TIENE_RUC:
    "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  VALIDAR_RUC: IC_DOC_CHECK,
  BUSCAR_RUC_POR_NOMBRE: IC_BUSCAR_LISTA,
  CONFIRMAR_RUC_ORACLE: IC_BASE_DATOS,
  NOTIFICAR_RUC: IC_CAMPANA,
  ES_CORRECCION: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
  DESATORAR_ORIGINAL: "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z",
  BUSCAR_CONTACTO: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  CREAR_CONTACTO: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z",
  UNIFICAR_CONTACTOS: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  ACTUALIZAR_CONTACTO: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  NOTIFICAR_CORREO: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  EXISTE_LEAD: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01",
  OBTENER_RDV: "M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z",
  CREAR_LEAD: "M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  CREAR_ACTIVIDAD: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  PRIORIDAD: "M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z",
  INFOBIP_PERSONA: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  INFOBIP_CONVERSACION: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  INFOBIP_PLANTILLA: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8",
  INFOBIP_VINCULAR: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  INFOBIP_ETIQUETAS: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
  ACTUALIZAR_LEAD: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  FINALIZAR: "M5 13l4 4L19 7",
};

/** Polilínea con esquinas redondeadas. */
function codo(puntos: [number, number][], radio = 12): string {
  let d = `M ${puntos[0][0]} ${puntos[0][1]}`;
  for (let i = 1; i < puntos.length; i++) {
    const [x, y] = puntos[i];
    const sig = puntos[i + 1];
    if (!sig) {
      d += ` L ${x} ${y}`;
      break;
    }
    const [px, py] = puntos[i - 1];
    const r1 = Math.min(radio, Math.hypot(x - px, y - py) / 2);
    const r2 = Math.min(radio, Math.hypot(sig[0] - x, sig[1] - y) / 2);
    const ax = x - Math.sign(x - px) * r1;
    const ay = y - Math.sign(y - py) * r1;
    const bx = x + Math.sign(sig[0] - x) * r2;
    const by = y + Math.sign(sig[1] - y) * r2;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  return d;
}

/** Acorta el último tramo para que la punta de flecha no quede bajo el halo del nodo. */
function acortar(puntos: [number, number][], px = 7): [number, number][] {
  const r = puntos.map((p) => [...p] as [number, number]);
  const [x1, y1] = r[r.length - 2];
  const fin = r[r.length - 1];
  const largo = Math.hypot(fin[0] - x1, fin[1] - y1) || 1;
  fin[0] -= ((fin[0] - x1) / largo) * px;
  fin[1] -= ((fin[1] - y1) / largo) * px;
  return r;
}

function anchoTexto(t: string, px: number): number {
  return t.length * px * 0.6;
}

const USADO: EstadoNodo[] = ["OK", "ERROR", "ACTUAL"];

export default function Canvas({
  nodos,
  seleccion,
  onSeleccion,
  panel,
  entrada,
  todasActivas = false,
}: {
  nodos: Record<PasoId, VistaNodo>;
  seleccion: Seleccion | null;
  onSeleccion: (p: Seleccion | null) => void;
  panel: ReactNode;
  /** Texto del nodo de entrada (p. ej. "Eloqua · 3 en cola"); al hacer clic se selecciona "ENTRADA". */
  entrada: string;
  /** Vista de toda la cola: todos los caminos se usan, se dibujan sólidos. */
  todasActivas?: boolean;
}) {
  // Un terminal se alcanzó si su paso quedó OK (en la cola: si hay solicitudes ahí).
  const terminalActivo = (de: PasoId) => (todasActivas ? !!nodos[de].insignias?.length : nodos[de].estado === "OK");

  // Una arista se recorrió si sus nodos no están tenues, el destino ya se alcanzó (un paso opcional
  // omitido cuenta como atravesado) y se cumplen sus condiciones de mini-camino.
  const recorrida = (a: Arista) => {
    if (a.a === null) return terminalActivo(a.de);
    if (todasActivas) return true;
    const d = nodos[a.de];
    const b = nodos[a.a];
    if (d.tenue || b.tenue || b.estado === "PENDIENTE") return false;
    if (a.siOk && nodos[a.siOk].estado !== "OK") return false;
    return (a.si ?? []).every((c) => c.nodos.some((n) => USADO.includes(nodos[n].estado)) === c.usada);
  };

  const elegir = (s: Seleccion) => onSeleccion(seleccion === s ? null : s);
  const teclado = (s: Seleccion) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      elegir(s);
    }
  };

  const anchoEntrada = Math.max(180, anchoTexto(entrada, 13) + 48);
  const entradaActiva = seleccion === "ENTRADA";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-2xl border border-gray-200 bg-white bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] p-2 [background-size:18px_18px]">
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="mx-auto block h-auto w-full max-w-[760px] select-none" role="img" aria-label="Lienzo del flujo Eloqua → Oracle">
          <defs>
            {(Object.keys(COLOR_ARISTA) as Tono[]).map((t) => (
              <marker
                key={t}
                id={`eo-flecha-${t}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0 0L10 5L0 10z" fill={COLOR_ARISTA[t]} />
              </marker>
            ))}
          </defs>

          {/* Entrada (clic: qué llegó) */}
          <g
            role="button"
            tabIndex={0}
            aria-label={entrada}
            onClick={() => elegir("ENTRADA")}
            onKeyDown={teclado("ENTRADA")}
            className="cursor-pointer outline-none"
          >
            <rect
              x={EJE - anchoEntrada / 2}
              y={20}
              width={anchoEntrada}
              height={34}
              rx={17}
              fill={entradaActiva ? "#ede9fe" : "#ffffff"}
              stroke={entradaActiva ? "#7c3aed" : "#c4b5fd"}
              strokeWidth={entradaActiva ? 2.5 : 1.5}
            />
            <text x={EJE} y={41} textAnchor="middle" fontSize={13} fontWeight={600} fill="#5b21b6">
              {entrada}
            </text>
          </g>
          <path d={codo([[EJE, 54], [EJE, 79]])} fill="none" stroke={COLOR_ARISTA.base} strokeWidth={2} markerEnd="url(#eo-flecha-base)" />

          {/* Recuadro de InfobipExt (una sola llamada, desglosada en sus pasos internos) */}
          <g>
            <rect
              x={CAJA_INFOBIP.x}
              y={CAJA_INFOBIP.y}
              width={CAJA_INFOBIP.ancho}
              height={CAJA_INFOBIP.alto}
              rx={14}
              fill="#f0fdf4"
              fillOpacity={0.6}
              stroke="#86efac"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text x={CAJA_INFOBIP.x + CAJA_INFOBIP.ancho - 12} y={CAJA_INFOBIP.y + 18} textAnchor="end" fontSize={11.5} fontWeight={700} fill="#15803d">
              InfobipExt · POST /sales/active
            </text>
          </g>

          {/* Conectores: primero los no recorridos, encima los recorridos */}
          {[...ARISTAS]
            .sort((a, b) => Number(recorrida(a)) - Number(recorrida(b)))
            .map((a) => {
              const activa = recorrida(a);
              return (
                <g key={a.id} opacity={activa ? 1 : 0.45}>
                  <path
                    d={codo(a.a === null ? a.puntos : acortar(a.puntos))}
                    fill="none"
                    stroke={COLOR_ARISTA[a.tono]}
                    strokeWidth={activa ? 2.5 : 1.75}
                    strokeDasharray={activa ? undefined : "6 5"}
                    strokeLinejoin="round"
                    markerEnd={`url(#eo-flecha-${a.tono})`}
                  />
                  {a.etiqueta && (
                    <text
                      x={a.etiqueta.x}
                      y={a.etiqueta.y}
                      textAnchor={a.etiqueta.ancla ?? "middle"}
                      fontSize={11.5}
                      fontWeight={600}
                      fill={a.tono === "base" ? "#64748b" : COLOR_ARISTA[a.tono]}
                      stroke="#ffffff"
                      strokeWidth={4}
                      paintOrder="stroke"
                    >
                      {a.etiqueta.texto}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Terminales: en espera del cliente / corrección aplicada */}
          {TERMINALES.map((t) => {
            const activa = terminalActivo(t.de);
            const c = PINTA_TERMINAL[t.tipo];
            const w = Math.max(150, anchoTexto(t.texto, 11.5) + 28);
            return (
              <g key={t.de} opacity={activa ? 1 : 0.55}>
                <rect x={LADO - w / 2} y={t.y - 13} width={w} height={26} rx={13} fill={activa ? c.relleno : "#ffffff"} stroke={c.borde} strokeWidth={1.5} strokeDasharray={activa ? undefined : "4 3"} />
                <text x={LADO} y={t.y + 4} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={c.texto}>
                  {t.texto}
                </text>
              </g>
            );
          })}

          {/* Nodos */}
          {(Object.keys(POS) as PasoId[]).map((paso) => {
            const pos = POS[paso];
            const n = nodos[paso];
            const p = pos.decision && n.estado === "NEUTRO" ? PINTA_DECISION_NEUTRO : PINTA[n.estado];
            const activo = seleccion === paso;
            const izq = pos.etiqueta === "izq";
            const tx = izq ? pos.x - (pos.decision ? D : R) - 16 : pos.x + (pos.decision ? D : R) + 16;
            const forma = (extra: number, props: Record<string, unknown>) =>
              pos.decision ? (
                <rect
                  x={pos.x - 20 - extra}
                  y={pos.y - 20 - extra}
                  width={40 + extra * 2}
                  height={40 + extra * 2}
                  rx={8}
                  transform={`rotate(45 ${pos.x} ${pos.y})`}
                  {...props}
                />
              ) : (
                <circle cx={pos.x} cy={pos.y} r={R + extra} {...props} />
              );
            // Insignias arriba a la derecha del nodo, una al lado de otra.
            let bx = pos.x + 14;
            return (
              <g
                key={paso}
                role="button"
                tabIndex={0}
                aria-label={etiquetaPaso(paso)}
                onClick={() => elegir(paso)}
                onKeyDown={teclado(paso)}
                className="cursor-pointer outline-none"
                opacity={n.tenue ? 0.35 : 1}
              >
                {/* zona de clic amplia: nodo + etiqueta */}
                <rect
                  x={izq ? tx - 190 : pos.x - R - 6}
                  y={pos.y - R - 6}
                  width={190 + R * 2 + 18}
                  height={R * 2 + 12}
                  fill="transparent"
                />
                {p.halo && forma(5, { fill: p.halo, className: n.estado === "ACTUAL" ? "animate-pulse" : undefined })}
                {activo && forma(9, { fill: "none", stroke: "#7c3aed", strokeWidth: 2.5, strokeDasharray: "4 3" })}
                {forma(0, { fill: p.relleno, stroke: p.borde, strokeWidth: 2, strokeDasharray: p.punteado ? "4 3" : undefined })}
                <g transform={`translate(${pos.x - 11} ${pos.y - 11}) scale(0.92)`}>
                  <path d={ICONO[paso]} fill="none" stroke={p.icono} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </g>

                {n.insignias?.map((b, i) => {
                  const w = Math.max(18, anchoTexto(b.texto, 11) + 12);
                  const x = bx;
                  bx += w + 3;
                  return (
                    <g key={i}>
                      <rect x={x} y={pos.y - R - 8} width={w} height={18} rx={9} fill={COLOR_INSIGNIA[b.tono]} stroke="#ffffff" strokeWidth={2} />
                      <text x={x + w / 2} y={pos.y - R + 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#ffffff">
                        {b.texto}
                      </text>
                    </g>
                  );
                })}

                <text
                  x={tx}
                  y={pos.y - (n.sub ? 2 : -4)}
                  textAnchor={izq ? "end" : "start"}
                  fontSize={13.5}
                  fontWeight={600}
                  fill={n.estado === "ERROR" ? "#b91c1c" : "#1f2937"}
                >
                  {etiquetaPaso(paso)}
                </text>
                {n.sub && (
                  <text x={tx} y={pos.y + 15} textAnchor={izq ? "end" : "start"} fontSize={11.5} fill="#6b7280">
                    {n.sub}
                  </text>
                )}
                {[NOTA[paso]?.texto ?? []].flat().map((linea, i) => (
                  <text
                    key={i}
                    x={tx}
                    y={pos.y + (n.sub ? 31 : 18) + i * 13}
                    textAnchor={izq ? "end" : "start"}
                    fontSize={11}
                    fontStyle="italic"
                    fill={NOTA[paso]?.correo ? "#be123c" : "#94a3b8"}
                  >
                    {linea}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <aside className="lg:sticky lg:top-4 lg:self-start">{panel}</aside>
    </div>
  );
}
