// CropOverlay: overlay khi double-click ảnh để crop. ESC = huỷ, Enter = xác nhận.
import { useEffect, useRef, useState } from "react";
import type { ImageCrop } from "@/models";

type Handle = "nw" | "ne" | "sw" | "se";

export function CropOverlay({
  src,
  initial,
  zoom,
  width,
  height,
  onCommit,
  onCancel,
}: {
  src: string;
  initial?: ImageCrop;
  zoom: number;
  width: number; // hiển thị (canvas px * zoom)
  height: number;
  onCommit: (crop: ImageCrop) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState<ImageCrop>(
    initial ?? { x: 0, y: 0, w: 1, h: 1 },
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onCommit(crop);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [crop, onCommit, onCancel]);

  const startDrag = (e: React.MouseEvent, handle: Handle | "move") => {
    e.stopPropagation();
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...crop };
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      let { x, y, w, h } = orig;
      if (handle === "move") {
        x = clamp(orig.x + dx, 0, 1 - orig.w);
        y = clamp(orig.y + dy, 0, 1 - orig.h);
      } else {
        if (handle.includes("e")) w = clamp(orig.w + dx, 0.05, 1 - orig.x);
        if (handle.includes("s")) h = clamp(orig.h + dy, 0.05, 1 - orig.y);
        if (handle.includes("w")) {
          const nw = clamp(orig.w - dx, 0.05, orig.x + orig.w);
          x = orig.x + (orig.w - nw);
          w = nw;
        }
        if (handle.includes("n")) {
          const nh = clamp(orig.h - dy, 0.05, orig.y + orig.h);
          y = orig.y + (orig.h - nh);
          h = nh;
        }
      }
      setCrop({ x, y, w, h });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handles: { h: Handle; style: React.CSSProperties }[] = [
    { h: "nw", style: { left: -6, top: -6, cursor: "nwse-resize" } },
    { h: "ne", style: { right: -6, top: -6, cursor: "nesw-resize" } },
    { h: "sw", style: { left: -6, bottom: -6, cursor: "nesw-resize" } },
    { h: "se", style: { right: -6, bottom: -6, cursor: "nwse-resize" } },
  ];

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.5)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Ảnh đầy đủ phía dưới (nhìn xuyên qua mask) */}
      <img
        src={src}
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "fill",
          opacity: 0.4,
          pointerEvents: "none",
        }}
        alt=""
      />
      {/* Khung crop */}
      <div
        onMouseDown={(e) => startDrag(e, "move")}
        style={{
          position: "absolute",
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.w * 100}%`,
          height: `${crop.h * 100}%`,
          border: "2px solid white",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
          cursor: "move",
          overflow: "hidden",
        }}
      >
        <img
          src={src}
          draggable={false}
          style={{
            position: "absolute",
            left: `${-crop.x * 100}%`,
            top: `${-crop.y * 100}%`,
            width: `${100 / crop.w}%`,
            height: `${100 / crop.h}%`,
            objectFit: "fill",
            pointerEvents: "none",
          }}
          alt=""
        />
        {handles.map((hd) => (
          <div
            key={hd.h}
            onMouseDown={(e) => startDrag(e, hd.h)}
            style={{
              position: "absolute",
              width: 12,
              height: 12,
              background: "white",
              border: "2px solid hsl(var(--primary))",
              borderRadius: 2,
              ...hd.style,
            }}
          />
        ))}
      </div>
      {/* Toolbar */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 6,
          background: "white",
          padding: 6,
          borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <button
          onClick={() => onCancel()}
          style={{ padding: "4px 10px", fontSize: 12, border: "1px solid #ddd", borderRadius: 4, background: "white" }}
        >
          Huỷ (Esc)
        </button>
        <button
          onClick={() => onCommit(crop)}
          style={{ padding: "4px 10px", fontSize: 12, border: "none", borderRadius: 4, background: "hsl(var(--primary))", color: "white" }}
        >
          Áp dụng (Enter)
        </button>
      </div>
      {/* hint */}
      <div style={{ position: "absolute", top: 8, left: 8, color: "white", fontSize: 11, background: "rgba(0,0,0,0.6)", padding: "2px 6px", borderRadius: 3 }}>
        {Math.round(crop.w * width)} × {Math.round(crop.h * height)} (zoom {Math.round(zoom * 100)}%)
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
