# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Comparative reporting dashboard for Centrum PUCP CRM. Compares program metrics (leads, conversions, enrollments) between 2025 and 2026 cohorts, aligned relative to inauguration dates. Built in Spanish for Spanish-speaking users.

## Commands

- `npm run dev` — Start dev server (Turbopack enabled)
- `npm run build` — Production build
- `npm run lint` — ESLint

No test framework is configured.

## Architecture

**Framework**: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + React 19

**Routing**:
- `/` → redirects to `/dashboard`
- `/login` → Supabase email/password auth
- `/update-password` → Password reset (invite-based onboarding)
- `/auth/callback` → OAuth callback
- `/dashboard` → Main application (single large client component)

**Authentication**: Supabase Auth via `@supabase/ssr`. Middleware (`middleware.ts`) guards all routes, redirecting unauthenticated users to `/login`. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Data Layer** (`app/dashboard/lib/`):
- `config.ts` — S3 CSV URLs, metric definitions, color schemes
- `dataService.ts` — `DataService` singleton that loads and filters CSV data from S3 via PapaParse. Holds in-memory stores for datamarts (2025/2026), program metadata, and pairing data.
- `compareEngine.ts` — Aligns 2025/2026 data relative to inauguration dates for comparison. Includes linear regression projections.
- `chartRenderer.ts` — Chart.js wrapper. Single global chart instance, destroyed and recreated on data change. Dual-axis support (leads + custom metric).

**Dashboard** (`app/dashboard/page.tsx`): Large `'use client'` component (~1200 lines). All state is local React hooks. Features multi-select dropdowns with filters, dual-mode metrics ("alumnos" / "pxq"), and an export flow that POSTs to an AWS Lambda which returns S3 pre-signed URLs for CSV downloads.

**Path alias**: `@/*` maps to project root.
