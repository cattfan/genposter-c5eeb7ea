// Repository chung cho mọi bảng JSON. Dùng better-sqlite3 sync API.
//
// API mirror Dexie:
//   list(filter?) -> array, supports indexedFields filter
//   get(id) -> row | null
//   put(row) -> void  (upsert)
//   bulkPut(rows) -> void
//   delete(id) -> void
//   clear() -> void
//   count() -> number
//
// Mọi row trả về luôn có primary key field set đúng (lấy từ payload).

import type Database from "better-sqlite3";
import type { TableConfig } from "../config/tables";

export type Row = Record<string, unknown>;

export class TableRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly table: TableConfig,
  ) {}

  list(filter?: Record<string, string>, limit?: number, offset?: number): Row[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter) {
      for (const [field, value] of Object.entries(filter)) {
        if (!this.table.indexedFields?.includes(field)) continue;
        where.push(`"idx_${field}" = ?`);
        params.push(value);
      }
    }
    let sql = `SELECT payload FROM "${this.table.name}"`;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY updated_at DESC`;
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
      if (offset) {
        sql += ` OFFSET ?`;
        params.push(offset);
      }
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as Row);
  }

  get(id: string): Row | null {
    const stmt = this.db.prepare(`SELECT payload FROM "${this.table.name}" WHERE pk = ?`);
    const row = stmt.get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Row) : null;
  }

  put(row: Row): Row {
    const id = row[this.table.primaryKey];
    if (id == null || id === "") {
      throw new Error(`Missing primary key '${this.table.primaryKey}' in row for ${this.table.name}`);
    }
    const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : Date.now();
    const merged = { ...row, updatedAt };
    const stmt = this.db.prepare(`
      INSERT INTO "${this.table.name}" (pk, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(pk) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `);
    stmt.run(String(id), JSON.stringify(merged), updatedAt);
    return merged;
  }

  bulkPut(rows: Row[]): number {
    if (rows.length === 0) return 0;
    const insert = this.db.prepare(`
      INSERT INTO "${this.table.name}" (pk, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(pk) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `);
    const tx = this.db.transaction((items: Row[]) => {
      for (const row of items) {
        const id = row[this.table.primaryKey];
        if (id == null || id === "") {
          throw new Error(
            `Missing primary key '${this.table.primaryKey}' in bulkPut row for ${this.table.name}`,
          );
        }
        const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : Date.now();
        insert.run(String(id), JSON.stringify({ ...row, updatedAt }), updatedAt);
      }
    });
    tx(rows);
    return rows.length;
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM "${this.table.name}" WHERE pk = ?`);
    const info = stmt.run(id);
    return info.changes > 0;
  }

  clear(): number {
    const info = this.db.prepare(`DELETE FROM "${this.table.name}"`).run();
    return info.changes;
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM "${this.table.name}"`).get() as { c: number };
    return row.c;
  }
}
