"use client";

import DataTableView from "@/components/data-table/DataTableView";
import type { TableConfig } from "@/components/data-table/types";
import { createRow, listRows, removeRow, updateRow } from "./actions";

const CONFIG: TableConfig = {
  title: "Cola General de Senders",
  description: "Asigna cada sender a su cola general.",
  primaryKey: "id",
  apiPath: "/api/infobip-ext/sender-general-queue",
  defaultSort: { key: "created_at", direction: "desc" },
  columns: [
    {
      key: "id",
      label: "ID",
      type: "number",
      readOnly: true,
      filterable: false,
    },
    {
      key: "sender",
      label: "Sender",
      type: "text",
      required: true,
      unique: true,
    },
    {
      key: "general_queue_id",
      label: "Cola General",
      type: "text",
      required: true,
      placeholder: "ID de la cola general",
    },
    {
      key: "created_at",
      label: "Creado",
      type: "datetime",
      readOnly: true,
    },
  ],
};

export default function SenderGeneralQueuePage() {
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
