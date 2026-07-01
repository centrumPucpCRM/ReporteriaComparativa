export type TableDef = {
  schema: string;
  table: string;
  primaryKey: string;
  /** Si está presente, POST hace UPSERT con `onConflict` sobre estas columnas (CSV). */
  upsertOn?: string;
  /** Columna timestamp que el server sella con now() en cada escritura (insert/upsert). */
  touch?: string;
  /**
   * En upsert, descarta del payload las claves con valor null/undefined antes de
   * escribir. Como PostgREST solo actualiza las columnas presentes en el payload,
   * esto preserva el valor existente cuando el campo llega null/ausente
   * (equivale a COALESCE(entrante, actual)).
   */
  preserveOnNull?: boolean;
  /**
   * Columnas cuya ausencia (IS NULL) marca la fila como "incompleta". Habilita el
   * query param `?incompletos=true` en el GET, que devuelve solo filas con alguna
   * de estas columnas en NULL.
   */
  incompleteColumns?: string[];
  /**
   * Solo aplica en INSERT (no matchea ninguna fila por `upsertOn`): si esta columna
   * llega null/ausente, se busca su valor en otra tabla filtrando por las mismas
   * columnas de `upsertOn` (deben llamarse igual en ambas tablas). Si tampoco
   * aparece ahí, la columna queda en null. En UPDATE no se usa: `preserveOnNull`
   * ya se encarga de no pisar el valor existente.
   */
  fallbackLookup?: {
    schema: string;
    table: string;
    column: string;
  };
};

export const TABLES = {
  "conversation-lead-relation": {
    schema: "Infobip_ext",
    table: "conversation_lead_relation",
    primaryKey: "id",
    upsertOn: "infobip_conversation_id",
    touch: "updated_at",
    preserveOnNull: true,
    incompleteColumns: ["telefono_contacto", "sender"],
  },
  "sender-last-rdv": {
    schema: "Infobip_ext",
    table: "sender_last_rdv",
    primaryKey: "id",
    upsertOn: "telefono_contacto,sender",
    touch: "fecha_actualizacion",
    preserveOnNull: true,
    fallbackLookup: {
      schema: "Infobip_ext",
      table: "conversation_lead_relation",
      column: "lead_id",
    },
  },
  "colas": {
    schema: "Infobip_ext",
    table: "colas",
    primaryKey: "id",
  },
} satisfies Record<string, TableDef>;

export type TableSlug = keyof typeof TABLES;

export function resolveTable(slug: string): TableDef | null {
  if (slug in TABLES) return TABLES[slug as TableSlug];
  return null;
}
