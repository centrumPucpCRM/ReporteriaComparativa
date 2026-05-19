"use client";

import { useEffect, useMemo, useState } from "react";
import type { TableConfig } from "./types";

type Tab = "create" | "list" | "update" | "delete";

interface Props {
  config: TableConfig;
  apiPath: string;
  onClose: () => void;
}

const TAB_LABELS: Record<Tab, string> = {
  create: "Crear (POST)",
  list: "Listar (GET)",
  update: "Editar (PATCH)",
  delete: "Eliminar (DELETE)",
};

export default function ApiDocsModal({ config, apiPath, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("create");
  const [baseUrl] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : "https://tu-app.com",
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fullUrl = `${baseUrl}${apiPath}`;

  const exampleBody = useMemo(() => {
    const body: Record<string, unknown> = {};
    for (const col of config.columns) {
      if (col.readOnly) continue;
      if (col.type === "text") body[col.key] = `"ejemplo_${col.key}"`;
      else if (col.type === "number") body[col.key] = 1;
      else if (col.type === "datetime") body[col.key] = `"2026-05-19T08:00:00Z"`;
    }
    return body;
  }, [config.columns]);

  const code = useMemo(
    () => buildCode(tab, fullUrl, exampleBody),
    [tab, fullUrl, exampleBody],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignored
    }
  }

  const methodColor: Record<Tab, string> = {
    create: "bg-blue-100 text-blue-800",
    list: "bg-green-100 text-green-800",
    update: "bg-amber-100 text-amber-800",
    delete: "bg-red-100 text-red-800",
  };
  const method: Record<Tab, string> = {
    create: "POST",
    list: "GET",
    update: "PATCH",
    delete: "DELETE",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-200">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-gray-900">
              API REST · {config.title}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">
              <span className={`inline-block px-1.5 py-0.5 rounded font-bold mr-2 ${methodColor[tab]}`}>
                {method[tab]}
              </span>
              {tab === "update" || tab === "delete" ? `${fullUrl}/{id}` : fullUrl}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-2 border-b border-gray-100">
          {(["create", "list", "update", "delete"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-semibold transition-colors border-b-2 ${
                tab === t
                  ? "text-emerald-700 border-emerald-500"
                  : "text-gray-600 hover:text-gray-900 border-transparent"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Code block */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-md bg-gray-900 text-gray-100 font-mono text-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <span className="text-gray-400">Python · requests</span>
              <button
                onClick={copy}
                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
              >
                {copied ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <pre className="px-4 py-3 overflow-x-auto whitespace-pre">{code}</pre>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Reemplazá{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">YOUR_API_KEY</code> por la clave del servidor (env var{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">INFOBIP_EXT_API_KEY</code>).
          </p>
        </div>
      </div>
    </div>
  );
}

function buildCode(tab: Tab, url: string, exampleBody: Record<string, unknown>): string {
  const headers = `headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
}`;

  if (tab === "create") {
    return `import requests

url = "${url}"
${headers}
data = ${pythonDict(exampleBody)}

response = requests.post(url, headers=headers, json=data)
response.raise_for_status()
print(response.json())  # {"data": {...}}
`;
  }
  if (tab === "list") {
    return `import requests

url = "${url}"
${headers}
params = {"page": 1, "pageSize": 25}

response = requests.get(url, headers=headers, params=params)
response.raise_for_status()
print(response.json())  # {"data": [...], "total": N, "page": 1, "pageSize": 25}
`;
  }
  if (tab === "update") {
    return `import requests

row_id = 1  # reemplazá por el ID a editar
url = f"${url}/{row_id}"
${headers}
data = ${pythonDict(exampleBody)}

response = requests.patch(url, headers=headers, json=data)
response.raise_for_status()
print(response.json())  # {"data": {...}}
`;
  }
  return `import requests

row_id = 1  # reemplazá por el ID a eliminar
url = f"${url}/{row_id}"
${headers}

response = requests.delete(url, headers=headers)
response.raise_for_status()
print(response.json())  # {"ok": true}
`;
}

function pythonDict(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).map(([k, v]) => `    "${k}": ${v}`);
  return `{\n${entries.join(",\n")},\n}`;
}
