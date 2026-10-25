/**
 * Tipos y constantes compartidos (UI + server) del módulo Eloqua → Oracle.
 *
 * El procesamiento real ocurre en el servicio del EC2 (IntegracionEloquaOracleSalesCloud);
 * esta app solo lee y escribe el estado en Supabase (schemas `Eloqua_oracle` / `Eloqua_oracle_test`)
 * y hace de puente HTTPS para el webhook de Eloqua. Estos tipos reflejan
 * `IntegracionEloquaOracleSalesCloud/sql/001_eloqua_oracle.sql`.
 */

export type Ambiente = "prod" | "test" | "demo";

export const AMBIENTES: { id: Ambiente; label: string }[] = [
  { id: "prod", label: "Prod" },
  { id: "test", label: "Test" },
  { id: "demo", label: "Demo" },
];

export const SCHEMA_POR_AMBIENTE: Record<Exclude<Ambiente, "demo">, string> = {
  prod: "Eloqua_oracle",
  test: "Eloqua_oracle_test",
};

export const COOKIE_AMBIENTE = "eloqua_oracle_ambiente";

/**
 * EN_ESPERA = identidad no coincide: se notificó al cliente y se espera su corrección (no bloquea la cola).
 * SIN_CONTACTO = ni el correo ni el teléfono son válidos: se guarda en "Ningún campo válido" y sale de la cola.
 */
export type EstadoSolicitud = "PENDIENTE" | "EN_PROCESO" | "OK" | "PARCIAL" | "ERROR" | "EN_ESPERA" | "SIN_CONTACTO" | "DESCARTADO";
export type EstadoPrograma = "PENDIENTE" | "EN_PROCESO" | "OK" | "ERROR";
export type ResultadoEvento = "OK" | "ERROR" | "OMITIDO";
export type TipoError = "VALIDACION" | "TEMPORAL" | "PERMANENTE" | "AUTENTICACION";

/**
 * Pasos del flujo, en orden. `nivel` = si corre una vez por solicitud o una vez por programa.
 * Alcance: el servicio solo crea o actualiza el lead y lo que pasa "cuando entra un lead"
 * (RDV, actividad, prioridad, conversación Infobip). Los pasos opcionales quedan OMITIDO
 * cuando Eloqua no manda los datos (p. ej. datos de admisión) o la respuesta no los pide.
 */
