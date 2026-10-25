/**
 * Cliente directo a la API de Infobip (CCaaS + WhatsApp), usado por el
 * broadcast de plantillas.
 *
 * Solo server-side: la API key de Infobip nunca debe llegar al browser, así
 * que este módulo se importa únicamente desde server actions / route handlers.
 */

import { extractVariables } from "@/lib/broadcast";
import type { AgentInfo, QueueInfo, TemplateInfo } from "@/lib/broadcast";

function readEnvValue(name: string): string {
  const raw = (process.env[name] || "").trim();
  const value = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;
  return value.replace(/^['"]|['"]$/g, "");
}

function config() {
  const host = readEnvValue("INFOBIP_API_HOST")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const apiKey = readEnvValue("INFOBIP_API_KEY");
  if (!host || !apiKey) {
    throw new Error("Faltan INFOBIP_API_HOST o INFOBIP_API_KEY en el entorno del servidor.");
  }
  return { host, apiKey };
}

export interface InfobipResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Mensaje legible del error de Infobip (vacío si ok). */
  error: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extrae el texto útil de un error de Infobip. Los endpoints no son
 * consistentes: CCaaS usa `requestError.serviceException.text`, WhatsApp
 * `errorMessage`/`description`, y algunos devuelven texto plano.
 */
function describeError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    const msg =
      j?.requestError?.serviceException?.text ||
      j?.errorMessage ||
      j?.description ||
      j?.message ||
      j?.error;
    if (msg) return `${status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
  } catch {
    // no era JSON
  }
  return `${status}: ${body.slice(0, 300) || "sin detalle"}`;
}

/**
 * Llamada a Infobip con reintentos ante 429 (siempre) y 5xx (solo métodos
 * idempotentes: un POST que dio 500 pudo haberse ejecutado igual, y
 * reintentarlo duplicaría el mensaje).
 */
async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<InfobipResponse<T>> {
  const { host, apiKey } = config();
  const retry5xx = method !== "POST";

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://${host}${path}`, {
        method,
        headers: {
          Authorization: `App ${apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      if (retry5xx && attempt < 2) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return { ok: false, status: 0, data: null, error: `Sin respuesta de Infobip: ${(e as Error).message}` };
    }

    const text = await res.text();
    const retriable = res.status === 429 || (retry5xx && res.status >= 500);
    if (retriable && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: describeError(res.status, text) };
    }
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { ok: true, status: res.status, data, error: "" };
  }
}

function orThrow<T>(r: InfobipResponse<T>, contexto: string): T {
  if (!r.ok || r.data === null) throw new Error(`Infobip (${contexto}) respondió ${r.error}`);
  return r.data;
}

// ==================== Catálogos ====================

interface Paged {
  pagination?: { totalItems?: number };
}

/** Recorre un listado paginado de CCaaS (`page` empieza en 0). */
async function listAll<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 20; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const data = orThrow(
      await request<Paged & Record<string, T[]>>("GET", `${path}${sep}limit=999&page=${page}`),
      key,
    );
    const items = data[key] ?? [];
    out.push(...items);
    const total = data.pagination?.totalItems ?? out.length;
    if (items.length === 0 || out.length >= total) break;
  }
  return out;
}

export async function listQueues(): Promise<QueueInfo[]> {
  const raw = await listAll<{ id: string; name: string; isPrivate?: boolean; deletedAt?: string | null }>(
    "/ccaas/1/queues",
    "queues",
  );
  return raw
    .filter((q) => !q.deletedAt)
    .map((q) => ({ id: q.id, name: q.name, isPrivate: !!q.isPrivate }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Solo agentes habilitados (los deshabilitados no pueden recibir conversaciones). */
export async function listAgents(): Promise<AgentInfo[]> {
  const raw = await listAll<{ id: string; displayName: string; role: string; enabled: boolean }>(
    "/ccaas/1/agents",
    "agents",
  );
  return raw
    .filter((a) => a.enabled)
    .map((a) => ({ id: a.id, name: a.displayName, role: a.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

interface RawTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  structure?: {
    header?: { format?: string; text?: string };
    body?: { text?: string };
    buttons?: { type: string; text?: string }[];
  };
}

/**
 * Plantillas APROBADAS del WABA del sender. Los 7 números de producción
 * comparten WABA, así que devuelven la misma lista.
 */
export async function listTemplates(sender: string): Promise<TemplateInfo[]> {
  const data = orThrow(
    await request<{ templates?: RawTemplate[] }>(
      "GET",
      `/whatsapp/2/senders/${encodeURIComponent(sender)}/templates`,
    ),
    "plantillas",
  );
  return (data.templates ?? [])
    .filter((t) => t.status === "APPROVED")
    .map((t) => {
      const body = t.structure?.body?.text ?? "";
      const header = t.structure?.header;
      return {
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        body,
        variables: extractVariables(body),
        headerFormat: header?.format ?? null,
        // Una cabecera de texto con {{1}} también exige parámetro.
        headerHasVariables: !!header?.text && extractVariables(header.text).length > 0,
        buttons: (t.structure?.buttons ?? []).map((b) => b.type),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ==================== Conversaciones ====================

export interface ConversationInfo {
  id: string;
  status: string;
  queueId: string | null;
  agentId: string | null;
}

/**
 * Devuelve la respuesta completa (no solo los datos) para que el llamador
 * distinga "no existe" (404) de "no se pudo consultar" (red, 5xx): en el
 * segundo caso no hay que asumir nada, o se crearían conversaciones duplicadas.
 */
export async function getConversation(id: string): Promise<InfobipResponse<ConversationInfo>> {
  return request<ConversationInfo>("GET", `/ccaas/1/conversations/${encodeURIComponent(id)}`);
}

export async function createConversation(input: {
  queueId: string;
  agentId?: string | null;
  topic: string;
}): Promise<InfobipResponse<ConversationInfo>> {
  const payload: Record<string, unknown> = {
    channel: "WHATSAPP",
    topic: input.topic,
    queueId: input.queueId,
  };
  if (input.agentId) payload.agentId = input.agentId;
  return request<ConversationInfo>("POST", "/ccaas/1/conversations", payload);
}

/** Cambia la cola. Infobip no permite modificar conversaciones CLOSED. */
export async function moveConversationQueue(id: string, queueId: string) {
  return request("PATCH", `/ccaas/1/conversations/${encodeURIComponent(id)}`, { queueId });
}

export async function assignConversation(id: string, agentId: string) {
  return request("PUT", `/ccaas/1/conversations/${encodeURIComponent(id)}/assignee`, { agentId });
}

/**
 * Envía una plantilla WhatsApp dentro de la conversación (mismo formato que
 * InfobipExt `enviar_template_conversacion`). `parameters` va con claves
 * "{{n}}"; si la plantilla no tiene variables se omite.
 */
export async function sendTemplate(input: {
  conversationId: string;
  from: string;
  to: string;
  templateName: string;
  language: string;
  parameters: Record<string, string>;
  agentId?: string | null;
}) {
  const content: Record<string, unknown> = {
    templateName: input.templateName,
    language: input.language,
  };
  if (Object.keys(input.parameters).length > 0) content.parameters = [input.parameters];

  return request<{ id?: string }>(
    "POST",
    `/ccaas/1/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    {
      from: input.from,
      to: input.to,
      channel: "WHATSAPP",
      contentType: "TEMPLATE",
      content,
    },
    input.agentId ? { "x-agent-id": input.agentId } : undefined,
  );
}

interface RawConversationMessage {
  id: string;
  direction: string;
  createdAt: string;
  singleSendMessage?: { content?: { elementName?: string; type?: string } };
}

/**
 * Id del primer mensaje OUTBOUND de esa plantilla en la conversación enviado
 * desde `desde` (creación del broadcast). El primero y no el último: en una
 * conversación reutilizada, un broadcast posterior pudo mandar la misma
 * plantilla. Sirve para envíos que no guardaron el id al mandarse.
 */
export async function findTemplateMessageId(
  conversationId: string,
  templateName: string,
  desde: string,
): Promise<string | null> {
  const r = await request<{ messages?: RawConversationMessage[] }>(
    "GET",
    `/ccaas/1/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`,
  );
  if (!r.ok || !r.data) return null;
  const desdeMs = new Date(desde).getTime();
  const match = (r.data.messages ?? [])
    .filter(
      (m) =>
        m.direction === "OUTBOUND" &&
        m.singleSendMessage?.content?.elementName === templateName &&
        new Date(m.createdAt).getTime() >= desdeMs,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return match[0]?.id ?? null;
}

export interface EstadoEntrega {
  /** PENDING | DELIVERED | UNDELIVERABLE | EXPIRED | REJECTED ... */
  grupo: string;
  nombre: string;
  errorId: number | null;
  errorNombre: string | null;
  errorDescripcion: string | null;
}

interface RawLog {
  messageId: string;
  status?: { groupName?: string; name?: string };
  error?: { id?: number; name?: string; description?: string } | null;
}

/**
 * Estado real de entrega (lo que WhatsApp hizo con el mensaje) desde los logs
 * de Infobip. Acepta varios ids por llamada. Los mensajes que todavía no
 * aparecen en los logs simplemente no vienen en el mapa.
 */
export async function getDeliveryStatus(messageIds: string[]): Promise<Map<string, EstadoEntrega>> {
  const out = new Map<string, EstadoEntrega>();
  if (messageIds.length === 0) return out;
  const qs = messageIds.map((id) => `messageId=${encodeURIComponent(id)}`).join("&");
  const data = orThrow(
    await request<{ results?: RawLog[] }>("GET", `/messages-api/1/logs?${qs}&limit=${messageIds.length}`),
    "logs de entrega",
  );
  for (const l of data.results ?? []) {
    const errorId = l.error?.id ?? null;
    out.set(l.messageId, {
      grupo: l.status?.groupName ?? "",
      nombre: l.status?.name ?? "",
      errorId: errorId && errorId !== 0 ? errorId : null,
      errorNombre: errorId ? l.error?.name ?? null : null,
      errorDescripcion: errorId ? l.error?.description ?? null : null,
    });
  }
  return out;
}

/** Crea la etiqueta si no existe ("already exists" no es error). */
export async function ensureTag(name: string): Promise<boolean> {
  const r = await request("POST", "/ccaas/1/tags", { name });
  return r.ok || (r.status === 400 && r.error.toLowerCase().includes("already exists"));
}

export async function addTag(conversationId: string, tagName: string) {
  return request("POST", `/ccaas/1/conversations/${encodeURIComponent(conversationId)}/tags`, { tagName });
}

// ==================== Mensaje directo (sin conversación CCaaS) ====================

export interface EnvioDirecto {
  messageId: string | null;
  /** Estado que devuelve Infobip al aceptar el envío (PENDING si lo tomó; REJECTED si no). */
  grupo: string;
  nombre: string;
  descripcion: string;
}

/**
 * Envía una plantilla WhatsApp directo al número (`/whatsapp/1/message/template`), sin crear
 * conversación en CCaaS. La usa la prueba de teléfono de Eloqua → Oracle. `placeholders` son las
 * variables del cuerpo en orden ({{1}}, {{2}}…).
 */
export async function enviarPlantillaDirecta(input: {
  from: string;
  to: string;
  templateName: string;
  language: string;
  placeholders: string[];
}): Promise<InfobipResponse<EnvioDirecto>> {
  const r = await request<{ messages?: { messageId?: string; status?: { groupName?: string; name?: string; description?: string } }[] }>(
    "POST",
    "/whatsapp/1/message/template",
    {
      messages: [
        {
          from: input.from,
          to: input.to,
          content: {
            templateName: input.templateName,
            templateData: { body: { placeholders: input.placeholders } },
            language: input.language,
          },
        },
      ],
    },
  );
  if (!r.ok) return { ...r, data: null };
  const m = r.data?.messages?.[0];
  return {
    ...r,
    data: {
      messageId: m?.messageId ?? null,
      grupo: m?.status?.groupName ?? "",
      nombre: m?.status?.name ?? "",
      descripcion: m?.status?.description ?? "",
    },
  };
}
