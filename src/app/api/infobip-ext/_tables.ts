export type TableDef = {
  schema: string;
  table: string;
  primaryKey: string;
  /** Si está presente, POST hace UPSERT con `onConflict` sobre estas columnas (CSV). */
  upsertOn?: string;
  /** Columna timestamp que el server sella con now() en cada escritura (insert/upsert). */
  touch?: string;
};

export const TABLES = {
  "conversation-lead-relation": {
    schema: "Infobip_ext",
    table: "conversation_lead_relation",
    primaryKey: "id",
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
