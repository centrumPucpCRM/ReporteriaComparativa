"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatHistory, ChatMessage } from "@/lib/infobip-ext-api";

type LoadResult =
  | { success: true; data: ChatHistory }
  | { success: false; error: string };

interface Props {
  conversationId: string;
  /** Lead de la fila, solo para mostrarlo en la cabecera. */
  leadId?: string | null;
  /** Server action que trae el historial desde InfobipExt. */
  load: (conversationId: string) => Promise<LoadResult>;
  onClose: () => void;
}

export default function ChatHistoryModal({ conversationId, leadId, load, onClose }: Props) {
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // El primer setState tiene que quedar detrás del await: llamarlo de forma
  // síncrona en el cuerpo del effect dispara renders en cascada y el lint
  // del proyecto lo rechaza. El estado inicial ya es "loading", así que el
  // montaje no necesita marcarlo; el refresh lo hace en su handler.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await load(conversationId);
      if (cancelled) return;
      if (result.success) {
        setHistory(result.data);
        setError(null);
      } else {
        setError(result.error);
        setHistory(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, load, reloadKey]);

  const fetchHistory = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl max-h-[90vh] flex-col bg-white rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900">Historial de chat</h2>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              <span className="font-mono">{conversationId}</span>
              {leadId ? ` · Lead ${leadId}` : ""}
              {history ? ` · ${history.total_mensajes} mensajes` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={fetchHistory}
              disabled={loading}
              title="Volver a sincronizar con Infobip"
              aria-label="Actualizar"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {history?.stale ? (
          <div className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
            No se pudo sincronizar con Infobip. Se muestra lo último guardado en
            InfobipExt, puede faltar lo más reciente.
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-50">
          {loading ? (
            <p className="py-12 text-center text-sm text-gray-500">
              Sincronizando con Infobip...
            </p>
          ) : error ? (
            <p className="py-12 text-center text-sm text-red-600">{error}</p>
          ) : !history || history.mensajes.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">
              Esta conversación no tiene mensajes registrados.
            </p>
          ) : (
            <div className="space-y-3">
              {history.mensajes.map((m) => (
                <Bubble key={m.id} mensaje={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ mensaje }: { mensaje: ChatMessage }) {
  const isNote = mensaje.tipo === "NOTE" || mensaje.direccion === "INTERNAL";
  const isOutbound = mensaje.direccion === "OUTBOUND";

  // Las notas son internas (las deja el vendedor o el flujo de venta activa),
  // no parte de la conversación con el cliente: van centradas y sin lado.
  if (isNote) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
            Nota interna{mensaje.remitente ? ` · ${mensaje.remitente}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-amber-900">
            {mensaje.contenido || "(sin contenido)"}
          </p>
          <Timestamp value={mensaje.created_at_infobip} className="text-amber-600" />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${
          isOutbound
            ? "bg-emerald-100 border border-emerald-200"
            : "bg-white border border-gray-200"
        }`}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {isOutbound ? "Vendedor" : "Cliente"}
          {mensaje.remitente ? ` · ${mensaje.remitente}` : ""}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900">
          {mensaje.contenido || "(sin contenido)"}
        </p>
        <Timestamp value={mensaje.created_at_infobip} className="text-gray-400" />
      </div>
    </div>
  );
}

function Timestamp({ value, className }: { value: string | null; className: string }) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <p className={`mt-1 text-[10px] ${className}`}>
      {d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}
    </p>
  );
}
