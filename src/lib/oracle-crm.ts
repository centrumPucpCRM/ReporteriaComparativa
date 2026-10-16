/**
 * Cliente mínimo de la REST API de Oracle Sales Cloud (CRM), usado por Sistema de Vacaciones.
 *
 * Solo server-side: las credenciales (Basic auth) nunca deben llegar al browser, así que
 * este módulo se importa únicamente desde server actions / route handlers.
 *
 * Env (todas obligatorias): ORACLE_CRM_URL (host de la instancia, sin path),
 * ORACLE_CRM_USER y ORACLE_CRM_PASSWORD.
 */

const API_PATH = "/crmRestApi/resources/11.13.18.05";
const CAMPOS_VENDEDOR = "PartyName,ResourcePartyId,ResourcePartyNumber,ResourceEmail,CTREnVacaciones_c";
const PAGINA = 500;

function readEnvValue(name: string): string {
  const raw = (process.env[name] || "").trim();
  const value = raw.startsWith(`${name}=`) ? raw.slice(name.length + 1).trim() : raw;
  return value.replace(/^['"]|['"]$/g, "");
}

function config() {
  const baseUrl = readEnvValue("ORACLE_CRM_URL").replace(/\/+$/, "");
  const user = readEnvValue("ORACLE_CRM_USER");
  const password = readEnvValue("ORACLE_CRM_PASSWORD");
  if (!baseUrl || !user || !password) {
    throw new Error("Faltan ORACLE_CRM_URL, ORACLE_CRM_USER u ORACLE_CRM_PASSWORD en el entorno del servidor.");
  }
  return {
    baseUrl: `${baseUrl}${API_PATH}`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  };
}

async function oracleFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, headers } = config();
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Oracle CRM respondió ${res.status}: ${text.slice(0, 300) || res.statusText}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type Vendedor = {
  nombre: string;
  partyId: string;
  partyNumber: string;
  correo: string;
  enVacaciones: boolean;
};

type ResourceUser = {
  PartyName?: string | null;
  ResourcePartyId?: number | string | null;
  ResourcePartyNumber?: string | null;
  ResourceEmail?: string | null;
  CTREnVacaciones_c?: boolean | null;
};

function aVendedor(r: ResourceUser): Vendedor {
  return {
    nombre: r.PartyName ?? "",
    partyId: r.ResourcePartyId != null ? String(r.ResourcePartyId) : "",
    partyNumber: r.ResourcePartyNumber ?? "",
    correo: r.ResourceEmail ?? "",
    enVacaciones: r.CTREnVacaciones_c === true,
  };
}

/** Vendedores activos (rol SALES_REPRESENTATIVE), recorriendo todas las páginas. */
export async function listarVendedores(): Promise<Vendedor[]> {
  const vendedores: Vendedor[] = [];
  for (let offset = 0; ; offset += PAGINA) {
    const params = new URLSearchParams({
      fields: CAMPOS_VENDEDOR,
      q: 'UserStatus="A";IndividualRoleCode="SALES_REPRESENTATIVE"',
      onlyData: "true",
      limit: String(PAGINA),
      offset: String(offset),
    });
    const page = await oracleFetch<{ items?: ResourceUser[]; hasMore?: boolean }>(`/resourceUsers?${params}`);
    vendedores.push(...(page.items ?? []).map(aVendedor));
    if (!page.hasMore) break;
  }
  return vendedores.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Marca / desmarca a un vendedor como "en vacaciones" (CTREnVacaciones_c) y devuelve cómo quedó. */
export async function actualizarVacaciones(partyNumber: string, enVacaciones: boolean): Promise<Vendedor> {
  const params = new URLSearchParams({ fields: CAMPOS_VENDEDOR, onlyData: "true" });
  const r = await oracleFetch<ResourceUser>(`/resourceUsers/${encodeURIComponent(partyNumber)}?${params}`, {
    method: "PATCH",
    body: JSON.stringify({ CTREnVacaciones_c: enVacaciones }),
  });
  return aVendedor(r);
}
