"use server";

import { createTableActions } from "@/components/data-table/createTableActions";
import type { ListParams, RowData } from "@/components/data-table/types";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { fetchChatHistory, type ChatHistory } from "@/lib/infobip-ext-api";

const baseActions = createTableActions({
  schema: "Infobip_ext",
  table: "conversation_lead_relation",
  primaryKey: "id",
  incompleteColumns: ["telefono_contacto", "sender"],
});

export async function listRows(params: ListParams) {
  return baseActions.list(params);
}

export async function createRow(data: RowData) {
  return baseActions.create(data);
}

export async function updateRow(id: unknown, data: RowData) {
  return baseActions.update(id, data);
}

export async function removeRow(id: unknown) {
  return baseActions.remove(id);
}

export type ChatHistoryResult =
  | { success: true; data: ChatHistory }
  | { success: false; error: string };

/**
 * Historial de chat de una conversación, traído de InfobipExt.
 *
 * Devuelve el error como valor en vez de lanzarlo: una server action que
 * lanza pierde el mensaje en producción y el modal solo podría mostrar
 * "algo falló".
 */
export async function getChatHistory(conversationId: string): Promise<ChatHistoryResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "No autenticado." };

  if (!conversationId) {
    return { success: false, error: "La fila no tiene ID de conversación." };
  }

  try {
    return { success: true, data: await fetchChatHistory(conversationId) };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
