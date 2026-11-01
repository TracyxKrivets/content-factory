import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../env";
import type { TableMap, TableName } from "../types";
import { now, withLock } from "../util";
import type { ListOpts, Repo } from "./index";

/** One JSON file per row under data/db/<table>/<id>.json. Atomic writes, per-row locks. */
export class LocalRepo implements Repo {
  mode = "local" as const;
  private dir(table: string) {
    return path.join(dataDir(), "db", table);
  }
  private file(table: string, id: string) {
    return path.join(this.dir(table), encodeURIComponent(id) + ".json");
  }
  private async write(table: string, row: any) {
    await fs.mkdir(this.dir(table), { recursive: true });
    const f = this.file(table, row.id);
    const tmp = f + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(row));
    await fs.rename(tmp, f);
  }

  async get<K extends TableName>(table: K, id: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(table, id), "utf8")) as TableMap[K];
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async list<K extends TableName>(table: K, opts: ListOpts<TableMap[K]> = {}) {
    let names: string[] = [];
    try {
      names = (await fs.readdir(this.dir(table))).filter((n) => n.endsWith(".json"));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    const rows: TableMap[K][] = [];
    for (const n of names) {
      try {
        rows.push(JSON.parse(await fs.readFile(path.join(this.dir(table), n), "utf8")));
      } catch {
        /* half-written or deleted mid-read: skip */
      }
    }
    const where = Object.entries(opts.where || {});
    let out = rows.filter((r: any) => where.every(([k, v]) => (r[k] ?? null) === v));
    const key = opts.orderBy || "createdAt";
    out.sort((a: any, b: any) => (a[key] < b[key] ? -1 : 1) * (opts.desc ? -1 : 1));
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async insert<K extends TableName>(table: K, row: TableMap[K]) {
    await withLock(`${table}:${(row as any).id}`, () => this.write(table, row));
    return row;
  }

  async update<K extends TableName>(table: K, id: string, patch: any) {
    return withLock(`${table}:${id}`, async () => {
      const cur = await this.get(table, id);
      if (!cur) throw new Error(`${table} ${id} not found`);
      const p = typeof patch === "function" ? patch(cur) : patch;
      const next = { ...cur, ...p, updatedAt: now() };
      await this.write(table, next);
      return next as TableMap[K];
    });
  }

  async remove(table: TableName, id: string) {
    await withLock(`${table}:${id}`, () => fs.rm(this.file(table, id), { force: true }));
  }

  async ping() {
    await fs.mkdir(path.join(dataDir(), "db"), { recursive: true });
  }
}
