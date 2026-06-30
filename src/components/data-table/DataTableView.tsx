"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  ColumnConfig,
  DataTableActions,
  FilterValue,
  ListParams,
  RowData,
  TableConfig,
} from "./types";
import ApiDocsModal from "./ApiDocsModal";

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; row: RowData }
  | { mode: "delete"; row: RowData };

interface Props {
  config: TableConfig;
  actions: DataTableActions;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function DataTableView({ config, actions }: Props) {
  const [rows, setRows] = useState<RowData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageSize, setPageSize] = useState(config.defaultPageSize ?? 25);
  const [sort, setSort] = useState(config.defaultSort);

  // Mantener el campo "ir a página" sincronizado con la página actual
  // (cambios por prev/next, salto, o reset al filtrar/cambiar tamaño).
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const [filterInputs, setFilterInputs] = useState<Record<string, FilterValue>>({});
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});

  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [formData, setFormData] = useState<RowData>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showApiDocs, setShowApiDocs] = useState(false);

  // Debounce filter inputs -> applied filters
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(filterInputs);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [filterInputs]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ListParams = { page, pageSize, sort, filters };
      const result = await actions.list(params);
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actions, page, pageSize, sort, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleColumns = useMemo(
    () => config.columns.filter((c) => !c.hiddenInTable),
    [config.columns],
  );

  const formColumns = useMemo(
    () => config.columns.filter((c) => !c.readOnly),
    [config.columns],
  );

  function handleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return undefined;
    });
  }

  function updateFilterInput(col: ColumnConfig, partial: Partial<FilterValue>) {
    setFilterInputs((prev) => {
      const next = { ...prev };
      const existing = next[col.key];

      if (col.type === "text") {
        const p = partial as { contains?: string };
        const contains =
          p.contains !== undefined
            ? p.contains
            : existing?.type === "text"
              ? existing.contains
              : "";
        if (!contains) delete next[col.key];
        else next[col.key] = { type: "text", contains };
      } else if (col.type === "number") {
        const p = partial as { equals?: string };
        const equals =
          p.equals !== undefined
            ? p.equals
            : existing?.type === "number"
              ? existing.equals
              : "";
        if (!equals) delete next[col.key];
        else next[col.key] = { type: "number", equals };
      } else {
        const p = partial as { from?: string; to?: string };
        const from =
          p.from !== undefined
            ? p.from
            : existing?.type === "datetime"
              ? existing.from
              : undefined;
        const to =
          p.to !== undefined
            ? p.to
            : existing?.type === "datetime"
              ? existing.to
              : undefined;
        if (!from && !to) delete next[col.key];
        else next[col.key] = { type: "datetime", from, to };
      }
      return next;
    });
  }

  function clearFilters() {
    setFilterInputs({});
  }

  function openCreate() {
    setFormData({});
    setFormError(null);
    setModal({ mode: "create" });
  }

  function openEdit(row: RowData) {
    setFormData({ ...row });
    setFormError(null);
    setModal({ mode: "edit", row });
  }

  function openDelete(row: RowData) {
    setFormError(null);
    setModal({ mode: "delete", row });
  }

  function closeModal() {
    setModal({ mode: "closed" });
    setFormError(null);
    setFormData({});
  }

  function setField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modal.mode !== "create" && modal.mode !== "edit") return;

    // Validation: required fields
    for (const col of formColumns) {
      if (col.required) {
        const v = formData[col.key];
        if (v === undefined || v === null || v === "") {
          setFormError(`El campo "${col.label}" es obligatorio.`);
          return;
        }
      }
    }

    // Build payload: convert values per column type
    const payload: RowData = {};
    for (const col of formColumns) {
      const raw = formData[col.key];
      if (raw === undefined || raw === null || raw === "") {
        if (col.required) {
          setFormError(`El campo "${col.label}" es obligatorio.`);
          return;
        }
        continue;
      }
      if (col.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          setFormError(`"${col.label}" debe ser un número válido.`);
          return;
        }
        payload[col.key] = n;
      } else if (col.type === "datetime") {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          setFormError(`"${col.label}" debe ser una fecha válida.`);
          return;
        }
        payload[col.key] = d.toISOString();
      } else {
        payload[col.key] = String(raw);
      }
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result =
        modal.mode === "create"
          ? await actions.create(payload)
          : await actions.update(
              (modal as { mode: "edit"; row: RowData }).row[config.primaryKey],
              payload,
            );
      if (!result.success) {
        setFormError(result.error ?? "Error desconocido.");
        return;
      }
      closeModal();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (modal.mode !== "delete") return;
    setSubmitting(true);
    setFormError(null);
    try {
      const id = modal.row[config.primaryKey];
      const result = await actions.remove(id);
      if (!result.success) {
        setFormError(result.error ?? "Error desconocido.");
        return;
      }
      closeModal();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilterCount = Object.keys(filterInputs).length;
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{config.title}</h1>
          {config.description && (
            <p className="mt-1 text-sm text-gray-600">{config.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {config.apiPath && (
            <button
              onClick={() => setShowApiDocs(true)}
              title="Ver ejemplos de API REST"
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              API
            </button>
          )}
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo
          </button>
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        columns={config.columns}
        inputs={filterInputs}
        onChange={updateFilterInput}
        onClear={clearFilters}
        activeCount={activeFilterCount}
      />

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <SortIcon active={sort?.key === col.key} direction={sort?.direction} />
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-24">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    Cargando...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="px-4 py-12 text-center text-sm text-red-600"
                  >
                    Error: {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    {activeFilterCount > 0
                      ? "No hay resultados con los filtros aplicados."
                      : "No hay filas todavía. Hacé clic en \"Nuevo\" para crear la primera."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={String(row[config.primaryKey])}
                    onClick={() => openEdit(row)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-sm text-gray-900">
                        {formatCell(row[col.key], col)}
                      </td>
                    ))}
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openEdit(row)}
                          title="Editar"
                          aria-label="Editar"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => openDelete(row)}
                          title="Eliminar"
                          aria-label="Eliminar"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-gray-100 bg-gray-50 text-sm">
          <div className="text-gray-600">
            {total === 0
              ? "0 filas"
              : `${rangeFrom}-${rangeTo} de ${total}`}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-gray-600">
              <span className="hidden sm:inline">Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-900"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Anterior"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-1 px-1 text-gray-700 font-semibold">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(pageInput, 10);
                      setPage(
                        Number.isFinite(n) ? Math.min(totalPages, Math.max(1, n)) : page,
                      );
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(pageInput, 10);
                    if (Number.isFinite(n)) setPage(Math.min(totalPages, Math.max(1, n)));
                    else setPageInput(String(page));
                  }}
                  aria-label="Ir a la página"
                  title="Escribe una página y Enter"
                  className="w-14 rounded-md border border-gray-300 bg-white px-2 py-1 text-center font-semibold text-gray-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="whitespace-nowrap">/ {totalPages}</span>
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Siguiente"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {modal.mode === "create" || modal.mode === "edit" ? (
        <Modal
          title={modal.mode === "create" ? `Nueva fila` : `Editar fila`}
          onClose={closeModal}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {modal.mode === "edit" && (
              <div className="text-xs text-gray-500 font-mono">
                {config.primaryKey}: {String((modal as { row: RowData }).row[config.primaryKey])}
              </div>
            )}
            {formColumns.map((col) => (
              <FormField
                key={col.key}
                column={col}
                value={formData[col.key]}
                onChange={(v) => setField(col.key, v)}
              />
            ))}
            {formError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {submitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {showApiDocs && config.apiPath && (
        <ApiDocsModal
          config={config}
          apiPath={config.apiPath}
          onClose={() => setShowApiDocs(false)}
        />
      )}

      {modal.mode === "delete" ? (
        <Modal title="Eliminar fila" onClose={closeModal}>
          <p className="text-sm text-gray-700">
            ¿Estás seguro de que querés eliminar esta fila? Esta acción no se puede deshacer.
          </p>
          <div className="mt-3 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-mono text-gray-700">
            {config.primaryKey}: {String(modal.row[config.primaryKey])}
          </div>
          {formError && (
            <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function FiltersBar({
  columns,
  inputs,
  onChange,
  onClear,
  activeCount,
}: {
  columns: ColumnConfig[];
  inputs: Record<string, FilterValue>;
  onChange: (col: ColumnConfig, partial: Partial<FilterValue>) => void;
  onClear: () => void;
  activeCount: number;
}) {
  const filterable = columns.filter((c) => c.filterable !== false && !c.readOnly);
  if (filterable.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Filtros</h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-gray-600 hover:text-red-600"
          >
            Limpiar ({activeCount})
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filterable.map((col) => {
          const value = inputs[col.key];
          if (col.type === "text") {
            return (
              <FilterField key={col.key} label={col.label}>
                <input
                  type="text"
                  placeholder={`contiene...`}
                  value={value?.type === "text" ? value.contains : ""}
                  onChange={(e) => onChange(col, { contains: e.target.value })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
                />
              </FilterField>
            );
          }
          if (col.type === "number") {
            return (
              <FilterField key={col.key} label={col.label}>
                <input
                  type="number"
                  placeholder="= valor"
                  value={value?.type === "number" ? value.equals : ""}
                  onChange={(e) => onChange(col, { equals: e.target.value })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
                />
              </FilterField>
            );
          }
          return (
            <FilterField key={col.key} label={col.label}>
              <div className="grid grid-cols-2 gap-1">
                <input
                  type="date"
                  value={value?.type === "datetime" ? value.from ?? "" : ""}
                  onChange={(e) => onChange(col, { from: e.target.value })}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900"
                />
                <input
                  type="date"
                  value={value?.type === "datetime" ? value.to ?? "" : ""}
                  onChange={(e) => onChange(col, { to: e.target.value })}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900"
                />
              </div>
            </FilterField>
          );
        })}
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function FormField({
  column,
  value,
  onChange,
}: {
  column: ColumnConfig;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const stringValue = value === undefined || value === null ? "" : String(value);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold text-gray-700">
        {column.label}
        {column.required && <span className="text-red-600 ml-0.5">*</span>}
        {column.unique && (
          <span className="ml-2 text-[10px] font-normal text-gray-400 uppercase tracking-wider">único</span>
        )}
      </span>
      {column.type === "datetime" ? (
        <input
          type="datetime-local"
          value={toDatetimeLocal(stringValue)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={column.placeholder}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
      ) : column.type === "number" ? (
        <input
          type="number"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={column.placeholder}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
      ) : (
        <input
          type="text"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={column.placeholder}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
      )}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
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
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
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
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction?: "asc" | "desc";
}) {
  if (!active) {
    return (
      <svg className="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
        <path d="M7 10l5-5 5 5H7zm0 4h10l-5 5-5-5z" />
      </svg>
    );
  }
  return (
    <svg className="w-3 h-3 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {direction === "asc" ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      )}
    </svg>
  );
}

function formatCell(value: unknown, col: ColumnConfig): string {
  if (value === null || value === undefined) return "—";
  if (col.type === "datetime") {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("es-PE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return String(value);
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
