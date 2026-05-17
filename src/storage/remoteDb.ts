// Replacement cho Dexie `db` — gọi backend NestJS qua HTTP thay vì IndexedDB.
//
// Mục tiêu: 50+ callsite hiện tại dùng `db.<table>.<method>(...)` không phải
// sửa import path. API chỉ cover các method được dùng thực tế trong codebase
// (toArray, get, put, bulkPut, delete, clear, count, where().equals().toArray(),
// update). Các method Dexie khác sẽ throw "not implemented".
//
// Reactive: gắn EventTarget local + listen WebSocket /ws từ backend để tự
// invalidate React Query khi data đổi từ tab khác. Hook `useRemoteQuery`
// (file riêng) subscribe sự kiện này để re-fetch.

import { remoteClient } from "./remoteClient";
import { realtimeBus } from "./realtimeBus";
import type { BlobRecord } from "@/models";

/** Slug URL → name của table backend. */
const TABLE_SLUGS = {
  projects: "projects",
  entities: "entities",
  assets: "assets",
  assetLibrary: "asset_library",
  brandKits: "brand_kits",
  designDocuments: "design_documents",
  fontAssets: "font_assets",
  pageTemplates: "page_templates",
  packTemplates: "pack_templates",
  jobs: "jobs",
  overrides: "overrides",
  generatePresets: "generate_presets",
  analyses: "analyses",
  symbols: "symbols",
  settings: "settings",
} as const;

export type TableName = keyof typeof TABLE_SLUGS;

/** Bus internal để hook React invalidate khi mutation. */
class TableBus extends EventTarget {
  emit(table: TableName | string) {
    this.dispatchEvent(new CustomEvent("change", { detail: { table } }));
    // Phát ra cross-tab (BroadcastChannel) qua realtimeBus để tab khác
    // cùng browser cũng refetch.
    realtimeBus.emitLocal(String(table));
  }
  on(handler: (table: string) => void): () => void {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ table: string }>).detail;
      handler(detail.table);
    };
    this.addEventListener("change", listener);
    return () => this.removeEventListener("change", listener);
  }
}

export const tableBus = new TableBus();

interface QueryChain<T> {
  toArray(): Promise<T[]>;
  first(): Promise<T | undefined>;
  primaryKeys(): Promise<string[]>;
}

interface WhereChain<T> {
  equals(value: unknown): QueryChain<T>;
  anyOf(values: unknown[]): QueryChain<T>;
}

interface DexieLikeTable<T> {
  toArray(): Promise<T[]>;
  toCollection(): {
    first(): Promise<T | undefined>;
    primaryKeys(): Promise<string[]>;
  };
  limit(n: number): { toArray(): Promise<T[]> };
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<T>;
  bulkPut(rows: T[]): Promise<number>;
  bulkGet(ids: string[]): Promise<Array<T | undefined>>;
  delete(id: string): Promise<void>;
  bulkDelete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  where(field: string): WhereChain<T>;
  orderBy(field: string): {
    toArray(): Promise<T[]>;
    reverse(): { toArray(): Promise<T[]> };
  };
  update(id: string, patch: Partial<T>): Promise<T>;
}

function basePath(slug: string): string {
  return `/tables/${slug}`;
}

