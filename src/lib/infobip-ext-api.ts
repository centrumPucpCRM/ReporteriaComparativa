/**
 * Cliente hacia la API de InfobipExt (FastAPI, EC2).
 *
 * Solo server-side: el token nunca debe llegar al browser, así que este
 * módulo se importa únicamente desde server actions / route handlers.
 */

function readEnvValue(name: string): string {
  const raw = (process.env[name] || "").trim();
  const value = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;
  return value.replace(/^['"]|['"]$/g, "");
}

export interface ChatMessage {
  id: number;
  /** MESSAGE | NOTE */
  tipo: string | null;
  contenido: string | null;
  /** INBOUND | OUTBOUND | INTERNAL */
  direccion: string | null;
  remitente: string | null;
  created_at_infobip: string | null;
}

export interface ChatHistory {
  id_conversation: string;
  lead_id: string | null;
  codigo_crm: string | null;
  estado_conversacion: string | null;
  telefono_creado: string | null;
  total_mensajes: number;
  mensajes: ChatMessage[];
  /** El sync contra Infobip falló: lo que se muestra es solo lo ya cacheado. */
  stale: boolean;
}

function config() {
  const baseUrl = readEnvValue("INFOBIPEXT_API_URL").replace(/\/+$/, "");
  const token = readEnvValue("INFOBIPEXT_API_TOKEN");
  if (!baseUrl || !token) {
    throw new Error(
      "Faltan INFOBIPEXT_API_URL o INFOBIPEXT_API_TOKEN en el entorno del servidor.",
    );
  }
  return { baseUrl, token };
}

/**
 * Trae el historial completo de una conversación.
 *
 * InfobipExt sirve el timeline desde su SQLite local, que es un espejo — no la
 * fuente de verdad. Por eso primero se dispara el sync contra Infobip, o una
 * conversación nunca sincronizada se vería vacía. Ese paso es best-effort:
 * si falla (red, 429, Infobip caído) igual devolvemos lo cacheado marcado
 * como `stale` en vez de romper la vista.
 */
export async function fetchChatHistory(conversationId: string): Promise<ChatHistory> {
  const { baseUrl, token } = config();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let stale = false;
  try {
    const sync = await fetch(`${baseUrl}/api/v1/messages/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id_conversation: conversationId }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!sync.ok) stale = true;
  } catch {
    stale = true;
  }

  const res = await fetch(
    `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );

  if (res.status === 404) {
    throw new Error("InfobipExt no tiene registrada esta conversación.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("InfobipExt rechazó el token (INFOBIPEXT_API_TOKEN).");
  }
  if (!res.ok) {
    throw new Error(`InfobipExt respondió ${res.status} ${res.statusText}.`);
  }

  const data = (await res.json()) as Omit<ChatHistory, "stale">;
  return { ...data, stale };
}
