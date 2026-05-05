// Mini thumbnail render 1 page template (scale-fit container)
import { useEffect, useRef, useState } from "react";
import type { PageTemplate } from "@/models";
import { PageRenderer } from "@/features/render/PageRenderer";

export function PackPagePreview({ tpl }: { tpl: PageTemplate }) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

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

  const scale =
    viewport.width && viewport.height
      ? Math.min(viewport.width / tpl.canvas.width, viewport.height / tpl.canvas.height)
      : 0;
  const renderedWidth = tpl.canvas.width * scale;
  const renderedHeight = tpl.canvas.height * scale;
  const left = (viewport.width - renderedWidth) / 2;
  const top = (viewport.height - renderedHeight) / 2;

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden"
      style={{ background: tpl.canvas.background ?? "#fff" }}
    >
      {scale > 0 ? (
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
            template={tpl}
            entities={[]}
            assets={[]}
            scale={scale}
            showSlotBounds
            hideImagePlaceholderText
          />
        </div>
      ) : null}
    </div>
  );
}