export const PASOS = [
  { id: "VALIDAR", label: "Validar", nivel: "solicitud" },
  { id: "VALIDAR_CORREO", label: "Validar correo", nivel: "solicitud" },
  { id: "VALIDAR_TELEFONO", label: "Validar teléfono", nivel: "solicitud" },
  { id: "CONTACTO_VALIDO", label: "¿Correo o teléfono válido?", nivel: "solicitud" },
  { id: "SIN_CONTACTO_VALIDO", label: "Ningún campo válido", nivel: "solicitud" },
  { id: "VALIDAR_DNI", label: "Validar DNI", nivel: "solicitud" },
  { id: "DNI_EXTRANJERO_ORACLE", label: "¿Extranjero en Oracle?", nivel: "solicitud" },
  { id: "BUSCAR_DNI_POR_NOMBRE", label: "Buscar DNI por nombre", nivel: "solicitud" },
  { id: "CONFIRMAR_DNI_ORACLE", label: "¿Alguno ≥75% en Oracle?", nivel: "solicitud" },
  { id: "NOTIFICAR_DNI", label: "Notificar al cliente", nivel: "solicitud" },
  { id: "TIENE_RUC", label: "¿Tiene RUC?", nivel: "solicitud" },
  { id: "VALIDAR_RUC", label: "Validar RUC", nivel: "solicitud" },
  { id: "BUSCAR_RUC_POR_NOMBRE", label: "Buscar RUC por empresa", nivel: "solicitud" },
  { id: "CONFIRMAR_RUC_ORACLE", label: "¿Alguno ≥75% en Oracle?", nivel: "solicitud" },
  { id: "NOTIFICAR_RUC", label: "Notificar al cliente", nivel: "solicitud" },
  { id: "ES_CORRECCION", label: "¿Es corrección?", nivel: "solicitud" },
  { id: "DESATORAR_ORIGINAL", label: "Desatorar la original", nivel: "solicitud" },
  { id: "BUSCAR_CONTACTO", label: "Buscar contacto por DNI", nivel: "solicitud" },
  { id: "CREAR_CONTACTO", label: "Crear contacto", nivel: "solicitud" },
  { id: "UNIFICAR_CONTACTOS", label: "Unificar duplicados", nivel: "solicitud" },
  { id: "ACTUALIZAR_CONTACTO", label: "Actualizar contacto", nivel: "solicitud" },
  { id: "EXISTE_LEAD", label: "¿Existe lead?", nivel: "programa" },
  { id: "OBTENER_RDV", label: "Obtener RDV", nivel: "programa" },
  { id: "CREAR_LEAD", label: "Crear lead", nivel: "programa" },
  { id: "CREAR_ACTIVIDAD", label: "Actividad del lead", nivel: "programa" },
  { id: "PRIORIDAD", label: "Tabla de prioridad", nivel: "programa" },
  { id: "INFOBIP_PERSONA", label: "Infobip · persona", nivel: "programa" },
  { id: "INFOBIP_CONVERSACION", label: "Infobip · conversación", nivel: "programa" },
  { id: "INFOBIP_PLANTILLA", label: "Infobip · plantilla WhatsApp", nivel: "programa" },
  { id: "INFOBIP_VINCULAR", label: "Infobip · vincular lead", nivel: "programa" },
  { id: "INFOBIP_ETIQUETAS", label: "Infobip · notas y etiquetas", nivel: "programa" },
  { id: "ACTUALIZAR_LEAD", label: "Actualizar lead", nivel: "programa" },
  { id: "NOTIFICAR_CORREO", label: "Notificar por correo", nivel: "solicitud" },
  { id: "FINALIZAR", label: "Finalizar", nivel: "solicitud" },
] as const;

/**
 * Contrato del payload de Eloqua (propuesta). Las llaves son los mismos atributos del
 * contacto que Eloqua escribe hoy en Oracle y lee el trigger `ELOQUA_AntesDeActualizarContacto`,
 * así el mapeo en Eloqua casi no cambia. `lead` = atributo del Lead donde termina el valor.
 */
