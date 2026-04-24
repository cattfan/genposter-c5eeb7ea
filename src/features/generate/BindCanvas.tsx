// Canvas read-only, chỉ để chọn block và bind data ở trang Tạo nội dung.
// Render giống PageRenderer nhưng cho phép click + outline khi chọn / đã bind.
import { useMemo } from "react";
import type { Asset, Entity, PageTemplate, RenderedItem, Slot } from "@/models";
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
import {
  buildExpandedSlotImagePlan,
  type PlannedImage,
  type SlotImagePlan,
} from "@/engines/binding/imagePlan";
import { LayoutGuides } from "@/features/render/LayoutGuides";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { expandPageWithCardGroups } from "@/engines/binding/cardRepeater";

export function BindCanvas({
  template,
  scale,
  selectedSlotIds,
  onSelectSlot,
  entity,
  assets,
  entityPool,
  slotItems,
  seedKey,
}: {
  template: PageTemplate;
  scale: number;
  selectedSlotIds: string[];
  onSelectSlot: (id: string | null, additive?: boolean) => void;
  entity?: Entity;
  assets: Asset[];
  entityPool?: Entity[];
  slotItems?: RenderedItem[];
  seedKey?: string;
}) {
  const { width, height, background, backgroundImage } = template.canvas;
  const resolvedBg = useResolvedImageSrc(backgroundImage);
  const bgUsable = resolvedBg && !resolvedBg.startsWith("idb://") ? resolvedBg : undefined;

  const entityLookup = useMemo(() => {
    const ordered = [entity, ...(entityPool ?? [])].filter((item): item is Entity => !!item);
    return new Map(ordered.map((item) => [item.entityId, item]));
  }, [entity, entityPool]);

  const slotEntityOverride = useMemo(() => {
    const map = new Map<string, { entityId?: string; assetId?: string }>();
    for (const item of slotItems ?? []) {
      if (item.slotId) {
        map.set(item.slotId, { entityId: item.entityId, assetId: item.assetId });
      }
    }
    return map;
  }, [slotItems]);

  const expanded = useMemo(() => {
    const pool =
      slotItems && slotItems.length > 0
        ? []
        : entityPool && entityPool.length > 0
          ? entityPool
          : entity
            ? [entity]
            : [];
    return expandPageWithCardGroups(template, pool);
  }, [template, entityPool, entity, slotItems]);

  const ghostSlots = useMemo(() => expanded.slots.filter((slot) => slot.cardIndex > 0), [expanded]);

  const resolveEntityForSlot = (
    slot: Slot & { originalSlotId?: string; __cardEntityId?: string },
  ) => {
    const override =
      slotEntityOverride.get(slot.slotId) ??
      slotEntityOverride.get(slot.originalSlotId ?? slot.slotId);
    if (override?.entityId) return entityLookup.get(override.entityId);
    if (slot.sectionRefId) {
      const sectionEntity = (slotItems ?? []).find((item) => item.sectionId === slot.sectionRefId)?.entityId;
      if (sectionEntity) return entityLookup.get(sectionEntity);
    }
    if (slotItems && slotItems.length > 0) return undefined;
    if (slot.__cardEntityId) return entityLookup.get(slot.__cardEntityId);
    return entity;
  };

  const imagePlan: SlotImagePlan = useMemo(
    () =>
      buildExpandedSlotImagePlan(
        expanded.slots,
        assets,
        resolveEntityForSlot,
        seedKey ?? template.pageTemplateId,
      ),
    [expanded.slots, assets, entityLookup, slotEntityOverride, entity, seedKey, template.pageTemplateId],
  );

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelectSlot(null, false);
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
      <LayoutGuides width={width} height={height} scale={scale} />

      {ghostSlots.map((slot) => {
        const cardEntity = resolveEntityForSlot(slot);
        return (
          <GhostSlot
            key={slot.slotId}
            slot={slot}
            scale={scale}
            entity={cardEntity}
            entityPool={entityPool}
            label={
              slot.cardIndex === 1 && isFirstSlotOfCard(slot, expanded.slots)
                ? `Card ${slot.cardIndex + 1}: ${cardEntity?.name ?? "—"}`
                : undefined
            }
          />
        );
      })}

      {expanded.slots
        .slice()
        .filter((slot) => slot.cardIndex === 0)
        .filter((slot) => !slot.style?.hidden)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.renderOrder - b.renderOrder)
        .map((slot) => {
          const resolvedEntity = resolveEntityForSlot(slot);
          const inCardGroup =
            !!slot.groupId &&
            (template.cardGroups ?? []).some((group) => group.groupId === slot.groupId);
          const cardCfg = inCardGroup
            ? (template.cardGroups ?? []).find((group) => group.groupId === slot.groupId)
            : undefined;
          return (
            <BindSlot
              key={slot.slotId}
              slot={slot}
              template={template}
              scale={scale}
              selected={selectedSlotIds.includes(slot.slotId)}
              onSelect={(additive) => onSelectSlot(slot.slotId, additive)}
              entity={resolvedEntity}
              entityPool={entityPool}
              planned={imagePlan.get(slot.slotId)}
              cardBadge={cardCfg ? `↻ ${cardCfg.repeatCount}` : undefined}
            />
          );
        })}
    </div>
  );
}

