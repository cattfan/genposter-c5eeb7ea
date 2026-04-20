// Canvas read-only, chỉ để chọn block và bind data ở trang Tạo nội dung.
// Render giống PageRenderer nhưng cho phép click + outline khi chọn / đã bind.
import { useMemo } from "react";
import type { Asset, Entity, PageTemplate, Slot } from "@/models";
import {
  buildBoxShadow,
  buildCssFilter,
  buildFlipTransform,
  buildBorder,
  buildGradient,
  buildTextStyle,
  resolveTextBinding,
  shapeBorderRadius,
  shapeClipPath,
} from "@/engines/binding/dataBinding";
import { buildSlotImagePlan, type PlannedImage, type SlotImagePlan } from "@/engines/binding/imagePlan";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { expandPageWithCardGroups } from "@/engines/binding/cardRepeater";

export function BindCanvas({
  template,
  scale,
  selectedSlotId,
  onSelectSlot,
  entity,
  assets,
  entityPool,
}: {
  template: PageTemplate;
  scale: number;
  selectedSlotId: string | null;
  onSelectSlot: (id: string | null) => void;
  entity?: Entity;
  assets: Asset[];
  entityPool?: Entity[];
}) {
  const { width, height, background, backgroundImage } = template.canvas;
  const resolvedBg = useResolvedImageSrc(backgroundImage);
  const bgUsable = resolvedBg && !resolvedBg.startsWith("idb://") ? resolvedBg : undefined;

  const imagePlan: SlotImagePlan = useMemo(
    () => buildSlotImagePlan(template, entity, assets),
    [template, entity, assets],
  );

  // Card Repeater: ghost preview các card clone (cardIndex >= 1) — mờ, không clickable.
  const expanded = useMemo(() => {
    const pool = entityPool && entityPool.length > 0 ? entityPool : entity ? [entity] : [];
    return expandPageWithCardGroups(template, pool);
  }, [template, entityPool, entity]);
  const ghostSlots = useMemo(
    () => expanded.slots.filter((s) => s.cardIndex > 0),
    [expanded],
  );

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
        backgroundImage: bgUsable ? `url(${bgUsable})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        overflow: "hidden",
        fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
      }}
    >
      {/* Ghost cards (clone) — render TRƯỚC để slot gốc nằm trên */}
      {ghostSlots.map((slot) => {
        const cardEnt = slot.__cardEntityId
          ? expanded.entityBySlotId.get(slot.slotId)
          : undefined;
        return (
          <GhostSlot
            key={slot.slotId}
            slot={slot}
            scale={scale}
            entity={cardEnt}
            label={
              slot.cardIndex === 1 && isFirstSlotOfCard(slot, expanded.slots)
                ? `Card ${slot.cardIndex + 1}: ${cardEnt?.name ?? "—"}`
                : undefined
            }
          />
        );
      })}

      {template.slots
        .slice()
        .filter((s) => !s.style?.hidden)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((slot) => {
          const inCardGroup = !!slot.groupId &&
            (template.cardGroups ?? []).some((g) => g.groupId === slot.groupId);
          const cardCfg = inCardGroup
            ? (template.cardGroups ?? []).find((g) => g.groupId === slot.groupId)
            : undefined;
          return (
            <BindSlot
              key={slot.slotId}
              slot={slot}
              scale={scale}
              selected={slot.slotId === selectedSlotId}
              onSelect={() => onSelectSlot(slot.slotId)}
              entity={entity}
              planned={imagePlan.get(slot.slotId)}
              cardBadge={cardCfg ? `↻ ${cardCfg.repeatCount}` : undefined}
            />
          );
        })}
    </div>
  );
}

/** Slot đầu tiên của 1 card (theo y/x nhỏ nhất trong cùng cardIndex+cardGroupId). */
function isFirstSlotOfCard(slot: Slot & { cardIndex: number; cardGroupId?: string }, allExpanded: Array<Slot & { cardIndex: number; cardGroupId?: string }>): boolean {
  const sameCard = allExpanded.filter(
    (s) => s.cardGroupId === slot.cardGroupId && s.cardIndex === slot.cardIndex,
  );
  const top = sameCard.reduce((acc, s) => (s.y < acc.y ? s : acc), sameCard[0]);
  return top.slotId === slot.slotId;
}

function GhostSlot({
  slot,
  scale,
  entity,
  label,
}: {
  slot: Slot & { __cardEntityId?: string };
  scale: number;
  entity?: Entity;
  label?: string;
}) {
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: slot.x * scale,
    top: slot.y * scale,
    width: slot.width * scale,
    height: slot.height * scale,
    opacity: 0.45,
    pointerEvents: "none",
    outline: "1px dashed hsl(var(--primary) / 0.4)",
    outlineOffset: 0,
    boxSizing: "border-box",
    overflow: "hidden",
  };

  let inner: React.ReactNode = null;
  if (slot.kind === "text") {
    const text = slot.bindingPath ? resolveTextBinding(slot.bindingPath, entity, slot.staticText) : (slot.staticText ?? "");
    const textCss = buildTextStyle(slot.style, scale);
    inner = <div style={textCss}>{text}</div>;
  } else if (slot.kind === "image" || slot.kind === "shape") {
    inner = (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: slot.kind === "shape" ? slot.style?.fill ?? "hsl(var(--muted))" : "hsl(var(--muted))",
          borderRadius: shapeBorderRadius(slot.shapeKind, slot.style?.borderRadius, scale),
          display: "grid",
          placeItems: "center",
          color: "hsl(var(--muted-foreground))",
          fontSize: 10 * scale,
        }}
      >
        {slot.kind === "image" ? "🖼" : ""}
      </div>
    );
  }

  return (
    <div style={baseStyle}>
      {inner}
      {label && (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 0,
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 600,
            opacity: 1,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function BindSlot({
  slot,
  scale,
  selected,
  onSelect,
  entity,
  planned,
  cardBadge,
}: {
  slot: Slot;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  entity?: Entity;
  planned?: PlannedImage;
  cardBadge?: string;
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

  // Determine raw src for image/shape (priority: planned bind > staticImage)
  const rawSrc = (slot.kind === "image" || slot.kind === "shape")
    ? (planned?.src ?? slot.staticImage)
    : undefined;
  const resolvedRaw = useResolvedImageSrc(rawSrc);
  const usableSrc = resolvedRaw && !resolvedRaw.startsWith("idb://")
    ? resolvedRaw
    : (rawSrc && !rawSrc.startsWith("idb://") ? rawSrc : undefined);

  if (slot.kind === "shape") {
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
          background: usableSrc ? undefined : gradient ?? slot.style?.fill ?? "#e5e7eb",
          borderRadius: radius,
          clipPath: clip,
          border: usableSrc ? undefined : border,
          overflow: "hidden",
        }}
      >
        {usableSrc ? (
          <>
            <img
              src={usableSrc}
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
    const filter = buildCssFilter(slot.style);
    const objectFit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const crop = slot.crop;
    return (
      <div onMouseDown={onClick} style={{ ...baseStyle, overflow: "hidden", borderRadius: (slot.style?.borderRadius ?? 0) * scale }}>
        {usableSrc ? (
          crop ? (
            <img
              src={usableSrc}
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
              src={usableSrc}
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
        {planned?.fallback && (
          <div
            style={{
              position: "absolute",
              top: 4,
              left: 4,
              background: "hsl(var(--destructive) / 0.85)",
              color: "white",
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            ảnh trùng
          </div>
        )}
        {selected && cardBadge && <CardBadge label={cardBadge} />}
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
        {selected && cardBadge && <CardBadge label={cardBadge} />}
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
