"use client";

import DataTableView from "@/components/data-table/DataTableView";
import type { TableConfig } from "@/components/data-table/types";
import { createRow, listRows, removeRow, updateRow } from "./actions";

const CONFIG: TableConfig = {
  title: "Colas",
  description: "Mapea cada NI (teléfono Infobip) a sus colas de Ingreso (IN) y General (GEN).",
  primaryKey: "id",
  apiPath: "/api/infobip-ext/colas",
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
      key: "ni",
      label: "NI (Teléfono Infobip)",
      type: "text",
      required: true,
      unique: true,
    },
    {
      key: "programa",
      label: "Programa",
      type: "text",
      placeholder: 'Ej: "MBA y Executive"',
    },
    {
      key: "ing_queue_id",
      label: "Cola Ingreso (IN)",
      type: "text",
      required: true,
      placeholder: "queueId de la cola ING",
    },
    {
      key: "gen_queue_id",
      label: "Cola General (GEN)",
      type: "text",
      required: true,
      placeholder: "queueId de la cola GEN",
    },
    {
      key: "created_at",
      label: "Creado",
      type: "datetime",
      readOnly: true,
    },
  ],
};

export default function ColasPage() {
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
