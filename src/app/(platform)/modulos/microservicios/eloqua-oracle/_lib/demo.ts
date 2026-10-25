/**
 * Datos de ejemplo para el ambiente "Demo": permiten recorrer todas las vistas y el flujo
 * antes de que existan las tablas en Supabase y el servicio del EC2. No son datos reales:
 * DNIs, nombres y códigos son ficticios. Las acciones (reintentar, descartar…) no guardan nada.
 */

import type {
  DetalleSolicitud,
  DuplicadoDni,
  Evento,
  Solicitud,
  SolicitudPrograma,
} from "@/lib/eloqua-oracle";

const MIN = 60_000;

function haceMin(min: number): string {
  return new Date(Date.now() - min * MIN).toISOString();
}

// Llaves según CAMPOS_ELOQUA (src/lib/eloqua-oracle.ts).
function payload(dni: string, nombre: string, programa: string, extra: Record<string, unknown> = {}) {
  return {
    dni,
    FirstName: nombre,
    LastName: "Demo Ejemplo",
    EmailAddress: `${nombre.toLowerCase()}.demo@ejemplo.com`,
    MobileNumber: "+51900000000",
    CTRSalesPrograma_c: programa,
    CTREloquaRDV_c: "",
    CTRTipoDeAccion_c: "TR_MARKETING",
    CTREloquaTipoDeFormulario_c: "MASINFO",
    CTREloquaFechaDeCharla_c: "",
    EloquaUTMCampaignSource_c: "facebook",
    EloquaUTMCampaignMedium_c: "cpc",
    EloquaUTMCampaignName_c: "mba-2027",
    EloquaFuente_c: "PAUTA",
    EloquaDetalle_c: "Facebook",
    EloquaAsistenciaACharla_c: "N",
    EloquaImpactadoPorCallCenter_c: "N",
    EloquaPaisLead_c: "PE",
    ...extra,
  };
}

const ADMISION = {
  CTREloquaTipoDeFormulario_c: "ADMISION",
  CTRCorreoEloqua_c: "alterno.demo@ejemplo.com",
  CTREspecialidad_c: "Ingeniería Industrial",
  CTRGradoacademico_c: "BACHILLER",
  CTRInstitucionAcademica_c: "Universidad Demo",
  CTRAnioMesquefinalizoEstuSupe_c: "2019-12",
};

const CORREO_MASINFO = {
  canal: "correo",
  destinatario: "correo del cliente",
  plantilla: "MASINFO (más información del programa)",
  asunto: "Más información de tu programa · PAUTA / Facebook",
  origen: { fuente: "PAUTA", detalle: "Facebook" },
};

/** InfobipExt /sales/active OK, desglosado en sus pasos internos. */
function infobipOk(programaId: number, extra: { persona?: Record<string, unknown>; plantilla?: Record<string, unknown> } = {}): Def["eventos"] {
  const conv = `demo-conv-${programaId}`;
  return [
    ["INFOBIP_PERSONA", "OK", programaId, 900, { coincidencia: "party + teléfono", telefono_lambda: "válido", ...extra.persona }],
    ["INFOBIP_CONVERSACION", "OK", programaId, 1200, { accion: "creada", conversation_id: conv, cola: "GEN", asignada_a: "RDV" }],
    ["INFOBIP_PLANTILLA", "OK", programaId, 700, { plantilla: "robot_saludo_automatico", ...extra.plantilla }],
    ["INFOBIP_VINCULAR", "OK", programaId, 450, { CTRIdConversacionInfobip_c: conv }],
    ["INFOBIP_ETIQUETAS", "OK", programaId, 650, { notas: 3, etiquetas: ["CRM", "Nuevo Lead", "cartera", "JP", "subdirección", "tipo", "programa"], reporteria: "ok" }],
  ];
}

type Def = {
  s: Omit<Solicitud, "updated_at" | "iniciado_at" | "procesado_at" | "lote_id" | "intentos"> & { intentos?: number };
  programas: ReturnType<typeof prog>[];
  eventos: [paso: string, resultado: Evento["resultado"], programaId: number | null, ms: number, detalle?: unknown][];
};

