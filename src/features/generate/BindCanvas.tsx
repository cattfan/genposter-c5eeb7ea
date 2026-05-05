// Canvas read-only, chỉ để chọn block và bind data ở trang Tạo nội dung.
// Render giống PageRenderer nhưng cho phép click + outline khi chọn / đã bind.
import { useCallback, useMemo, useRef, useState } from "react";
import type { Asset, Entity, PageTemplate, RenderedItem, Slot } from "@/models";
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
import {
  buildExpandedSlotImagePlan,
  type PlannedImage,
  type SlotImagePlan,
} from "@/engines/binding/imagePlan";
import { LayoutGuides } from "@/features/render/LayoutGuides";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { expandPageWithCardGroups } from "@/engines/binding/cardRepeater";
import { renderRichTextRuns } from "@/features/editor/richText";

const IMAGE_PLACEHOLDER_BACKGROUND =
  "repeating-linear-gradient(135deg, rgba(99,102,241,0.035) 0, rgba(99,102,241,0.035) 12px, rgba(248,250,252,0.28) 12px, rgba(248,250,252,0.28) 24px)";

type BindCanvasSelectionMode = "replace" | "toggle" | "group" | "replace-many";
type SelectionRect = { left: number; top: number; width: number; height: number };

export function BindCanvas({
  template,
  scale,
  selectedSlotIds,
  onSelectSlot,
  entity,
  assets,
  entityPool,
  sourceEntities,
  slotItems,
  seedKey,
  showSafeFrame = false,
  flatPreview = false,
}: {
  template: PageTemplate;
  scale: number;
  selectedSlotIds: string[];
  onSelectSlot: (
    id: string | null,
    mode?: BindCanvasSelectionMode,
    relatedSlotIds?: string[],
  ) => void;
  entity?: Entity;
  assets: Asset[];
  entityPool?: Entity[];
  sourceEntities?: Entity[];
  slotItems?: RenderedItem[];
  seedKey?: string;
  showSafeFrame?: boolean;
  flatPreview?: boolean;
}) {
  const { width, height, background, backgroundImage } = template.canvas;
  const resolvedBg = useResolvedImageSrc(backgroundImage);
  const bgUsable = resolvedBg && !resolvedBg.startsWith("idb://") ? resolvedBg : undefined;

  const entityLookup = useMemo(() => {
    const ordered = [entity, ...(entityPool ?? [])].filter((item): item is Entity => !!item);
    return new Map(ordered.map((item) => [item.entityId, item]));
  }, [entity, entityPool]);
  const imageResolveEntities = useMemo(
    () => (sourceEntities?.length ? sourceEntities : Array.from(entityLookup.values())),
    [entityLookup, sourceEntities],
  );

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
      const sectionEntity = (slotItems ?? []).find(
        (item) => item.sectionId === slot.sectionRefId,
      )?.entityId;
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
        imageResolveEntities,
      ),
    [
      expanded.slots,
      assets,
      entityLookup,
      slotEntityOverride,
      entity,
      seedKey,
      template.pageTemplateId,
      imageResolveEntities,
    ],
  );

  const visiblePrimarySlots = useMemo(
    () =>
      expanded.slots
        .slice()
        .filter((slot) => slot.cardIndex === 0)
        .filter((slot) => !slot.style?.hidden)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.renderOrder - b.renderOrder),
    [expanded.slots],
  );

  const visibleSlotById = useMemo(
    () => new Map(visiblePrimarySlots.map((slot) => [slot.slotId, slot])),
    [visiblePrimarySlots],
  );

  const selectedOverlaySlots = useMemo(
    () =>
      selectedSlotIds
        .map((slotId) => visibleSlotById.get(slotId))
        .filter((slot): slot is Slot & { cardIndex: number } => !!slot),
    [selectedSlotIds, visibleSlotById],
  );

  const selectedBounds = useMemo(() => {
    if (selectedOverlaySlots.length < 2) return null;
    return buildSelectionBounds(selectedOverlaySlots);
  }, [selectedOverlaySlots]);
  const marqueeSlots = useMemo(
    () => visiblePrimarySlots.filter(isBindableSlot),
    [visiblePrimarySlots],
  );
  const marqueeRef = useRef<{
    start: { x: number; y: number };
    active: boolean;
    lastSignature: string;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<SelectionRect | null>(null);

  const updateMarqueeSelection = useCallback(
    (rect: SelectionRect) => {
      const ids = marqueeSlots
        .filter((slot) => rectIntersectsSlot(rect, slot))
        .map((slot) => slot.slotId);
      const signature = ids.join("|");
      if (signature === marqueeRef.current?.lastSignature) return;
      if (marqueeRef.current) marqueeRef.current.lastSignature = signature;
      onSelectSlot(null, "replace-many", ids);
    },
    [marqueeSlots, onSelectSlot],
  );

  const startMarqueeSelection = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const canvas = event.currentTarget;
      const start = getCanvasPoint(canvas, event.clientX, event.clientY, scale);
      marqueeRef.current = { start, active: false, lastSignature: "" };

      const onMouseMove = (moveEvent: MouseEvent) => {
        const state = marqueeRef.current;
        if (!state) return;
        const current = getCanvasPoint(canvas, moveEvent.clientX, moveEvent.clientY, scale);
        const moved = Math.hypot(current.x - state.start.x, current.y - state.start.y);
        if (!state.active && moved < 4 / Math.max(scale, 0.01)) return;
        state.active = true;
        const rect = normalizeSelectionRect(state.start, current);
        setMarqueeRect(rect);
        updateMarqueeSelection(rect);
        moveEvent.preventDefault();
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        const state = marqueeRef.current;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        if (state?.active) {
          const current = getCanvasPoint(canvas, upEvent.clientX, upEvent.clientY, scale);
          updateMarqueeSelection(normalizeSelectionRect(state.start, current));
          upEvent.preventDefault();
        }
        marqueeRef.current = null;
        setMarqueeRect(null);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [scale, updateMarqueeSelection],
  );

  return (
    <div
      data-bind-canvas-root="true"
      onMouseDownCapture={startMarqueeSelection}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelectSlot(null, "replace");
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
        boxShadow: "0 1px 8px rgba(15,23,42,0.08)",
        userSelect: "none",
      }}
    >
      {showSafeFrame && <LayoutGuides width={width} height={height} scale={scale} />}

      {ghostSlots.map((slot) => {
        const cardEntity = resolveEntityForSlot(slot);
        return (
          <GhostSlot
            key={slot.slotId}
            slot={slot}
            scale={scale}
            entity={cardEntity}
            entityPool={entityPool}
            sourceEntities={imageResolveEntities}
            showSafeFrame={showSafeFrame}
            label={
              slot.cardIndex === 1 && isFirstSlotOfCard(slot, expanded.slots)
                ? `Nhóm ${slot.cardIndex + 1}: ${cardEntity?.name ?? "—"}`
                : undefined
            }
          />
        );
      })}

      {visiblePrimarySlots.map((slot) => {
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
            onSelect={(mode) =>
              onSelectSlot(
                slot.slotId,
                mode,
                mode === "replace"
                  ? getDataGroupSlotIds(slot, visiblePrimarySlots)
                  : getRelatedSlotIds(slot, visiblePrimarySlots),
              )
            }
            entity={resolvedEntity}
            entityPool={entityPool}
            imageResolveEntities={imageResolveEntities}
            assets={assets}
            planned={imagePlan.get(slot.slotId)}
            showSafeFrame={showSafeFrame}
            flatPreview={flatPreview}
            seedKey={seedKey}
            cardBadge={cardCfg ? `↻ ${cardCfg.repeatCount}` : undefined}
          />
        );
      })}
      {visiblePrimarySlots.map((slot) => (
        <SlotHitTarget
          key={`hit-${slot.slotId}`}
          slot={slot}
          scale={scale}
          selected={selectedSlotIds.includes(slot.slotId)}
          flatPreview={flatPreview}
          onSelect={(mode) =>
            onSelectSlot(
              slot.slotId,
              mode,
              mode === "replace"
                ? getDataGroupSlotIds(slot, visiblePrimarySlots)
                : getRelatedSlotIds(slot, visiblePrimarySlots),
            )
          }
        />
      ))}
      {selectedOverlaySlots.map((slot) => (
        <SelectedSlotOverlay
          key={`selected-${slot.slotId}`}
          slot={slot}
          scale={scale}
          flatPreview={flatPreview}
        />
      ))}
      {selectedBounds && (
        <SelectionBoundsOverlay bounds={selectedBounds} scale={scale} flatPreview={flatPreview} />
      )}
      {marqueeRect && <SelectionMarqueeOverlay rect={marqueeRect} scale={scale} />}
    </div>
  );
}