export const CAMPOS_ELOQUA = {
  identidad: [
    { llave: "dni", obligatorio: true, nota: "PersonDEO_CTRNrodedocumento_c del contacto" },
    { llave: "FirstName", obligatorio: false, nota: "Para crear el contacto si no existe" },
    { llave: "LastName", obligatorio: false, nota: "Para crear el contacto si no existe" },
    { llave: "EmailAddress", obligatorio: false, nota: "Se prueba; solo se escribe en el contacto (crear o actualizar) si es válido" },
    { llave: "MobileNumber", obligatorio: false, nota: "Se prueba con un mensaje; solo se escribe en el contacto (crear o actualizar) si es válido" },
    { llave: "ruc", obligatorio: false, nota: "Solo si el formulario pide RUC: se valida contra la base de RUC (nombre de llave por confirmar)" },
    { llave: "empresa", obligatorio: false, nota: "Razón social; se usa para buscar el RUC si viene inválido (nombre de llave por confirmar)" },
  ],
  programa: [
    { llave: "CTRSalesPrograma_c", obligatorio: true, nota: "Código(s) CRM del programa, separados por ::" },
    { llave: "CTREloquaRDV_c", obligatorio: false, nota: "RDV sugerido; igual se llama a la regla de venta" },
    { llave: "CTRTipoDeAccion_c", obligatorio: false, nota: "Default TR_MARKETING" },
  ],
  lead: [
    { llave: "CTREloquaFechaDeCharla_c", lead: "CTRFechaCharla_c" },
    { llave: "CTREloquaTipoDeFormulario_c", lead: "CTREloquaOPFormulario_c", nota: "Default MASINFO" },
    { llave: "EloquaUTMCampaignSource_c", lead: "CTRUTMCampaignSource_c" },
    { llave: "EloquaUTMCampaignMedium_c", lead: "CTRUTMCampaignMedium_c" },
    { llave: "EloquaUTMCampaignName_c", lead: "CTRUTMCampaignName_c" },
    { llave: "EloquaFuente_c", lead: "CTRFuente_c", nota: "Origen, nivel 1: PAUTA, PÁGINA WEB, ORGÁNICO… También va en el asunto del correo al cliente (llave por confirmar)" },
    { llave: "EloquaDetalle_c", lead: "CTRDetalleDeFuente_c", nota: "Origen, nivel 2: el detalle de la fuente (p. ej. si es PAUTA: TikTok, Instagram…). También va en el asunto (llave por confirmar)" },
    { llave: "CTRObservacion_c", lead: "CTRObservacionesActiv_c" },
    { llave: "EloquaAsistenciaACharla_c", lead: "CTRAsistoACharla_c", nota: "Y/N, default N" },
    { llave: "EloquaImpactadoPorCallCenter_c", lead: "CTRContactadoPorCallCenter_c", nota: "Y/N, default N" },
    { llave: "CTRTipoDeVentaLead_c", lead: "CTRTipoDeVenta_c", nota: "Default VENTA_NACIONAL" },
    { llave: "EloquaEspecializacionDelPrograma_c", lead: "CTREspecializacionDelPrograma_c" },
    { llave: "EloquaPaisLead_c", lead: "CTRPaisLead_c" },
  ],
  admision: [
    { llave: "CTRCorreoEloqua_c", nota: "Correo alterno (solo si tipo de formulario = ADMISION)" },
    { llave: "CTREspecialidad_c", nota: "Info académica" },
    { llave: "CTRGradoacademico_c" },
    { llave: "CTRInstitucionAcademica_c" },
    { llave: "CTRAnioMesquefinalizoEstuSupe_c" },
  ],
} as const;

/**
 * Lo que calcula el servicio y se envía a Oracle (no viene de Eloqua). Nombres de campo por confirmar
 * con César. Correo/teléfono: marca en el contacto y en el lead. Identidad: marca en el contacto y,
 * una vez en Y, Oracle bloquea la edición de DNI y nombre (y RUC / razón social) — eso se configura en
 * Oracle (Application Composer), el servicio solo escribe la marca y respeta el bloqueo.
 */
export const CAMPOS_CALCULADOS = [
  { llave: "correo_valido", lead: "CTRCorreoValido_c (por confirmar)", nota: "true si el correo pasó la prueba (sintaxis, dominio con MX y buzón que acepta); si no, false" },
  { llave: "telefono_valido", lead: "CTRTelefonoValido_c (por confirmar)", nota: "true si el mensaje de prueba se entregó; si no se entregó o no hay celular, false" },
  { llave: "dni_validado", lead: "CTRDniValidado_c (contacto, por confirmar)", nota: "Y si el DNI pasó la validación (directo o encontrado por nombre ≥75%). Bloquea el DNI en Oracle. No se marca si se saltó la regla (extranjero)" },
  { llave: "nombre_validado", lead: "CTRNombreValidado_c (contacto, por confirmar)", nota: "Y si nombres y apellidos son los oficiales del servicio de identidad. Bloquea nombres y apellidos en Oracle" },
  { llave: "ruc_validado", lead: "CTRRucValidado_c (por confirmar)", nota: "Y si el RUC y la razón social pasaron la validación. Los bloquea en Oracle" },
  { llave: "fecha_validacion", lead: "CTRFechaValidacion_c (contacto, por confirmar)", nota: "Cuándo se validó y con qué fuente, para auditoría" },
] as const;

export type PasoId = (typeof PASOS)[number]["id"];

