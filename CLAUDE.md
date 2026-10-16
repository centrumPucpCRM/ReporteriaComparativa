# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Centrum PUCP CRM platform, organized as a hub of modules. Two areas exist today:
- **Reportería Comparativa** — compares program metrics (leads, conversions, enrollments) between 2025 and 2026 cohorts, aligned relative to inauguration dates.
- **Microservicios** — internal operational tools. `infobip-ext` is the first real one: CRUD admin tables over a custom Supabase schema plus a token-authenticated REST API consumed by external Infobip flows. `eloqua-webhooks` recibe webhooks outbound de Eloqua (hoy: exportar contactos a Google Sheets). `sistema-vacaciones` is still a placeholder.

Built in Spanish for Spanish-speaking users — keep UI strings, comments, and commit messages in Spanish to match.

## Commands

- `npm run dev` — Start dev server (Turbopack enabled)
- `npm run build` — Production build
- `npm run lint` — ESLint

No test framework is configured.

## Architecture

**Framework**: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + React 19

**Folder layout** (everything lives under `src/`):

```
src/
├── lib/
│   ├── supabase/
│   │   ├── client.ts    # browser anon client (flowType: "implicit")
│   │   ├── server.ts    # server anon + cookies
│   │   └── admin.ts     # service role (server-only, bypassa RLS)
│   └── api-auth.ts      # checkApiKey() — Bearer-token guard for /api/* routes
├── components/
│   ├── LogoutButton.tsx # avatar + email + Salir (client-side via supabase.auth.getUser)
│   ├── ModuleShell.tsx  # shared sidebar layout for module sub-pages (nav, collapse, logout)
│   └── data-table/      # generic CRUD table library (see "Generic data-table" below)
├── middleware.ts    # auth guard (excludes /api/ — those routes self-authenticate)
└── app/
    ├── (auth)/             # login + update-password (invite)
    ├── auth/               # callback, forgot, reset (route handlers + recovery pages)
    ├── api/                # REST endpoints (NOT session-guarded; own API-key auth)
    │   └── infobip-ext/    # [table] CRUD + [table]/[id] + decidir-cola + _tables allowlist
    ├── (platform)/         # session-authenticated app
    │   └── modulos/        # module hub
    │       ├── reporteria/      # dashboard comparativo + lib/ (standalone header)
    │       └── microservicios/  # ModuleShell sidebar modules
    │           ├── infobip-ext/      # CRUD tables driven by data-table lib
    │           ├── eloqua-webhooks/  # instrucciones + prueba del webhook Eloqua → Google Sheets
    │           └── sistema-vacaciones/  # placeholder
    └── page.tsx     # redirects to /modulos
```

**Path alias**: `@/*` maps to `./src/*`.

## Routing

- `/` → redirects to `/modulos`
- `/login` → Supabase email/password auth
- `/auth/forgot` → request password reset email
- `/auth/reset` → set new password (recovery flow)
- `/auth/callback` → server-side handler for `token_hash` (recovery) and PKCE `code` (invite, OAuth)
- `/update-password` → invite-based onboarding (separate from `/auth/reset`)
- `/modulos` → authenticated hub (entry point after login); selector con cards a cada módulo
- `/modulos/reporteria` → dashboard comparativo (módulo principal)
- `/modulos/microservicios` → selector de microservicios (cards)
- `/modulos/microservicios/infobip-ext` → home + sub-tablas (`conversation-lead-relation`, `sender-last-rdv`, `colas`) + `broadcast` (envío masivo, ver "Broadcast")
- `/modulos/microservicios/eloqua-webhooks` → instrucciones de configuración + formulario de prueba
- `/modulos/microservicios/sistema-vacaciones` → placeholder
- `/api/infobip-ext/*` → REST API (see "REST API layer" below); not behind session auth

**Two layout conventions coexist** — match the one already in the branch of the tree you're editing:
- **Reportería** is a standalone page: it renders its own header with a `← Módulos` breadcrumb (back to `/modulos`) and `<LogoutButton />` on the right. No shared layout wraps it.
- **Microservicios** sub-modules use a shared sidebar: each has a `layout.tsx` that wraps `children` in [`<ModuleShell>`](src/components/ModuleShell.tsx) with `info`, a `back` link, and `sections` of nav `views`. ModuleShell renders the sidebar (collapsible, persisted in `localStorage` under `moduleShell:collapsed` and synced across tabs via `useSyncExternalStore`), the user/logout footer, and a mobile drawer. New microservicio pages should add a nav entry in the module's `layout.tsx` rather than building a bespoke header.

