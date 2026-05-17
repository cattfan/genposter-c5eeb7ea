// Bridge giữa code cũ (gọi `db.<table>.<method>` kiểu Dexie) và backend NestJS.
//
// Trước đây file này định nghĩa Dexie database lưu IndexedDB. Sau migration
// sang backend SQLite, mọi storage chuyển ra server. File này chỉ re-export
// `remoteDb` (HTTP-backed) cùng tên `db` để 50+ callsite không phải đổi import.
//
// `saveBlob`/`getBlobURL`/`clearAll`/`clearAllExceptSymbols` được port sang
// gọi backend tương đương.

import { nanoid } from "nanoid";
import { remoteClient, blobPublicUrl } from "./remoteClient";
import { remoteDb } from "./remoteDb";

export const db = remoteDb;

/** Upload Blob lên backend. Trả về blobKey để store vào field `idb://<key>`. */
export async function saveBlob(blob: Blob, key?: string): Promise<string> {
  const blobKey = key ?? nanoid();
  const result = await remoteClient.uploadBlob(blob, blobKey);
  return result.blobKey;
}

/**
 * Trả về URL công khai để render `<img>`. Vì blob nằm trên server, chỉ cần
 * trỏ đến endpoint `/api/v1/blobs/<key>` — browser tự cache theo header
 * `Cache-Control: immutable` mà server set.
 */
export async function getBlobURL(blobKey: string): Promise<string | null> {
  return blobPublicUrl(blobKey);
}

/**
 * Xoá toàn bộ data khỏi server (15 bảng JSON). Blob orphan không xoá tự động
 * — server có thể GC sau.
 */
export async function clearAll(): Promise<void> {
  await Promise.all([
    db.projects.clear(),
    db.entities.clear(),
    db.assets.clear(),
    db.assetLibrary.clear(),
    db.brandKits.clear(),
    db.designDocuments.clear(),
    db.fontAssets.clear(),
    db.pageTemplates.clear(),
    db.packTemplates.clear(),
    db.jobs.clear(),
    db.overrides.clear(),
    db.generatePresets.clear(),
    db.analyses.clear(),
    db.settings.clear(),
    db.symbols.clear(),
  ]);
}

/**
 * Như `clearAll` nhưng giữ lại `symbols` — dùng cho luồng import legacy JSON
 * không bao gồm symbols, tránh xoá thư viện symbol user đã build.
 */
export async function clearAllExceptSymbols(): Promise<void> {
  await Promise.all([
    db.projects.clear(),
    db.entities.clear(),
    db.assets.clear(),
    db.assetLibrary.clear(),
    db.brandKits.clear(),
    db.designDocuments.clear(),
    db.fontAssets.clear(),
    db.pageTemplates.clear(),
    db.packTemplates.clear(),
    db.jobs.clear(),
    db.overrides.clear(),
    db.generatePresets.clear(),
    db.analyses.clear(),
    db.settings.clear(),
  ]);
}
