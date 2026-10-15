-- Estado de ENTREGA real de cada mensaje del broadcast (WhatsApp lo resuelve
-- unos segundos después de que Infobip acepta el envío; p. ej. Meta puede
-- bloquearlo por límite de frecuencia de marketing, error 7032).
-- Ejecutar una sola vez en Supabase → SQL Editor.

alter table "Infobip_ext".broadcast_destinatario
  add column if not exists message_id      text,
  -- PENDIENTE | ENTREGADO | NO_ENTREGADO (null = aún no se envió)
  add column if not exists entrega         text,
  add column if not exists entrega_detalle text,
  add column if not exists entrega_at      timestamptz;

alter table "Infobip_ext".broadcast
  add column if not exists entregados    int not null default 0,
  add column if not exists no_entregados int not null default 0;

create index if not exists broadcast_destinatario_broadcast_entrega_idx
  on "Infobip_ext".broadcast_destinatario (broadcast_id, entrega);

-- Los OK ya enviados quedan pendientes de verificar.
update "Infobip_ext".broadcast_destinatario
   set entrega = 'PENDIENTE'
 where estado = 'OK' and entrega is null;
