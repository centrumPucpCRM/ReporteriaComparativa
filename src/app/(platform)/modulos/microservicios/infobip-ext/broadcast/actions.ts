"use server";

import { requireUser } from "@/components/data-table/createTableActions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addTag,
  assignConversation,
  createConversation,
  ensureTag,
  findTemplateMessageId,
  getConversation,
  getDeliveryStatus,
  listAgents,
  listQueues,
  listTemplates,
  moveConversationQueue,
  sendTemplate,
  type ConversationInfo,
} from "@/lib/infobip";
import {
  describirErrorEntrega,
  motivoNoSoportada,
  normalizarTelefono,
  type AgentInfo,
  type DestinatarioInput,
  type EstadoDestinatario,
  type EstadoEntrega,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  created_at: string;
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
  message_id: string | null;
  entrega: EstadoEntrega | null;
  entrega_detalle: string | null;
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
    entrega: r.entrega,
    entregaDetalle: r.entrega_detalle,
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

// ==================== Resolución de conversación ====================
//
// Infobip no permite buscar conversaciones por teléfono (ni el listado ni el
// detalle tienen ese filtro), así que el broadcast lleva su propio registro en
// `broadcast_conversacion`: una fila por conversación con su estado. Un índice
// único parcial permite UNA sola fila no CERRADA por (teléfono, número
// Infobip): si dos broadcasts llegan a la vez al mismo contacto, solo uno
// consigue la reserva CREANDO y el otro espera y reutiliza la conversación.

/** Una reserva CREANDO más vieja que esto quedó huérfana (proceso caído). */
const RESERVA_VENCIDA_MS = 2 * 60 * 1000;
/** Cuánto espera un lote a que otro broadcast termine de crear la conversación. */
const ESPERA_RESERVA_MS = 15_000;
/** Conversaciones de venta activa a revisar por par (más recientes primero). */
const CANDIDATOS_VENTA_ACTIVA = 5;

interface RegistroConversacion {
  id: number;
  conversation_id: string | null;
  estado: "CREANDO" | "ACTIVA" | "CERRADA";
  updated_at: string;
}

type Resolucion =
  | { tipo: "reutilizar"; conversation: ConversationInfo }
  | { tipo: "crear"; registroId: number }
  | { tipo: "error"; error: string };

function tabla(nombre: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db().from(nombre as any);
}

async function registroActivo(telefono: string, sender: string): Promise<RegistroConversacion | null> {
  const { data, error } = await tabla("broadcast_conversacion")
    .select("id, conversation_id, estado, updated_at")
    .eq("telefono", telefono)
    .eq("sender", sender)
    .neq("estado", "CERRADA")
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as unknown as RegistroConversacion) ?? null;
}

async function marcarCerrada(registroId: number) {
  const ahora = new Date().toISOString();
  await tabla("broadcast_conversacion")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ estado: "CERRADA", cerrada_at: ahora, updated_at: ahora } as any)
    .eq("id", registroId)
    .neq("estado", "CERRADA");
}

/** Inserta un registro; `conflicto` = otro proceso ganó la carrera (índice único). */
async function insertarRegistro(
  row: Record<string, unknown>,
): Promise<{ ok: true; id: number } | { ok: false; conflicto: boolean; error: string }> {
  const { data, error } = await tabla("broadcast_conversacion")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(row as any)
    .select("id")
    .single();
  if (error) {
    const conflicto = error.code === "23505" || error.message.includes("duplicate key");
    return { ok: false, conflicto, error: error.message };
  }
  return { ok: true, id: (data as unknown as { id: number }).id };
}

