/**
 * Tipos y utilidades puras del broadcast de plantillas. Sin dependencias de
 * servidor: se usan tanto en la UI (validación/preview) como en las actions.
 */

export interface QueueInfo {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  /** AGENT | SUPERVISOR */
  role: string;
}

/** Número Infobip habilitado para broadcast (sale de la tabla `colas`). */
export interface LineaEnvio {
  ni: string;
  programa: string | null;
  ingQueueId: string;
  genQueueId: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  /** Números de las variables del cuerpo, ordenados: [1, 2, 3]. */
  variables: number[];
  /** IMAGE | VIDEO | DOCUMENT | TEXT | null */
  headerFormat: string | null;
  headerHasVariables: boolean;
  buttons: string[];
}

/** De dónde sale el valor de cada {{n}}. */
export type FuenteVariable =
  | { tipo: "columna"; columna: string }
  | { tipo: "fijo"; valor: string };

export type Mapeo = Record<number, FuenteVariable>;

export interface DestinatarioInput {
  fila: number;
  telefono: string;
  /** {"{{1}}": "Ana"} */
  parametros: Record<string, string>;
}

export type EstadoDestinatario = "PENDIENTE" | "ENVIANDO" | "OK" | "ERROR";

/**
 * Lo que hizo WhatsApp con un mensaje que Infobip aceptó (estado OK). Se
 * resuelve unos segundos después del envío consultando los logs de Infobip.
 */
export type EstadoEntrega = "PENDIENTE" | "ENTREGADO" | "NO_ENTREGADO";

export interface ResultadoDestinatario {
  id: number;
  fila: number;
  telefono: string;
  estado: EstadoDestinatario;
  conversationId: string | null;
  reutilizada: boolean | null;
  error: string | null;
  advertencia: string | null;
  entrega: EstadoEntrega | null;
  entregaDetalle: string | null;
}

/** Texto legible para los errores de entrega más comunes de WhatsApp. */
export function describirErrorEntrega(errorId: number | null, nombre: string | null, descripcion: string | null): string {
  if (errorId === 7032) {
    return "Meta bloqueó el mensaje por límite de frecuencia: el contacto recibió demasiadas plantillas de marketing en poco tiempo (7032).";
  }
  const base = [nombre, descripcion].filter(Boolean).join(": ");
  return base ? `${base}${errorId ? ` (${errorId})` : ""}` : "WhatsApp no entregó el mensaje.";
}

export function extractVariables(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

/**
 * La primera versión solo envía variables de cuerpo: el formato que espera
 * CCaaS para cabeceras con media/variables aún no está verificado.
 */
export function motivoNoSoportada(t: TemplateInfo): string | null {
  if (t.headerFormat && t.headerFormat !== "TEXT") {
    return `Cabecera ${t.headerFormat}: todavía no soportada en el broadcast.`;
  }
  if (t.headerHasVariables) return "Cabecera con variables: todavía no soportada en el broadcast.";
  return null;
}

export function renderTemplate(body: string, valores: Record<number, string>): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const v = valores[Number(n)];
    return v ? v : match;
  });
}

/**
 * Normaliza al formato de Infobip (51987654321). Mismo criterio que
 * InfobipExt `_normalizar_telefono`: quita paréntesis, '+', espacios y
 * guiones, corrige '5151...' y antepone 51 a móviles '9...'.
 * Devuelve null si no queda un número plausible (10 a 15 dígitos).
 */
export function normalizarTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = String(raw).trim().replace(/\([^)]*\)/g, "").replace(/[+\s\-.]/g, "");
  if (t.startsWith("5151")) t = t.slice(2);
  else if (/^9\d{8}$/.test(t)) t = `51${t}`;
  if (!/^\d{10,15}$/.test(t)) return null;
  // Perú: 51 + 9 dígitos de móvil.
  if (t.startsWith("51") && !/^519\d{8}$/.test(t)) return null;
  return t;
}

/**
 * Tarifa en USD por mensaje de plantilla entregado, según la categoría de la
 * plantilla (WhatsApp cobra por categoría y país de destino; aquí, Perú).
 *
 * MARKETING: sale de la estimación de Infobip para un broadcast real
 * (US$ 97,85 / 1.475 mensajes = 0,0663). Las categorías sin tarifa se
 * muestran como "sin tarifa configurada" en vez de inventar un monto:
 * agregarlas aquí cuando se confirmen con Infobip.
 */
export const TARIFAS_USD: Record<string, number> = {
  MARKETING: 0.0663,
};

export function tarifaPorCategoria(categoria: string | null | undefined): number | null {
  if (!categoria) return null;
  return TARIFAS_USD[categoria.toUpperCase()] ?? null;
}

export function formatoUsd(monto: number): string {
  return `US$ ${monto.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Comparación sin tildes ni mayúsculas, para los buscadores. */
export function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
