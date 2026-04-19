// Undo/Redo stack cho draft template
import { useCallback, useEffect, useRef, useState } from "react";

const MAX = 50;

export function useHistory<T>(initial: T | null) {
  const [present, setPresent] = useState<T | null>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const skipNextPush = useRef(false);

  // reset khi initial thay đổi (load template mới)
  useEffect(() => {
    setPresent(initial);
    past.current = [];
    future.current = [];
  }, [initial]);

  const set = useCallback((updater: (prev: T) => T) => {
    setPresent((prev) => {
      if (prev == null) return prev;
      if (!skipNextPush.current) {
        past.current.push(prev);
        if (past.current.length > MAX) past.current.shift();
        future.current = [];
      }
      skipNextPush.current = false;
      return updater(prev);
    });
  }, []);

  const replace = useCallback((value: T) => {
    setPresent(value);
    past.current = [];
    future.current = [];
  }, []);

  const undo = useCallback(() => {
    setPresent((prev) => {
      if (prev == null) return prev;
      const last = past.current.pop();
      if (last == null) return prev;
      future.current.push(prev);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setPresent((prev) => {
      if (prev == null) return prev;
      const next = future.current.pop();
      if (next == null) return prev;
      past.current.push(prev);
      return next;
    });
  }, []);

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    state: present,
    set,
    replace,
    undo,
    redo,
    canUndo: () => past.current.length > 0,
    canRedo: () => future.current.length > 0,
  };
}
