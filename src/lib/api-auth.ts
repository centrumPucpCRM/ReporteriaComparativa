type AuthResult = { ok: true } | { ok: false; status: number; error: string };

export function checkApiKey(req: Request, envName = "INFOBIP_EXT_API_KEY"): AuthResult {
  const expected = (process.env[envName] || "").trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: `${envName} no configurada en el servidor.`,
    };
  }

  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Falta el header "Authorization: Bearer <api_key>".',
    };
  }
  if (token !== expected) {
    return { ok: false, status: 401, error: "API key inválida." };
  }
  return { ok: true };
}
