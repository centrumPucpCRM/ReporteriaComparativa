"use server";

import { createTableActions } from "@/components/data-table/createTableActions";
import type { ListParams, RowData } from "@/components/data-table/types";

const baseActions = createTableActions({
  schema: "Infobip_ext",
  table: "colas",
  primaryKey: "id",
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
