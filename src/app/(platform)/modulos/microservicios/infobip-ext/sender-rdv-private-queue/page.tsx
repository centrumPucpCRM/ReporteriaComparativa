"use client";

import DataTableView from "@/components/data-table/DataTableView";
import type { TableConfig } from "@/components/data-table/types";
import { createRow, listRows, removeRow, updateRow } from "./actions";

const CONFIG: TableConfig = {
  title: "Cola Privada de RDVs",
  description: "Mapeo de senders a colas privadas para RDVs específicos.",
  primaryKey: "id",
  apiPath: "/api/infobip-ext/sender-rdv-private-queue",
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
    },
    {
      key: "rdv_id",
      label: "RDV ID",
      type: "number",
      required: true,
    },
    {
      key: "private_queue_id",
      label: "Cola Privada",
      type: "text",
      required: true,
      placeholder: "ID de la cola privada",
    },
    {
      key: "created_at",
      label: "Creado",
      type: "datetime",
      readOnly: true,
    },
  ],
};

export default function SenderRdvPrivateQueuePage() {
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
