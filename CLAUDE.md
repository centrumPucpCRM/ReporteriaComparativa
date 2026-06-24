# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Centrum PUCP CRM platform, organized as a hub of modules. Two areas exist today:
- **Reportería Comparativa** — compares program metrics (leads, conversions, enrollments) between 2025 and 2026 cohorts, aligned relative to inauguration dates.
- **Microservicios** — internal operational tools. `infobip-ext` is the first real one: CRUD admin tables over a custom Supabase schema plus a token-authenticated REST API consumed by external Infobip flows. `sistema-vacaciones` is still a placeholder.

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
- `/modulos/microservicios/infobip-ext` → home + sub-tablas (`conversation-lead-relation`, `sender-last-rdv`, `colas`)
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

1. **`TableConfig`** ([types.ts](src/components/data-table/types.ts)) — declares columns (`text | number | datetime`, with `readOnly`, `required`, `unique`, `hiddenInTable`, `filterable`), `primaryKey`, default sort/page-size, and optional `apiPath` (when set, the table header shows an **API** button opening [ApiDocsModal](src/components/data-table/ApiDocsModal.tsx), which generates copy-paste Python snippets from the column config).
2. **`DataTableActions`** — `list / create / update / remove`. Built by [`createTableActions({ schema, table, primaryKey })`](src/components/data-table/createTableActions.ts), which returns Supabase-backed implementations. Each action calls `requireUser()` first (server-side session gate) and then uses the **admin client** (service role, bypasses RLS) against a schema-qualified table. DB errors are run through `humanizeError()` to produce Spanish messages.
3. **`<DataTableView config actions />`** — the `'use client'` UI.

The per-table `actions.ts` must be a `"use server"` module that re-exports thin wrappers around `createTableActions(...)` — you cannot pass a server-action object created elsewhere; each exported function has to be declared in the action file.

## REST API layer (infobip-ext)

[src/app/api/infobip-ext/](src/app/api/infobip-ext/) is a separate, **session-less** surface for external callers (Infobip flows). Key facts:

- **Auth is API-key, not Supabase session.** Every handler calls [`checkApiKey(req)`](src/lib/api-auth.ts) first, expecting `Authorization: Bearer <INFOBIP_EXT_API_KEY>`. The middleware matcher explicitly excludes `/api/` ([src/middleware.ts](src/middleware.ts)), so these routes are NOT redirected to `/login` — the key is the only gate. Missing env key → `503`; bad/absent key → `401`.
- **Table allowlist.** `[table]` is resolved through [_tables.ts](src/app/api/infobip-ext/_tables.ts), which maps a public slug → `{ schema, table, primaryKey }`. Only listed slugs are reachable; this is the boundary that prevents arbitrary table access. To expose a new table, add it here (and usually mirror it as a data-table UI page).
- **Routes**: `GET/POST /api/infobip-ext/[table]` (list w/ `?page&pageSize`, max 500; create), `GET/PATCH/DELETE /api/infobip-ext/[table]/[id]`. All use the admin client schema-qualified via `.schema(target.schema)`. Every handler is wrapped in try/catch → `serverError()` (logs + 500).
- **`POST /api/infobip-ext/decidir-cola`** is business logic, not generic CRUD: given `{ nt, ni }` it looks up the queue pair for the Infobip number (`colas`), checks whether the contact has a prior `sender_last_rdv`, and returns which Infobip queue (`IN` vs `GEN`) to route the inbound to.

**Supabase schema**: the infobip data lives in a non-public schema named `Infobip_ext` (capital I, underscore) with tables `conversation_lead_relation`, `sender_last_rdv`, `colas`. Always access it via `.schema("Infobip_ext")` — the default client only sees `public`. The casts to `as any` on `.from(table)` are a known workaround because these tables aren't in the generated Supabase types.

## Environment

Required `.env.local` at the project root (gitignored via `.env*`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # used by admin.ts: data-table actions + /api/infobip-ext/*
INFOBIP_EXT_API_KEY=<bearer token>             # gate for /api/infobip-ext/* (checkApiKey)
```

`admin.ts` reads env via `readEnvValue()`, which strips a stray `NAME=` prefix and surrounding quotes — so a value accidentally pasted as `SUPABASE_SERVICE_ROLE_KEY=eyJ...` still works.

If `NEXT_PUBLIC_*` are missing, the middleware short-circuits all protected routes to `/login` and the browser client throws `@supabase/ssr: Your project's URL and API key are required to create a Supabase client!`. If `INFOBIP_EXT_API_KEY` is missing, `/api/infobip-ext/*` returns `503`. Next reads `.env.local` only at process start — restart `npm run dev` after editing.