/**
 * Prueba de correo y de teléfono: nunca fallan, dejan la marca true/false que va a Oracle. Luego la
 * decisión: si ninguno es válido, la solicitud sale de la cola ("Ningún campo válido").
 */
function marcas({ correo = true, telefono = true } = {}): Def["eventos"] {
  return [
    [
      "VALIDAR_CORREO",
      "OK",
      null,
      correo ? 850 : 430,
      correo
        ? { valido: true, sintaxis: true, dominio_mx: true, buzon: "existe" }
        : { valido: false, sintaxis: true, dominio_mx: false, motivo: "El dominio no recibe correo (sin registro MX)" },
    ],
    [
      "VALIDAR_TELEFONO",
      "OK",
      null,
      telefono ? 4200 : 30000,
      telefono
        ? { valido: true, mensaje_prueba: "enviado", entrega: "DELIVERED" }
        : { valido: false, mensaje_prueba: "enviado", entrega: "UNDELIVERABLE", motivo: "Sin confirmación de entrega en 30 s" },
    ],
    ["CONTACTO_VALIDO", "OK", null, 1, { correo_valido: correo, telefono_valido: telefono, sigue: correo || telefono }],
  ];
}

const OK_CONTACTO: Def["eventos"] = [
  ["VALIDAR", "OK", null, 4],
  ...marcas(),
  ["VALIDAR_DNI", "OK", null, 640, { valido: true, coincidencia_nombre: "96%", nombre_oficial: "corregido con el servicio de identidad" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: false }],
  ["ES_CORRECCION", "OK", null, 1, { es_correccion: false }],
  ["BUSCAR_CONTACTO", "OK", null, 820, { encontrados: 1 }],
  ["CREAR_CONTACTO", "OMITIDO", null, 0, { motivo: "El contacto ya existe" }],
  ["UNIFICAR_CONTACTOS", "OMITIDO", null, 0, { motivo: "Un solo contacto con ese DNI" }],
  ["ACTUALIZAR_CONTACTO", "OK", null, 610, { identidad: "ya validada en Oracle: DNI y nombre bloqueados, no se tocan", actualizados: [], motivo: "El correo y el celular válidos ya coinciden con Oracle" }],
];

function prog(id: number, codigo: string, extra: Partial<SolicitudPrograma>) {
  return {
    id,
    codigo_crm: codigo,
    estado: "OK" as const,
    accion: null,
    lead_id: null,
    lead_number: null,
    rdv_party_number: null,
    actividad_id: null,
    conversacion_infobip_id: null,
    ...extra,
  };
}

