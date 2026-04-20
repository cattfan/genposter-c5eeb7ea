// Canvas read-only, chỉ để chọn block và bind data ở trang Tạo nội dung.
// Render giống PageRenderer nhưng cho phép click + outline khi chọn / đã bind.
import type { Asset, Entity, PageTemplate, Slot } from "@/models";
import {
  buildBoxShadow,
  buildCssFilter,
  buildFlipTransform,
  buildBorder,
  buildGradient,
  buildTextStyle,
  resolveImageBinding,
  resolveTextBinding,
  shapeBorderRadius,
  shapeClipPath,
} from "@/engines/binding/dataBinding";
import { useResolvedImageSrc } from "@/storage/imageSrc";

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
  const resolvedBg = useResolvedImageSrc(backgroundImage);

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
        backgroundImage: resolvedBg ? `url(${resolvedBg})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        overflow: "hidden",
        fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
      }}
    >
      {template.slots
        .slice()
        .filter((s) => !s.style?.hidden)
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
  const isBindable = slot.kind === "text" || slot.kind === "image" || slot.kind === "shape";

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
    let src = slot.staticImage;
    if (slot.bindingPath && entity) {
      const r = resolveImageBinding(slot.bindingPath, entity, assets, src);
      if (r.src) src = r.src;
    }
    const resolvedSrc = useResolvedImageSrc(src);
    const fit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const filter = buildCssFilter(slot.style);
    const radius = shapeBorderRadius(slot.shapeKind, slot.style?.borderRadius, scale);
    const clip = slot.shapeKind ? shapeClipPath(slot.shapeKind) : undefined;
    const gradient = buildGradient(slot.style);
    const border = buildBorder(slot.style, scale);
    const isLine = slot.shapeKind === "line" || slot.shapeKind === "divider";

    if (isLine) {
      return (
        <div
          onMouseDown={onClick}
          style={{
            ...baseStyle,
            background: gradient ?? slot.style?.fill ?? "#000",
          }}
        />
      );
    }

    return (
      <div
        onMouseDown={onClick}
        style={{
          ...baseStyle,
          background: src ? undefined : gradient ?? slot.style?.fill ?? "#e5e7eb",
          borderRadius: radius,
          clipPath: clip,
          border: src ? undefined : border,
          overflow: "hidden",
        }}
      >
        {src ? (
          <>
            <img
              src={resolvedSrc ?? src}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: fit, filter, pointerEvents: "none" }}
            />
            {slot.style?.overlayColor && (
              <div style={{ position: "absolute", inset: 0, background: slot.style.overlayColor, pointerEvents: "none" }} />
            )}
          </>
        ) : null}
      </div>
    );
  }

  if (slot.kind === "image") {
    let src = slot.staticImage;
    if (slot.bindingPath && entity) {
      const r = resolveImageBinding(slot.bindingPath, entity, assets, src);
      if (r.src) src = r.src;
    }
    const resolvedImgSrc = useResolvedImageSrc(src);
    const filter = buildCssFilter(slot.style);
    const objectFit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const crop = slot.crop;
    return (
      <div onMouseDown={onClick} style={{ ...baseStyle, overflow: "hidden", borderRadius: (slot.style?.borderRadius ?? 0) * scale }}>
        {src ? (
          crop ? (
            <img
              src={resolvedImgSrc ?? src}
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
              src={resolvedImgSrc ?? src}
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
    const text = slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText)
      : (slot.staticText ?? "Văn bản");
    const textCss = buildTextStyle(slot.style, scale);
    return (
      <div
        onMouseDown={onClick}
        style={{
          ...baseStyle,
          ...textCss,
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
