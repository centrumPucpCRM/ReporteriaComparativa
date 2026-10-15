"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Papa from "papaparse";
import SearchSelect, { type SearchOption } from "./SearchSelect";
import { Badge, BarraProgreso, EstadoFilaBadge, LeyendaProgreso, descargarCsv } from "./ui";
import {
  agregarDestinatarios,
  cargarCatalogos,
  cargarPlantillas,
  crearBroadcast,
  enviarLote,
  finalizarBroadcast,
  reintentarFallidos,
  verificarEntregas,
} from "./actions";
import {
  motivoNoSoportada,
  normalizarTelefono,
  normalizarTexto,
  renderTemplate,
  type AgentInfo,
  type DestinatarioInput,
  type FuenteVariable,
  type LineaEnvio,
  type Mapeo,
  type QueueInfo,
  type ResultadoDestinatario,
  type TemplateInfo,
} from "@/lib/broadcast";

interface Props {
  colaInicial: string | null;
  asesorInicial: string | null;
}

interface Catalogos {
  queues: QueueInfo[];
  agents: AgentInfo[];
  lineas: LineaEnvio[];
}

interface CsvData {
  archivo: string;
  columnas: string[];
  filas: Record<string, string>[];
}

interface FilaValidada {
  fila: number;
  telefonoOriginal: string;
  telefono: string | null;
  parametros: Record<string, string>;
  valores: Record<number, string>;
  problema: string | null;
}

interface Envio {
  broadcastId: number;
  ids: number[];
  resultados: Record<number, ResultadoDestinatario>;
  procesando: boolean;
  interrumpido: string | null;
  resumen: { ok: number; error: number; pendientes: number; sinConfirmar: number } | null;
}

const LOTE = 10;
/** Esperas entre consultas de entrega al terminar el envío. */
const ENTREGA_ESPERAS_MS = [5000, 8000, 12000, 20000];
const TANDA_INSERT = 500;
const COLUMNAS_TELEFONO = ["telefono", "celular", "movil", "phone", "numero", "whatsapp", "nt"];

const templateKey = (t: Pick<TemplateInfo, "name" | "language">) => `${t.name}|${t.language}`;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Resuelve un preseleccionado de la URL por id o por nombre exacto. */
function resolver<T extends { id: string; name: string }>(items: T[], buscado: string | null): string | null {
  if (!buscado) return null;
  const n = normalizarTexto(buscado);
  return (items.find((i) => i.id === buscado) ?? items.find((i) => normalizarTexto(i.name) === n))?.id ?? null;
}

