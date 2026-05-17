// Resolver chung cho src ảnh trong toàn app.
//
// Sau migration sang backend SQLite + filesystem blobs:
//   - "idb://<blobKey>"  → resolve thành "/api/v1/blobs/<key>" (Vite proxy về NestJS)
//   - "blob:..."          → trả thẳng (object URL trong session, ví dụ preview upload)
//   - URL thường (http..) → trả thẳng
//
// Trước đây phải fetch binary từ IndexedDB rồi tạo `URL.createObjectURL` →
// 1 round trip async. Sau migration: URL backend stable, browser tự cache theo
// header `Cache-Control: immutable` → đồng bộ, không cần state.

import { useMemo } from "react";
import { blobPublicUrl } from "@/storage/remoteClient";

const IDB_PREFIX = "idb://";

export function isIdbSrc(src: string | undefined | null): src is string {
  return !!src && src.startsWith(IDB_PREFIX);
}

export function makeIdbSrc(blobKey: string): string {
  return IDB_PREFIX + blobKey;
}

export function getBlobKeyFromSrc(src: string): string | null {
  if (!src.startsWith(IDB_PREFIX)) return null;
  return src.slice(IDB_PREFIX.length);
}

/** True nếu src là idb:// chưa resolve. Sau migration luôn resolve được, giữ
 *  hàm để code cũ không phải đổi. */
export function isPendingIdb(src: string | undefined | null, resolved: string | undefined): boolean {
  if (!src) return false;
  return src.startsWith(IDB_PREFIX) && !resolved;
}

/** Sync version: convert idb:// → URL backend ngay (không cần await). */
export function resolveImageSrc(src: string | undefined | null): string | null {
  if (!src) return null;
  if (!src.startsWith(IDB_PREFIX)) return src;
  const key = src.slice(IDB_PREFIX.length);
  return blobPublicUrl(key);
}

/** Async version giữ signature cũ cho code cũ chưa migrate. */
export async function resolveImageSrcAsync(src: string | undefined | null): Promise<string | null> {
  return resolveImageSrc(src);
}

/** Hook React: trả ra src đã resolve. Sync vì giờ chỉ là URL transformation. */
export function useResolvedImageSrc(src: string | undefined | null): string | undefined {
  return useMemo(() => {
    const resolved = resolveImageSrc(src ?? null);
    return resolved ?? undefined;
  }, [src]);
}
