"use client";

import DataTableView from "@/components/data-table/DataTableView";
import type { TableConfig } from "@/components/data-table/types";
import { createRow, listRows, removeRow, updateRow } from "./actions";

const CONFIG: TableConfig = {
  title: "Último RDV por Sender",
  description: "Registra el último RDV asociado a cada combinación de sender + teléfono.",
  primaryKey: "id",
  apiPath: "/api/infobip-ext/sender-last-rdv",
  defaultSort: { key: "fecha_actualizacion", direction: "desc" },
  columns: [
    {
      key: "id",
      label: "ID",
      type: "number",
      readOnly: true,
      filterable: false,
    },
    {
      key: "telefono_contacto",
      label: "Teléfono Contacto",
      type: "text",
      required: true,
      placeholder: "+51 999 999 999",
    },
    {
      key: "sender",
      label: "Sender",
      type: "text",
      required: true,
    },
    {
      key: "last_rdv_id",
      label: "Último RDV ID",
      type: "number",
      required: true,
    },
    {
      key: "lead_id",
      label: "Lead ID",
      type: "number",
      required: true,
    },
    {
      key: "fecha_actualizacion",
      label: "Actualizado",
      type: "datetime",
      readOnly: true,
    },
  ],
};

export default function SenderLastRdvPage() {
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
