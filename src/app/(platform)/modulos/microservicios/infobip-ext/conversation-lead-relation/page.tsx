"use client";

import DataTableView from "@/components/data-table/DataTableView";
import type { TableConfig } from "@/components/data-table/types";
import { createRow, listRows, removeRow, updateRow } from "./actions";

const CONFIG: TableConfig = {
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
  return (
    <DataTableView
      config={CONFIG}
      actions={{
        list: listRows,
        create: createRow,
        update: updateRow,
        remove: removeRow,
      }}
    />
  );
}
