// Test helper: a small in-memory stand-in for the Supabase client (only what Ivar uses). Never used in production.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;
export type Tables = Record<string, Row[]>;
type RpcFn = (args: Record<string, unknown>, tables: Tables) => { data?: unknown; error?: { message: string; code?: string } | null };

const UNIQUE: Record<string, string[][]> = { yt_jobs: [["studio_id", "idempotency_key"]], ivar_messages: [["conversation_id", "client_key"]] };

function likeToRegex(p: string) {
  return new RegExp(`^${p.replace(/\\([%_\\])/g, "\u0000$1").replace(/[.*+?^${}()|[\]]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".").replace(/\u0000(.)/g, (_m, c) => `\\${c}`)}$`, "i");
}
function parseOr(expr: string): Pred {
  const parts = expr.split(",").map((p) => {
    const [col, op, ...rest] = p.split(".");
    const v = rest.join(".");
    if (op === "eq") return (r: Row) => String(r[col]) === v;
    if (op === "is") return (r: Row) => (v === "null" ? r[col] == null : r[col] === (v === "true"));
    if (op === "ilike") return (r: Row) => likeToRegex(v).test(String(r[col] ?? ""));
    throw new Error(`or: ${op}`);
  });
  return (r) => parts.some((f) => f(r));
}

export function memoryDb(tables: Tables = {}, rpcs: Record<string, RpcFn> = {}) {
  const t = (name: string) => (tables[name] ??= []);
  const from = (table: string) => {
    const preds: Pred[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let values: Row | Row[] | null = null;
    let order: [string, boolean][] = [];
    let limit = Infinity;
    let single: "one" | "maybe" | null = null;
    let wantRows = false;
    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      if (op === "insert") {
        const rows = (Array.isArray(values) ? values : [values!]).map((v): Row => ({ id: randomUUID(), created_at: new Date(Date.now() + t(table).length).toISOString(), ...v }));
        for (const r of rows) {
          for (const cols of UNIQUE[table] ?? []) {
            if (cols.every((c) => r[c] != null) && t(table).some((x) => cols.every((c) => x[c] === r[c]))) return { data: null, error: { message: "duplicate key", code: "23505" } };
          }
        }
        t(table).push(...rows);
        return shape(rows);
      }
      let rows = t(table).filter((r) => preds.every((p) => p(r)));
      if (op === "update") {
        for (const r of rows) Object.assign(r, values);
        return wantRows ? shape(rows) : { data: null, error: null };
      }
      if (op === "delete") {
        tables[table] = t(table).filter((r) => !rows.includes(r));
        return { data: null, error: null };
      }
      for (const [col, asc] of [...order].reverse()) rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      return shape(rows.slice(0, limit));
    };
    const shape = (rows: Row[]) => {
      const copy = rows.map((r) => ({ ...r }));
      if (single === "one") return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: `expected one row in ${table}, got ${copy.length}` } };
      if (single === "maybe") return { data: copy[0] ?? null, error: null };
      return { data: copy, error: null };
    };
    const chain = {
      select: () => ((wantRows = true), chain),
      insert: (v: Row | Row[]) => ((op = "insert"), (values = v), chain),
      update: (v: Row) => ((op = "update"), (values = v), (wantRows = false), chain),
      delete: () => ((op = "delete"), chain),
      upsert: (v: Row | Row[]) => ((op = "insert"), (values = v), chain),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), chain),
      neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), chain),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), chain),
      is: (c: string, v: unknown) => (preds.push((r) => (v === null ? r[c] == null : r[c] === v)), chain),
      lte: (c: string, v: unknown) => (preds.push((r) => String(r[c]) <= String(v)), chain),
      gte: (c: string, v: unknown) => (preds.push((r) => String(r[c]) >= String(v)), chain),
      ilike: (c: string, v: string) => (preds.push((r) => likeToRegex(v).test(String(r[c] ?? ""))), chain),
      like: (c: string, v: string) => (preds.push((r) => likeToRegex(v).test(String(r[c] ?? ""))), chain),
      or: (expr: string) => (preds.push(parseOr(expr)), chain),
      order: (c: string, o?: { ascending?: boolean }) => (order.push([c, o?.ascending !== false]), chain),
      limit: (n: number) => ((limit = n), chain),
      single: () => ((single = "one"), chain),
      maybeSingle: () => ((single = "maybe"), chain),
      returns: () => chain,
      then: (resolve: (r: unknown) => void, reject?: (e: unknown) => void) => {
        try {
          resolve(run());
        } catch (e) {
          reject?.(e);
        }
      },
    };
    return chain;
  };
  const db = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      const fn = rpcs[name];
      if (!fn) return { data: null, error: { message: `no rpc ${name}` } };
      const r = fn(args, tables);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { db, tables };
}
