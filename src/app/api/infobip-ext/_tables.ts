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
};

export const TABLES = {
  "conversation-lead-relation": {
    schema: "Infobip_ext",
    table: "conversation_lead_relation",
    primaryKey: "id",
    upsertOn: "infobip_conversation_id",
    touch: "updated_at",
    preserveOnNull: true,
  },
  "sender-last-rdv": {
    schema: "Infobip_ext",
    table: "sender_last_rdv",
    primaryKey: "id",
    upsertOn: "telefono_contacto,sender",
    touch: "fecha_actualizacion",
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