function makeTable<T extends Record<string, unknown>>(
  uiName: TableName,
  primaryKey: string,
): DexieLikeTable<T> {
  const slug = TABLE_SLUGS[uiName];
  const root = basePath(slug);

  const list = async (
    query?: Record<string, string>,
    limit?: number,
  ): Promise<T[]> => {
    const params = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        params.set(key, value);
      }
    }
    if (limit) params.set("limit", String(limit));
    let url = root;
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    const result = await remoteClient.get<{ rows: T[] }>(url);
    return result.rows;
  };

  return {
    toArray: () => list(),
    toCollection: () => ({
      async first() {
        const rows = await list();
        return rows[0];
      },
      async primaryKeys() {
        const rows = await list();
        return rows.map((row) => String((row as Record<string, unknown>)[primaryKey]));
      },
    }),
    limit(n: number) {
      return {
        toArray: () => list(undefined, Math.max(1, Math.floor(n))),
      };
    },
    async get(id: string) {
      try {
        return await remoteClient.get<T>(`${root}/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
          return undefined;
        }
        throw err;
      }
    },
    async bulkGet(ids: string[]): Promise<Array<T | undefined>> {
      if (ids.length === 0) return [];
      // Backend chưa hỗ trợ bulkGet; fetch song song.
      return Promise.all(
        ids.map((id) =>
          remoteClient
            .get<T>(`${root}/${encodeURIComponent(id)}`)
            .catch(() => undefined as T | undefined),
        ),
      );
    },
    async put(row: T) {
      const id = row[primaryKey];
      if (id == null) throw new Error(`Missing primary key '${primaryKey}' in ${uiName} put`);
      const saved = await remoteClient.put<T>(`${root}/${encodeURIComponent(String(id))}`, row);
      tableBus.emit(uiName);
      return saved;
    },
    async bulkPut(rows: T[]) {
      if (rows.length === 0) return 0;
      const result = await remoteClient.post<{ count: number }>(`${root}/bulk`, { rows });
      tableBus.emit(uiName);
      return result.count;
    },
    async delete(id: string) {
      await remoteClient.delete(`${root}/${encodeURIComponent(id)}`);
      tableBus.emit(uiName);
    },
    async bulkDelete(ids: string[]) {
      if (ids.length === 0) return;
      // Backend chưa hỗ trợ bulkDelete; thực hiện tuần tự.
      for (const id of ids) {
        await remoteClient.delete(`${root}/${encodeURIComponent(id)}`).catch(() => undefined);
      }
      tableBus.emit(uiName);
    },
    async clear() {
      await remoteClient.delete(root);
      tableBus.emit(uiName);
    },
    async count() {
      const result = await remoteClient.get<{ count: number }>(`${root}/count`);
      return result.count;
    },
    where(field: string) {
      const buildChain = (filter: () => Promise<T[]>): QueryChain<T> => ({
        toArray: filter,
        async first() {
          const rows = await filter();
          return rows[0];
        },
        async primaryKeys() {
          const rows = await filter();
          return rows.map((row) => String((row as Record<string, unknown>)[primaryKey]));
        },
      });
      return {
        equals(value: unknown) {
          return buildChain(() => list({ [field]: String(value) }));
        },
        anyOf(values: unknown[]) {
          return buildChain(async () => {
            const all = await list();
            const set = new Set(values.map((v) => String(v)));
            return all.filter((row) => set.has(String((row as Record<string, unknown>)[field])));
          });
        },
      };
    },
    orderBy(field: string) {
      const sortBy = async (reverse: boolean): Promise<T[]> => {
        const rows = await list();
        return rows.slice().sort((a, b) => {
          const av = String((a as Record<string, unknown>)[field] ?? "");
          const bv = String((b as Record<string, unknown>)[field] ?? "");
          if (av < bv) return reverse ? 1 : -1;
          if (av > bv) return reverse ? -1 : 1;
          return 0;
        });
      };
      return {
        toArray: () => sortBy(false),
        reverse: () => ({ toArray: () => sortBy(true) }),
      };
    },
    async update(id: string, patch: Partial<T>) {
      const existing = await remoteClient.get<T>(`${root}/${encodeURIComponent(id)}`);
      const merged = { ...existing, ...patch } as T;
      const saved = await remoteClient.put<T>(`${root}/${encodeURIComponent(id)}`, merged);
      tableBus.emit(uiName);
      return saved;
    },
  };
}

// 15 bảng JSON. blobs xử lý riêng qua remoteClient.uploadBlob + blobPublicUrl.
//
// Type của từng bảng được nâng từ `Record<string, unknown>` lên domain type
// thật (Entity, Asset, ...) qua type assertion — backend không validate shape
// nên client phải tin payload trả về đúng. Trade-off chấp nhận để 50+ callsite
// không phải sửa.
import type {
  AnalysisRecord,
  AppSettings,
  Asset,
  AssetItem,
  BrandKit,
  DesignDocument,
  Entity,
  FontAsset,
  GenerateBindingPreset,
  GenerationJob,
  ManualOverride,
  PackTemplate,
  PageTemplate,
  Project,
  SymbolDefinition,
} from "@/models";

export const remoteDb = {
  projects: makeTable("projects", "projectId") as unknown as DexieLikeTable<Project>,
  entities: makeTable("entities", "entityId") as unknown as DexieLikeTable<Entity>,
  assets: makeTable("assets", "assetId") as unknown as DexieLikeTable<Asset>,
  assetLibrary: makeTable("assetLibrary", "assetId") as unknown as DexieLikeTable<AssetItem>,
  brandKits: makeTable("brandKits", "brandKitId") as unknown as DexieLikeTable<BrandKit>,
  designDocuments: makeTable("designDocuments", "designDocumentId") as unknown as DexieLikeTable<DesignDocument>,
  fontAssets: makeTable("fontAssets", "fontAssetId") as unknown as DexieLikeTable<FontAsset>,
  pageTemplates: makeTable("pageTemplates", "pageTemplateId") as unknown as DexieLikeTable<PageTemplate>,
  packTemplates: makeTable("packTemplates", "packTemplateId") as unknown as DexieLikeTable<PackTemplate>,
  jobs: makeTable("jobs", "jobId") as unknown as DexieLikeTable<GenerationJob>,
  overrides: makeTable("overrides", "overrideId") as unknown as DexieLikeTable<ManualOverride>,
  generatePresets: makeTable("generatePresets", "presetId") as unknown as DexieLikeTable<GenerateBindingPreset>,
  analyses: makeTable("analyses", "analysisId") as unknown as DexieLikeTable<AnalysisRecord>,
  symbols: makeTable("symbols", "symbolId") as unknown as DexieLikeTable<SymbolDefinition>,
  settings: makeTable("settings", "id") as unknown as DexieLikeTable<AppSettings & { id: string }>,

  /**
   * Dexie's `transaction("rw", [tables], fn)` → best-effort mode: chạy fn
   * với cùng db reference. Backend không có ACID transaction qua HTTP, nhưng
   * mỗi mutation đơn lẻ ở SQLite vẫn atomic. Chấp nhận trade-off cho single
   * user. Khi cần batch atomic: dùng bulkPut hoặc thêm endpoint /tx sau.
   */
  async transaction<T>(
    _mode: string,
    _tables: unknown,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    return await fn();
  },

  /** Bảng blobs: chỉ expose count (cho dashboard). Upload đi qua remoteClient. */
  blobs: {
    async count(): Promise<number> {
      try {
        const result = await remoteClient.get<{ count: number }>("/tables/blobs/count");
        return result.count;
      } catch {
        return 0;
      }
    },
    async get(_blobKey: string): Promise<BlobRecord | undefined> {
      console.warn(
        "[remoteDb] db.blobs.get() không hoạt động - blob lưu trên server. Dùng URL /api/v1/blobs/<key> thay vì binary.",
      );
      return undefined;
    },
    async put(_record: unknown): Promise<void> {
      console.warn(
        "[remoteDb] db.blobs.put() không hoạt động - dùng saveBlob() từ storage/db.ts.",
      );
    },
    async bulkPut(_records: unknown): Promise<void> {
      console.warn(
        "[remoteDb] db.blobs.bulkPut() không hoạt động - dùng saveBlob() từ storage/db.ts.",
      );
    },
    async delete(_blobKey: string): Promise<void> {
      // No-op cho luồng cleanup. Server có thể GC blob orphan sau.
    },
    async bulkDelete(_keys: string[]): Promise<void> {
      // No-op.
    },
    async clear(): Promise<void> {
      // No-op. Cleanup blobs orphan là responsibility của server.
    },
    async toArray(): Promise<BlobRecord[]> {
      return [];
    },
    where(_field: string) {
      return {
        anyOf(_values: unknown[]) {
          return {
            async toArray(): Promise<BlobRecord[]> {
              return [];
            },
          };
        },
        equals(_value: unknown) {
          return {
            async toArray(): Promise<BlobRecord[]> {
              return [];
            },
          };
        },
      };
    },
  },
};

export type RemoteDb = typeof remoteDb;
