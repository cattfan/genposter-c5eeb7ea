// Resolver chung cho src ảnh trong toàn app.
// Hỗ trợ:
//   - "idb://<blobKey>" → load từ IndexedDB và tạo object URL (persistent qua reload)
//   - "blob:..."         → trả thẳng (chỉ sống trong session hiện tại)
//   - URL thường         → trả thẳng
import { useEffect, useState } from "react";
import { db } from "@/storage/db";

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

// Cache để tránh tạo nhiều object URL cho cùng 1 blobKey trong session.
const urlCache = new Map<string, Promise<string | null>>();

export async function resolveImageSrcAsync(src: string | undefined | null): Promise<string | null> {
  if (!src) return null;
  if (!src.startsWith(IDB_PREFIX)) return src;
  const key = src.slice(IDB_PREFIX.length);
  let p = urlCache.get(key);
  if (!p) {
    p = (async () => {
      const rec = await db.blobs.get(key);
      if (!rec) return null;
      return URL.createObjectURL(rec.blob);
    })();
    urlCache.set(key, p);
  }
  return p;
}

/** Hook React: trả ra src đã resolve (object URL) cho idb:// , giữ nguyên cho URL thường. */
export function useResolvedImageSrc(src: string | undefined | null): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => (src && !src.startsWith(IDB_PREFIX) ? src : undefined));

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setResolved(undefined);
      return;
    }
    if (!src.startsWith(IDB_PREFIX)) {
      setResolved(src);
      return;
    }
    resolveImageSrcAsync(src).then((url) => {
      if (!cancelled) setResolved(url ?? undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}
