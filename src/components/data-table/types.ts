export type ColumnType = "text" | "number" | "datetime";

export interface ColumnConfig {
  key: string;
  label: string;
  type: ColumnType;
  /** No aparece en el form de crear/editar (campos auto-poblados por la DB). */
  readOnly?: boolean;
  /** No se renderiza en la tabla. */
  hiddenInTable?: boolean;
  required?: boolean;
  /** Hay un UNIQUE constraint en la DB; usado para hints en el form. */
  unique?: boolean;
  /** Permite filtrar por esta columna. Default: true salvo readOnly. */
  filterable?: boolean;
  placeholder?: string;
}

export interface TableConfig {
  title: string;
  description?: string;
  primaryKey: string;
  columns: ColumnConfig[];
  defaultSort?: { key: string; direction: "asc" | "desc" };
  defaultPageSize?: number;
  /** Ruta del endpoint REST equivalente (ej: "/api/infobip-ext/<slug>"). Si está, muestra botón "API" en el header. */
  apiPath?: string;
}

export type RowData = Record<string, unknown>;

export type FilterValue =
  | { type: "text"; contains: string }
  | { type: "number"; equals: string }
  | { type: "datetime"; from?: string; to?: string };

export interface ListParams {
  page: number;
  pageSize: number;
  sort?: { key: string; direction: "asc" | "desc" };
  filters?: Record<string, FilterValue>;
}

export interface ListResult {
  rows: RowData[];
  total: number;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface DataTableActions {
  list: (params: ListParams) => Promise<ListResult>;
  create: (data: RowData) => Promise<ActionResult>;
  update: (id: unknown, data: RowData) => Promise<ActionResult>;
  remove: (id: unknown) => Promise<ActionResult>;
}
