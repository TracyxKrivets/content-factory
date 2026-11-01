import { useSupabase } from "../env";
import type { TableMap, TableName } from "../types";
import { LocalRepo } from "./local";
import { SupabaseRepo } from "./supabase";

export interface ListOpts<T> {
  where?: Partial<Record<keyof T, string | null>>;
  orderBy?: "createdAt" | "updatedAt";
  desc?: boolean;
  limit?: number;
}

/** Storage-agnostic repository. Filters only on simple key fields (ids, status, userId). */
export interface Repo {
  mode: "local" | "supabase";
  get<K extends TableName>(table: K, id: string): Promise<TableMap[K] | null>;
  list<K extends TableName>(table: K, opts?: ListOpts<TableMap[K]>): Promise<TableMap[K][]>;
  insert<K extends TableName>(table: K, row: TableMap[K]): Promise<TableMap[K]>;
  /** Read-modify-write under a per-row lock. */
  update<K extends TableName>(
    table: K,
    id: string,
    patch: Partial<TableMap[K]> | ((row: TableMap[K]) => Partial<TableMap[K]>),
  ): Promise<TableMap[K]>;
  remove(table: TableName, id: string): Promise<void>;
  ping(): Promise<void>;
}

const g = globalThis as any;
export function db(): Repo {
  if (!g.__cfRepo) g.__cfRepo = useSupabase() ? new SupabaseRepo() : new LocalRepo();
  return g.__cfRepo;
}
