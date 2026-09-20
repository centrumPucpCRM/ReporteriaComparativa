"use client";

import { useMemo, useState } from "react";
import DataTableView from "@/components/data-table/DataTableView";
import ChatHistoryModal from "@/components/data-table/ChatHistoryModal";
import type { RowData, TableConfig } from "@/components/data-table/types";
import { createRow, getChatHistory, listRows, removeRow, updateRow } from "./actions";

const CHAT_ICON =
  "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z";

const BASE_CONFIG: TableConfig = {
  title: "Conversaciones ↔ Leads",
  description:
    "Relaciona cada conversación de Infobip con su lead correspondiente.",
  primaryKey: "id",
  apiPath: "/api/infobip-ext/conversation-lead-relation",
  incompleteColumns: ["telefono_contacto", "sender"],
  defaultSort: { key: "id", direction: "desc" },
  columns: [
    {
      key: "id",
      label: "ID",
      type: "number",
      readOnly: true,
      filterable: false,
    },
    {
      key: "infobip_conversation_id",
      label: "Conversación Infobip",
      type: "text",
      required: true,
      unique: true,
      placeholder: "ID único de la conversación",
    },
    {
      key: "lead_id",
      label: "Lead ID",
      type: "number",
      required: true,
      placeholder: "ID del lead",
    },
    {
      key: "sender",
      label: "Sender",
      type: "text",
      placeholder: "Número Infobip emisor (opcional)",
    },
    {
      key: "telefono_contacto",
      label: "Teléfono Contacto",
      type: "text",
      placeholder: "Teléfono del cliente (opcional)",
    },
    {
      key: "created_at",
      label: "Creado",
      type: "datetime",
      readOnly: true,
    },
    {
      key: "updated_at",
      label: "Actualizado",
      type: "datetime",
      readOnly: true,
    },
  ],
};

export default function ConversationLeadRelationPage() {
  const [chatRow, setChatRow] = useState<RowData | null>(null);

  const config = useMemo<TableConfig>(
    () => ({
      ...BASE_CONFIG,
      rowActions: [
        {
          key: "chat",
          title: "Ver historial de chat",
          iconPath: CHAT_ICON,
          onClick: (row) => setChatRow(row),
          enabled: (row) => Boolean(row.infobip_conversation_id),
        },
      ],
    }),
    [],
  );

  return (
    <>
      <DataTableView
        config={config}
        actions={{
          list: listRows,
          create: createRow,
          update: updateRow,
          remove: removeRow,
        }}
      />
      {chatRow ? (
        <ChatHistoryModal
          conversationId={String(chatRow.infobip_conversation_id)}
          leadId={chatRow.lead_id != null ? String(chatRow.lead_id) : null}
          load={getChatHistory}
          onClose={() => setChatRow(null)}
        />
      ) : null}
    </>
  );
}