## Authentication

Supabase Auth via `@supabase/ssr`. Middleware ([src/middleware.ts](src/middleware.ts)) guards everything except `/login` and `/auth/*` (and `/update-password` for the invite flow), redirecting unauth'd users to `/login`. The matcher also excludes `/api/` entirely, so REST routes never run session middleware — they authenticate themselves via API key (see "REST API layer"). Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `SUPABASE_SERVICE_ROLE_KEY` if `admin.ts` is used).

### Forgot-password flow (cross-browser)

The reset flow is designed to work when the user requests the reset in one browser and opens the email in another (e.g., requests in Chrome, opens email in Outlook → opens in Edge).

**Why this is non-trivial**: Supabase's default PKCE flow stores a `code_verifier` in the requesting browser's localStorage. A second browser doesn't have it, so `exchangeCodeForSession` fails. The fix uses the **OTP `token_hash` flow** instead, which is stateless.

**Three pieces have to agree**:
1. Browser client ([src/lib/supabase/client.ts](src/lib/supabase/client.ts)) uses `flowType: "implicit"` so `resetPasswordForEmail` doesn't try to mint a PKCE verifier.
2. Supabase Dashboard → Authentication → Email Templates → **Reset Password** template's link must be `{{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}&type=recovery` (NOT the default `{{ .ConfirmationURL }}` which forces PKCE).
3. Supabase Dashboard → Authentication → URL Configuration → **Site URL** has NO trailing `/` (otherwise the template produces `//auth/reset` → broken on some email providers' safelinks).

**Critical gotcha in [src/app/auth/reset/page.tsx](src/app/auth/reset/page.tsx)**: if the user has a pre-existing session in cookies (e.g., logged in on another tab of the same browser), `verifyOtp({type:"recovery"})` mixes with that session, `updateUser({password})` runs against the wrong session, and the password update appears successful but doesn't persist. The page therefore **forces `signOut({scope:"local"})` before processing any URL token**, and **does NOT fall back to an existing session** when a token is present in the URL but verification fails. The "existing session" branch is the *last* fallback and only fires when no URL token is present (the legitimate redirect-from-callback case).

The reset page handles 4 token-delivery shapes: `?token_hash=...&type=recovery` (preferred), `#access_token=...&refresh_token=...` (hash fragment legacy), `?code=...` (PKCE same-browser), or no token + pre-existing recovery cookies (from callback redirect).

The server-side [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts) mirrors this: tries `verifyOtp(token_hash)` first, falls back to `exchangeCodeForSession(code)`.

### Invite flow (separate)

Admins invite users from Supabase Dashboard. The invite email lands at `/login` with tokens in the hash fragment; [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx) detects `type=invite` in the hash, calls `setSession`, and redirects to `/update-password`. This flow is **distinct from `/auth/reset`** — don't merge them.

## Data Layer

[src/app/(platform)/modulos/reporteria/lib/](src/app/(platform)/modulos/reporteria/lib/):
- `config.ts` — S3 CSV URLs, metric definitions, color schemes
- `dataService.ts` — `DataService` singleton that loads and filters CSV data from S3 via PapaParse. Holds in-memory stores for datamarts (2025/2026), program metadata, and pairing data.
- `compareEngine.ts` — Aligns 2025/2026 data relative to inauguration dates for comparison. Includes linear regression projections.
- `chartRenderer.ts` — Chart.js wrapper. Single global chart instance, destroyed and recreated on data change. Dual-axis support (leads + custom metric).

## Reportería page

[src/app/(platform)/modulos/reporteria/page.tsx](src/app/(platform)/modulos/reporteria/page.tsx): large `'use client'` component (~1270 lines). All state in local React hooks. Multi-select dropdown filters, dual-mode metrics ("alumnos" / "pxq"), and an export flow that POSTs to an AWS Lambda which returns S3 pre-signed URLs for CSV downloads.

**Filter dropdowns**: the three button-style dropdowns (`FilterDropdown`, `ProgramaDropdown`, `Par2025Dropdown`) explicitly set `text-gray-900 font-semibold` on their display label span — without it, some browsers/themes inherit a light gray system color and the selected value reads as faint/transparent. Don't strip this.

## Generic data-table (microservicios)

[src/components/data-table/](src/components/data-table/) is a config-driven CRUD admin table reused across `infobip-ext` sub-tables. A page wires three pieces together (see [colas/page.tsx](src/app/(platform)/modulos/microservicios/infobip-ext/colas/page.tsx) as the canonical example):

1. **`TableConfig`** ([types.ts](src/components/data-table/types.ts)) — declares columns (`text | number | datetime`, with `readOnly`, `required`, `unique`, `hiddenInTable`, `filterable`), `primaryKey`, default sort/page-size, optional `apiPath` (when set, the table header shows an **API** button opening [ApiDocsModal](src/components/data-table/ApiDocsModal.tsx), which generates copy-paste Python snippets from the column config), and optional `incompleteColumns` (when set, shows a **"Solo incompletos"** toggle that filters to rows where any of those columns is NULL — mirrors the REST layer's `incompleteColumns`, see below).
2. **`DataTableActions`** — `list / create / update / remove`. Built by [`createTableActions({ schema, table, primaryKey })`](src/components/data-table/createTableActions.ts), which returns Supabase-backed implementations. Each action calls `requireUser()` first (server-side session gate) and then uses the **admin client** (service role, bypasses RLS) against a schema-qualified table. DB errors are run through `humanizeError()` to produce Spanish messages.
3. **`<DataTableView config actions />`** — the `'use client'` UI. The paginator has a "jump to page" input in addition to prev/next.

The per-table `actions.ts` must be a `"use server"` module that re-exports thin wrappers around `createTableActions(...)` — you cannot pass a server-action object created elsewhere; each exported function has to be declared in the action file.

## REST API layer (infobip-ext)

[src/app/api/infobip-ext/](src/app/api/infobip-ext/) is a separate, **session-less** surface for external callers (Infobip flows). Key facts:

- **Auth is API-key, not Supabase session.** Every handler calls [`checkApiKey(req)`](src/lib/api-auth.ts) first, expecting `Authorization: Bearer <INFOBIP_EXT_API_KEY>`. The middleware matcher explicitly excludes `/api/` ([src/middleware.ts](src/middleware.ts)), so these routes are NOT redirected to `/login` — the key is the only gate. Missing env key → `503`; bad/absent key → `401`.
- **Table allowlist.** `[table]` is resolved through [_tables.ts](src/app/api/infobip-ext/_tables.ts), which maps a public slug → a `TableDef` (`schema`, `table`, `primaryKey`, plus the optional per-table behaviors below). Only listed slugs are reachable; this is the boundary that prevents arbitrary table access. To expose a new table, add it here (and usually mirror it as a data-table UI page).
- **Routes**: `GET/POST /api/infobip-ext/[table]`, `GET/PATCH/DELETE /api/infobip-ext/[table]/[id]`. All use the admin client schema-qualified via `.schema(target.schema)`. Every handler is wrapped in try/catch → `serverError()` (logs + 500).
- **`GET`** lists w/ `?page&pageSize` (max 500 per page), ordered by `primaryKey` descending. `?incompletos=true` restricts to rows where any of `TableDef.incompleteColumns` is NULL (OR'd `is.null` filters) — used to find migration rows still missing data.
- **`POST` upsert semantics** (in [[table]/route.ts](src/app/api/infobip-ext/[table]/route.ts)): if `TableDef.upsertOn` is set, the row is `upsert()`'d on that column (CSV for composite keys) instead of inserted — e.g. `conversation-lead-relation` upserts on `infobip_conversation_id`, `sender-last-rdv` on `telefono_contacto,sender`. Two behaviors layer on top:
  - `preserveOnNull: true` strips `null`/`undefined` keys from the payload before writing, so an upsert with a missing field doesn't null out an existing value (PostgREST only touches columns present in the payload — this is effectively `COALESCE(incoming, current)`).
  - `touch` names a timestamp column that gets stamped with `now()` on write, **unless the caller already sent an explicit value** for it (needed so historical-data migrations can preserve the real original timestamp instead of getting today's date).
- **Batch POST**: if the JSON body is an array (≤500 rows), each row is processed independently with bounded concurrency (20 at a time) through the same `writeRow` upsert/insert path, and the response reports per-row success/failure (`{ total, ok, failed, results }`) so a caller can retry just the failed rows. A single-object body still returns `{ data }` with `201` (insert) or `200` (upsert).
- **`POST /api/infobip-ext/decidir-cola`** is business logic, not generic CRUD: given `{ nt, ni }` it looks up the queue pair for the Infobip number (`colas`), checks whether the contact has a prior `sender_last_rdv`, and returns which Infobip queue (`IN` vs `GEN`) to route the inbound to.

**Supabase schema**: the infobip data lives in a non-public schema named `Infobip_ext` (capital I, underscore) with tables `conversation_lead_relation`, `sender_last_rdv`, `colas`. Always access it via `.schema("Infobip_ext")` — the default client only sees `public`. The casts to `as any` on `.from(table)` are a known workaround because these tables aren't in the generated Supabase types.

## Broadcast (infobip-ext)

[broadcast/](src/app/(platform)/modulos/microservicios/infobip-ext/broadcast/) envía una plantilla WhatsApp a una lista (CSV) **creando o reutilizando la conversación CCaaS de cada contacto** en la cola elegida — a diferencia del broadcast nativo de Infobip, que no crea conversaciones. Habla directo con Infobip vía [src/lib/infobip.ts](src/lib/infobip.ts) (server-only); utilidades puras compartidas con la UI en [src/lib/broadcast.ts](src/lib/broadcast.ts).

- **Cola obligatoria, asesor opcional**, ambos buscados en vivo en Infobip (`/ccaas/1/queues`, `/ccaas/1/agents`, solo agentes `enabled`). `?cola=` / `?asesor=` en la URL los preselecciona (id o nombre exacto).
- **Línea de envío (`from`)**: se deduce de la cola si es la IN/GEN de alguna fila de `colas`; si no, el usuario la elige entre los NI de esa tabla. Nunca hay número por defecto. Los 7 números comparten WABA, así que la plantilla no determina el número.
- **Plantillas**: `/whatsapp/2/senders/{ni}/templates`, solo `APPROVED`. Se envían con el **idioma propio de la plantilla** (muchas están registradas como `en` aunque el texto es español). Solo variables de cuerpo: cabeceras con media o variables se bloquean (`motivoNoSoportada`) porque el formato CCaaS no está verificado.
- **Reutilización**: Infobip no permite buscar conversaciones por teléfono (`GET /ccaas/1/conversations` solo filtra por ids, cola, tags, agente, estado, prioridad y fechas; `customerId` existe sin documentar y devuelve 0). El broadcast lleva su propio registro `broadcast_conversacion` por `(telefono, sender)` con estados `CREANDO → ACTIVA → CERRADA`; un **índice único parcial** (una sola fila no CERRADA por par) evita que dos broadcasts simultáneos creen dos conversaciones para el mismo contacto: el que pierde la reserva espera y reutiliza. Toda candidata se verifica en vivo en Infobip (OPEN/WAITING/SOLVED → se reutiliza con PATCH `queueId` + PUT `assignee`; CLOSED o 404 → se marca CERRADA y no se vuelve a consultar). Sin registro propio, se revisan las últimas 5 de `conversation_lead_relation` (venta activa). Un 5xx/red al verificar es ERROR, nunca "crear otra". Las reservas CREANDO de más de 2 min se consideran huérfanas. SQL en [sql/infobip_ext_broadcast_conversacion.sql](sql/infobip_ext_broadcast_conversacion.sql).
- **Lotes e idempotencia**: el navegador manda lotes de 10 a `enviarLote`; cada fila se reclama `PENDIENTE → ENVIANDO` atómicamente, así un lote repetido no reenvía. `ERROR` = la plantilla no salió (reintentable); fallos posteriores (etiquetas, registro) son `advertencia` sobre un `OK`. Una fila que queda en `ENVIANDO` no se reintenta sola.
- Tablas `Infobip_ext.broadcast` y `broadcast_destinatario`: SQL en [sql/infobip_ext_broadcast.sql](sql/infobip_ext_broadcast.sql).
- **Entrega real**: `OK` solo significa que Infobip aceptó el mensaje. WhatsApp lo entrega o lo rechaza segundos después (p. ej. **7032 `EC_FREQUENCY_CAPPING`**: Meta bloquea por exceso de plantillas de marketing al mismo contacto). `verificarEntregas` consulta `GET /messages-api/1/logs?messageId=…` (acepta varios ids) y guarda `entrega` = `ENTREGADO` / `NO_ENTREGADO` + `entrega_detalle`. El `message_id` se toma de la respuesta del envío o, si falta, se busca en los mensajes de la conversación. La UI verifica sola al terminar y en el detalle del historial. Columnas en [sql/infobip_ext_broadcast_entrega.sql](sql/infobip_ext_broadcast_entrega.sql).
- **Historial** (`broadcast/historial` y `historial/[id]`): lista con progreso en vivo y detalle por contacto. Cada lote recalcula `enviados`/`fallidos` y toca `updated_at`; un `EN_CURSO` sin actividad por 2 min se muestra como "Detenido" (se cerró la pestaña) y se puede **continuar** desde el detalle, que vuelve a correr los lotes de las filas `PENDIENTE`.

## Eloqua Webhooks → Google Sheets

`POST /api/eloqua-webhooks/google-sheets` ([route.ts](src/app/api/eloqua-webhooks/google-sheets/route.ts)) recibe el webhook outbound de Eloqua (objeto Contact) y agrega una fila al Google Sheet que indican los UTM del contacto: `utm_excel` (UTM Campaign Name) = ID o URL del documento, `utm_hoja` (UTM Campaign Medium) = pestaña (vacío → primera pestaña). Columnas (A:E, mismo orden que la pestaña "Eloqua" del sheet de reportería): `dni`, `correo`, `PartyNumber`, `OptyNumber`, `fecha_creacion` (hora Lima); los encabezados se escriben solos si la fila 1 está vacía. El append se limita a A:E con `insertDataOption=OVERWRITE` (no inserta filas), porque esa pestaña tiene fórmulas en F por fila que deben quedar alineadas. Los ids puramente numéricos se escriben como número para que los cruces con CRM sigan funcionando.

- Auth: `checkApiKey(req, "ELOQUA_WEBHOOKS_API_KEY")` — en Eloqua va como header `Authorization: Bearer <key>` (sección Headers).
- Lógica compartida con la UI en [src/lib/eloqua-webhooks.ts](src/lib/eloqua-webhooks.ts); el formulario de prueba del módulo llama la misma función vía server action.
- [src/lib/google-sheets.ts](src/lib/google-sheets.ts) habla con la Sheets API v4 firmando el JWT del service account con `node:crypto` (sin `googleapis`); token cacheado en memoria. Escribe con `valueInputOption=RAW` (un texto que empiece con "=" no se evalúa como fórmula).
- Cada Google Sheet debe compartirse (edición) con el `client_email` del service account; si no, la API responde 403 con ese mensaje.

## Environment

Required `.env.local` at the project root (gitignored via `.env*`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # used by admin.ts: data-table actions + /api/infobip-ext/*
INFOBIP_EXT_API_KEY=<bearer token>             # gate for /api/infobip-ext/* (checkApiKey)
INFOBIP_API_KEY=<infobip api key>              # broadcast: llamadas directas a Infobip (src/lib/infobip.ts)
INFOBIP_API_HOST=<xxxx.api-us.infobip.com>     # broadcast
GOOGLE_CLIENT_EMAIL=<client_email>             # eloqua-webhooks: service account de Google Sheets
GOOGLE_PRIVATE_KEY="<private_key>"            # eloqua-webhooks: con 
 literales o saltos reales
ELOQUA_WEBHOOKS_API_KEY=<bearer token>         # gate para /api/eloqua-webhooks/*
```

`admin.ts` reads env via `readEnvValue()`, which strips a stray `NAME=` prefix and surrounding quotes — so a value accidentally pasted as `SUPABASE_SERVICE_ROLE_KEY=eyJ...` still works.

If `NEXT_PUBLIC_*` are missing, the middleware short-circuits all protected routes to `/login` and the browser client throws `@supabase/ssr: Your project's URL and API key are required to create a Supabase client!`. If `INFOBIP_EXT_API_KEY` is missing, `/api/infobip-ext/*` returns `503`. Next reads `.env.local` only at process start — restart `npm run dev` after editing.
