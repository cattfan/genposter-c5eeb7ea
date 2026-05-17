// Hook quản lý "draft template" trong workspace generate.
//
// Nguyên do tách: PackTabContent có 4 ref + 1 state + 6 helper xoay quanh
// previewPageDrafts (clone, undo/redo history, hydrate khi packPages thay
// đổi). Tách giúp test riêng, giảm noise trong god-component.
//
// Đặc điểm:
// - State chính lưu trong `useState` để React re-render khi đổi.
// - Lịch sử (past/future stack) lưu trong `useRef` để tránh re-render thừa
//   khi đẩy/lấy 1 entry. `historyVersion` là số tăng dần để force re-render
//   khi UI cần biết "có còn undo/redo được không".
// - `commit(updater, { history: true })` (default) là API chính cho thay đổi
//   incremental. `replace`/`reset` cho thay đổi lớn.
// - Khi `packPages` (template gốc) thay đổi, drafts phải được "hydrate" lại
//   qua `restoreTemplateGroups` để đồng bộ groups; hook tự lo việc này nếu
//   caller gọi `setPackPages`.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageTemplate } from "@/models";
import {
  clonePageTemplate,
  GENERATE_TEMPLATE_OPTIONS,
  restoreTemplateGroups,
} from "@/features/generate/templateState";

export type PreviewPageDrafts = Record<string, PageTemplate>;

export const DRAFT_HISTORY_LIMIT = 30;

export interface CommitOptions {
  history?: boolean;
}

export interface UsePreviewPageDraftsResult {
  /** State drafts; dùng cho effect/render. Reactivity normal React. */
  drafts: PreviewPageDrafts;
  /** Snapshot tại thời điểm hiện tại (đồng bộ với drafts; convenience). */
  draftsRef: React.MutableRefObject<PreviewPageDrafts>;
  canUndo: boolean;
  canRedo: boolean;
  /** Thay đổi drafts qua updater. Default đẩy snapshot trước vào history. */
  commit: (updater: (prev: PreviewPageDrafts) => PreviewPageDrafts, options?: CommitOptions) => void;
  /** Reset toàn bộ drafts về {}. */
  reset: (options?: CommitOptions) => void;
  /** Replace drafts hoàn toàn (clone deep input). */
  replace: (next: PreviewPageDrafts, options?: CommitOptions) => void;
  undo: () => void;
  redo: () => void;
  /** Bind packPages mới (khi user đổi pack hoặc template gốc thay đổi). */
  hydrateForPackPages: (packPages: PageTemplate[]) => void;
}

export function clonePreviewPageDrafts(drafts: PreviewPageDrafts): PreviewPageDrafts {
  return Object.fromEntries(
    Object.entries(drafts).map(([pageTemplateId, template]) => [
      pageTemplateId,
      clonePageTemplate(template),
    ]),
  );
}

export function cloneTemplateDraftsWithSource(
  drafts: PreviewPageDrafts,
  sourceTemplates: PageTemplate[],
): PreviewPageDrafts {
  const sourceById = new Map(sourceTemplates.map((template) => [template.pageTemplateId, template]));
  return Object.fromEntries(
    Object.entries(drafts).map(([pageTemplateId, template]) => [
      pageTemplateId,
      clonePageTemplate(
        restoreTemplateGroups(
          sourceById.get(pageTemplateId),
          template,
          GENERATE_TEMPLATE_OPTIONS,
        ),
      ),
    ]),
  );
}

export function usePreviewPageDrafts(): UsePreviewPageDraftsResult {
  const [drafts, setDrafts] = useState<PreviewPageDrafts>({});
  const draftsRef = useRef<PreviewPageDrafts>({});
  const pastRef = useRef<PreviewPageDrafts[]>([]);
  const futureRef = useRef<PreviewPageDrafts[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const packPagesRef = useRef<PageTemplate[]>([]);

  const touchHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  const clearHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    touchHistory();
  }, [touchHistory]);

  const setNoHistory = useCallback((next: PreviewPageDrafts) => {
    const hydrated = cloneTemplateDraftsWithSource(next, packPagesRef.current);
    draftsRef.current = hydrated;
    setDrafts(hydrated);
  }, []);

  const commit = useCallback(
    (updater: (prev: PreviewPageDrafts) => PreviewPageDrafts, options: CommitOptions = {}) => {
      const prev = draftsRef.current;
      const next = updater(prev);
      if (next === prev) return;

      if (options.history !== false) {
        pastRef.current = [...pastRef.current, clonePreviewPageDrafts(prev)].slice(-DRAFT_HISTORY_LIMIT);
        futureRef.current = [];
        touchHistory();
      }

      setNoHistory(next);
    },
    [setNoHistory, touchHistory],
  );

  const reset = useCallback(
    (options: CommitOptions = {}) => {
      commit(() => ({}), options);
      if (options.history === false) clearHistory();
    },
    [commit, clearHistory],
  );

  const replace = useCallback(
    (next: PreviewPageDrafts, options: CommitOptions = {}) => {
      commit(() => clonePreviewPageDrafts(next), options);
      if (options.history === false) clearHistory();
    },
    [commit, clearHistory],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [
      ...futureRef.current,
      clonePreviewPageDrafts(draftsRef.current),
    ].slice(-DRAFT_HISTORY_LIMIT);
    setNoHistory(clonePreviewPageDrafts(previous));
    touchHistory();
  }, [setNoHistory, touchHistory]);

  const redo = useCallback(() => {
    const next = futureRef.current.at(-1);
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [
      ...pastRef.current,
      clonePreviewPageDrafts(draftsRef.current),
    ].slice(-DRAFT_HISTORY_LIMIT);
    setNoHistory(clonePreviewPageDrafts(next));
    touchHistory();
  }, [setNoHistory, touchHistory]);

  const hydrateForPackPages = useCallback((packPages: PageTemplate[]) => {
    packPagesRef.current = packPages;
    if (Object.keys(draftsRef.current).length === 0) return;
    const hydrated = cloneTemplateDraftsWithSource(draftsRef.current, packPages);
    if (JSON.stringify(hydrated) === JSON.stringify(draftsRef.current)) return;
    draftsRef.current = hydrated;
    setDrafts(hydrated);
  }, []);

  // Đảm bảo draftsRef đồng bộ khi React batch update từ ngoài (rất hiếm —
  // chỉ phòng hờ).
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  return {
    drafts,
    draftsRef,
    canUndo: historyVersion >= 0 && pastRef.current.length > 0,
    canRedo: historyVersion >= 0 && futureRef.current.length > 0,
    commit,
    reset,
    replace,
    undo,
    redo,
    hydrateForPackPages,
  };
}
