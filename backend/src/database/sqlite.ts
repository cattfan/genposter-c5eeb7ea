// Lớp truy cập SQLite trực tiếp qua better-sqlite3 (sync API).
//
// Vì sao không dùng TypeORM:
// - 16 bảng có schema gần giống hệt: 1 PK + payload JSON + vài cột index. Viết
//   16 @Entity class là dư thừa.
// - TypeORM `synchronize: true` sửa schema mỗi lần restart -> dữ liệu user
//   không an toàn khi thêm field index mới (đã từng cause data loss).
// - better-sqlite3 sync API cực nhanh cho single-user, đơn giản hơn.
//
// Schema mỗi bảng:
//   <pk> TEXT PRIMARY KEY
//   payload TEXT NOT NULL  (JSON full row)
//   updated_at INTEGER NOT NULL
//   plus generated columns cho mỗi indexedFields (json_extract -> INDEX).

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { TABLES, type TableConfig } from "../config/tables";

let dbInstance: Database.Database | null = null;

export function getDataDir(): string {
  // backend/data/ — mkdir nếu chưa có. Khi build production (dist/),
  // process.cwd() sẽ vẫn là project root nếu start từ npm.
  const cwd = process.cwd();
  const dataDir = cwd.endsWith("backend") ? join(cwd, "data") : join(cwd, "backend", "data");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "blobs"), { recursive: true });
  return dataDir;
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dataDir = getDataDir();
  const dbPath = join(dataDir, "genposter.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // WAL mode tốt cho perf single-user + cho phép reader đồng thời.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  dbInstance = db;
  return db;
}

function initSchema(db: Database.Database): void {
  // Tạo bảng + index cho mỗi TableConfig. Idempotent qua IF NOT EXISTS.
  for (const table of TABLES) {
    createTable(db, table);
  }
  // Bảng riêng cho blobs metadata (binary stored on filesystem).
  db.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      blob_key TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function createTable(db: Database.Database, table: TableConfig): void {
  const tableName = quoteIdent(table.name);
  // Primary key cột vẫn lưu giá trị từ payload, nhưng tách ra để PRIMARY KEY hoạt động.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      pk TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Tạo virtual columns + index cho indexedFields.
  // Phải dùng generated column thay vì index expression vì SQLite không
  // index trực tiếp lên json_extract của 1 expression NOT in PK clause.
  for (const field of table.indexedFields ?? []) {
    const colName = quoteIdent(`idx_${field}`);
    const indexName = quoteIdent(`idx_${table.name}_${field}`);
    // Try add column (idempotent)
    try {
      db.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${colName} TEXT GENERATED ALWAYS AS (json_extract(payload, '$.${field}')) VIRTUAL;`,
      );
    } catch (err: unknown) {
      // Cột đã tồn tại -> bỏ qua. SQLite không có IF NOT EXISTS cho ALTER ADD COLUMN.
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("duplicate column")) throw err;
    }
    db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${colName});`);
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
