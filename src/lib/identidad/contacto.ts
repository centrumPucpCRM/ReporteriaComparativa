/**
 * Prueba de correo y de teléfono del lead (pasos VALIDAR_CORREO y VALIDAR_TELEFONO). Server-only.
 *
 * - Correo: sintaxis, dominio mal escrito o desechable, y que el dominio reciba correo (registro MX,
 *   o A como respaldo según el RFC) consultado por DNS-over-HTTPS. Si pasa, se envía un correo de
 *   confirmación por SMTP (CORREO_SMTP_*) y se revisa cada segundo por IMAP el buzón del remitente:
 *   un rebote con el token del envío = el buzón no existe. Sin SMTP configurado se queda en el DNS.
 * - Teléfono: se le envía un WhatsApp de confirmación con una plantilla aprobada de Infobip y se
 *   consulta el estado cada segundo. Válido si el envío salió (entregado, o en camino sin error al
 *   terminar la espera); inválido si Infobip no lo acepta o WhatsApp lo rechaza / no lo puede entregar,
 *   y en ese caso el error y su detalle quedan en el evento.
 *
 * Usa las credenciales reales de Infobip (INFOBIP_API_HOST / INFOBIP_API_KEY), no InfobipExt.
 */
import { enviarPlantillaDirecta, getDeliveryStatus, type EstadoEntrega } from "@/lib/infobip";

/** Plantilla de confirmación: UTILITY, es_PE, aprobada. {{1}} = nombre, {{2}} = sobre qué pidió información. */
export const PLANTILLA_CONFIRMACION = { nombre: "contacto1_alerta_ventas_v1", idioma: "es_PE" };
/** Número de WhatsApp de Infobip desde el que sale la confirmación (uno de los NI de `Infobip_ext.colas`). */
export const remitenteConfirmacion = () => process.env.INFOBIP_REMITENTE_CONFIRMACION?.trim() || "51993240119";
/** En Test (y en Demo) los mensajes de prueba siempre van a este número, nunca al del lead. */
export const TELEFONO_PRUEBA = "51991967975";

const ESPERA_ENTREGA_S = 25;

/* ── Teléfono ────────────────────────────────────────────────────────────── */

export interface TelefonoNormalizado {
  /** Solo dígitos con código de país, p. ej. 51991967975. null = no es un número usable. */
  numero: string | null;
  /** Se le agregó el 51 (celular peruano de 9 dígitos que llegó sin código de país). */
  agrego51: boolean;
  motivo: string | null;
}

/**
 * Celular peruano = 9 dígitos que empiezan en 9. Si llega así se le antepone 51 (WhatsApp exige
 * el código de país): 991967975 → 51991967975. También limpia "+", espacios, guiones y "00".
 */
export function normalizarTelefono(valor: string): TelefonoNormalizado {
  let d = String(valor ?? "").replace(/\D/g, "");
  if (!d) return { numero: null, agrego51: false, motivo: "No hay celular" };
  if (d.startsWith("00")) d = d.slice(2);
  if (/^9\d{8}$/.test(d)) return { numero: `51${d}`, agrego51: true, motivo: null };
  if (/^519\d{8}$/.test(d)) return { numero: d, agrego51: false, motivo: null };
  if (d.startsWith("51")) return { numero: null, agrego51: false, motivo: `Número peruano inválido: ${valor} (debe ser 51 + 9 dígitos que empiezan en 9)` };
  if (d.length >= 10 && d.length <= 15) return { numero: d, agrego51: false, motivo: null };
  return { numero: null, agrego51: false, motivo: `Número inválido: ${valor}` };
}

