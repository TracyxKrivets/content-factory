import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import type { TableMap, TableName } from "../types";
import { now, withLock } from "../util";
import type { ListOpts, Repo } from "./index";

/**
 * Each table has indexed key columns (see supabase/schema.sql) plus `doc jsonb` holding the full row.
 * camelCase field -> snake_case column for the filterable keys.
 */
const KEY_COLS: Record<string, string> = {
  id: "id",
  userId: "user_id",
  projectId: "project_id",
  videoId: "video_id",
  formatId: "format_id",
  status: "status",
  kind: "kind",
  createdAt: "created_at",
  updatedAt: "updated_at",
};
const TABLE_KEYS: Record<TableName, string[]> = {
  projects: ["id", "userId", "formatId", "status", "createdAt", "updatedAt"],
  videos: ["id", "userId", "projectId", "status", "createdAt", "updatedAt"],
  formats: ["id", "userId", "createdAt", "updatedAt"],
  jobs: ["id", "userId", "projectId", "videoId", "kind", "status", "createdAt", "updatedAt"],
  errors: ["id", "userId", "projectId", "videoId", "createdAt", "updatedAt"],
  usage: ["id", "userId", "projectId", "videoId", "createdAt", "updatedAt"],
  history: ["id", "userId", "projectId", "videoId", "createdAt", "updatedAt"],
  cache: ["id", "userId", "createdAt", "updatedAt"],
  settings: ["id", "userId", "createdAt", "updatedAt"],
};

export class SupabaseRepo implements Repo {
  mode = "supabase" as const;
  private sb: SupabaseClient;
  constructor() {
    this.sb = createClient(env().SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  private toRecord(table: TableName, row: any) {
    const rec: any = { doc: row };
    for (const k of TABLE_KEYS[table]) rec[KEY_COLS[k]] = row[k] ?? null;
    return rec;
  }

  async get<K extends TableName>(table: K, id: string) {
    const { data, error } = await this.sb.from(table).select("doc").eq("id", id).maybeSingle();
    if (error) throw new Error(`DB read failed (${table}): ${error.message}`);
    return (data?.doc as TableMap[K]) ?? null;
  }

  async list<K extends TableName>(table: K, opts: ListOpts<TableMap[K]> = {}) {
    let q: any = this.sb.from(table).select("doc");
    for (const [k, v] of Object.entries(opts.where || {})) {
      const col = KEY_COLS[k];
      if (!col) throw new Error(`Cannot filter ${table} by ${k}`);
      q = v === null ? q.is(col, null) : q.eq(col, v);
    }
    q = q.order(KEY_COLS[opts.orderBy || "createdAt"], { ascending: !opts.desc });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`DB list failed (${table}): ${error.message}`);
    return (data || []).map((d: any) => d.doc);
  }

  async insert<K extends TableName>(table: K, row: TableMap[K]) {
    const { error } = await this.sb.from(table).insert(this.toRecord(table, row));
    if (error) throw new Error(`DB insert failed (${table}): ${error.message}`);
    return row;
  }

  // Per-row lock serializes writes within this process. Multiple worker processes should
  // only touch disjoint rows (jobs are claimed atomically below).
  async update<K extends TableName>(table: K, id: string, patch: any) {
    return withLock(`${table}:${id}`, async () => {
      const cur = await this.get(table, id);
      if (!cur) throw new Error(`${table} ${id} not found`);
      const p = typeof patch === "function" ? patch(cur) : patch;
      const next: any = { ...cur, ...p, updatedAt: now() };
      const { error } = await this.sb.from(table).update(this.toRecord(table, next)).eq("id", id);
      if (error) throw new Error(`DB update failed (${table}): ${error.message}`);
      return next as TableMap[K];
    });
  }

  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq("id", id);
    if (error) throw new Error(`DB delete failed (${table}): ${error.message}`);
  }

  async ping() {
    const { error } = await this.sb.from("settings").select("id").limit(1);
    if (error) throw new Error(error.message);
  }

  /** Atomic claim: only succeeds if the job is still queued. */
  async claimJob(id: string, lockedAt: string) {
    const { data, error } = await this.sb
      .from("jobs")
      .update({ status: "running" })
      .eq("id", id)
      .eq("status", "queued")
      .select("id");
    if (error) throw new Error(error.message);
    return (data || []).length > 0 ? lockedAt : null;
  }
}