function isBindableSlot(slot: Slot): boolean {
  return (
    slot.kind === "text" ||
    slot.kind === "image" ||
    slot.kind === "shape" ||
    slot.kind === "section"
  );
}

function getCanvasPoint(canvas: HTMLElement, clientX: number, clientY: number, scale: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

function normalizeSelectionRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
): SelectionRect {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  return {
    left,
    top,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

function rectIntersectsSlot(rect: SelectionRect, slot: Slot): boolean {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const slotRight = slot.x + slot.width;
  const slotBottom = slot.y + slot.height;
  return rect.left <= slotRight && right >= slot.x && rect.top <= slotBottom && bottom >= slot.y;
}

function getDataGroupSlotIds(slot: Slot, slots: Array<Slot & { cardIndex: number }>): string[] {
  if (slot.dataGroupId) {
    const dataGroupIds = slots
      .filter((item) => item.dataGroupId === slot.dataGroupId)
      .map((item) => item.slotId);
    if (dataGroupIds.length > 1) return dataGroupIds;
  }
  return [slot.slotId];
}

function getRelatedSlotIds(slot: Slot, slots: Array<Slot & { cardIndex: number }>): string[] {
  const dataGroupIds = getDataGroupSlotIds(slot, slots);
  if (dataGroupIds.length > 1) return dataGroupIds;
  if (slot.groupId) {
    const groupIds = slots
      .filter((item) => item.groupId === slot.groupId)
      .map((item) => item.slotId);
    if (groupIds.length > 1) return groupIds;
  }
  if (slot.sectionRefId) {
    const sectionIds = slots
      .filter((item) => item.sectionRefId === slot.sectionRefId)
      .map((item) => item.slotId);
    if (sectionIds.length > 1) return sectionIds;
  }
  return [slot.slotId];
}

function buildSelectionBounds(slots: Array<Slot & { cardIndex: number }>) {
  const left = Math.min(...slots.map((slot) => slot.x));
  const top = Math.min(...slots.map((slot) => slot.y));
  const right = Math.max(...slots.map((slot) => slot.x + slot.width));
  const bottom = Math.max(...slots.map((slot) => slot.y + slot.height));
  return { left, top, width: right - left, height: bottom - top, count: slots.length };
}

function SlotHitTarget({
  slot,
  scale,
  selected,
  flatPreview,
  onSelect,
}: {
  slot: Slot & { cardIndex: number };
  scale: number;
  selected: boolean;
  flatPreview?: boolean;
  onSelect: (mode: BindCanvasSelectionMode) => void;
}) {
  const isBindable = isBindableSlot(slot);
  if (!isBindable) return null;

  const fontSize = (slot.style?.fontSize ?? 24) * scale;
  const minHeight = slot.kind === "text" ? Math.max(24, fontSize * 1.25) : 12;
  const transform = `${slot.rotation ? `rotate(${slot.rotation}deg)` : ""}${buildFlipTransform(
    slot.style,
  )}`.trim();

  const selectedRadius = flatPreview ? 0 : Math.max(4, (slot.style?.borderRadius ?? 0) * scale);

  return (
    <div
      data-bind-hit-target={slot.slotId}
      data-bind-selected={selected ? "true" : undefined}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.shiftKey) {
          onSelect("group");
          return;
        }
        onSelect(e.metaKey || e.ctrlKey ? "toggle" : "replace");
      }}
      title="Bấm để chọn khối"
      style={{
        position: "absolute",
        left: slot.x * scale,
        top: slot.y * scale,
        width: Math.max(12, slot.width * scale),
        height: Math.max(minHeight, slot.height * scale),
        transform: transform || undefined,
        transformOrigin: "center",
        cursor: "pointer",
        background: selected ? "rgba(124, 58, 237, 0.035)" : "transparent",
        border: selected ? "1px solid rgba(124, 58, 237, 0.68)" : "1px solid transparent",
        boxShadow: selected ? "0 0 0 1px rgba(124, 58, 237, 0.12)" : undefined,
        borderRadius: selected ? selectedRadius : 0,
        boxSizing: "border-box",
        pointerEvents: "auto",
        zIndex: 2147483600,
      }}
    />
  );
}

