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
  },
  "colas": {
    schema: "Infobip_ext",
    table: "colas",
    primaryKey: "id",
  },
} as const;

export type TableSlug = keyof typeof TABLES;

export function resolveTable(slug: string) {
  if (slug in TABLES) return TABLES[slug as TableSlug];
  return null;
}
