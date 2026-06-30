import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type {
  ActionResult,
  DataTableActions,
  ListParams,
  ListResult,
  RowData,
} from "./types";

interface FactoryOptions {
  schema: string;
  table: string;
  primaryKey: string;
  /** Columnas que, si alguna está en NULL, marcan la fila como incompleta (para el filtro "Solo incompletos"). */
  incompleteColumns?: string[];
}

async function requireUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado.");
  return user;
}

function applyFilters(
  query: ReturnType<ReturnType<ReturnType<typeof createAdminClient>["schema"]>["from"]>["select"] extends (...args: never[]) => infer R ? R : never,
  filters: ListParams["filters"],
) {
  let q = query as unknown as {
    ilike: (col: string, pattern: string) => typeof q;
    eq: (col: string, val: unknown) => typeof q;
    gte: (col: string, val: unknown) => typeof q;
    lte: (col: string, val: unknown) => typeof q;
  };
  if (!filters) return q;
  for (const [key, filter] of Object.entries(filters)) {
    if (filter.type === "text" && filter.contains) {
      q = q.ilike(key, `%${filter.contains}%`);
    } else if (filter.type === "number" && filter.equals !== "") {
      const n = Number(filter.equals);
      if (Number.isFinite(n)) q = q.eq(key, n);
    } else if (filter.type === "datetime") {
      if (filter.from) q = q.gte(key, filter.from);
      if (filter.to) q = q.lte(key, `${filter.to}T23:59:59.999Z`);
    }
  }
  return q;
}

export function createTableActions({ schema, table, primaryKey, incompleteColumns }: FactoryOptions): DataTableActions {
  return {
    async list(params: ListParams): Promise<ListResult> {
      await requireUser();
      const admin = createAdminClient();
      let query = admin
        .schema(schema)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select("*", { count: "exact" });

      // Solo incompletas: alguna columna de completitud en NULL.
      if (params.onlyIncomplete && incompleteColumns?.length) {
        query = query.or(incompleteColumns.map((c) => `${c}.is.null`).join(","));
      }

      // Sort
      if (params.sort) {
        query = query.order(params.sort.key, { ascending: params.sort.direction === "asc" });
      } else {
        query = query.order(primaryKey, { ascending: false });
      }

      // Filters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = applyFilters(query as any, params.filters) as any;

      // Pagination
      const offset = (params.page - 1) * params.pageSize;
      query = query.range(offset, offset + params.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as RowData[], total: count ?? 0 };
    },

    async create(data: RowData): Promise<ActionResult> {
      try {
        await requireUser();
        const admin = createAdminClient();
        const { error } = await admin
          .schema(schema)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from(table as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert(data as any);
        if (error) return { success: false, error: humanizeError(error.message) };
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },

    async update(id: unknown, data: RowData): Promise<ActionResult> {
      try {
        await requireUser();
        const admin = createAdminClient();
        const { error } = await admin
          .schema(schema)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from(table as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(data as any)
          .eq(primaryKey, id);
        if (error) return { success: false, error: humanizeError(error.message) };
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },

    async remove(id: unknown): Promise<ActionResult> {
      try {
        await requireUser();
        const admin = createAdminClient();
        const { error } = await admin
          .schema(schema)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from(table as any)
          .delete()
          .eq(primaryKey, id);
        if (error) return { success: false, error: humanizeError(error.message) };
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  };
}

function humanizeError(msg: string): string {
  if (msg.includes("duplicate key value")) {
    return "Ya existe un registro con ese valor único.";
  }
  if (msg.includes("violates not-null")) {
    return "Falta completar un campo obligatorio.";
  }
  if (msg.includes("violates foreign key")) {
    return "Referencia inválida — el ID relacionado no existe.";
  }
  return msg;
}
