// Canvas read-only, chỉ để chọn block và bind data ở trang Tạo nội dung.
// Render giống PageRenderer nhưng cho phép click + outline khi chọn / đã bind.
import { useMemo } from "react";
import type { Asset, Entity, PageTemplate, Slot } from "@/models";
import {
  buildBoxShadow,
  buildCssFilter,
  buildFlipTransform,
  resolveImageBinding,
  resolveTextBinding,
} from "@/engines/binding/dataBinding";

export function BindCanvas({
  template,
  scale,
  selectedSlotId,
  onSelectSlot,
  entity,
  assets,
}: {
  template: PageTemplate;
  scale: number;
  selectedSlotId: string | null;
  onSelectSlot: (id: string | null) => void;
  entity?: Entity;
  assets: Asset[];
}) {
  const { width, height, background, backgroundImage } = template.canvas;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelectSlot(null);
      }}
      style={{
        width: width * scale,
        height: height * scale,
        position: "relative",
        background: background ?? "transparent",
        backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        overflow: "hidden",
        fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
      }}
    >
      {template.slots
        .slice()
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((slot) => (
          <BindSlot
            key={slot.slotId}
            slot={slot}
            scale={scale}
            selected={slot.slotId === selectedSlotId}
            onSelect={() => onSelectSlot(slot.slotId)}
            entity={entity}
            assets={assets}
          />
        ))}
    </div>
  );
}

function BindSlot({
  slot,
  scale,
  selected,
  onSelect,
  entity,
  assets,
}: {
  slot: Slot;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  entity?: Entity;
  assets: Asset[];
}) {
  const flip = buildFlipTransform(slot.style);
  const rot = slot.rotation ? `rotate(${slot.rotation}deg)` : "";
  const transform = (rot + flip).trim() || undefined;
  const hasBinding = !!slot.bindingPath;
  const isBindable = slot.kind === "text" || slot.kind === "image";

  const outline = selected
    ? "2px solid hsl(var(--primary))"
    : hasBinding
      ? "2px dashed hsl(var(--primary) / 0.6)"
      : isBindable
        ? "1px dashed hsl(var(--border))"
        : "1px dashed transparent";

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: slot.x * scale,
    top: slot.y * scale,
    width: slot.width * scale,
    height: slot.height * scale,
    transform,
    transformOrigin: "center",
    boxShadow: buildBoxShadow(slot.style, scale),
    opacity: slot.style?.opacity ?? 1,
    outline,
    outlineOffset: 0,
    boxSizing: "border-box",
    cursor: isBindable ? "pointer" : "default",
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBindable) onSelect();
  };

  if (slot.kind === "shape") {
    return (
      <div
        onMouseDown={onClick}
        style={{
          ...baseStyle,
          background: slot.style?.fill ?? "#000",
          borderRadius: slot.shapeKind === "circle" ? "50%" : (slot.style?.borderRadius ?? 0) * scale,
        }}
      />
    );
  }

  if (slot.kind === "image") {
    let src = slot.staticImage;
    if (slot.bindingPath && entity) {
      const r = resolveImageBinding(slot.bindingPath, entity, assets, src);
      if (r.src) src = r.src;
    }
    const filter = buildCssFilter(slot.style);
    const objectFit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const crop = slot.crop;
    return (
      <div onMouseDown={onClick} style={{ ...baseStyle, overflow: "hidden", borderRadius: (slot.style?.borderRadius ?? 0) * scale }}>
        {src ? (
          crop ? (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: `${-crop.x * 100}%`,
                top: `${-crop.y * 100}%`,
                width: `${100 / crop.w}%`,
                height: `${100 / crop.h}%`,
                objectFit: "fill",
                filter,
                pointerEvents: "none",
              }}
            />
          ) : (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit, filter, pointerEvents: "none" }}
            />
          )
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "hsl(var(--muted))",
              display: "grid",
              placeItems: "center",
              color: "hsl(var(--muted-foreground))",
              fontSize: 12,
              padding: 8,
              textAlign: "center",
            }}
          >
            {hasBinding ? slot.bindingPath : "Block ảnh — click để chọn"}
          </div>
        )}
      </div>
    );
  }

  if (slot.kind === "text") {
    const s = slot.style ?? {};
    const text = slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText)
      : (slot.staticText ?? "Văn bản");
    return (
      <div
        onMouseDown={onClick}
        style={{
          ...baseStyle,
          color: s.color ?? "#0f172a",
          fontSize: (s.fontSize ?? 24) * scale,
          fontWeight: s.fontWeight ?? 500,
          lineHeight: s.lineHeight ?? 1.2,
          textAlign: s.textAlign ?? "left",
          textTransform: s.textTransform ?? "none",
          letterSpacing: (s.letterSpacing ?? 0) * scale,
          padding: (s.padding ?? 0) * scale,
          background: s.background,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "hidden",
        }}
      >
        {text}
      </div>
    );
  }

  if (slot.kind === "section") {
    return (
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        style={{
          ...baseStyle,
          background: "hsl(var(--accent) / 0.3)",
          border: "1px dashed hsl(var(--border))",
          display: "grid",
          placeItems: "center",
          color: "hsl(var(--muted-foreground))",
          fontSize: 12,
        }}
      >
        Section
      </div>
    );
  }

  return null;
}
