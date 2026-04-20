// Convert AI layout JSON → PageTemplate.
// AI trả slots với x/y/w/h là tỉ lệ 0..1 + placeholder text. Ta scale lên 1080x1350.

import { nanoid } from "nanoid";
import type { PageTemplate, Slot } from "@/models";

interface AiSlot {
  kind: "text" | "image" | "shape";
  shapeKind?: "rectangle" | "circle" | "badge";
  x: number;
  y: number;
  w: number;
  h: number;
  placeholder?: string;
  style?: {
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    fill?: string;
    borderRadius?: number;
    textAlign?: "left" | "center" | "right";
    textTransform?: "none" | "uppercase" | "lowercase";
  };
}

interface AiLayout {
  canvas?: { bgColor?: string };
  slots: AiSlot[];
}

export function aiLayoutToTemplate(layout: AiLayout, name = "AI Template"): PageTemplate {
  const W = 1080;
  const H = 1350;
  const slots: Slot[] = layout.slots
    .filter((s) => s && typeof s.x === "number")
    .map((s, idx) => {
      const x = Math.max(0, Math.min(1, s.x)) * W;
      const y = Math.max(0, Math.min(1, s.y)) * H;
      const width = Math.max(0.01, Math.min(1, s.w)) * W;
      const height = Math.max(0.01, Math.min(1, s.h)) * H;
      const base: Slot = {
        slotId: nanoid(),
        kind: s.kind,
        x,
        y,
        width,
        height,
        rotation: 0,
        zIndex: idx + 1,
      };
      if (s.kind === "text") {
        base.staticText = s.placeholder ?? "{{text}}";
        base.style = {
          fontFamily: "Be Vietnam Pro",
          fontSize: s.style?.fontSize ?? 32,
          fontWeight: s.style?.fontWeight ?? 600,
          color: s.style?.color ?? "#0f172a",
          textAlign: s.style?.textAlign ?? "left",
          textTransform: s.style?.textTransform ?? "none",
        };
      } else if (s.kind === "shape") {
        base.shapeKind = s.shapeKind ?? "rectangle";
        base.style = {
          fill: s.style?.fill ?? "#e5e7eb",
          borderRadius: s.style?.borderRadius,
        };
      } else if (s.kind === "image") {
        base.style = { fit: "cover", borderRadius: s.style?.borderRadius };
      }
      return base;
    });

  return {
    pageTemplateId: nanoid(),
    name,
    type: "mixed",
    canvas: { width: W, height: H, background: layout.canvas?.bgColor ?? "#ffffff" },
    slots,
    sections: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
