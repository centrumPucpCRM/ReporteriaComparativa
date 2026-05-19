# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Centrum PUCP CRM platform. Currently hosts the **Reportería Comparativa** module (compares program metrics — leads, conversions, enrollments — between 2025 and 2026 cohorts, aligned relative to inauguration dates) plus a modules hub for future tools. Built in Spanish for Spanish-speaking users.

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
├── lib/supabase/
│   ├── client.ts    # browser anon client (flowType: "implicit")
│   ├── server.ts    # server anon + cookies
│   └── admin.ts     # service role (server-only, bypassa RLS)
├── components/      # shared UI (LogoutButton = avatar + email + Salir, fetched client-side via supabase.auth.getUser)
├── middleware.ts    # auth guard
└── app/
    ├── (auth)/             # login + update-password (invite)
    ├── auth/               # callback, forgot, reset (route handlers + recovery pages)
    ├── (platform)/         # authenticated app
    │   └── modulos/        # module hub
    │       ├── reporteria/ # dashboard comparativo + lib/
    │       └── microservicios/  # placeholder
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
- `/modulos/microservicios` → placeholder "Próximamente"

**Convention for module sub-pages**: every page under `/modulos/<x>` must include a breadcrumb link `← Módulos` in its header (back to `/modulos`) plus the `<LogoutButton />` on the right. There is no shared `(platform)/layout.tsx` — each module page renders its own header.

## Authentication

Supabase Auth via `@supabase/ssr`. Middleware ([src/middleware.ts](src/middleware.ts)) guards everything except `/login` and `/auth/*` (and `/update-password` for the invite flow), redirecting unauth'd users to `/login`. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `SUPABASE_SERVICE_ROLE_KEY` if `admin.ts` is used).

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

## Environment

Required `.env.local` at the project root (gitignored via `.env*`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # only if admin.ts is in use
```

If these are missing, the middleware short-circuits all protected routes to `/login` and the browser client throws `@supabase/ssr: Your project's URL and API key are required to create a Supabase client!`. Next reads `.env.local` only at process start — restart `npm run dev` after editing.