/** Qué hace cada paso, en una línea (se muestra en el panel del canvas). */
export const DESCRIPCION_PASO: Record<PasoId, string> = {
  VALIDAR:
    "Revisa que el payload traiga dni y CTRSalesPrograma_c. Normaliza el DNI: si es numérico y tiene menos de 8 dígitos, completa con ceros a la izquierda (3040421 → 03040421).",
  VALIDAR_CORREO:
    "Prueba el correo sin enviarle nada al cliente: sintaxis, dominio mal escrito (gmial.com, hotmail.con…) o desechable, y que el dominio reciba correo (MX). Marca correo_valido = true o false y sigue: no detiene el flujo. El valor se envía a Oracle.",
  VALIDAR_TELEFONO:
    "Normaliza el celular (un celular peruano de 9 dígitos recibe el 51) y le envía un WhatsApp de confirmación con la plantilla aprobada contacto1_alerta_ventas_v1 de Infobip; consulta el estado cada segundo (hasta 25 s). Entregado, o enviado sin error → telefono_valido = true. Si Infobip no lo acepta o WhatsApp lo rechaza o no lo entrega → false, con el error y su detalle. En Test el mensaje va siempre al 51991967975. No detiene el flujo. El valor se envía a Oracle.",
  CONTACTO_VALIDO:
    "¿Al menos uno de los dos (correo o teléfono) salió válido? Sí → sigue con la validación del DNI. No → no hay cómo contactar al cliente: se guarda en \"Ningún campo válido\".",
  SIN_CONTACTO_VALIDO:
    "Ni el correo ni el teléfono son válidos: la solicitud se guarda en \"Ningún campo válido\" y sale de la cola. No se crea nada en Oracle. Si Eloqua la vuelve a mandar con datos corregidos, entra como una solicitud nueva.",
  VALIDAR_DNI:
    "Consulta el DNI en el servicio de identidad (solo DNI peruano) y compara el nombre completo con el registrado. Pasa si el DNI existe y el nombre coincide al menos 75%; entonces reemplaza nombres y apellidos por los oficiales (limpieza) y quedan marcados como validados: en el contacto se escribe la marca y Oracle los bloquea.",
  DNI_EXTRANJERO_ORACLE:
    "La validación es solo para peruanos. Busca el mismo documento en Oracle: si existe y no es documento nacional (extranjero), se salta la regla y sigue. Si no, busca por nombre.",
  BUSCAR_DNI_POR_NOMBRE: "Busca por nombre completo en el servicio de identidad y trae las 10 mejores coincidencias, cada una con su % de coincidencia.",
  CONFIRMAR_DNI_ORACLE:
    "¿Alguna coincidencia tiene 75% o más y su DNI ya está en Oracle? Antes se descartan los candidatos cuyo contacto en Oracle marcó que no desea ser contactado por ningún medio (DoNotContactFlag, nombre por confirmar). Sí → sigue con ese DNI y el nombre oficial. No → se notifica al cliente.",
  NOTIFICAR_DNI:
    "Envía al cliente un enlace para corregir sus datos con un id de seguimiento. Intento 1: correo + WhatsApp. Intento 2: correo + último WhatsApp. Desde el 3: solo correo. Solo usa los canales que salieron válidos (al menos uno lo es: si no, la solicitud ya salió en \"Ningún campo válido\"). La solicitud queda EN ESPERA (no bloquea la cola).",
  TIENE_RUC: "¿El formulario le pidió RUC (viene `ruc` en el payload)? Sí → se valida. No → sigue sin validar RUC.",
  VALIDAR_RUC:
    "Valida el RUC contra la base de RUC y compara la razón social con la registrada. Pasa si existe y coincide al menos 75%; entonces corrige la razón social y ambos quedan marcados como validados (bloqueados en Oracle).",
  BUSCAR_RUC_POR_NOMBRE: "Busca por nombre de empresa en la base de RUC y trae las 10 mejores coincidencias con su % de coincidencia.",
  CONFIRMAR_RUC_ORACLE:
    "¿Alguna coincidencia tiene 75% o más y ya está en Oracle? Sí → sigue con ese RUC. No → se notifica al cliente.",
  NOTIFICAR_RUC:
    "Igual que con el DNI: correo + WhatsApp con id de seguimiento (2.º intento: último WhatsApp; desde el 3.º: solo correo). Queda EN ESPERA.",
  ES_CORRECCION:
    "¿La solicitud trae un id de seguimiento? Es la corrección que llenó el cliente. Sí → desatora la solicitud original. No → sigue el flujo normal.",
  DESATORAR_ORIGINAL:
    "La identidad ya pasó: la solicitud original (EN ESPERA) vuelve a la cola con el DNI, nombre o RUC corregidos y sigue desde ahí. Esta corrección se cierra como aplicada.",
  BUSCAR_CONTACTO:
    "Busca el contacto en Oracle por PersonDEO_CTRNrodedocumento_c con coincidencia exacta contra el DNI con y sin ceros a la izquierda (3040421 y 03040421), nunca por \"contiene\". No existe → se crea. Existe → si hay dos o más, se unifican; luego se actualiza.",
  UNIFICAR_CONTACTOS:
    "Solo si el DNI trae dos o más contactos. Los dos o más pueden diferir solo en los ceros (3040421 y 03040421): son la misma persona. Se queda el que tiene el lead más reciente y su DNI se corrige al de 8 dígitos; a ese se le pasan por API todos los leads de los otros (CustomerId) con sus actividades, y las actividades de los otros contactos. Cada contacto que queda vacío se elimina. Si alguno no se puede eliminar porque aún tiene datos (p. ej. oportunidades), no se borra: queda en Duplicados para revisión y el flujo sigue. Si falla un movimiento, queda en ERROR y al reintentar retoma lo que faltó (no duplica). Todo queda registrado en Duplicados.",
  CREAR_CONTACTO:
    "Solo si el DNI no existe: crea el contacto con el nombre oficial y solo los datos que pasaron la prueba (correo si correo_valido, celular si telefono_valido), más las marcas: correo y teléfono válidos, y DNI y nombre validados (quedan bloqueados en Oracle).",
  ACTUALIZAR_CONTACTO:
    "El contacto ya existe. DNI y nombre: si en Oracle ya están validados (bloqueados) no se tocan; si no, y esta solicitud los validó, se escriben los oficiales y se marcan como validados (quedan bloqueados). Correo y celular: solo los que pasaron la prueba y si son distintos, más sus marcas; nunca pisa un dato con uno inválido. Si a Eloqua le falta un campo (o vino inválido), lo recupera del contacto en Oracle y el resto del flujo usa ese valor, salvo que el contacto haya marcado «No deseo más información» por ese canal: correo (DoNotEmailFlag) o teléfono (DoNotCallFlag); si marcó no contactar (DoNotContactFlag), no se recupera ninguno. Nombres de campo por confirmar.",
  EXISTE_LEAD: "¿Ya hay un lead del contacto para este programa? Sí → se actualiza. No → se crea.",
  OBTENER_RDV: "Regla de venta en AWS (regla_de_venta_principal_aws_ti): devuelve el vendedor, prioridad y actividad.",
  CREAR_LEAD: "Crea el lead en Oracle con los campos de Eloqua, las marcas de correo y teléfono válidos y el RDV como dueño.",
  CREAR_ACTIVIDAD: "Solo si la regla de venta devuelve actividad_vacaciones: la registra en el lead (AWS).",
  PRIORIDAD: "Solo si la regla de venta marca prioridad: agrega el lead a la tabla de prioridad (AWS).",
  // Los cinco INFOBIP_* son una sola llamada a InfobipExt POST /api/v1/sales/active (sales_orchestrator.py,
  // flujo_venta_activa + crear_conversacion). Ojo: InfobipExt responde HTTP 200 aun cuando falla; el
  // resultado real está en `success` / `error` / `content` del cuerpo. Si no responde, falla INFOBIP_PERSONA.
  INFOBIP_PERSONA:
    "Busca a la persona en Infobip por PartyId y por teléfono (valida el teléfono con la Lambda) y decide cuál usar; si no existe, la crea; si su teléfono cambió, lo actualiza. Se detiene si: no hay coincidencia y el teléfono es inválido, no se puede obtener su id de Infobip, o falla la actualización del teléfono. En esos tres casos InfobipExt manda un correo de error al RDV (con copia a gestordecuentascrmcentrum), solo si el RDV tiene correo en rdv_ext.",
  INFOBIP_CONVERSACION:
    "Reutiliza la conversación activa del mismo cliente con el mismo número de Infobip (según la cartera del programa) o crea una nueva en la cola GEN, asignada al RDV. Se detiene si Infobip no la crea: no se envía correo, solo queda en el log.",
  INFOBIP_PLANTILLA:
    "Envía la plantilla robot_saludo_automatico; si falla, reintenta con crm_plantilla_utility. Se omite si el lead ya estaba registrado en esa conversación. Si las dos fallan no se detiene ni avisa a nadie.",
  INFOBIP_VINCULAR:
    "Escribe el id de la conversación en el lead de Oracle (CTRIdConversacionInfobip_c). Si falla no se detiene ni avisa: el lead queda sin conversación vinculada.",
  INFOBIP_ETIQUETAS:
    "Notas (comentario del cruce, programa, vendedor), etiquetas (CRM, Nuevo Lead, cartera, JP, subdirección, tipo y programa), relación lead–conversación y último RDV en la reportería. Todo es best-effort: si algo falla no se detiene ni avisa.",
  ACTUALIZAR_LEAD: "Actualiza el lead existente: UTMs, fecha de charla, asistencia, contador de Eloqua y las marcas de correo y teléfono válidos.",
  NOTIFICAR_CORREO:
    "Al final, con los leads ya creados o actualizados: envía un correo al cliente (solo por correo). La plantilla depende del formulario: ADMISION (con sus datos de admisión) o MASINFO (más información del programa). El asunto incluye el origen en dos niveles, fuente y detalle (p. ej. \"… · PAUTA / TikTok\"); si no viene el detalle, solo la fuente. Usa el correo de Eloqua si es válido o, si no, el recuperado del contacto en Oracle; se omite si no hay ninguno. No escribe nada en Oracle.",
  FINALIZAR: "Cierra la solicitud: OK, o PARCIAL si algún programa falló.",
};

