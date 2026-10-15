"use server";

import { requireUser } from "@/components/data-table/createTableActions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addTag,
  assignConversation,
  createConversation,
  ensureTag,
  getConversation,
  listAgents,
  listQueues,
  listTemplates,
  moveConversationQueue,
  sendTemplate,
} from "@/lib/infobip";
import {
  motivoNoSoportada,
  normalizarTelefono,
  type AgentInfo,
  type DestinatarioInput,
  type EstadoDestinatario,
  type LineaEnvio,
  type Mapeo,
  type QueueInfo,
  type ResultadoDestinatario,
  type TemplateInfo,
} from "@/lib/broadcast";

type Result<T> = { success: true; data: T } | { success: false; error: string };

const SCHEMA = "Infobip_ext";
/** Estados en los que InfobipExt también reutiliza una conversación. */
const ESTADOS_REUTILIZABLES = new Set(["OPEN", "WAITING", "SOLVED"]);
const TAG_BROADCAST = "BROADCAST";
/** Filas que procesa cada lote en paralelo (más de ~4 dispara 429 en Infobip). */
const CONCURRENCIA = 4;
const MAX_LOTE = 25;
const MAX_INSERT = 500;

function db() {
  return createAdminClient().schema(SCHEMA);
}

async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

async function cargarLineas(): Promise<LineaEnvio[]> {
  const { data, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("colas" as any)
    .select("ni, programa, ing_queue_id, gen_queue_id")
    .order("programa");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as {
    ni: string;
    programa: string | null;
    ing_queue_id: string;
    gen_queue_id: string;
  }[]).map((r) => ({
    ni: r.ni,
    programa: r.programa,
    ingQueueId: r.ing_queue_id,
    genQueueId: r.gen_queue_id,
  }));
}

// ==================== Catálogos ====================

export async function cargarCatalogos(): Promise<
  Result<{ queues: QueueInfo[]; agents: AgentInfo[]; lineas: LineaEnvio[] }>
> {
  return safe(async () => {
    await requireUser();
    const [queues, agents, lineas] = await Promise.all([listQueues(), listAgents(), cargarLineas()]);
    return { queues, agents, lineas };
  });
}

export async function cargarPlantillas(sender: string): Promise<Result<TemplateInfo[]>> {
  return safe(async () => {
    await requireUser();
    await validarLinea(sender);
    return listTemplates(sender);
  });
}

/** Solo se envía desde números de la tabla `colas`: nunca un número por defecto. */
async function validarLinea(sender: string): Promise<LineaEnvio> {
  const linea = (await cargarLineas()).find((l) => l.ni === sender);
  if (!linea) throw new Error(`La línea ${sender} no está registrada en la tabla de colas.`);
  return linea;
}

// ==================== Creación ====================

export interface CrearBroadcastInput {
  campana: string;
  queueId: string;
  queueNombre: string;
  agentId: string | null;
  agentNombre: string | null;
  sender: string;
  templateNombre: string;
  templateIdioma: string;
  mapeo: Mapeo;
  total: number;
}

/**
 * Registra el broadcast y deja las etiquetas creadas en Infobip. Los
 * destinatarios se agregan aparte en tandas (`agregarDestinatarios`) para no
 * chocar con el límite de tamaño de una server action.
 */