function SelectedSlotOverlay({
  slot,
  scale,
  flatPreview,
}: {
  slot: Slot & { cardIndex: number };
  scale: number;
  flatPreview?: boolean;
}) {
  const transform = `${slot.rotation ? `rotate(${slot.rotation}deg)` : ""}${buildFlipTransform(
    slot.style,
  )}`.trim();

  return (
    <div
      data-bind-selection-overlay={slot.slotId}
      style={{
        position: "absolute",
        left: slot.x * scale,
        top: slot.y * scale,
        width: slot.width * scale,
        height: slot.height * scale,
        transform: transform || undefined,
        transformOrigin: "center",
        border: "1px solid rgba(124, 58, 237, 0.7)",
        boxShadow: "0 0 0 1px rgba(124, 58, 237, 0.12)",
        borderRadius: flatPreview ? 0 : Math.max(4, (slot.style?.borderRadius ?? 0) * scale),
        pointerEvents: "none",
        zIndex: 2147483646,
      }}
    />
  );
}

function SelectionBoundsOverlay({
  bounds,
  scale,
  flatPreview,
}: {
  bounds: ReturnType<typeof buildSelectionBounds>;
  scale: number;
  flatPreview?: boolean;
}) {
  return (
    <div
      data-bind-selection-bounds="true"
      style={{
        position: "absolute",
        left: bounds.left * scale,
        top: bounds.top * scale,
        width: bounds.width * scale,
        height: bounds.height * scale,
        border: "1px solid rgba(124, 58, 237, 0.42)",
        boxShadow: "0 0 0 1px rgba(124, 58, 237, 0.08)",
        borderRadius: flatPreview ? 0 : 4,
        pointerEvents: "none",
        zIndex: 2147483647,
      }}
    />
  );
}