export function etiquetaPaso(paso: string | null | undefined): string {
  return PASOS.find((p) => p.id === paso)?.label ?? paso ?? "—";
}

export interface Solicitud {
  id: number;
  lote_id: number | null;
  dni: string;
  payload: Record<string, unknown>;
  estado: EstadoSolicitud;
  paso_actual: string | null;
  intentos: number;
  error_paso: string | null;
  error_tipo: TipoError | null;
  error_motivo: string | null;
  error_detalle: unknown;
  contacto_party_id: string | null;
  contacto_party_number: string | null;
  /** Resultado de VALIDAR_CORREO / VALIDAR_TELEFONO (null = aún no se probó). Se envía a Oracle. */
  correo_valido?: boolean | null;
  telefono_valido?: boolean | null;
  recibido_at: string;
  iniciado_at: string | null;
  procesado_at: string | null;
  updated_at: string;
  /** Solo en la vista de auditoría: primera solicitud posterior del mismo DNI que quedó OK. */
  resuelta_por_id?: number | null;
}

export interface SolicitudPrograma {
  id: number;
  solicitud_id: number;
  codigo_crm: string;
  orden: number;
  estado: EstadoPrograma;
  paso_actual: string | null;
  accion: "CREADO" | "ACTUALIZADO" | null;
  lead_id: string | null;
  lead_number: string | null;
  rdv_party_number: string | null;
  actividad_id: string | null;
  conversacion_infobip_id: string | null;
  error_paso: string | null;
  error_motivo: string | null;
}