const DEFS: Def[] = [
  // Carné de extranjería: el servicio de DNI no lo reconoce, pero el mismo documento ya está en Oracle
  // como extranjero → se salta la regla de validación. El lead ya existía: solo se actualiza.
  {
    s: { id: 1014, dni: "001234567", payload: payload("001234567", "Lucas", "300000200003", { EloquaPaisLead_c: "AR" }), estado: "OK", paso_actual: "FINALIZAR", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: "300000900014", contacto_party_number: "900014", recibido_at: haceMin(6) },
    programas: [prog(2014, "300000200003", { accion: "ACTUALIZADO", lead_id: "300000700014", lead_number: "510014" })],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas({ telefono: false }),
      ["VALIDAR_DNI", "OK", null, 610, { valido: false, motivo: "No es un DNI peruano" }],
      ["DNI_EXTRANJERO_ORACLE", "OK", null, 870, { mismo_documento_en_oracle: true, tipo_documento: "CARNET_EXTRANJERIA", party_number: "900014" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: false }],
      ["ES_CORRECCION", "OK", null, 1, { es_correccion: false }],
      ["BUSCAR_CONTACTO", "OK", null, 760, { encontrados: 1 }],
      ["CREAR_CONTACTO", "OMITIDO", null, 0, { motivo: "El contacto ya existe" }],
      ["UNIFICAR_CONTACTOS", "OMITIDO", null, 0, { motivo: "Un solo contacto con ese DNI" }],
      ["ACTUALIZAR_CONTACTO", "OK", null, 640, { identidad: "no validada (extranjero: se saltó la regla), no se marca ni se bloquea", actualizados: [], no_se_recupera: { MobileNumber: "el contacto marcó «No deseo más información por teléfono» (DoNotCallFlag = Y)" }, preferencias_oracle: { DoNotCallFlag: true, DoNotEmailFlag: false } }],
      ["EXISTE_LEAD", "OK", 2014, 380, { existe: true, LeadNumber: "510014" }],
      ["ACTUALIZAR_LEAD", "OK", 2014, 1300, { campos: ["CTRUTMCampaignSource_c", "CTRPaisLead_c"] }],
      ["NOTIFICAR_CORREO", "OK", null, 850, CORREO_MASINFO],
      ["FINALIZAR", "OK", null, 4],
    ],
  },
  // DNI mal escrito: el servicio no lo reconoce, se encuentra por nombre, se confirma en Oracle y se
  // revalida. Además trae RUC (válido).
  {
    s: { id: 1013, dni: "7000013", payload: payload("7000013", "Sofia", "300000200001", { ruc: "20600000013", empresa: "Empresa Demo SAC" }), estado: "OK", paso_actual: "FINALIZAR", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: "300000900013", contacto_party_number: "900013", recibido_at: haceMin(4) },
    programas: [prog(2013, "300000200001", { accion: "CREADO", lead_id: "300000700013", lead_number: "510013", rdv_party_number: "4100013", conversacion_infobip_id: "demo-conv-2013" })],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas(),
      ["VALIDAR_DNI", "OK", null, 700, { valido: false, motivo: "El DNI 7000013 no existe en el servicio de identidad" }],
      ["DNI_EXTRANJERO_ORACLE", "OK", null, 820, { mismo_documento_en_oracle: false }],
      ["BUSCAR_DNI_POR_NOMBRE", "OK", null, 1400, { busqueda: "SOFIA DEMO EJEMPLO", coincidencias: 10, top: ["70000013", "70000113", "70001300"] }],
      ["CONFIRMAR_DNI_ORACLE", "OK", null, 2100, { descartados_no_contactar: [{ dni: "70000113", coincidencia: "94%", motivo: "DoNotContactFlag = Y" }], mejor: { dni: "70000013", coincidencia: "92%", en_oracle: true, party_number: "900013" }, nombre_oficial: "SOFIA DEMO EJEMPLO" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: true }],
      ["VALIDAR_RUC", "OK", null, 520, { ruc: "20600000013", valido: true, razon_social: "EMPRESA DEMO S.A.C." }],
      ["ES_CORRECCION", "OK", null, 1, { es_correccion: false }],
      ["BUSCAR_CONTACTO", "OK", null, 780, { encontrados: 1 }],
      ["CREAR_CONTACTO", "OMITIDO", null, 0, { motivo: "El contacto ya existe" }],
      ["UNIFICAR_CONTACTOS", "OMITIDO", null, 0, { motivo: "Un solo contacto con ese DNI" }],
      ["ACTUALIZAR_CONTACTO", "OK", null, 980, { identidad: "validada en esta solicitud: se escriben los datos oficiales y se bloquean", escritos: { FirstName: "SOFIA", LastName: "DEMO EJEMPLO", CTRDniValidado_c: "Y", CTRNombreValidado_c: "Y", CTRRucValidado_c: "Y" }, correo_celular: "ya coinciden con Oracle" }],
      ["EXISTE_LEAD", "OK", 2013, 400, { existe: false }],
      ["OBTENER_RDV", "OK", 2013, 1150, { V_rdvId: "4100013", prioridad: false }],
      ["CREAR_LEAD", "OK", 2013, 2050, { LeadNumber: "510013" }],
      ["CREAR_ACTIVIDAD", "OMITIDO", 2013, 0, { motivo: "La regla de venta no devolvió actividad_vacaciones" }],
      ["PRIORIDAD", "OMITIDO", 2013, 0, { motivo: "prioridad = false" }],
      ...infobipOk(2013),
      ["NOTIFICAR_CORREO", "OK", null, 850, CORREO_MASINFO],
      ["FINALIZAR", "OK", null, 4],
    ],
  },
  {
    s: { id: 1012, dni: "70000012", payload: payload("70000012", "Lucia", "300000200001"), estado: "EN_PROCESO", paso_actual: "CREAR_LEAD", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: "300000900012", contacto_party_number: "900012", recibido_at: haceMin(1) },
    programas: [prog(2012, "300000200001", { estado: "EN_PROCESO", paso_actual: "CREAR_LEAD" })],
    eventos: [...OK_CONTACTO, ["EXISTE_LEAD", "OK", 2012, 410, { existe: false }], ["OBTENER_RDV", "OK", 2012, 1300, { V_rdvId: "4100012" }]],
  },
  {
    s: { id: 1011, dni: "70000011", payload: payload("70000011", "Marco", "300000200002"), estado: "PENDIENTE", paso_actual: null, error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(2), intentos: 0 },
    programas: [],
    eventos: [],
  },
  {
    s: { id: 1010, dni: "70000010", payload: payload("70000010", "Rosa", "300000200001::300000200003"), estado: "PARCIAL", paso_actual: "FINALIZAR", error_paso: "OBTENER_RDV", error_tipo: "PERMANENTE", error_motivo: "La Lambda de RDV no devolvió vendedor para el programa 300000200003", error_detalle: null, contacto_party_id: "300000900010", contacto_party_number: "900010", recibido_at: haceMin(9) },
    programas: [
      prog(2010, "300000200001", { accion: "CREADO", lead_id: "300000700010", lead_number: "510010", rdv_party_number: "4100010", actividad_id: null, conversacion_infobip_id: "demo-conv-2010" }),
      prog(2011, "300000200003", { estado: "ERROR", paso_actual: "OBTENER_RDV", error_paso: "OBTENER_RDV", error_motivo: "Sin RDV para el programa 300000200003" }),
    ],
    eventos: [
      ...OK_CONTACTO,
      ["EXISTE_LEAD", "OK", 2010, 380, { existe: false }],
      ["OBTENER_RDV", "OK", 2010, 1210, { V_rdvId: "4100010", prioridad: false }],
      ["CREAR_LEAD", "OK", 2010, 2400, { LeadNumber: "510010" }],
      ["CREAR_ACTIVIDAD", "OMITIDO", 2010, 0, { motivo: "La regla de venta no devolvió actividad_vacaciones" }],
      ["PRIORIDAD", "OMITIDO", 2010, 0, { motivo: "prioridad = false" }],
      ...infobipOk(2010),
      ["EXISTE_LEAD", "OK", 2011, 350, { existe: false }],
      ["OBTENER_RDV", "ERROR", 2011, 1150, { respuesta: null, motivo: "Sin RDV" }],
      ["NOTIFICAR_CORREO", "OK", null, 850, CORREO_MASINFO],
      ["FINALIZAR", "OK", null, 5],
    ],
  },
  {
    s: { id: 1009, dni: "70000009", payload: payload("70000009", "Pedro", "300000200001", { LastName: "" }), estado: "ERROR", paso_actual: "CREAR_CONTACTO", error_paso: "CREAR_CONTACTO", error_tipo: "PERMANENTE", error_motivo: "Oracle rechazó el contacto: falta el apellido (LastName es obligatorio)", error_detalle: { status: 400, oracle: "The attribute LastName is required." }, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(14) },
    programas: [prog(2009, "300000200001", { estado: "PENDIENTE" })],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas(),
      ["VALIDAR_DNI", "OK", null, 640, { valido: true, coincidencia_nombre: "96%", nombre_oficial: "corregido con el servicio de identidad" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: false }],
      ["ES_CORRECCION", "OK", null, 1, { es_correccion: false }],
      ["BUSCAR_CONTACTO", "OK", null, 760, { encontrados: 0 }],
      ["CREAR_CONTACTO", "ERROR", null, 980, { status: 400, oracle: "The attribute LastName is required." }],
    ],
  },
  {
    s: { id: 1008, dni: "70000008", payload: payload("70000008", "Ana", "300000200002"), estado: "ERROR", paso_actual: "INFOBIP_PERSONA", error_paso: "INFOBIP_PERSONA", error_tipo: "PERMANENTE", error_motivo: "InfobipExt: el cliente no está en Infobip y no se pudo dar de alta (se envió correo al RDV)", error_detalle: { success: false, error: "People no tiene infobip_id sincronizado" }, contacto_party_id: "300000900008", contacto_party_number: "900008", recibido_at: haceMin(26), intentos: 5 },
    programas: [prog(2008, "300000200002", { estado: "ERROR", paso_actual: "INFOBIP_PERSONA", accion: "CREADO", lead_id: "300000700008", lead_number: "510008", rdv_party_number: "4100008", actividad_id: "300000800008", error_paso: "INFOBIP_PERSONA", error_motivo: "People sin infobip_id" })],
    eventos: [
      ...OK_CONTACTO,
      ["EXISTE_LEAD", "OK", 2008, 400, { existe: false }],
      ["OBTENER_RDV", "OK", 2008, 1180, { V_rdvId: "4100008", prioridad: true, actividad_vacaciones: "RDV titular de vacaciones; asignado a reemplazo" }],
      ["CREAR_LEAD", "OK", 2008, 2300, { LeadNumber: "510008" }],
      ["CREAR_ACTIVIDAD", "OK", 2008, 870],
      ["PRIORIDAD", "OK", 2008, 640],
      ["INFOBIP_PERSONA", "ERROR", 2008, 4100, { http: 200, success: false, error: "People no tiene infobip_id sincronizado", correo_error: "enviado al RDV (cc gestordecuentascrmcentrum)" }],
    ],
  },
  {
    s: { id: 1007, dni: "70000007", payload: payload("70000007", "Jorge", "300000200001"), estado: "OK", paso_actual: "FINALIZAR", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: "300000900007", contacto_party_number: "900007", recibido_at: haceMin(41) },
    programas: [prog(2007, "300000200001", { accion: "ACTUALIZADO", lead_id: "300000700007", lead_number: "510007" })],
    eventos: [
      ...OK_CONTACTO,
      ["EXISTE_LEAD", "OK", 2007, 420, { existe: true, LeadNumber: "510007" }],
      ["ACTUALIZAR_LEAD", "OK", 2007, 1500, { campos: ["CTRUTMCampaignSource_c", "CTRUTMCampaignMedium_c", "CTRUTMCampaignName_c", "CTREloquaOPFormulario_c"], CTREloquaConteoDeActualizacion_c: 3 }],
      ["NOTIFICAR_CORREO", "OK", null, 850, CORREO_MASINFO],
      ["FINALIZAR", "OK", null, 4],
    ],
  },
  {
    s: { id: 1006, dni: "70000006", payload: payload("70000006", "Carla", "300000200003"), estado: "OK", paso_actual: "FINALIZAR", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: "300000900006", contacto_party_number: "900006", recibido_at: haceMin(55) },
    programas: [prog(2006, "300000200003", { accion: "CREADO", lead_id: "300000700006", lead_number: "510006", rdv_party_number: "4100006", actividad_id: null, conversacion_infobip_id: "demo-conv-2006" })],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas({ telefono: false }),
      ["VALIDAR_DNI", "OK", null, 640, { valido: true, coincidencia_nombre: "96%", nombre_oficial: "corregido con el servicio de identidad" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: false }],
      ["ES_CORRECCION", "OK", null, 1, { es_correccion: false }],
      ["BUSCAR_CONTACTO", "OK", null, 900, { busqueda_exacta: ["70000006"], encontrados: 2 }],
      ["CREAR_CONTACTO", "OMITIDO", null, 0, { motivo: "El contacto ya existe" }],
      ["UNIFICAR_CONTACTOS", "OK", null, 6400, { se_queda: { party_number: "900006", ultimo_lead: "hace 20 días" }, desde: { party_number: "900106", leads_movidos: 1, actividades_movidas: 2, eliminado: true } }],
      ["ACTUALIZAR_CONTACTO", "OK", null, 920, { identidad: "ya validada en Oracle: DNI y nombre bloqueados, no se tocan", actualizados: ["EmailAddress", "CTRCorreoValido_c", "CTRTelefonoValido_c"], recuperados_de_oracle: { MobileNumber: "+51900000106 (el de Eloqua no pasó la prueba)" }, preferencias_oracle: { DoNotCallFlag: false, DoNotEmailFlag: false } }],
      ["EXISTE_LEAD", "OK", 2006, 390, { existe: false }],
      ["OBTENER_RDV", "OK", 2006, 1250, { V_rdvId: "4100006", prioridad: false }],
      ["CREAR_LEAD", "OK", 2006, 2200, { LeadNumber: "510006" }],
      ["CREAR_ACTIVIDAD", "OMITIDO", 2006, 0, { motivo: "La regla de venta no devolvió actividad_vacaciones" }],
      ["PRIORIDAD", "OMITIDO", 2006, 0, { motivo: "prioridad = false" }],
      ...infobipOk(2006, { persona: { coincidencia: "party", telefono_lambda: "inválido", comentario: "Se usa el teléfono registrado en el CRM" } }),
      ["NOTIFICAR_CORREO", "OK", null, 850, CORREO_MASINFO],
      ["FINALIZAR", "OK", null, 4],
    ],
  },
  {
    s: { id: 1005, dni: "70000005", payload: payload("70000005", "Diego", "300000200002", { ...ADMISION, EmailAddress: "diego@dominio-inexistente.pe" }), estado: "OK", paso_actual: "FINALIZAR", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: "300000900005", contacto_party_number: "900005", recibido_at: haceMin(70) },
    programas: [prog(2005, "300000200002", { accion: "CREADO", lead_id: "300000700005", lead_number: "510005", rdv_party_number: "4100005", actividad_id: "300000800005", conversacion_infobip_id: "demo-conv-2005" })],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas({ correo: false }),
      ["VALIDAR_DNI", "OK", null, 640, { valido: true, coincidencia_nombre: "96%", nombre_oficial: "corregido con el servicio de identidad" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: false }],
      ["ES_CORRECCION", "OK", null, 1, { es_correccion: false }],
      ["BUSCAR_CONTACTO", "OK", null, 700, { encontrados: 0 }],
      ["CREAR_CONTACTO", "OK", null, 1900, { PartyNumber: "900005", con: ["FirstName", "LastName", "MobileNumber"], sin: { EmailAddress: "correo_valido = false" }, marcas: { CTRDniValidado_c: "Y", CTRNombreValidado_c: "Y", CTRCorreoValido_c: "N", CTRTelefonoValido_c: "Y" } }],
      ["ACTUALIZAR_CONTACTO", "OMITIDO", null, 0, { motivo: "El contacto no existía: se crea" }],
      ["EXISTE_LEAD", "OK", 2005, 360, { existe: false }],
      ["OBTENER_RDV", "OK", 2005, 1200, { V_rdvId: "4100005", prioridad: true, actividad_vacaciones: "RDV titular de vacaciones; asignado a reemplazo" }],
      ["CREAR_LEAD", "OK", 2005, 2100, { LeadNumber: "510005" }],
      ["CREAR_ACTIVIDAD", "OK", 2005, 820],
      ["PRIORIDAD", "OK", 2005, 600],
      ...infobipOk(2005, { plantilla: { plantilla: "robot_saludo_automatico", resultado: "no entregada (7032)", respaldo: "crm_plantilla_utility enviada" } }),
      ["NOTIFICAR_CORREO", "OMITIDO", null, 0, { motivo: "correo_valido = false: no se envía el correo de ADMISION" }],
      ["FINALIZAR", "OK", null, 4],
    ],
  },
  // Mismo DNI que 1007: llegó antes sin programa y falló; la 1007 (posterior) quedó OK y lo resolvió.
  {
    s: { id: 1004, dni: "70000007", payload: payload("70000007", "Jorge", ""), estado: "ERROR", paso_actual: "VALIDAR", error_paso: "VALIDAR", error_tipo: "VALIDACION", error_motivo: "Falta el programa (CTRSalesPrograma_c)", error_detalle: null, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(95) },
    programas: [],
    eventos: [["VALIDAR", "ERROR", null, 2, { faltan: ["CTRSalesPrograma_c"] }]],
  },
  // Ni el correo ni el teléfono pasan la prueba: no hay cómo contactarlo → "Ningún campo válido", sale de la cola.
  {
    s: { id: 1017, dni: "70000017", payload: payload("70000017", "Hugo", "300000200001", { EmailAddress: "hugo@dominio-inexistente.pe", MobileNumber: "+51900000017" }), estado: "SIN_CONTACTO", paso_actual: "SIN_CONTACTO_VALIDO", error_paso: null, error_tipo: null, error_motivo: "Correo sin MX y teléfono sin confirmación de entrega", error_detalle: null, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(8) },
    programas: [],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas({ correo: false, telefono: false }),
      ["SIN_CONTACTO_VALIDO", "OK", null, 20, { sale_de_la_cola: true, correo_valido: false, telefono_valido: false }],
    ],
  },
  // El nombre no coincide (63%) y ninguna coincidencia por nombre llega a 75% en Oracle: se avisa al
  // cliente (intento 1: correo + WhatsApp) y queda EN ESPERA de su corrección.
  {
    s: { id: 1003, dni: "70000003", payload: payload("70000003", "Raul", "300000200002"), estado: "EN_ESPERA", paso_actual: "NOTIFICAR_DNI", error_paso: null, error_tipo: null, error_motivo: "Nombre no coincide con el DNI (63%) · notificado: correo + WhatsApp (SEG-7K2F)", error_detalle: null, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(110) },
    programas: [],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas(),
      ["VALIDAR_DNI", "OK", null, 690, { valido: false, dni_existe: true, coincidencia_nombre: "63%", nombre_registrado: "RAUL ALBERTO QUISPE MAMANI" }],
      ["DNI_EXTRANJERO_ORACLE", "OK", null, 790, { mismo_documento_en_oracle: false }],
      ["BUSCAR_DNI_POR_NOMBRE", "OK", null, 1350, { busqueda: "RAUL DEMO EJEMPLO", coincidencias: 10, mejor: "71%" }],
      ["CONFIRMAR_DNI_ORACLE", "OK", null, 1900, { ninguna_mayor_a: "75%", mejor: { dni: "70000303", coincidencia: "71%", en_oracle: true } }],
      ["NOTIFICAR_DNI", "OK", null, 1200, { seguimiento: "SEG-7K2F", intento: 1, canales: ["correo", "whatsapp"], correo: "raul.demo@ejemplo.com" }],
    ],
  },
  // La corrección de la 1003 llegó con su id de seguimiento pero volvió a fallar: intento 2 = correo + último WhatsApp.
  {
    s: { id: 1016, dni: "70000003", payload: payload("70000003", "Raul A", "300000200002", { seguimiento: "SEG-7K2F" }), estado: "EN_ESPERA", paso_actual: "NOTIFICAR_DNI", error_paso: null, error_tipo: null, error_motivo: "Nombre no coincide con el DNI (68%) · notificado: correo + último WhatsApp (SEG-7K2F, intento 2)", error_detalle: null, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(30) },
    programas: [],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas(),
      ["VALIDAR_DNI", "OK", null, 640, { valido: false, dni_existe: true, coincidencia_nombre: "68%" }],
      ["DNI_EXTRANJERO_ORACLE", "OK", null, 760, { mismo_documento_en_oracle: false }],
      ["BUSCAR_DNI_POR_NOMBRE", "OK", null, 1300, { busqueda: "RAUL A DEMO EJEMPLO", coincidencias: 10, mejor: "70%" }],
      ["CONFIRMAR_DNI_ORACLE", "OK", null, 1800, { ninguna_mayor_a: "75%" }],
      ["NOTIFICAR_DNI", "OK", null, 1100, { seguimiento: "SEG-7K2F", intento: 2, canales: ["correo", "whatsapp (último)"], siguiente: "desde el intento 3 solo correo" }],
    ],
  },
  // Corrección que sí pasó: trae id de seguimiento, la identidad coincide y desatora a su original (1001).
  {
    s: { id: 1015, dni: "70000001", payload: payload("70000001", "Elena", "300000200001", { seguimiento: "SEG-4H8P" }), estado: "OK", paso_actual: "DESATORAR_ORIGINAL", error_paso: null, error_tipo: null, error_motivo: null, error_detalle: null, contacto_party_id: null, contacto_party_number: null, recibido_at: haceMin(12) },
    programas: [],
    eventos: [
      ["VALIDAR", "OK", null, 3],
      ...marcas(),
      ["VALIDAR_DNI", "OK", null, 620, { valido: true, coincidencia_nombre: "97%", nombre_oficial: "ELENA DEMO EJEMPLO" }],
      ["TIENE_RUC", "OK", null, 1, { tiene_ruc: false }],
      ["ES_CORRECCION", "OK", null, 40, { es_correccion: true, seguimiento: "SEG-4H8P", original: 1001 }],
      ["DESATORAR_ORIGINAL", "OK", null, 120, { original: 1001, vuelve_a: "PENDIENTE", datos_corregidos: ["dni", "FirstName", "LastName"] }],
    ],
  },
];

