// Drop-in replacement cho dexie-react-hooks `useLiveQuery`.
//
// Sau migration sang backend HTTP, không còn IndexedDB observer. Hook này:
//   - Chạy querier bất cứ khi nào deps đổi.
//   - Subscribe `tableBus` + `realtimeBus` nhưng CHỈ re-fetch khi đúng bảng
//     liên quan bị mutation (tránh cascade re-fetch toàn bộ app).
//   - Trả về undefined trong lần render đầu (giống useLiveQuery).
//
// Performance fix: trước đây mọi mutation trigger mọi hook → 10+ HTTP
// requests mỗi click. Giờ chỉ hook nào subscribe bảng bị đổi mới re-fetch.

import { useEffect, useRef, useState } from "react";
import { tableBus } from "./remoteDb";
import { realtimeBus } from "./realtimeBus";

type Querier<T> = () => Promise<T> | T;

interface LiveQueryRunnerOptions {
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  sleep?: (delayMs: number) => Promise<void>;
}

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** Math.max(0, attempt - 1));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export async function runLiveQueryQuerier<T>(
  querier: Querier<T>,
  options: LiveQueryRunnerOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const wait = options.sleep ?? sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await querier();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      await wait(retryDelayMs(attempt));
    }
  }

  throw lastError;
}

/**
 * @param querier — async function trả về data (giống Dexie useLiveQuery)
 * @param deps — dependency array cho querier (giống useEffect deps)
 * @param tables — tên bảng(s) mà hook này quan tâm. Nếu không truyền,
 *   hook sẽ re-fetch khi BẤT KỲ bảng nào bị mutation (behavior cũ, chậm).
 *   Truyền để tối ưu: `useLiveQuery(() => db.entities.toArray(), [], ["entities"])`
 */
export function useLiveQuery<T>(
  querier: Querier<T>,
  deps: unknown[] = [],
  tables?: string[],
): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  // Subscribe bus — chỉ increment tick khi bảng liên quan bị mutation.
  useEffect(() => {
    const handler = (table: string) => {
      const watched = tablesRef.current;
      // Nếu không specify tables → re-fetch mọi mutation (backward compat)
      if (!watched || watched.length === 0) {
        setTick((n) => n + 1);
        return;
      }
      // Chỉ re-fetch nếu bảng bị mutation nằm trong danh sách quan tâm
      if (watched.includes(table)) {
        setTick((n) => n + 1);
      }
    };
    const offLocal = tableBus.on(handler);
    const offRemote = realtimeBus.on(handler);
    return () => {
      offLocal();
      offRemote();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    runLiveQueryQuerier(querier)
      .then((next) => {
        if (!cancelled) setValue(next);
      })
      .catch((err) => {
        if (!cancelled) console.error("[useLiveQuery] querier failed:", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return value;
}