export interface Evento {
  id: number;
  solicitud_id: number;
  programa_id: number | null;
  paso: string;
  resultado: ResultadoEvento;
  duracion_ms: number | null;
  detalle: unknown;
  created_at: string;
}

export interface CandidatoDuplicado {
  party_id: string;
  party_number?: string | null;
  /** DNI tal como está en ese contacto (puede venir sin ceros a la izquierda). */
  dni?: string | null;
  nombre?: string | null;
  n_leads: number;
  ultimo_lead_at?: string | null;
  /** Unificación (solo los que no se quedan): qué se movió al elegido y si se eliminó. */
  leads_movidos?: number;
  actividades_movidas?: number;
  eliminado?: boolean;
  no_eliminado_motivo?: string | null;
}

export interface DuplicadoDni {
  id: number;
  dni: string;
  solicitud_id: number | null;
  candidatos: CandidatoDuplicado[];
  /** Contacto que se queda (el del lead más reciente). */
  elegido_party_id: string | null;
  /** UNIFICADO = todo movido y los vacíos eliminados · PARCIAL = alguno no se pudo eliminar · ERROR = falló un movimiento. */
  estado?: "UNIFICADO" | "PARCIAL" | "ERROR" | null;
  revisado: boolean;
  revisado_por: string | null;
  detectado_at: string;
}

