type AuthResult = { ok: true } | { ok: false; status: number; error: string };

export function checkApiKey(req: Request): AuthResult {
  const expected = (process.env.INFOBIP_EXT_API_KEY || "").trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "INFOBIP_EXT_API_KEY no configurada en el servidor.",
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