export interface PruebaTelefono {
  valido: boolean;
  detalle: Record<string, unknown>;
  messageId: string | null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FALLIDO = new Set(["UNDELIVERABLE", "REJECTED", "EXPIRED"]);

/**
 * Envía la confirmación y consulta la entrega cada segundo. `forzarA` manda el mensaje a otro número
 * (el de prueba) sin dejar de validar el formato del número del lead.
 */
export async function probarTelefono(celular: string, nombre: string, forzarA?: string): Promise<PruebaTelefono> {
  const n = normalizarTelefono(celular);
  const base: Record<string, unknown> = {
    telefono_registrado: celular || null,
    telefono: n.numero,
    ...(n.agrego51 ? { correccion: "Se agregó el código de Perú (51)" } : {}),
  };
  if (!n.numero) return { valido: false, messageId: null, detalle: { ...base, valido: false, motivo: n.motivo } };

  const destino = forzarA ?? n.numero;
  const primerNombre = (nombre.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/^./, (c) => c.toUpperCase()) || "Hola";
  const envio = {
    enviado_a: destino,
    ...(forzarA ? { numero_de_prueba: true } : {}),
    plantilla: PLANTILLA_CONFIRMACION.nombre,
    remitente: remitenteConfirmacion(),
  };

  let r;
  try {
    r = await enviarPlantillaDirecta({
      from: remitenteConfirmacion(),
      to: destino,
      templateName: PLANTILLA_CONFIRMACION.nombre,
      language: PLANTILLA_CONFIRMACION.idioma,
      placeholders: [primerNombre, "el programa de tu interés"],
    });
  } catch (e) {
    // Sin credenciales de Infobip, por ejemplo.
    const motivo = e instanceof Error ? e.message : String(e);
    return { valido: false, messageId: null, detalle: { ...base, ...envio, valido: false, motivo: `No se pudo enviar: ${motivo}`, error: { detalle: motivo } } };
  }
  if (!r.ok || !r.data) {
    return {
      valido: false,
      messageId: null,
      detalle: { ...base, ...envio, valido: false, motivo: "Infobip no aceptó el envío", error: { http: r.status, detalle: r.error } },
    };
  }
  const { messageId } = r.data;
  if (r.data.grupo === "REJECTED" || !messageId) {
    return {
      valido: false,
      messageId,
      detalle: {
        ...base,
        ...envio,
        message_id: messageId,
        valido: false,
        motivo: "Infobip rechazó el envío",
        error: { estado: r.data.nombre, detalle: r.data.descripcion },
      },
    };
  }

  // Consulta de entrega cada segundo. Los logs tardan unos segundos en aparecer.
  const t0 = Date.now();
  let ultimo: EstadoEntrega | null = null;
  const consultas: string[] = [];
  while (Date.now() - t0 < ESPERA_ENTREGA_S * 1000) {
    await dormir(1000);
    try {
      ultimo = (await getDeliveryStatus([messageId])).get(messageId) ?? ultimo;
    } catch {
      /* un fallo puntual de la consulta no cambia nada: se vuelve a preguntar */
    }
    const marca = ultimo ? `${ultimo.grupo}/${ultimo.nombre}` : "sin log aún";
    if (consultas[consultas.length - 1] !== marca) consultas.push(`${Math.round((Date.now() - t0) / 1000)} s: ${marca}`);
    if (ultimo && (ultimo.grupo === "DELIVERED" || FALLIDO.has(ultimo.grupo))) break;
  }
  const segundos = Math.round((Date.now() - t0) / 1000);
  const entrega = ultimo ? { estado: ultimo.grupo, nombre: ultimo.nombre } : { estado: "SIN_REPORTE" };
  const comun = { ...base, ...envio, message_id: messageId, envio: r.data.nombre, entrega, segundos_esperando: segundos, consultas };

  if (ultimo && FALLIDO.has(ultimo.grupo)) {
    return {
      valido: false,
      messageId,
      detalle: {
        ...comun,
        valido: false,
        motivo: `WhatsApp no entregó el mensaje (${ultimo.nombre})`,
        error: { id: ultimo.errorId, nombre: ultimo.errorNombre, detalle: ultimo.errorDescripcion },
      },
    };
  }
  if (ultimo?.grupo === "DELIVERED") {
    return { valido: true, messageId, detalle: { ...comun, valido: true, entrega_confirmada: true } };
  }
  return {
    valido: true,
    messageId,
    detalle: {
      ...comun,
      valido: true,
      entrega_confirmada: false,
      nota: `El envío salió sin error; WhatsApp aún no confirma la entrega tras ${segundos} s (con el message_id se puede volver a consultar).`,
    },
  };
}

/* ── Correo ──────────────────────────────────────────────────────────────── */

/**
 * Registros DNS por DNS-over-HTTPS (Google y, si falla, Cloudflare). No se usa el resolver de Node:
 * depende del DNS de la máquina (en una red con DNS por IPv6 devolvía ECONNREFUSED y daba por
 * inválidos dominios que sí reciben correo, como pucp.edu.pe). [] = el dominio no tiene ese
 * registro o no existe · null = no se pudo consultar.
 */
async function consultarDns(nombre: string, tipo: "MX" | "A"): Promise<string[] | null> {
  for (const url of [
    `https://dns.google/resolve?name=${encodeURIComponent(nombre)}&type=${tipo}`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nombre)}&type=${tipo}`,
  ]) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
      if (j.Status === 3) return []; // NXDOMAIN: el dominio no existe
      if (j.Status !== 0) continue;
      const codigo = tipo === "MX" ? 15 : 1;
      return (j.Answer ?? []).filter((r) => r.type === codigo).map((r) => r.data);
    } catch {
      /* siguiente proveedor */
    }
  }
  return null;
}

const RE_CORREO = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Dominios mal escritos que llegan seguido en formularios → el correcto. Tienen MX propio a veces (typosquatting). */
const DOMINIOS_MAL_ESCRITOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmaill.com": "gmail.com", "gnail.com": "gmail.com", "gmal.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmai.com": "hotmail.com", "hotamil.com": "hotmail.com", "hotmaill.com": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com", "outllok.com": "outlook.com",
  "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com",
  "pucp.pe": "pucp.edu.pe", "pucp.edu": "pucp.edu.pe",
};

/** Correos desechables / temporales: el dominio existe pero el buzón no sirve para contactar al lead. */
const DOMINIOS_DESECHABLES = new Set([
  "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
  "throwawaymail.com", "mailnesia.com", "mintemail.com", "emailondeck.com", "moakt.com", "tempail.com",
]);

export async function probarCorreo(correo: string, nombre = ""): Promise<{ valido: boolean; detalle: Record<string, unknown> }> {
  const c = String(correo ?? "").trim().toLowerCase();
  if (!c) return { valido: false, detalle: { correo: null, valido: false, motivo: "No hay correo" } };
  if (!RE_CORREO.test(c) || c.includes("..")) return { valido: false, detalle: { correo: c, valido: false, motivo: "Sintaxis inválida" } };
  const dominio = c.split("@")[1];
  const sugerido = DOMINIOS_MAL_ESCRITOS[dominio];
  if (sugerido) {
    return {
      valido: false,
      detalle: { correo: c, valido: false, dominio, motivo: `Dominio mal escrito: ${dominio}`, sugerencia: `${c.split("@")[0]}@${sugerido}` },
    };
  }
  if (DOMINIOS_DESECHABLES.has(dominio)) {
    return { valido: false, detalle: { correo: c, valido: false, dominio, motivo: "Correo desechable / temporal" } };
  }
  const mx = await consultarDns(dominio, "MX");
  if (mx === null) {
    // Sin DNS no se puede saber: no se castiga al lead por una caída de la consulta.
    return { valido: true, detalle: { correo: c, valido: true, dominio, nota: "No se pudo consultar el DNS: válido solo por sintaxis" } };
  }
  let servidores: string[] = [];
  if (mx.length) {
    servidores = mx
      .map((d) => d.split(" "))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map((p) => (p[1] ?? p[0]).replace(/\.$/, ""))
      .filter((h) => h && h !== ".")
      .slice(0, 3);
    // MX nulo (RFC 7505: "0 ."): el dominio declara que NO recibe correo.
  } else {
    // Sin MX, el RFC permite entregar al registro A del dominio.
    const a = await consultarDns(dominio, "A");
    if (a?.length) servidores = [dominio];
  }
  if (!servidores.length) {
    return { valido: false, detalle: { correo: c, valido: false, dominio, motivo: `El dominio ${dominio} no recibe correo (sin MX ni A)` } };
  }
  const base = { correo: c, dominio, mx: servidores };
  if (!smtpConfigurado()) {
    return { valido: true, detalle: { ...base, valido: true, nota: "El dominio recibe correo. No se envió confirmación: falta configurar CORREO_SMTP_*" } };
  }
  const envio = await enviarConfirmacion(c, nombre);
  return { valido: envio.valido, detalle: { ...base, ...envio } };
}

// ---------------------------------------------------------------------------
// Correo de confirmación + rebote
// ---------------------------------------------------------------------------

/** Segundos que se espera un rebote después de enviar (Gmail/Outlook rechazan un buzón inexistente en segundos). */
const ESPERA_REBOTE_S = 25;

const env = (k: string) => process.env[k]?.trim() ?? "";
const smtpConfigurado = () => !!(env("CORREO_SMTP_HOST") && env("CORREO_SMTP_USUARIO") && env("CORREO_SMTP_CLAVE"));

/** Línea del rebote con el motivo (p. ej. "550 5.1.1 The email account that you tried to reach does not exist"). */
function motivoRebote(texto: string): string | null {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim());
  const smtp = lineas.find((l) => /\b5\d\d[ -]5\.\d+\.\d+/.test(l)) ?? lineas.find((l) => /^Diagnostic-Code:/i.test(l)) ?? lineas.find((l) => /\b55\d\b/.test(l));
  return smtp ? smtp.replace(/^Diagnostic-Code:\s*(smtp;)?\s*/i, "").slice(0, 300) : null;
}

/**
 * Envía el correo de confirmación por SMTP y mira el buzón del remitente por IMAP cada segundo:
 * si llega un rebote que menciona el token del envío, el buzón no existe → inválido con el motivo.
 * Sin rebote al terminar la espera → válido (el servidor de destino lo aceptó).
 */
async function enviarConfirmacion(correo: string, nombre: string): Promise<Record<string, unknown> & { valido: boolean }> {
  const { default: nodemailer } = await import("nodemailer");
  const { ImapFlow } = await import("imapflow");
  const usuario = env("CORREO_SMTP_USUARIO");
  const clave = env("CORREO_SMTP_CLAVE");
  const remitente = env("CORREO_REMITENTE") || usuario;
  const token = `CTR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const primerNombre = nombre.trim().split(/\s+/)[0] ?? "";
  const saludo = primerNombre ? `Hola ${primerNombre[0].toUpperCase()}${primerNombre.slice(1).toLowerCase()},` : "Hola,";

  const puerto = Number(env("CORREO_SMTP_PUERTO") || 465);
  const transporte = nodemailer.createTransport({
    host: env("CORREO_SMTP_HOST"),
    port: puerto,
    secure: puerto === 465,
    auth: { user: usuario, pass: clave },
    connectionTimeout: 10_000,
  });
  const enviadoEn = new Date();
  let messageId: string;
  try {
    const info = await transporte.sendMail({
      from: { name: env("CORREO_REMITENTE_NOMBRE") || remitente, address: remitente },
      to: correo,
      subject: `Confirmación de tus datos de contacto (${token})`,
      text: `${saludo}\n\nRecibimos tu solicitud de información. Este correo confirma que podemos escribirte a esta dirección; no necesitas responder.\n\nRef. ${token}`,
      headers: { "X-Centrum-Prueba": token },
    });
    messageId = info.messageId;
    if (info.rejected?.length) {
      return { valido: false, enviado_a: correo, remitente, token, motivo: "El servidor SMTP rechazó el destinatario", error: { rechazados: info.rejected, respuesta: info.response } };
    }
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
    // 5xx en RCPT TO = el destinatario no existe; otro error = falla técnica del envío.
    const destinatario = err.responseCode != null && err.responseCode >= 500 && err.responseCode < 600 && /recipient|rcpt|mailbox|user/i.test(err.response ?? "");
    return {
      valido: false,
      enviado_a: correo,
      remitente,
      token,
      motivo: destinatario ? "El servidor rechazó el destinatario" : "No se pudo enviar el correo de confirmación",
      error: { codigo: err.code ?? null, smtp: err.responseCode ?? null, detalle: err.response ?? err.message ?? String(e) },
    };
  }

  const base = { enviado_a: correo, remitente, token, message_id: messageId, envio: "Aceptado por el servidor SMTP" };
  const imap = new ImapFlow({
    host: env("CORREO_IMAP_HOST") || env("CORREO_SMTP_HOST").replace(/^smtp\./, "imap."),
    port: 993,
    secure: true,
    auth: { user: usuario, pass: clave },
    logger: false,
  });
  const consultas: string[] = [];
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const t0 = Date.now();
      while (Date.now() - t0 < ESPERA_REBOTE_S * 1000) {
        await dormir(1000);
        await imap.noop(); // refresca el buzón
        const uids = (await imap.search({ since: new Date(enviadoEn.getTime() - 60_000), body: token }, { uid: true })) || [];
        consultas.push(uids.length ? "REBOTE" : "SIN_REBOTE");
        if (uids.length) {
          const msg = await imap.fetchOne(String(uids[uids.length - 1]), { source: true, envelope: true }, { uid: true });
          const texto = msg && msg.source ? msg.source.toString("utf8") : "";
          return {
            ...base,
            valido: false,
            motivo: "El correo rebotó: la dirección no existe o no acepta correo",
            rebote: { asunto: msg && msg.envelope ? msg.envelope.subject : null, de: msg && msg.envelope ? msg.envelope.from?.[0]?.address : null, detalle: motivoRebote(texto) },
            segundos_esperando: Math.round((Date.now() - t0) / 1000),
            consultas,
          };
        }
      }
    } finally {
      lock.release();
    }
    return { ...base, valido: true, segundos_esperando: ESPERA_REBOTE_S, consultas, nota: `Sin rebote en ${ESPERA_REBOTE_S} s: el servidor de destino aceptó el correo` };
  } catch (e) {
    // Sin IMAP no se puede ver el rebote: el envío salió, así que no se castiga al lead.
    return { ...base, valido: true, consultas, nota: `Enviado, pero no se pudo revisar rebotes por IMAP: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    await imap.logout().catch(() => {});
  }
}
