"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface SidebarView {
  label: string;
  href: string;
  icon: ReactNode;
}

export interface SidebarSection {
  label: string;
  views: SidebarView[];
}

export interface ModuleInfo {
  title: string;
  subtitle: string;
  icon: ReactNode;
  iconBg?: string;
}

export interface BackLink {
  href: string;
  label: string;
}

interface ModuleShellProps {
  info: ModuleInfo;
  sections: SidebarSection[];
  back?: BackLink;
  children: ReactNode;
}

const DEFAULT_BACK: BackLink = { href: "/modulos", label: "Módulos" };

const COLLAPSE_KEY = "moduleShell:collapsed";
const COLLAPSE_EVENT = "moduleShell:collapseChange";

function subscribeCollapse(callback: () => void) {
  window.addEventListener(COLLAPSE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getCollapseSnapshot() {
  return localStorage.getItem(COLLAPSE_KEY) === "true";
}

function getCollapseServerSnapshot() {
  return false;
}

export default function ModuleShell({ info, sections, back, children }: ModuleShellProps) {
  const backLink = back ?? DEFAULT_BACK;
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useSyncExternalStore(
    subscribeCollapse,
    getCollapseSnapshot,
    getCollapseServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    });
  }, []);

  function toggleCollapsed() {
    localStorage.setItem(COLLAPSE_KEY, String(!collapsed));
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = (email[0] || "?").toUpperCase();
  const iconBg = info.iconBg ?? "bg-emerald-50 text-emerald-600";
  // Visual collapse only applies on desktop; mobile drawer always renders expanded
  const isCompact = collapsed && !mobileOpen;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile topbar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-gray-200 px-4 py-3">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
          className="inline-flex items-center justify-center w-9 h-9 rounded-md text-gray-700 hover:bg-gray-100"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${iconBg}`}>
            {info.icon}
          </div>
          <h1 className="text-base font-bold text-gray-900 truncate">{info.title}</h1>
        </div>
        <Link
          href={backLink.href}
          className="text-xs font-semibold text-gray-500 hover:text-gray-900"
        >
          {backLink.label}
        </Link>
      </header>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-screen flex flex-col bg-white border-r border-gray-200 transition-all duration-200
          ${mobileOpen ? "w-72 translate-x-0" : "-translate-x-full w-72"}
          md:translate-x-0
          ${collapsed ? "md:w-16" : "md:w-64"}
        `}
      >
        {/* Top: identity */}
        <div className="px-3 py-4 border-b border-gray-100">
          {/* Back link */}
          {isCompact ? (
            <Link
              href={backLink.href}
              aria-label={`Volver a ${backLink.label}`}
              title={`Volver a ${backLink.label}`}
              className="flex items-center justify-center w-9 h-9 mx-auto rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <Link
                href={backLink.href}
                className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-700"
              >
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {backLink.label}
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Cerrar menú"
                className="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:bg-gray-100 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Identity row */}
          {isCompact ? (
            <div className="mt-3 flex flex-col items-center gap-2">
              <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${iconBg}`}>
                {info.icon}
              </div>
              <button
                onClick={toggleCollapsed}
                aria-label="Expandir menú"
                title="Expandir menú"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${iconBg}`}>
                  {info.icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-gray-900 truncate">{info.title}</h2>
                  <p className="text-xs text-gray-500 truncate">{info.subtitle}</p>
                </div>
              </div>
              <button
                onClick={toggleCollapsed}
                aria-label="Colapsar menú"
                title="Colapsar menú"
                className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Middle: nav */}
        <nav className="flex-1 overflow-y-auto py-3">
          {sections.map((section, i) => (
            <div key={section.label} className={i > 0 ? "mt-4" : ""}>
              {!isCompact ? (
                <p className="px-4 mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {section.label}
                </p>
              ) : i > 0 ? (
                <div className="mx-3 my-2 border-t border-gray-100" />
              ) : null}
              <ul className="space-y-0.5">
                {section.views.map((view) => {
                  const isActive = pathname === view.href;
                  return (
                    <li key={view.href}>
                      <Link
                        href={view.href}
                        onClick={() => setMobileOpen(false)}
                        title={isCompact ? view.label : undefined}
                        className={`
                          flex items-center gap-3 px-3 py-2 mx-1 rounded-md text-sm font-semibold transition-colors
                          ${isCompact ? "justify-center" : ""}
                          ${
                            isActive
                              ? "bg-emerald-50 text-emerald-700 border-l-2 border-emerald-500"
                              : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-2 border-transparent"
                          }
                        `}
                      >
                        <span className="w-5 h-5 shrink-0 flex items-center justify-center">{view.icon}</span>
                        {!isCompact && <span className="truncate">{view.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom: user */}
        <div className="border-t border-gray-100 p-3">
          {!isCompact ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-orange-100 text-orange-700 text-sm font-bold border border-orange-200 shrink-0">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-600 truncate font-semibold">{email || "..."}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-red-600 hover:border-red-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Cerrar sesión
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div
                title={email}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-orange-100 text-orange-700 text-sm font-bold border border-orange-200"
              >
                {initial}
              </div>
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 hover:text-red-600 hover:border-red-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main
        className={`min-h-screen transition-all duration-200 ${
          collapsed ? "md:ml-16" : "md:ml-64"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