export default function BroadcastClient({ colaInicial, asesorInicial }: Props) {
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [catalogoError, setCatalogoError] = useState<string | null>(null);

  const [campana, setCampana] = useState("");
  const [queueId, setQueueId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [senderManual, setSenderManual] = useState<string | null>(null);

  const [plantillasPorSender, setPlantillasPorSender] = useState<
    Record<string, { data: TemplateInfo[] } | { error: string }>
  >({});
  const [templateSel, setTemplateSel] = useState<string | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo>({});

  const [csv, setCsv] = useState<CsvData | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [colTelefono, setColTelefono] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [envio, setEnvio] = useState<Envio | null>(null);

  // ---------- Catálogos (colas, asesores, líneas) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await cargarCatalogos();
      if (cancelled) return;
      if (!r.success) {
        setCatalogoError(r.error);
        return;
      }
      setCatalogos(r.data);
      setQueueId(resolver(r.data.queues, colaInicial));
      setAgentId(resolver(r.data.agents, asesorInicial));
    })();
    return () => {
      cancelled = true;
    };
  }, [colaInicial, asesorInicial]);

  // ---------- Línea de envío: automática por cola, o elegida a mano ----------
  const lineaAuto = useMemo(
    () =>
      catalogos && queueId
        ? catalogos.lineas.find((l) => l.ingQueueId === queueId || l.genQueueId === queueId) ?? null
        : null,
    [catalogos, queueId],
  );
  const sender = lineaAuto?.ni ?? senderManual;

  // ---------- Plantillas de la línea ----------
  const plantillasEstado = sender ? plantillasPorSender[sender] : undefined;
  const plantillas = plantillasEstado && "data" in plantillasEstado ? plantillasEstado.data : null;
  const plantillasError = plantillasEstado && "error" in plantillasEstado ? plantillasEstado.error : null;

  useEffect(() => {
    if (!sender || plantillasPorSender[sender]) return;
    let cancelled = false;
    (async () => {
      const r = await cargarPlantillas(sender);
      if (cancelled) return;
      setPlantillasPorSender((prev) => ({
        ...prev,
        [sender]: r.success ? { data: r.data } : { error: r.error },
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [sender, plantillasPorSender]);

  const plantilla = plantillas?.find((t) => templateKey(t) === templateSel) ?? null;
  const noSoportada = plantilla ? motivoNoSoportada(plantilla) : null;

  function autoMapeo(t: TemplateInfo | null, columnas: string[], actual: Mapeo): Mapeo {
    if (!t) return {};
    const out: Mapeo = {};
    for (const n of t.variables) {
      const previo = actual[n];
      if (previo && (previo.tipo === "fijo" || columnas.includes(previo.columna))) {
        out[n] = previo;
        continue;
      }
      const col = columnas.find((c) => normalizarTexto(c) === `variable_${n}` || c.trim() === `{{${n}}}`);
      out[n] = { tipo: "columna", columna: col ?? "" };
    }
    return out;
  }

  function elegirPlantilla(key: string | null) {
    setTemplateSel(key);
    const t = plantillas?.find((p) => templateKey(p) === key) ?? null;
    setMapeo(autoMapeo(t, csv?.columnas ?? [], {}));
  }

  // ---------- CSV ----------
  function cargarArchivo(file: File) {
    setCsvError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const columnas = (res.meta.fields ?? []).filter(Boolean);
        if (columnas.length === 0 || res.data.length === 0) {
          setCsv(null);
          setCsvError("El archivo está vacío o no tiene fila de encabezados.");
          return;
        }
        setCsv({ archivo: file.name, columnas, filas: res.data });
        setColTelefono(columnas.find((c) => COLUMNAS_TELEFONO.includes(normalizarTexto(c))) ?? null);
        setMapeo((m) => autoMapeo(plantilla, columnas, m));
      },
      error: (err) => setCsvError(`No se pudo leer el archivo: ${err.message}`),
    });
  }

  function descargarModelo() {
    const fila: Record<string, string> = { telefono: "51999999999" };
    for (const n of plantilla?.variables ?? []) fila[`variable_${n}`] = `valor de {{${n}}}`;
    descargarCsv(`broadcast_modelo${plantilla ? `_${plantilla.name}` : ""}.csv`, [fila]);
  }

  // ---------- Validación por fila ----------
  const mapeoCompleto =
    !!plantilla &&
    plantilla.variables.every((n) => {
      const f = mapeo[n];
      return f && (f.tipo === "fijo" ? f.valor.trim() !== "" : f.columna !== "");
    });

  const filasValidadas: FilaValidada[] = useMemo(() => {
    if (!csv || !colTelefono || !plantilla) return [];
    const vistos = new Set<string>();
    return csv.filas.map((row, i) => {
      const telefonoOriginal = (row[colTelefono] ?? "").trim();
      const telefono = normalizarTelefono(telefonoOriginal);
      const valores: Record<number, string> = {};
      const parametros: Record<string, string> = {};
      let problema: string | null = null;
      for (const n of plantilla.variables) {
        const f = mapeo[n];
        const v = (f?.tipo === "fijo" ? f.valor : f ? row[f.columna] ?? "" : "").trim();
        valores[n] = v;
        parametros[`{{${n}}}`] = v;
        if (!v && !problema) problema = `{{${n}}} vacío`;
      }
      if (!telefono) problema = telefonoOriginal ? "Teléfono inválido" : "Sin teléfono";
      else if (vistos.has(telefono)) problema = "Teléfono repetido";
      if (telefono) vistos.add(telefono);
      // +2: la fila 1 del archivo es el encabezado.
      return { fila: i + 2, telefonoOriginal, telefono, parametros, valores, problema };
    });
  }, [csv, colTelefono, plantilla, mapeo]);

  const validas = filasValidadas.filter((f) => !f.problema);
  const invalidas = filasValidadas.filter((f) => f.problema);

  const queue = catalogos?.queues.find((q) => q.id === queueId) ?? null;
  const agent = catalogos?.agents.find((a) => a.id === agentId) ?? null;
  const linea = catalogos?.lineas.find((l) => l.ni === sender) ?? null;

  const listo =
    !!campana.trim() &&
    !!queue &&
    !!sender &&
    !!plantilla &&
    !noSoportada &&
    mapeoCompleto &&
    !!colTelefono &&
    validas.length > 0;

  // ---------- Envío ----------
  const procesando = creando || !!envio?.procesando;

  useEffect(() => {
    if (!procesando) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [procesando]);

  async function procesarIds(broadcastId: number, ids: number[]) {
    setEnvio((e) => (e ? { ...e, procesando: true, interrumpido: null } : e));
    for (const lote of chunk(ids, LOTE)) {
      const r = await enviarLote(broadcastId, lote);
      if (!r.success) {
        setEnvio((e) => (e ? { ...e, procesando: false, interrumpido: r.error } : e));
        return;
      }
      setEnvio((e) => {
        if (!e) return e;
        const resultados = { ...e.resultados };
        for (const res of r.data) resultados[res.id] = res;
        return { ...e, resultados };
      });
    }
    const resumen = await finalizarBroadcast(broadcastId);
    setEnvio((e) =>
      e ? { ...e, procesando: false, resumen: resumen.success ? resumen.data : e.resumen } : e,
    );
    await confirmarEntregas(broadcastId);
  }

  /**
   * WhatsApp confirma (o rechaza) la entrega unos segundos después de que
   * Infobip acepta el mensaje: se consulta un par de veces y se actualizan
   * las filas. Lo que quede pendiente se sigue verificando en el historial.
   */
  async function confirmarEntregas(broadcastId: number) {
    for (const espera of ENTREGA_ESPERAS_MS) {
      await new Promise((r) => setTimeout(r, espera));
      const r = await verificarEntregas(broadcastId);
      if (!r.success) return;
      setEnvio((e) => {
        if (!e || e.broadcastId !== broadcastId) return e;
        const resultados = { ...e.resultados };
        for (const res of r.data.actualizados) resultados[res.id] = res;
        return { ...e, resultados };
      });
      if (r.data.pendientes === 0) return;
    }
  }

  async function iniciarEnvio() {
    if (!listo || !plantilla || !queue || !sender) return;
    setConfirmando(false);
    setCreando(true);
    setErrorEnvio(null);

    const creado = await crearBroadcast({
      campana: campana.trim(),
      queueId: queue.id,
      queueNombre: queue.name,
      agentId: agent?.id ?? null,
      agentNombre: agent?.name ?? null,
      sender,
      templateNombre: plantilla.name,
      templateIdioma: plantilla.language,
      mapeo,
      total: validas.length,
    });
    if (!creado.success) {
      setCreando(false);
      setErrorEnvio(creado.error);
      return;
    }

    const broadcastId = creado.data.id;
    const ids: number[] = [];
    for (const tanda of chunk(validas, TANDA_INSERT)) {
      const filas: DestinatarioInput[] = tanda.map((f) => ({
        fila: f.fila,
        telefono: f.telefono!,
        parametros: f.parametros,
      }));
      const r = await agregarDestinatarios(broadcastId, filas);
      if (!r.success) {
        setCreando(false);
        setErrorEnvio(`Broadcast #${broadcastId}: no se pudieron registrar los destinatarios. ${r.error}`);
        return;
      }
      ids.push(...r.data);
    }

    setCreando(false);
    setEnvio({ broadcastId, ids, resultados: {}, procesando: true, interrumpido: null, resumen: null });
    await procesarIds(broadcastId, ids);
  }

  async function continuar() {
    if (!envio) return;
    const faltan = envio.ids.filter((id) => !envio.resultados[id]);
    await procesarIds(envio.broadcastId, faltan);
  }

  async function reintentar() {
    if (!envio) return;
    const r = await reintentarFallidos(envio.broadcastId);
    if (!r.success) {
      setEnvio({ ...envio, interrumpido: r.error });
      return;
    }
    const resultados = { ...envio.resultados };
    for (const id of r.data) delete resultados[id];
    setEnvio({ ...envio, resultados, resumen: null });
    await procesarIds(envio.broadcastId, r.data);
  }

  function nuevoBroadcast() {
    setEnvio(null);
    setCsv(null);
    setColTelefono(null);
    setCampana("");
    setErrorEnvio(null);
  }

  // ---------- Opciones de los buscadores ----------
  const opcionesCola: SearchOption[] = useMemo(
    () =>
      (catalogos?.queues ?? []).map((q) => {
        const l = catalogos?.lineas.find((x) => x.ingQueueId === q.id || x.genQueueId === q.id);
        const hints = [l ? `Línea ${l.ni}${l.programa ? ` · ${l.programa}` : ""}` : null, q.isPrivate ? "Privada" : null];
        return { value: q.id, label: q.name, hint: hints.filter(Boolean).join(" · ") || undefined };
      }),
    [catalogos],
  );
  const opcionesAsesor: SearchOption[] = useMemo(
    () =>
      (catalogos?.agents ?? []).map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.role === "SUPERVISOR" ? "Supervisor" : "Agente",
      })),
    [catalogos],
  );
  const opcionesLinea: SearchOption[] = useMemo(
    () =>
      (catalogos?.lineas ?? []).map((l) => ({ value: l.ni, label: l.ni, hint: l.programa ?? undefined })),
    [catalogos],
  );
  const opcionesPlantilla: SearchOption[] = useMemo(
    () =>
      (plantillas ?? []).map((t) => {
        const motivo = motivoNoSoportada(t);
        const vars = t.variables.length ? `${t.variables.length} variable(s)` : "sin variables";
        return {
          value: templateKey(t),
          label: t.name,
          hint: motivo ?? `${t.language} · ${t.category} · ${vars}`,
          disabled: !!motivo,
        };
      }),
    [plantillas],
  );

  // ---------- Render ----------
  if (catalogoError) {
    return (
      <Contenedor>
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudieron cargar colas y asesores de Infobip: {catalogoError}
        </p>
      </Contenedor>
    );
  }

  if (envio) {
    return (
      <Contenedor>
        <ProgresoEnvio
          envio={envio}
          campana={campana}
          onContinuar={continuar}
          onReintentar={reintentar}
          onNuevo={nuevoBroadcast}
        />
      </Contenedor>
    );
  }

  const primeraValida = validas[0];

  return (
    <Contenedor>
      {/* 1. Destino */}
      <Paso numero={1} titulo="Destino" descripcion="A qué cola entran las conversaciones y quién las atiende.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Campaña<span className="text-red-500"> *</span>
            </label>
            <input
              value={campana}
              onChange={(e) => setCampana(e.target.value)}
              placeholder='Ej: "Cierre admisión MBA octubre"'
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Se usa como etiqueta en Infobip (junto con BROADCAST) para filtrar estas conversaciones.
            </p>
          </div>
          <SearchSelect
            label="Cola"
            required
            placeholder="Selecciona la cola"
            options={opcionesCola}
            value={queueId}
            onChange={(v) => {
              setQueueId(v);
              setSenderManual(null);
            }}
            loading={!catalogos}
          />
          <SearchSelect
            label="Asesor (opcional)"
            placeholder="Sin asesor: queda en la cola"
            clearLabel="Sin asesor"
            options={opcionesAsesor}
            value={agentId}
            onChange={setAgentId}
            loading={!catalogos}
          />
          <div className="sm:col-span-2">
            {!queueId ? null : lineaAuto ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                <span className="font-semibold">Línea de envío:</span> {lineaAuto.ni}
                {lineaAuto.programa ? ` · ${lineaAuto.programa}` : ""}
                <span className="text-sky-700"> (según la cola)</span>
              </div>
            ) : (
              <SearchSelect
                label="Línea de envío"
                required
                placeholder="Esta cola no tiene línea asociada: elige desde qué número sale"
                options={opcionesLinea}
                value={senderManual}
                onChange={setSenderManual}
              />
            )}
          </div>
        </div>
      </Paso>

      {/* 2. Plantilla */}
      <Paso numero={2} titulo="Plantilla" descripcion="Plantilla aprobada de WhatsApp y de dónde sale cada variable.">
        {!sender ? (
          <p className="text-sm text-gray-500">Primero elige la cola (y la línea de envío si hace falta).</p>
        ) : plantillasError ? (
          <p className="text-sm text-red-600">No se pudieron cargar las plantillas: {plantillasError}</p>
        ) : (
          <div className="space-y-4">
            <SearchSelect
              label="Plantilla"
              required
              placeholder="Busca la plantilla por nombre"
              options={opcionesPlantilla}
              value={templateSel}
              onChange={elegirPlantilla}
              loading={!plantillas}
            />
            {plantilla ? (
              <>
                {noSoportada ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {noSoportada}
                  </p>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                      Vista previa{primeraValida ? ` (fila ${primeraValida.fila})` : ""}
                    </p>
                    <div className="rounded-lg bg-[#e5ddd5] p-3">
                      <div className="max-w-sm rounded-lg bg-white px-3 py-2 shadow-sm">
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-900">
                          {renderTemplate(plantilla.body, primeraValida?.valores ?? {})}
                        </p>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Idioma {plantilla.language} · {plantilla.category}
                      {plantilla.buttons.length ? ` · Botones: ${plantilla.buttons.join(", ")}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Variables</p>
                    {plantilla.variables.length === 0 ? (
                      <p className="text-sm text-gray-500">Esta plantilla no tiene variables.</p>
                    ) : (
                      <div className="space-y-2">
                        {plantilla.variables.map((n) => (
                          <MapeoVariable
                            key={n}
                            n={n}
                            fuente={mapeo[n]}
                            columnas={csv?.columnas ?? []}
                            onChange={(f) => setMapeo((m) => ({ ...m, [n]: f }))}
                          />
                        ))}
                        {!csv ? (
                          <p className="text-[11px] text-gray-500">
                            Sube el CSV (paso 3) para poder asignar columnas.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </Paso>

      {/* 3. Destinatarios */}
      <Paso numero={3} titulo="Destinatarios" descripcion="CSV con una fila por contacto y columnas para cada variable.">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
            Subir CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) cargarArchivo(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={descargarModelo}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Descargar CSV modelo
          </button>
          {csv ? (
            <span className="text-sm text-gray-600">
              {csv.archivo} · {csv.filas.length} filas
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Desde Excel guárdalo como &quot;CSV UTF-8&quot; para que las tildes se lean bien. Teléfonos de Perú:
          con o sin 51.
        </p>
        {csvError ? <p className="mt-2 text-sm text-red-600">{csvError}</p> : null}

        {csv ? (
          <div className="mt-4 space-y-3">
            <div className="max-w-xs">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                Columna de teléfono<span className="text-red-500"> *</span>
              </label>
              <select
                value={colTelefono ?? ""}
                onChange={(e) => setColTelefono(e.target.value || null)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              >
                <option value="">Selecciona...</option>
                {csv.columnas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {plantilla && colTelefono ? (
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge color="emerald">{validas.length} listas para enviar</Badge>
                {invalidas.length ? <Badge color="red">{invalidas.length} con problemas (no se envían)</Badge> : null}
              </div>
            ) : null}
            {invalidas.length && mapeoCompleto ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-red-100">
                <table className="w-full text-sm">
                  <tbody>
                    {invalidas.slice(0, 200).map((f) => (
                      <tr key={f.fila} className="border-b border-red-50">
                        <td className="px-3 py-1 text-gray-500">Fila {f.fila}</td>
                        <td className="px-3 py-1 font-mono text-gray-900">{f.telefonoOriginal || "—"}</td>
                        <td className="px-3 py-1 text-red-600">{f.problema}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Paso>

      {/* 4. Envío */}
      <div className="flex flex-col items-end gap-2">
        {errorEnvio ? <p className="text-sm text-red-600">{errorEnvio}</p> : null}
        <button
          type="button"
          disabled={!listo || creando}
          onClick={() => setConfirmando(true)}
          className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {creando ? "Preparando..." : `Enviar a ${validas.length} contacto(s)`}
        </button>
        {!listo ? (
          <p className="text-[11px] text-gray-500">
            Completa campaña, cola, plantilla, variables y CSV para habilitar el envío.
          </p>
        ) : null}
      </div>

      {confirmando && plantilla && queue && linea ? (
        <Modal onClose={() => setConfirmando(false)}>
          <h2 className="text-base font-bold text-gray-900">Confirmar broadcast</h2>
          <p className="mt-1 text-sm text-gray-600">Se enviarán mensajes reales de WhatsApp. No se puede deshacer.</p>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Dato label="Contactos">{validas.length}</Dato>
            <Dato label="Campaña">{campana.trim()}</Dato>
            <Dato label="Cola">{queue.name}</Dato>
            <Dato label="Asesor">{agent?.name ?? "Sin asesor (queda en la cola)"}</Dato>
            <Dato label="Línea">
              {linea.ni}
              {linea.programa ? ` · ${linea.programa}` : ""}
            </Dato>
            <Dato label="Plantilla">
              {plantilla.name} ({plantilla.language})
            </Dato>
          </dl>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={iniciarEnvio}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
            >
              Enviar ahora
            </button>
          </div>
        </Modal>
      ) : null}
    </Contenedor>
  );
}

// ==================== Subcomponentes ====================

function Contenedor({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Broadcast</h1>
        <p className="mt-1 text-sm text-gray-600">
          Envío masivo de plantillas WhatsApp que crea (o reutiliza) la conversación de cada contacto en la cola
          elegida, a diferencia del broadcast nativo de Infobip.{" "}
          <Link
            href="/modulos/microservicios/infobip-ext/broadcast/historial"
            className="font-semibold text-sky-700 hover:underline"
          >
            Ver historial de broadcasts →
          </Link>
        </p>
      </div>
      {children}
    </div>
  );
}

function Paso({
  numero,
  titulo,
  descripcion,
  children,
}: {
  numero: number;
  titulo: string;
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
          {numero}
        </span>
        <div>
          <h2 className="text-base font-bold text-gray-900">{titulo}</h2>
          <p className="text-sm text-gray-500">{descripcion}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function MapeoVariable({
  n,
  fuente,
  columnas,
  onChange,
}: {
  n: number;
  fuente: FuenteVariable | undefined;
  columnas: string[];
  onChange: (f: FuenteVariable) => void;
}) {
  const tipo = fuente?.tipo ?? "columna";
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 font-mono text-sm font-bold text-gray-700">{`{{${n}}}`}</span>
      <select
        value={tipo}
        onChange={(e) =>
          onChange(e.target.value === "fijo" ? { tipo: "fijo", valor: "" } : { tipo: "columna", columna: "" })
        }
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
      >
        <option value="columna">Columna</option>
        <option value="fijo">Valor fijo</option>
      </select>
      {tipo === "fijo" ? (
        <input
          value={fuente?.tipo === "fijo" ? fuente.valor : ""}
          onChange={(e) => onChange({ tipo: "fijo", valor: e.target.value })}
          placeholder="Igual para todos"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      ) : (
        <select
          value={fuente?.tipo === "columna" ? fuente.columna : ""}
          onChange={(e) => onChange({ tipo: "columna", columna: e.target.value })}
          disabled={columnas.length === 0}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm font-semibold text-gray-900 disabled:bg-gray-50"
        >
          <option value="">Selecciona columna...</option>
          {columnas.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ProgresoEnvio({
  envio,
  campana,
  onContinuar,
  onReintentar,
  onNuevo,
}: {
  envio: Envio;
  campana: string;
  onContinuar: () => void;
  onReintentar: () => void;
  onNuevo: () => void;
}) {
  const [soloProblemas, setSoloProblemas] = useState(false);
  const resultados = envio.ids.map((id) => envio.resultados[id]).filter(Boolean);
  const hechos = resultados.length;
  const total = envio.ids.length;
  const errores = resultados.filter((r) => r.estado === "ERROR").length;
  const reutilizadas = resultados.filter((r) => r.estado === "OK" && r.reutilizada).length;
  const conAdvertencia = resultados.filter((r) => r.advertencia).length;
  const entregados = resultados.filter((r) => r.entrega === "ENTREGADO").length;
  const noEntregados = resultados.filter((r) => r.entrega === "NO_ENTREGADO").length;
  const confirmando = resultados.filter((r) => r.estado === "OK" && r.entrega === "PENDIENTE").length;
  const pct = total ? Math.round((hechos / total) * 100) : 0;
  const visibles = soloProblemas
    ? resultados.filter((r) => r.estado !== "OK" || r.advertencia || r.entrega === "NO_ENTREGADO")
    : resultados;
  const terminado = !envio.procesando && !envio.interrumpido && hechos >= total;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">
            Broadcast #{envio.broadcastId} · {campana}
          </h2>
          <p className="text-sm text-gray-500">
            {envio.procesando
              ? "Enviando por lotes. No cierres esta pestaña."
              : terminado
                ? "Envío terminado."
                : "Envío detenido."}
          </p>
        </div>
        <span className="text-2xl font-bold text-gray-900">{pct}%</span>
      </div>

      <BarraProgreso
        total={total}
        entregados={entregados}
        fallidos={errores + noEntregados}
        confirmando={confirmando}
        sinConfirmar={resultados.filter((r) => r.estado === "ENVIANDO").length}
        alto="h-3"
      />
      <LeyendaProgreso />

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge color="gray">
          {hechos} / {total} procesados
        </Badge>
        <Badge color="emerald">{entregados} entregados</Badge>
        {confirmando ? <Badge color="sky">{confirmando} confirmando entrega</Badge> : null}
        {noEntregados ? <Badge color="red">{noEntregados} no entregados</Badge> : null}
        {reutilizadas ? <Badge color="gray">{reutilizadas} en conversación existente</Badge> : null}
        {errores ? <Badge color="red">{errores} con error al enviar</Badge> : null}
        {conAdvertencia ? <Badge color="amber">{conAdvertencia} con advertencia</Badge> : null}
      </div>

      {envio.interrumpido ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Se interrumpió el envío: {envio.interrumpido}
        </div>
      ) : null}
      {envio.resumen?.sinConfirmar ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {envio.resumen.sinConfirmar} contacto(s) quedaron sin confirmar (el envío se cortó a mitad). No se
          reintentan solos para no duplicar: revísalos en Infobip.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!envio.procesando && hechos < total ? (
          <button
            type="button"
            onClick={onContinuar}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            Continuar envío
          </button>
        ) : null}
        {!envio.procesando && errores ? (
          <button
            type="button"
            onClick={onReintentar}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Reintentar {errores} con error
          </button>
        ) : null}
        <button
          type="button"
          disabled={hechos === 0}
          onClick={() =>
            descargarCsv(
              `broadcast_${envio.broadcastId}_resultados.csv`,
              resultados.map((r) => ({
                fila: r.fila,
                telefono: r.telefono,
                estado: r.estado,
                entrega: r.entrega ?? "",
                detalle_entrega: r.entregaDetalle ?? "",
                conversacion: r.conversationId ?? "",
                reutilizada: r.reutilizada ? "si" : "no",
                error: r.error ?? "",
                advertencia: r.advertencia ?? "",
              })),
            )
          }
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Descargar resultados
        </button>
        <Link
          href={`/modulos/microservicios/infobip-ext/broadcast/historial/${envio.broadcastId}`}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Ver en historial
        </Link>
        {!envio.procesando ? (
          <button
            type="button"
            onClick={onNuevo}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Nuevo broadcast
          </button>
        ) : null}
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} />
          Solo problemas
        </label>
      </div>

      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2">Fila</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {visibles.slice(0, 500).map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-1.5 text-gray-500">{r.fila}</td>
                <td className="px-3 py-1.5 font-mono text-gray-900">{r.telefono}</td>
                <td className="px-3 py-1.5">
                  <EstadoFilaBadge estado={r.estado} reutilizada={r.reutilizada} entrega={r.entrega} />
                </td>
                <td className="px-3 py-1.5 text-xs text-gray-600">
                  {r.error ? <p className="text-red-600">{r.error}</p> : null}
                  {r.entregaDetalle ? <p className="text-red-600">{r.entregaDetalle}</p> : null}
                  {r.advertencia ? <p className="text-amber-700">{r.advertencia}</p> : null}
                  {r.conversationId ? <p className="font-mono text-gray-400">{r.conversationId}</p> : null}
                </td>
              </tr>
            ))}
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  {envio.procesando ? "Procesando el primer lote..." : "Sin filas para mostrar."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-gray-500">{label}</dt>
      <dd className="font-semibold text-gray-900">{children}</dd>
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