function SelectionMarqueeOverlay({ rect, scale }: { rect: SelectionRect; scale: number }) {
  return (
    <div
      data-bind-marquee="true"
      style={{
        position: "absolute",
        left: rect.left * scale,
        top: rect.top * scale,
        width: rect.width * scale,
        height: rect.height * scale,
        border: "1px solid rgba(124,58,237,0.72)",
        background: "rgba(124,58,237,0.08)",
        pointerEvents: "none",
        zIndex: 2147483645,
      }}
    />
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
  sourceEntities,
  showSafeFrame,
  label,
}: {
  slot: Slot & { __cardEntityId?: string };
  scale: number;
  entity?: Entity;
  entityPool?: Entity[];
  sourceEntities?: Entity[];
  showSafeFrame?: boolean;
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
    outline: showSafeFrame ? "1px dashed hsl(var(--primary) / 0.4)" : "1px dashed transparent",
    outlineOffset: 0,
    boxSizing: "border-box",
    overflow: "hidden",
  };

  let inner: React.ReactNode = null;
  if (slot.kind === "text") {
    const text = slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool, {
          entities: sourceEntities,
          seed: `ghost:${slot.slotId}`,
        })
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
      {showSafeFrame && label && (
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
  imageResolveEntities,
  assets,
  planned,
  showSafeFrame,
  flatPreview,
  seedKey,
  cardBadge,
}: {
  slot: Slot;
  template: PageTemplate;
  scale: number;
  selected: boolean;
  onSelect: (mode: BindCanvasSelectionMode) => void;
  entity?: Entity;
  entityPool?: Entity[];
  imageResolveEntities: Entity[];
  assets: Asset[];
  planned?: PlannedImage;
  showSafeFrame?: boolean;
  flatPreview?: boolean;
  seedKey?: string;
  cardBadge?: string;
}) {
  const flip = buildFlipTransform(slot.style);
  const rot = slot.rotation ? `rotate(${slot.rotation}deg)` : "";
  const transform = (rot + flip).trim() || undefined;
  const hasBinding = !!slot.bindingPath;
  const isBindable = slot.kind === "text" || slot.kind === "image" || slot.kind === "shape";

  const outline = selected
    ? "1px solid hsl(var(--primary) / 0.72)"
    : hasBinding
      ? "2px dashed hsl(var(--primary) / 0.6)"
      : showSafeFrame && isBindable
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
    boxShadow: selected
      ? [buildBoxShadow(slot.style, scale), "0 0 0 1px hsl(var(--primary) / 0.14)"]
          .filter(Boolean)
          .join(", ")
      : buildBoxShadow(slot.style, scale),
    opacity: slot.style?.opacity ?? 1,
    outline,
    outlineOffset: 0,
    boxSizing: "border-box",
    cursor: isBindable ? "pointer" : "default",
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isBindable) return;
    if (e.shiftKey) {
      onSelect("group");
      return;
    }
    onSelect(e.metaKey || e.ctrlKey ? "toggle" : "replace");
  };

  const rawSrc =
    slot.kind === "image" || slot.kind === "shape" ? (planned?.src ?? slot.staticImage) : undefined;
  const resolvedBindingImage =
    !planned?.src && (slot.kind === "image" || slot.kind === "shape") && slot.bindingPath
      ? resolveImageBinding(slot.bindingPath, entity, assets, rawSrc, {
          entities: imageResolveEntities,
          seed: `${seedKey ?? "bind"}:${slot.slotId}`,
        })
      : undefined;
  const effectiveRawSrc = resolvedBindingImage?.src ?? rawSrc;
  const resolvedRaw = useResolvedImageSrc(effectiveRawSrc);
  const usableSrc =
    resolvedRaw && !resolvedRaw.startsWith("idb://")
      ? resolvedRaw
      : effectiveRawSrc && !effectiveRawSrc.startsWith("idb://")
        ? effectiveRawSrc
        : undefined;

  if (slot.kind === "shape") {
    const fit = (
      slot.style?.fit === "stretch" ? "fill" : (slot.style?.fit ?? "cover")
    ) as React.CSSProperties["objectFit"];
    const filter = buildCssFilter(slot.style);
    const radius = flatPreview
      ? 0
      : shapeBorderRadius(slot.shapeKind, slot.style?.borderRadius, scale);
    const clip = slot.shapeKind ? shapeClipPath(slot.shapeKind) : undefined;
    const gradient = buildGradient(slot.style);
    const border = buildBorder(slot.style, scale);
    const isLine = slot.shapeKind === "line" || slot.shapeKind === "divider";
    const shapeText = slot.bindingPath?.startsWith("entity.")
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool, {
          entities: imageResolveEntities,
          seed: `${seedKey ?? "bind"}:${slot.slotId}:shape-text`,
        })
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
          borderRadius: flatPreview ? 0 : (slot.style?.borderRadius ?? 0) * scale,
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
              background: IMAGE_PLACEHOLDER_BACKGROUND,
              display: "grid",
              placeItems: "center",
              color: "rgba(71,85,105,0.72)",
              fontSize: 12,
              padding: 8,
              textAlign: "center",
            }}
          >
            {hasBinding ? "Chưa có ảnh phù hợp" : "Khung ảnh - bấm để chọn"}
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
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool, {
          entities: imageResolveEntities,
          seed: `${seedKey ?? "bind"}:${slot.slotId}:text`,
        })
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
        {renderRichTextRuns({
          text,
          runs: slot.bindingPath ? undefined : slot.textRuns,
          baseStyle: slot.style,
          scale,
        })}
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
          if (e.shiftKey) {
            onSelect("group");
            return;
          }
          onSelect(e.metaKey || e.ctrlKey ? "toggle" : "replace");
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
        {section?.layoutMode === "poster_list" ? "Danh sách ảnh" : "Nhóm"}
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
      title="Khối này thuộc nhóm mẫu - sẽ được lặp"
    >
      {label}
    </div>
  );
}