function construir(def: Def): DetalleSolicitud {
  const s = def.s;
  const solicitud: Solicitud = {
    lote_id: null,
    intentos: 1,
    iniciado_at: s.estado === "PENDIENTE" ? null : s.recibido_at,
    procesado_at: ["OK", "PARCIAL", "ERROR", "SIN_CONTACTO", "DESCARTADO"].includes(s.estado) ? s.recibido_at : null,
    updated_at: s.recibido_at,
    resuelta_por_id: null,
    ...s,
  };
  const programas: SolicitudPrograma[] = def.programas.map((p, i) => ({
    solicitud_id: s.id,
    orden: i,
    paso_actual: null,
    error_paso: null,
    error_motivo: null,
    ...p,
  }));
  let t = Date.parse(s.recibido_at);
  const eventos: Evento[] = def.eventos.map(([paso, resultado, programaId, ms, detalle], i) => {
    t += ms + 50;
    return {
      id: s.id * 100 + i,
      solicitud_id: s.id,
      programa_id: programaId,
      paso,
      resultado,
      duracion_ms: ms,
      detalle: detalle ?? null,
      created_at: new Date(t).toISOString(),
    };
  });
  return { solicitud, programas, eventos, duplicado: null };
}

export function demoDetalles(): DetalleSolicitud[] {
  const detalles = DEFS.map(construir);
  // "Resuelta por": primera solicitud posterior del mismo DNI que quedó OK.
  for (const d of detalles) {
    const posterior = detalles
      .filter(
        (x) =>
          x.solicitud.dni === d.solicitud.dni &&
          x.solicitud.recibido_at > d.solicitud.recibido_at &&
          x.solicitud.estado === "OK",
      )
      .sort((a, b) => a.solicitud.id - b.solicitud.id)[0];
    d.solicitud.resuelta_por_id = posterior?.solicitud.id ?? null;
  }
  const dup = demoDuplicados()[0];
  const conDup = detalles.find((d) => d.solicitud.id === dup.solicitud_id);
  if (conDup) conDup.duplicado = dup;
  return detalles;
}

