// Mini thumbnail render 1 page template (scale-fit container)
// Đọc designDocument nếu có (chứa content mới nhất), fallback về pageTemplate.
import { useEffect, useRef, useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { DesignDocument, PageTemplate } from "@/models";
import { PageRenderer } from "@/features/render/PageRenderer";
import { db } from "@/storage/db";
import { designDocumentToPageTemplate } from "@/features/editor/designDocument";

/**
 * Lấy template hiệu quả nhất: ưu tiên designDocument (chứa content mới nhất từ editor),
 * fallback về pageTemplate gốc.
 */
function pickEffectiveTemplate(
  tpl: PageTemplate,
  linkedDoc: DesignDocument | undefined,
): PageTemplate {
  if (!linkedDoc) {
    if (import.meta.env.DEV && tpl.slots.length === 0) {
      console.debug("[PackPagePreview] no linkedDoc, tpl has 0 slots:", tpl.pageTemplateId);
    }
    return tpl;
  }
  try {
    const fromDoc = designDocumentToPageTemplate(linkedDoc, tpl);
    if (import.meta.env.DEV) {
      console.debug(
        "[PackPagePreview]",
        tpl.pageTemplateId,
        "tpl.slots:", tpl.slots.length,
        "fromDoc.slots:", fromDoc.slots.length,
        "elements:", linkedDoc.elements.length,
      );
    }
    // Ưu tiên bản có nhiều slot hơn (tránh trường hợp doc cũ/rỗng ghi đè template mới)
    if (fromDoc.slots.length >= tpl.slots.length) return fromDoc;
    return tpl;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[PackPagePreview] conversion error:", err);
    }
    return tpl;
  }
}

export function PackPagePreview({ tpl }: { tpl: PageTemplate }) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Đọc designDocument nếu có (content mới nhất từ editor)
  const linkedDoc = useLiveQuery(
    async () => {
      // Trường hợp 1: designDocumentId === pageTemplateId (EditorPage lưu trực tiếp)
      const direct = await db.designDocuments.get(tpl.pageTemplateId);
      if (direct) return direct;
      // Trường hợp 2: sourcePageTemplateId trỏ về pageTemplateId
      const linked = await db.designDocuments
        .where("sourcePageTemplateId")
        .equals(tpl.pageTemplateId)
        .first();
      return linked ?? null;
    },
    [tpl.pageTemplateId],
  );

  const effectiveTemplate = useMemo(
    () => pickEffectiveTemplate(tpl, linkedDoc ?? undefined),
    [linkedDoc, tpl],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width: cw, height: ch } = effectiveTemplate.canvas;

  // Render ở scale lớn hơn rồi CSS scale-down để text đủ lớn nhìn rõ
  const fitScale =
    viewport.width && viewport.height ? Math.min(viewport.width / cw, viewport.height / ch) : 0;
  // Render tối thiểu ở 0.25 để font ~40px → 10px (đọc được)
  const renderScale = Math.max(fitScale, 0.25);
  const cssScale = fitScale > 0 ? fitScale / renderScale : 0;
  const renderedWidth = cw * renderScale;
  const renderedHeight = ch * renderScale;
  const displayWidth = cw * fitScale;
  const displayHeight = ch * fitScale;
  const left = (viewport.width - displayWidth) / 2;
  const top = (viewport.height - displayHeight) / 2;

  const hasAnySlots = effectiveTemplate.slots.length > 0;

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden"
      style={{ background: effectiveTemplate.canvas.background ?? "#fff" }}
    >
      {fitScale > 0 && hasAnySlots ? (
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: displayWidth,
            height: displayHeight,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: renderedWidth,
              height: renderedHeight,
              transform: cssScale < 1 ? `scale(${cssScale})` : undefined,
              transformOrigin: "top left",
              willChange: "transform",
            }}
          >
            <PageRenderer
              template={effectiveTemplate}
              entities={[]}
              assets={[]}
              scale={renderScale}
              hideImagePlaceholderText
              hideEmptyImages
            />
          </div>
        </div>
      ) : fitScale > 0 && !hasAnySlots ? (
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[9px] text-muted-foreground/60">Trang trống</span>
        </div>
      ) : null}
    </div>
  );
}