export interface Control {
  pausado: boolean;
  motivo: string | null;
  pausado_at: string | null;
}

export interface Resumen {
  hoy: Record<EstadoSolicitud, number>;
  erroresPorPaso: { paso: string; total: number }[];
  duplicadosPendientes: number;
  control: Control;
  recientes: Solicitud[];
}

/** Estado de toda la cola por paso (canvas del Resumen). */
export interface Cola {
  pendientes: number;
  /** Las primeras en espera (las más antiguas primero). */
  enCola: { id: number; dni: string; recibido_at: string }[];
  porPaso: Record<
    string,
    {
      enCurso: number;
      errores: number;
      enEspera: number;
      /** Salieron de la cola hoy en este paso (Ningún campo válido). */
      fuera: number;
      muestras: { id: number; dni: string; motivo: string | null; estado: EstadoSolicitud }[];
    }
  >;
}

export interface DetalleSolicitud {
  solicitud: Solicitud;
  programas: SolicitudPrograma[];
  eventos: Evento[];
  duplicado: DuplicadoDni | null;
}

export const ESTADO_ESTILO: Record<EstadoSolicitud, { label: string; clase: string }> = {
  PENDIENTE: { label: "Pendiente", clase: "bg-gray-100 text-gray-700" },
  EN_PROCESO: { label: "En proceso", clase: "bg-sky-100 text-sky-800" },
  OK: { label: "OK", clase: "bg-emerald-100 text-emerald-800" },
  PARCIAL: { label: "Parcial", clase: "bg-amber-100 text-amber-800" },
  ERROR: { label: "Error", clase: "bg-red-100 text-red-700" },
  EN_ESPERA: { label: "En espera del cliente", clase: "bg-amber-100 text-amber-800" },
  SIN_CONTACTO: { label: "Ningún campo válido", clase: "bg-rose-100 text-rose-800" },
  DESCARTADO: { label: "Descartado", clase: "bg-gray-200 text-gray-500" },
};

/**
 * DNI peruano = 8 dígitos. Si llega numérico y más corto, se completa con ceros a la izquierda
 * ("3040421" → "03040421"). Otros documentos (carné de extranjería, pasaporte) quedan tal cual.
 * El servicio guarda `solicitud.dni` ya normalizado: así el bloqueo por DNI y la auditoría tratan
 * "3040421" y "03040421" como el mismo.
 */
export function normalizarDni(dni: string): string {
  const limpio = dni.trim().replace(/[\s.-]/g, "");
  return /^\d{1,7}$/.test(limpio) ? limpio.padStart(8, "0") : limpio;
}

/**
 * Formas exactas en que ese DNI puede estar guardado (en Oracle o en la cola): con y sin ceros a la
 * izquierda. La búsqueda es por igualdad exacta contra cada una, nunca por "contiene" (así "3040421"
 * no encuentra "13040421").
 */
export function variantesDni(dni: string): string[] {
  const n = normalizarDni(dni);
  if (!/^\d{8}$/.test(n)) return [n];
  return [...new Set([n, n.replace(/^0+/, "")])].filter(Boolean);
}

/** Lee un campo del payload de Eloqua tolerando llaves faltantes. */
export function campoPayload(payload: Record<string, unknown>, ...llaves: string[]): string {
  for (const k of llaves) {
    const v = payload?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function formatoFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