function isFirstSlotOfCard(
  slot: Slot & { cardIndex: number; cardGroupId?: string },
  allExpanded: Array<Slot & { cardIndex: number; cardGroupId?: string }>,
): boolean {
  const sameCard = allExpanded.filter(
    (item) => item.cardGroupId === slot.cardGroupId && item.cardIndex === slot.cardIndex,
  );
  const top = sameCard.reduce((acc, item) => (item.y < acc.y ? item : acc), sameCard[0]);
  return top.slotId === slot.slotId;
}

function GhostSlot({
  slot,
  scale,
  entity,
  entityPool,
  label,
}: {
  slot: Slot & { __cardEntityId?: string };
  scale: number;
  entity?: Entity;
  entityPool?: Entity[];
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
    const text = slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool)
      : (slot.staticText ?? "");
    const textCss = buildTextStyle(slot.style, scale);
    inner = <div style={textCss}>{text}</div>;
  } else if (slot.kind === "image" || slot.kind === "shape") {
    inner = (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            slot.kind === "shape" ? (slot.style?.fill ?? "hsl(var(--muted))") : "hsl(var(--muted))",
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
  template,
  scale,
  selected,
  onSelect,
  entity,
  entityPool,
  planned,
  cardBadge,
}: {
  slot: Slot;
  template: PageTemplate;
  scale: number;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  entity?: Entity;
  entityPool?: Entity[];
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
    if (isBindable) onSelect(e.metaKey || e.ctrlKey || e.shiftKey);
  };

  const rawSrc =
    slot.kind === "image" || slot.kind === "shape" ? (planned?.src ?? slot.staticImage) : undefined;
  const resolvedRaw = useResolvedImageSrc(rawSrc);
  const usableSrc =
    resolvedRaw && !resolvedRaw.startsWith("idb://")
      ? resolvedRaw
      : rawSrc && !rawSrc.startsWith("idb://")
        ? rawSrc
        : undefined;

  if (slot.kind === "shape") {
    const fit = (
      slot.style?.fit === "stretch" ? "fill" : (slot.style?.fit ?? "cover")
    ) as React.CSSProperties["objectFit"];
    const filter = buildCssFilter(slot.style);
    const radius = shapeBorderRadius(slot.shapeKind, slot.style?.borderRadius, scale);
    const clip = slot.shapeKind ? shapeClipPath(slot.shapeKind) : undefined;
    const gradient = buildGradient(slot.style);
    const border = buildBorder(slot.style, scale);
    const isLine = slot.shapeKind === "line" || slot.shapeKind === "divider";
    const shapeText = slot.bindingPath?.startsWith("entity.")
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool)
      : (slot.staticText ?? "");
    const hasShapeText = !!shapeText.trim();
    const textCss = buildTextStyle(slot.style, scale);

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
          background: usableSrc ? undefined : (gradient ?? slot.style?.fill ?? "#e5e7eb"),
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
              style={{
                width: "100%",
                height: "100%",
                objectFit: fit,
                filter,
                pointerEvents: "none",
              }}
            />
            {slot.style?.overlayColor && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: slot.style.overlayColor,
                  pointerEvents: "none",
                }}
              />
            )}
          </>
        ) : null}
        {hasShapeText && (
          <div
            style={{
              ...textCss,
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent:
                slot.style?.textAlign === "center"
                  ? "center"
                  : slot.style?.textAlign === "right"
                    ? "flex-end"
                    : "flex-start",
              pointerEvents: "none",
            }}
          >
            {shapeText}
          </div>
        )}
      </div>
    );
  }

  if (slot.kind === "image") {
    const filter = buildCssFilter(slot.style);
    const objectFit = (
      slot.style?.fit === "stretch" ? "fill" : (slot.style?.fit ?? "cover")
    ) as React.CSSProperties["objectFit"];
    const crop = slot.crop;
    return (
      <div
        onMouseDown={onClick}
        style={{
          ...baseStyle,
          overflow: "hidden",
          borderRadius: (slot.style?.borderRadius ?? 0) * scale,
        }}
      >
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
              style={{
                width: "100%",
                height: "100%",
                objectFit,
                filter,
                pointerEvents: "none",
              }}
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
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool)
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
    const section = template.sections.find((item) => item.sectionId === slot.sectionRefId);
    return (
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onSelect(e.metaKey || e.ctrlKey || e.shiftKey);
        }}
        style={{
          ...baseStyle,
          background:
            section?.layoutMode === "poster_list" ? "transparent" : "hsl(var(--accent) / 0.3)",
          border: "1px dashed hsl(var(--border))",
          display: "grid",
          placeItems: "center",
          color:
            section?.layoutMode === "poster_list"
              ? (slot.style?.color ?? "#ffffff")
              : "hsl(var(--muted-foreground))",
          fontSize: 12,
        }}
      >
        {section?.layoutMode === "poster_list" ? "Poster list" : "Section"}
      </div>
    );
  }

  return null;
}

function CardBadge({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: -22,
        right: -2,
        background: "hsl(var(--primary))",
        color: "hsl(var(--primary-foreground))",
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        fontWeight: 700,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
      title="Block này thuộc Card mẫu — sẽ được lặp"
    >
      {label}
    </div>
  );
}
