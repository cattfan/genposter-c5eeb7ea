// Drop-in replacement cho dexie-react-hooks `useLiveQuery`.
//
// Sau migration sang backend HTTP, không còn IndexedDB observer. Hook này:
//   - Chạy querier bất cứ khi nào deps đổi.
//   - Subscribe `tableBus` (emit local sau mỗi mutation qua remoteDb) +
//     WebSocket `/ws` (emit khi tab khác/browser khác mutate) → tự re-fetch.
//   - Trả về undefined trong lần render đầu (giống useLiveQuery).
//
// Các caller hiện đang dùng `useLiveQuery(() => db.X.toArray(), [deps])` chỉ
// cần đổi import path: từ "dexie-react-hooks" sang "@/storage/useLiveQuery".

import { useEffect, useState } from "react";
import { tableBus } from "./remoteDb";
import { realtimeBus } from "./realtimeBus";

type Querier<T> = () => Promise<T> | T;

export function useLiveQuery<T>(querier: Querier<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [tick, setTick] = useState(0);

  // Re-run khi mutation từ tab này (tableBus) hoặc tab khác (realtimeBus).
  useEffect(() => {
    const offLocal = tableBus.on(() => setTick((n) => n + 1));
    const offRemote = realtimeBus.on(() => setTick((n) => n + 1));
    return () => {
      offLocal();
      offRemote();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => querier())
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