export async function crearBroadcast(input: CrearBroadcastInput): Promise<Result<{ id: number }>> {
  return safe(async () => {
    const user = await requireUser();
    const campana = input.campana.trim();
    if (!campana) throw new Error("Falta el nombre de la campaña.");
    if (!input.queueId) throw new Error("Falta la cola.");
    await validarLinea(input.sender);

    const plantilla = (await listTemplates(input.sender)).find(
      (t) => t.name === input.templateNombre && t.language === input.templateIdioma,
    );
    if (!plantilla) throw new Error("La plantilla no existe o ya no está aprobada para esta línea.");
    const noSoportada = motivoNoSoportada(plantilla);
    if (noSoportada) throw new Error(noSoportada);

    const { data, error } = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast" as any)
      .insert({
        creado_por: user.email ?? user.id,
        campana,
        queue_id: input.queueId,
        queue_nombre: input.queueNombre,
        agent_id: input.agentId,
        agent_nombre: input.agentNombre,
        sender: input.sender,
        template_nombre: plantilla.name,
        template_idioma: plantilla.language,
        template_variables: plantilla.variables,
        mapeo: input.mapeo,
        total: input.total,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(`No se pudo registrar el broadcast: ${error.message}`);

    // Best-effort: si la etiqueta no se puede crear, addTag fallará después
    // y quedará como advertencia en cada fila, sin frenar el envío.
    await Promise.all([ensureTag(TAG_BROADCAST), ensureTag(campana)]);

    return { id: (data as unknown as { id: number }).id };
  });
}

interface BroadcastRow {
  id: number;
  campana: string;
  queue_id: string;
  agent_id: string | null;
  sender: string;
  template_nombre: string;
  template_idioma: string;
  template_variables: number[];
  estado: string;
}

async function cargarBroadcast(id: number): Promise<BroadcastRow> {
  const { data, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("broadcast" as any)
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`Broadcast ${id} no encontrado.`);
  return data as unknown as BroadcastRow;
}

/** Inserta destinatarios en estado PENDIENTE y devuelve sus ids. */
export async function agregarDestinatarios(
  broadcastId: number,
  filas: DestinatarioInput[],
): Promise<Result<number[]>> {
  return safe(async () => {
    await requireUser();
    if (filas.length > MAX_INSERT) throw new Error(`Máximo ${MAX_INSERT} filas por tanda.`);
    const b = await cargarBroadcast(broadcastId);
    if (b.estado !== "EN_CURSO") throw new Error("El broadcast ya fue finalizado.");

    const rows = filas.map((f) => {
      const telefono = normalizarTelefono(f.telefono);
      if (!telefono) throw new Error(`Fila ${f.fila}: teléfono inválido (${f.telefono}).`);
      for (const n of b.template_variables) {
        if (!f.parametros[`{{${n}}}`]?.trim()) {
          throw new Error(`Fila ${f.fila}: falta el valor de {{${n}}}.`);
        }
      }
      return { broadcast_id: broadcastId, fila: f.fila, telefono, parametros: f.parametros };
    });

    const { data, error } = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast_destinatario" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(rows as any)
      .select("id");
    if (error) {
      if (error.message.includes("duplicate key")) {
        throw new Error("Hay teléfonos repetidos en el broadcast.");
      }
      throw new Error(error.message);
    }
    return ((data ?? []) as unknown as { id: number }[]).map((r) => r.id);
  });
}

// ==================== Envío ====================

interface DestinatarioRow {
  id: number;
  fila: number;
  telefono: string;
  parametros: Record<string, string>;
  estado: EstadoDestinatario;
  conversation_id: string | null;
  conversacion_reutilizada: boolean | null;
  error: string | null;
  advertencia: string | null;
}

function toResultado(r: DestinatarioRow): ResultadoDestinatario {
  return {
    id: r.id,
    fila: r.fila,
    telefono: r.telefono,
    estado: r.estado,
    conversationId: r.conversation_id,
    reutilizada: r.conversacion_reutilizada,
    error: r.error,
    advertencia: r.advertencia,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Última conversación conocida para (teléfono, línea). Infobip no permite
 * buscar conversaciones por teléfono, así que se usa el espejo que mantiene
 * InfobipExt (y este mismo broadcast) en `conversation_lead_relation`.
 */
async function buscarConversacionPrevia(telefono: string, sender: string): Promise<string | null> {
  const { data } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("conversation_lead_relation" as any)
    .select("infobip_conversation_id")
    .eq("telefono_contacto", telefono)
    .eq("sender", sender)
    .order("updated_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as unknown as { infobip_conversation_id: string } | undefined;
  return row?.infobip_conversation_id ?? null;
}

async function procesarDestinatario(b: BroadcastRow, d: DestinatarioRow): Promise<DestinatarioRow> {
  const advertencias: string[] = [];
  const fin = (
    estado: EstadoDestinatario,
    extra: Partial<DestinatarioRow> = {},
  ): DestinatarioRow => ({
    ...d,
    estado,
    advertencia: advertencias.length ? advertencias.join(" | ") : null,
    ...extra,
  });

  // 1. Reutilizar la conversación abierta con esta línea, o crear una nueva.
  let conversationId: string | null = null;
  let reutilizada = false;
  try {
    const previaId = await buscarConversacionPrevia(d.telefono, b.sender);
    const previa = previaId ? await getConversation(previaId) : null;
    if (previa && ESTADOS_REUTILIZABLES.has(previa.status)) {
      conversationId = previa.id;
      reutilizada = true;
      if (previa.queueId !== b.queue_id) {
        const r = await moveConversationQueue(previa.id, b.queue_id);
        if (!r.ok) {
          return fin("ERROR", {
            conversation_id: previa.id,
            conversacion_reutilizada: true,
            error: `No se pudo mover la conversación a la cola: ${r.error}`,
          });
        }
      }
    }
  } catch (e) {
    advertencias.push(`No se pudo revisar conversaciones previas: ${(e as Error).message}`);
  }

  if (!conversationId) {
    const r = await createConversation({
      queueId: b.queue_id,
      agentId: b.agent_id,
      topic: `Broadcast ${b.campana} · ${d.telefono}`,
    });
    if (!r.ok || !r.data?.id) {
      return fin("ERROR", { error: `No se pudo crear la conversación: ${r.error || "sin id"}` });
    }
    conversationId = r.data.id;
  } else if (b.agent_id) {
    const r = await assignConversation(conversationId, b.agent_id);
    if (!r.ok) {
      return fin("ERROR", {
        conversation_id: conversationId,
        conversacion_reutilizada: true,
        error: `No se pudo asignar al asesor: ${r.error}`,
      });
    }
  }

  // 2. Plantilla. Si falla, el mensaje no salió: ERROR (se puede reintentar).
  const envio = await sendTemplate({
    conversationId,
    from: b.sender,
    to: d.telefono,
    templateName: b.template_nombre,
    language: b.template_idioma,
    parameters: d.parametros,
    agentId: b.agent_id,
  });
  if (!envio.ok) {
    return fin("ERROR", {
      conversation_id: conversationId,
      conversacion_reutilizada: reutilizada,
      error: `Infobip rechazó la plantilla: ${envio.error}`,
    });
  }

  // 3. Desde aquí el mensaje ya salió: los fallos son solo advertencias.
  for (const tag of [TAG_BROADCAST, b.campana]) {
    const r = await addTag(conversationId, tag);
    if (!r.ok) advertencias.push(`Etiqueta "${tag}": ${r.error}`);
  }

  if (!reutilizada) {
    const { error } = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("conversation_lead_relation" as any)
      .upsert(
        {
          infobip_conversation_id: conversationId,
          telefono_contacto: d.telefono,
          sender: b.sender,
          updated_at: new Date().toISOString(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { onConflict: "infobip_conversation_id" },
      );
    if (error) advertencias.push(`No se registró en conversation_lead_relation: ${error.message}`);
  }

  return fin("OK", {
    conversation_id: conversationId,
    conversacion_reutilizada: reutilizada,
    error: null,
  });
}

/**
 * Procesa un lote de destinatarios. Cada fila se "reclama" pasando de
 * PENDIENTE a ENVIANDO de forma atómica: si el mismo lote llega dos veces
 * (reintento del navegador, doble click) la segunda vez no reenvía nada.
 */
export async function enviarLote(
  broadcastId: number,
  ids: number[],
): Promise<Result<ResultadoDestinatario[]>> {
  return safe(async () => {
    await requireUser();
    if (ids.length > MAX_LOTE) throw new Error(`Máximo ${MAX_LOTE} destinatarios por lote.`);
    const b = await cargarBroadcast(broadcastId);

    const { data, error } = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast_destinatario" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ estado: "ENVIANDO", updated_at: new Date().toISOString() } as any)
      .eq("broadcast_id", broadcastId)
      .eq("estado", "PENDIENTE")
      .in("id", ids)
      .select("*");
    if (error) throw new Error(error.message);
    const reclamadas = (data ?? []) as unknown as DestinatarioRow[];

    const resultados = await mapLimit(reclamadas, CONCURRENCIA, async (d) => {
      let r: DestinatarioRow;
      try {
        r = await procesarDestinatario(b, d);
      } catch (e) {
        // Error inesperado: no sabemos si la plantilla salió, así que la fila
        // queda en ENVIANDO (no reintentable automáticamente) con el detalle.
        r = { ...d, estado: "ENVIANDO", error: `Error inesperado: ${(e as Error).message}` };
      }
      await db()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("broadcast_destinatario" as any)
        .update({
          estado: r.estado,
          conversation_id: r.conversation_id,
          conversacion_reutilizada: r.conversacion_reutilizada,
          error: r.error,
          advertencia: r.advertencia,
          updated_at: new Date().toISOString(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .eq("id", d.id);
      return toResultado(r);
    });

    return resultados;
  });
}

/** Devuelve a PENDIENTE las filas en ERROR (la plantilla no salió) y sus ids. */
export async function reintentarFallidos(broadcastId: number): Promise<Result<number[]>> {
  return safe(async () => {
    await requireUser();
    const { data, error } = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast_destinatario" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ estado: "PENDIENTE", error: null, updated_at: new Date().toISOString() } as any)
      .eq("broadcast_id", broadcastId)
      .eq("estado", "ERROR")
      .select("id");
    if (error) throw new Error(error.message);
    await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ estado: "EN_CURSO", updated_at: new Date().toISOString() } as any)
      .eq("id", broadcastId);
    return ((data ?? []) as unknown as { id: number }[]).map((r) => r.id);
  });
}

async function contar(broadcastId: number, estado: EstadoDestinatario): Promise<number> {
  const { count, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("broadcast_destinatario" as any)
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("estado", estado);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Recalcula los contadores del broadcast y lo cierra si no queda nada pendiente. */
export async function finalizarBroadcast(
  broadcastId: number,
): Promise<Result<{ ok: number; error: number; pendientes: number; sinConfirmar: number }>> {
  return safe(async () => {
    await requireUser();
    const [ok, error, pendientes, sinConfirmar] = await Promise.all([
      contar(broadcastId, "OK"),
      contar(broadcastId, "ERROR"),
      contar(broadcastId, "PENDIENTE"),
      contar(broadcastId, "ENVIANDO"),
    ]);
    await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast" as any)
      .update({
        enviados: ok,
        fallidos: error,
        estado: pendientes === 0 ? "FINALIZADO" : "EN_CURSO",
        updated_at: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", broadcastId);
    return { ok, error, pendientes, sinConfirmar };
  });
}
