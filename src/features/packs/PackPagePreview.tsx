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
 * fallback về pageTemplate gốc. Nếu designDocument có nhiều element hơn thì dùng nó.
 */
function pickEffectiveTemplate(
  tpl: PageTemplate,
  linkedDoc: DesignDocument | undefined,
): PageTemplate {
  if (!linkedDoc) return tpl;
  try {
    const fromDoc = designDocumentToPageTemplate(linkedDoc, tpl);
    // Ưu tiên bản có nhiều slot hơn (tránh trường hợp doc cũ/rỗng ghi đè template mới)
    if (fromDoc.slots.length >= tpl.slots.length) return fromDoc;
    return tpl;
  } catch {
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
      return linked ?? null; // null = không tìm thấy (phân biệt với undefined = đang load)
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
  const scale =
    viewport.width && viewport.height ? Math.min(viewport.width / cw, viewport.height / ch) : 0;
  const renderedWidth = cw * scale;
  const renderedHeight = ch * scale;
  const left = (viewport.width - renderedWidth) / 2;
  const top = (viewport.height - renderedHeight) / 2;

  const hasVisibleSlots = effectiveTemplate.slots.some((s) => !s.style?.hidden);

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden"
      style={{ background: effectiveTemplate.canvas.background ?? "#fff" }}
    >
      {scale > 0 && hasVisibleSlots ? (
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: renderedWidth,
            height: renderedHeight,
            pointerEvents: "none",
          }}
        >
          <PageRenderer
            template={effectiveTemplate}
            entities={[]}
            assets={[]}
            scale={scale}
            hideImagePlaceholderText
          />
        </div>
      ) : scale > 0 && !hasVisibleSlots ? (
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[9px] text-muted-foreground/60">Trang trống</span>
        </div>
      ) : null}
    </div>
  );
}