export function demoDuplicados(): DuplicadoDni[] {
  return [
    {
      id: 1,
      dni: "70000006",
      solicitud_id: 1006,
      candidatos: [
        { party_id: "300000900006", party_number: "900006", dni: "70000006", nombre: "Carla Demo Ejemplo", n_leads: 3, ultimo_lead_at: haceMin(60 * 24 * 20) },
        { party_id: "300000900106", party_number: "900106", dni: "70000006", nombre: "Carla Demo", n_leads: 1, ultimo_lead_at: haceMin(60 * 24 * 200), leads_movidos: 1, actividades_movidas: 2, eliminado: true },
      ],
      elegido_party_id: "300000900006",
      estado: "UNIFICADO",
      revisado: true,
      revisado_por: "demo@centrum.pucp.edu.pe",
      detectado_at: haceMin(55),
    },
    {
      id: 2,
      dni: "03040421",
      solicitud_id: null,
      candidatos: [
        { party_id: "300000900121", party_number: "900121", dni: "3040421", nombre: "Mario Demo", n_leads: 2, ultimo_lead_at: haceMin(60 * 24 * 400), leads_movidos: 2, actividades_movidas: 5, eliminado: false, no_eliminado_motivo: "Tiene 1 oportunidad abierta: no se borra" },
        { party_id: "300000900021", party_number: "900021", dni: "03040421", nombre: "Mario Demo Ejemplo", n_leads: 1, ultimo_lead_at: haceMin(60 * 24 * 3) },
      ],
      elegido_party_id: "300000900021",
      estado: "PARCIAL",
      revisado: false,
      revisado_por: null,
      detectado_at: haceMin(60 * 24 * 3),
    },
  ];
}