/** Últimas conversaciones de venta activa del par, sin las ya marcadas CERRADA. */
async function candidatosVentaActiva(telefono: string, sender: string): Promise<string[]> {
  const { data, error } = await tabla("conversation_lead_relation")
    .select("infobip_conversation_id")
    .eq("telefono_contacto", telefono)
    .eq("sender", sender)
    .order("updated_at", { ascending: false })
    .limit(CANDIDATOS_VENTA_ACTIVA);
  if (error) throw new Error(error.message);
  const ids = [
    ...new Set(
      ((data ?? []) as unknown as { infobip_conversation_id: string | null }[])
        .map((r) => r.infobip_conversation_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return [];
  const { data: cerradas } = await tabla("broadcast_conversacion")
    .select("conversation_id")
    .in("conversation_id", ids)
    .eq("estado", "CERRADA");
  const yaCerradas = new Set(((cerradas ?? []) as unknown as { conversation_id: string }[]).map((r) => r.conversation_id));
  return ids.filter((id) => !yaCerradas.has(id));
}

/**
 * Decide qué conversación usar para (teléfono, número Infobip):
 * 1. Si hay un registro ACTIVA, se verifica en vivo en Infobip: abierta →
 *    se reutiliza; cerrada → se marca CERRADA y no se vuelve a consultar.
 * 2. Si hay una reserva CREANDO de otro broadcast, se espera a que termine.
 * 3. Si no hay registro, se revisan las de venta activa (conversation_lead_relation):
 *    la primera abierta se reutiliza; las cerradas quedan marcadas CERRADA.
 * 4. Si no hay ninguna abierta, se toma la reserva CREANDO para crear una nueva.
 */
async function resolverConversacion(telefono: string, b: BroadcastRow): Promise<Resolucion> {
  const inicio = Date.now();
  const ahora = () => new Date().toISOString();

  for (let intento = 0; intento < 12; intento++) {
    const reg = await registroActivo(telefono, b.sender);

    if (reg?.estado === "CREANDO") {
      if (Date.now() - new Date(reg.updated_at).getTime() > RESERVA_VENCIDA_MS) {
        await marcarCerrada(reg.id);
        continue;
      }
      if (Date.now() - inicio > ESPERA_RESERVA_MS) {
        return {
          tipo: "error",
          error: "Otro broadcast está creando la conversación de este contacto en este momento. Reintenta en unos minutos.",
        };
      }
      await sleep(2000);
      continue;
    }

    if (reg?.estado === "ACTIVA" && reg.conversation_id) {
      const r = await getConversation(reg.conversation_id);
      if (r.ok && r.data && ESTADOS_REUTILIZABLES.has(r.data.status)) {
        return { tipo: "reutilizar", conversation: r.data };
      }
      if ((r.ok && r.data) || r.status === 404) {
        // CLOSED, o ya no existe en Infobip: no volver a consultarla.
        await marcarCerrada(reg.id);
        continue;
      }
      return { tipo: "error", error: `No se pudo verificar en Infobip la conversación existente: ${r.error}` };
    }

    // Sin registro propio: revisar conversaciones de venta activa.
    let abierta: ConversationInfo | null = null;
    for (const id of await candidatosVentaActiva(telefono, b.sender)) {
      const r = await getConversation(id);
      if (r.ok && r.data && ESTADOS_REUTILIZABLES.has(r.data.status)) {
        abierta = r.data;
        break;
      }
      if ((r.ok && r.data) || r.status === 404) {
        await insertarRegistro({
          telefono,
          sender: b.sender,
          conversation_id: id,
          estado: "CERRADA",
          origen: "VENTA_ACTIVA",
          cerrada_at: ahora(),
        });
        continue;
      }
      return { tipo: "error", error: `No se pudo verificar en Infobip una conversación previa: ${r.error}` };
    }

    if (abierta) {
      const ins = await insertarRegistro({
        telefono,
        sender: b.sender,
        conversation_id: abierta.id,
        estado: "ACTIVA",
        origen: "VENTA_ACTIVA",
        queue_id: abierta.queueId,
        broadcast_id: b.id,
      });
      if (ins.ok) return { tipo: "reutilizar", conversation: abierta };
      if (ins.conflicto) continue; // otro proceso registró el par mientras tanto
      return { tipo: "error", error: `No se pudo registrar la conversación: ${ins.error}` };
    }

    const reserva = await insertarRegistro({
      telefono,
      sender: b.sender,
      estado: "CREANDO",
      origen: "BROADCAST",
      queue_id: b.queue_id,
      broadcast_id: b.id,
    });
    if (reserva.ok) return { tipo: "crear", registroId: reserva.id };
    if (reserva.conflicto) continue;
    return { tipo: "error", error: `No se pudo reservar la conversación: ${reserva.error}` };
  }
  return { tipo: "error", error: "No se pudo resolver la conversación del contacto (demasiados reintentos)." };
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

  // 1. Reutilizar la conversación abierta con este número Infobip, o crear una nueva.
  const res = await resolverConversacion(d.telefono, b);
  if (res.tipo === "error") return fin("ERROR", { error: res.error });

  let conversationId: string;
  const reutilizada = res.tipo === "reutilizar";

  if (res.tipo === "reutilizar") {
    conversationId = res.conversation.id;
    if (res.conversation.queueId !== b.queue_id) {
      const r = await moveConversationQueue(conversationId, b.queue_id);
      if (!r.ok) {
        return fin("ERROR", {
          conversation_id: conversationId,
          conversacion_reutilizada: true,
          error: `No se pudo mover la conversación a la cola: ${r.error}`,
        });
      }
    }
    if (b.agent_id && res.conversation.agentId !== b.agent_id) {
      const r = await assignConversation(conversationId, b.agent_id);
      if (!r.ok) {
        return fin("ERROR", {
          conversation_id: conversationId,
          conversacion_reutilizada: true,
          error: `No se pudo asignar al asesor: ${r.error}`,
        });
      }
    }
  } else {
    const r = await createConversation({
      queueId: b.queue_id,
      agentId: b.agent_id,
      topic: `Broadcast ${b.campana} · ${d.telefono}`,
    });
    if (!r.ok || !r.data?.id) {
      // Liberar la reserva para que un reintento pueda volver a intentarlo.
      await tabla("broadcast_conversacion").delete().eq("id", res.registroId).eq("estado", "CREANDO");
      return fin("ERROR", { error: `No se pudo crear la conversación: ${r.error || "sin id"}` });
    }
    conversationId = r.data.id;
    // Desde aquí la conversación existe: si la plantilla falla, un reintento
    // la reutiliza en vez de crear otra.
    const { error } = await tabla("broadcast_conversacion")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ conversation_id: conversationId, estado: "ACTIVA", updated_at: new Date().toISOString() } as any)
      .eq("id", res.registroId);
    if (error) advertencias.push(`No se registró la conversación creada: ${error.message}`);
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

  // "OK" = Infobip aceptó el mensaje. Si WhatsApp lo entrega o no (p. ej. Meta
  // lo bloquea por frecuencia, 7032) se sabe después: `verificarEntregas`.
  return fin("OK", {
    conversation_id: conversationId,
    conversacion_reutilizada: reutilizada,
    error: null,
    message_id: envio.data?.id ?? null,
    entrega: "PENDIENTE",
    entrega_detalle: null,
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
          message_id: r.message_id ?? null,
          entrega: r.entrega ?? null,
          updated_at: new Date().toISOString(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .eq("id", d.id);
      return toResultado(r);
    });

    // Contadores al día después de cada lote: el historial los muestra en vivo
    // y `updated_at` sirve para saber si el envío sigue activo.
    await actualizarContadores(broadcastId);
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

async function contarEntrega(broadcastId: number, entrega: EstadoEntrega): Promise<number> {
  const { count, error } = await tabla("broadcast_destinatario")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("estado", "OK")
    .eq("entrega", entrega);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function calcularConteos(broadcastId: number): Promise<ConteoEstados> {
  const [ok, error, pendientes, sinConfirmar, entregados, noEntregados, entregaPendiente] = await Promise.all([
    contar(broadcastId, "OK"),
    contar(broadcastId, "ERROR"),
    contar(broadcastId, "PENDIENTE"),
    contar(broadcastId, "ENVIANDO"),
    contarEntrega(broadcastId, "ENTREGADO"),
    contarEntrega(broadcastId, "NO_ENTREGADO"),
    contarEntrega(broadcastId, "PENDIENTE"),
  ]);
  return { ok, error, pendientes, sinConfirmar, entregados, noEntregados, entregaPendiente };
}

/** Recalcula los contadores del broadcast y lo cierra si no queda nada pendiente. */
async function actualizarContadores(broadcastId: number): Promise<ConteoEstados> {
  const c = await calcularConteos(broadcastId);
  await tabla("broadcast")
    .update({
      enviados: c.ok,
      fallidos: c.error,
      entregados: c.entregados,
      no_entregados: c.noEntregados,
      estado: c.pendientes === 0 ? "FINALIZADO" : "EN_CURSO",
      updated_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", broadcastId);
  return c;
}

// ==================== Entrega ====================

/** Filas por llamada a `verificarEntregas` (y ids por consulta a los logs). */
const MAX_VERIFICAR = 200;
const IDS_POR_LOG = 50;
const GRUPOS_NO_ENTREGADO = new Set(["UNDELIVERABLE", "EXPIRED", "REJECTED"]);

/**
 * Consulta en los logs de Infobip qué pasó con los mensajes ya aceptados
 * (entrega PENDIENTE) y guarda ENTREGADO / NO_ENTREGADO con el motivo.
 * No toca `updated_at` del broadcast: eso marca actividad de envío.
 */
export async function verificarEntregas(
  broadcastId: number,
): Promise<Result<{ actualizados: ResultadoDestinatario[]; pendientes: number }>> {
  return safe(async () => {
    await requireUser();
    const b = await cargarBroadcast(broadcastId);

    const { data, error } = await tabla("broadcast_destinatario")
      .select("*")
      .eq("broadcast_id", broadcastId)
      .eq("estado", "OK")
      .eq("entrega", "PENDIENTE")
      .order("fila", { ascending: true })
      .limit(MAX_VERIFICAR);
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as unknown as DestinatarioRow[];

    // Envíos anteriores a guardar el id: buscarlo en la conversación.
    await mapLimit(
      filas.filter((f) => !f.message_id && f.conversation_id),
      CONCURRENCIA,
      async (f) => {
        const mid = await findTemplateMessageId(f.conversation_id!, b.template_nombre, b.created_at);
        if (!mid) return;
        f.message_id = mid;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tabla("broadcast_destinatario").update({ message_id: mid } as any).eq("id", f.id);
      },
    );

    const conId = filas.filter((f) => f.message_id);
    const estados: Awaited<ReturnType<typeof getDeliveryStatus>> = new Map();
    for (let i = 0; i < conId.length; i += IDS_POR_LOG) {
      const parte = await getDeliveryStatus(conId.slice(i, i + IDS_POR_LOG).map((f) => f.message_id!));
      for (const [k, v] of parte) estados.set(k, v);
    }

    const actualizados: ResultadoDestinatario[] = [];
    await mapLimit(conId, CONCURRENCIA, async (f) => {
      const e = estados.get(f.message_id!);
      if (!e) return; // todavía no aparece en los logs
      let entrega: EstadoEntrega;
      let detalle: string | null = null;
      if (e.grupo === "DELIVERED") {
        entrega = "ENTREGADO";
      } else if (GRUPOS_NO_ENTREGADO.has(e.grupo)) {
        entrega = "NO_ENTREGADO";
        detalle = describirErrorEntrega(e.errorId, e.errorNombre, e.errorDescripcion);
      } else {
        return; // PENDING: sigue en camino
      }
      const ahora = new Date().toISOString();
      await tabla("broadcast_destinatario")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ entrega, entrega_detalle: detalle, entrega_at: ahora } as any)
        .eq("id", f.id);
      actualizados.push(toResultado({ ...f, entrega, entrega_detalle: detalle }));
    });

    const c = await calcularConteos(broadcastId);
    await tabla("broadcast")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ entregados: c.entregados, no_entregados: c.noEntregados } as any)
      .eq("id", broadcastId);
    return { actualizados, pendientes: c.entregaPendiente };
  });
}

export async function finalizarBroadcast(broadcastId: number): Promise<Result<ConteoEstados>> {
  return safe(async () => {
    await requireUser();
    return actualizarContadores(broadcastId);
  });
}

// ==================== Historial ====================

export interface ConteoEstados {
  ok: number;
  error: number;
  pendientes: number;
  sinConfirmar: number;
  /** De los OK: qué hizo WhatsApp con el mensaje. */
  entregados: number;
  noEntregados: number;
  entregaPendiente: number;
}

export interface BroadcastResumen {
  id: number;
  created_at: string;
  updated_at: string;
  creado_por: string | null;
  campana: string;
  queue_id: string;
  queue_nombre: string | null;
  agent_nombre: string | null;
  sender: string;
  template_nombre: string;
  template_idioma: string;
  total: number;
  enviados: number;
  fallidos: number;
  entregados: number;
  no_entregados: number;
  estado: string;
  /** Categoría de la plantilla en Infobip (null si no se pudo consultar). */
  template_categoria: string | null;
}

/**
 * Categoría (MARKETING, UTILITY...) de la plantilla de cada broadcast, para
 * estimar el costo. Una consulta a Infobip por línea distinta; si falla, la
 * categoría queda null y el historial se muestra igual, sin costo.
 */
async function categoriasDePlantillas(
  items: { sender: string; template_nombre: string; template_idioma: string }[],
): Promise<(string | null)[]> {
  const porSender = new Map<string, Promise<Map<string, string>>>();
  for (const sender of new Set(items.map((i) => i.sender))) {
    porSender.set(
      sender,
      listTemplates(sender)
        .then((ts) => new Map(ts.map((t) => [`${t.name}|${t.language}`, t.category])))
        .catch(() => new Map<string, string>()),
    );
  }
  return Promise.all(
    items.map(async (i) => (await porSender.get(i.sender)!).get(`${i.template_nombre}|${i.template_idioma}`) ?? null),
  );
}

export async function listarBroadcasts(params: {
  page: number;
  pageSize: number;
  busqueda?: string;
}): Promise<Result<{ rows: BroadcastResumen[]; total: number }>> {
  return safe(async () => {
    await requireUser();
    let q = db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast" as any)
      .select(
        "id, created_at, updated_at, creado_por, campana, queue_id, queue_nombre, agent_nombre, sender, template_nombre, template_idioma, total, enviados, fallidos, entregados, no_entregados, estado",
        { count: "exact" },
      )
      .order("id", { ascending: false });
    const b = params.busqueda?.trim().replace(/[%,()]/g, " ");
    if (b) {
      q = q.or(
        `campana.ilike.%${b}%,template_nombre.ilike.%${b}%,queue_nombre.ilike.%${b}%,agent_nombre.ilike.%${b}%,creado_por.ilike.%${b}%`,
      );
    }
    const from = (params.page - 1) * params.pageSize;
    const { data, count, error } = await q.range(from, from + params.pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as BroadcastResumen[];
    const categorias = await categoriasDePlantillas(rows);
    return {
      rows: rows.map((r, i) => ({ ...r, template_categoria: categorias[i] })),
      total: count ?? 0,
    };
  });
}

export async function obtenerBroadcast(
  broadcastId: number,
): Promise<Result<{ broadcast: BroadcastResumen & { template_variables: number[]; mapeo: Mapeo | null }; conteo: ConteoEstados }>> {
  return safe(async () => {
    await requireUser();
    const [{ data, error }, conteo] = await Promise.all([
      tabla("broadcast").select("*").eq("id", broadcastId).single(),
      calcularConteos(broadcastId),
    ]);
    if (error || !data) throw new Error(`Broadcast ${broadcastId} no encontrado.`);
    const broadcast = data as unknown as BroadcastResumen & { template_variables: number[]; mapeo: Mapeo | null };
    const [categoria] = await categoriasDePlantillas([broadcast]);
    return { broadcast: { ...broadcast, template_categoria: categoria }, conteo };
  });
}

export type FiltroDestinatario = EstadoDestinatario | "ADVERTENCIA" | "NO_ENTREGADO" | "TODOS";

export async function listarDestinatarios(params: {
  broadcastId: number;
  filtro: FiltroDestinatario;
  telefono?: string;
  page: number;
  pageSize: number;
}): Promise<Result<{ rows: (ResultadoDestinatario & { parametros: Record<string, string> })[]; total: number }>> {
  return safe(async () => {
    await requireUser();
    let q = db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("broadcast_destinatario" as any)
      .select("*", { count: "exact" })
      .eq("broadcast_id", params.broadcastId)
      .order("fila", { ascending: true });
    if (params.filtro === "ADVERTENCIA") q = q.not("advertencia", "is", null);
    else if (params.filtro === "NO_ENTREGADO") q = q.eq("entrega", "NO_ENTREGADO");
    else if (params.filtro !== "TODOS") q = q.eq("estado", params.filtro);
    const tel = params.telefono?.replace(/\D/g, "");
    if (tel) q = q.ilike("telefono", `%${tel}%`);
    const from = (params.page - 1) * params.pageSize;
    const { data, count, error } = await q.range(from, from + params.pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as DestinatarioRow[]).map((r) => ({
      ...toResultado(r),
      parametros: r.parametros ?? {},
    }));
    return { rows, total: count ?? 0 };
  });
}

/** Ids de filas aún PENDIENTE, para continuar un envío que quedó a medias. */
export async function idsPendientes(broadcastId: number): Promise<Result<number[]>> {
  return safe(async () => {
    await requireUser();
    const ids: number[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("broadcast_destinatario" as any)
        .select("id")
        .eq("broadcast_id", broadcastId)
        .eq("estado", "PENDIENTE")
        .order("fila", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as { id: number }[];
      ids.push(...page.map((r) => r.id));
      if (page.length < 1000) break;
    }
    return ids;
  });
}

/** Todas las filas del broadcast para descargar como CSV. */
export async function exportarDestinatarios(
  broadcastId: number,
): Promise<Result<(ResultadoDestinatario & { parametros: Record<string, string> })[]>> {
  return safe(async () => {
    await requireUser();
    const out: (ResultadoDestinatario & { parametros: Record<string, string> })[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("broadcast_destinatario" as any)
        .select("*")
        .eq("broadcast_id", broadcastId)
        .order("fila", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as DestinatarioRow[];
      out.push(...page.map((r) => ({ ...toResultado(r), parametros: r.parametros ?? {} })));
      if (page.length < 1000) break;
    }
    return out;
  });
}
