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
  isEntityScopedImageBindingPath,
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
import { isLikelyGeneratePageBackgroundSlot } from "@/features/generate/backgroundGuards";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { expandPageWithCardGroups } from "@/engines/binding/cardRepeater";
import type { ExpandedSlot } from "@/engines/binding/cardRepeater";
import { isDataGroupMarkerSlot } from "@/engines/binding/slotMarkers";
import { renderRichTextRuns } from "@/features/editor/richText";
import { mergeBindingSources } from "@/engines/binding/sourceContext";

const IMAGE_PLACEHOLDER_BACKGROUND =
  "repeating-linear-gradient(135deg, rgba(99,102,241,0.035) 0, rgba(99,102,241,0.035) 12px, rgba(248,250,252,0.28) 12px, rgba(248,250,252,0.28) 24px)";
const BIND_CANVAS_INTERACTIVE_SELECTOR =
  "[data-bind-hit-target], [data-bind-selection-overlay], [data-bind-selection-bounds], [data-bind-card-badge]";

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
  const bindingSources = useMemo(() => mergeBindingSources(template.dataSources?.primary, template.dataSources?.secondary), [template.dataSources]);
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

  const resolveEntityForSlot = useCallback((
    slot: Slot & { originalSlotId?: string; __cardEntityId?: string },
  ) => {
    const override =
      slotEntityOverride.get(slot.slotId) ??
      slotEntityOverride.get(slot.originalSlotId ?? slot.slotId);
    if (override?.entityId) return entityLookup.get(override.entityId);
    if (slot.dataSourceId) {
      const source =
        bindingSources.primary?.id === slot.dataSourceId
          ? bindingSources.primary
          : bindingSources.secondary?.find((item) => item.id === slot.dataSourceId);
      const sourceEntity = source?.sheetName
        ? imageResolveEntities.find((item) => item.sheetName === source.sheetName)
        : source?.entityIds?.length
          ? imageResolveEntities.find((item) => source.entityIds?.includes(item.entityId))
          : undefined;
      if (sourceEntity) return sourceEntity;
    }
    if (slot.sectionRefId) {
      const sectionEntity = (slotItems ?? []).find(
        (item) => item.sectionId === slot.sectionRefId,
      )?.entityId;
      if (sectionEntity) return entityLookup.get(sectionEntity);
    }
    if (slot.__cardEntityId) return entityLookup.get(slot.__cardEntityId);
    if (slotItems && slotItems.length > 0 && slot.bindingPath?.startsWith("entity.")) {
      return undefined;
    }
    return entity;
  }, [bindingSources, entity, entityLookup, imageResolveEntities, slotEntityOverride, slotItems]);

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
      resolveEntityForSlot,
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
        .filter((slot): slot is ExpandedSlot => !!slot),
    [selectedSlotIds, visibleSlotById],
  );

  const selectedBounds = useMemo(() => {
    if (selectedOverlaySlots.length < 2) return null;
    return buildSelectionBounds(selectedOverlaySlots);
  }, [selectedOverlaySlots]);
  const marqueeSlots = useMemo(
    () => visiblePrimarySlots.filter((slot) => isSelectableSlot(slot, template)),
    [template, visiblePrimarySlots],
  );
  const hitTargetSlots = useMemo(
    () =>
      visiblePrimarySlots
        .filter((slot) => isSelectableSlot(slot, template))
        .slice()
        .sort(compareHitTargetSlots),
    [template, visiblePrimarySlots],
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
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (isBindCanvasInteractiveTarget(event.target)) {
        return;
      }
      event.preventDefault();
      const canvas = event.currentTarget;
      const pointerId = event.pointerId;
      const start = getCanvasPoint(canvas, event.clientX, event.clientY, scale);
      marqueeRef.current = { start, active: false, lastSignature: "" };
      try {
        canvas.setPointerCapture(pointerId);
      } catch {
        // Pointer capture is best-effort; fallback cleanup handlers still run.
      }

      const cleanup = () => {
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onCancel);
        canvas.removeEventListener("lostpointercapture", onCancel);
        window.removeEventListener("blur", onCancel);
        window.removeEventListener("keydown", onKeyDown);
        try {
          if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        } catch {
          // Browser already released capture.
        }
        marqueeRef.current = null;
        setMarqueeRect(null);
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
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

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const state = marqueeRef.current;
        if (state?.active) {
          const current = getCanvasPoint(canvas, upEvent.clientX, upEvent.clientY, scale);
          updateMarqueeSelection(normalizeSelectionRect(state.start, current));
          upEvent.preventDefault();
        } else {
          onSelectSlot(null, "replace");
        }
        cleanup();
      };

      const onCancel = () => cleanup();
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") cleanup();
      };

      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onCancel);
      canvas.addEventListener("lostpointercapture", onCancel);
      window.addEventListener("blur", onCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [scale, updateMarqueeSelection, onSelectSlot],
  );

  return (
    <div
      data-bind-canvas-root="true"
      onPointerDownCapture={startMarqueeSelection}
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
                ? cardEntity?.name
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
                getSelectionIdsForMode(slot, mode, visiblePrimarySlots, template, slotItems),
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
      {hitTargetSlots.map((slot) => (
        <SlotHitTarget
          key={`hit-${slot.slotId}`}
          slot={slot}
          template={template}
          scale={scale}
          selected={selectedSlotIds.includes(slot.slotId)}
          flatPreview={flatPreview}
          onSelect={(mode) =>
            onSelectSlot(
              slot.slotId,
              mode,
              getSelectionIdsForMode(slot, mode, visiblePrimarySlots, template, slotItems),
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
          label={bindingStatusLabel(slot)}
          showLabel={!isLikelyGeneratePageBackgroundSlot(slot, template)}
          onSelect={(mode) =>
            onSelectSlot(
              slot.slotId,
              mode,
              getSelectionIdsForMode(slot, mode, visiblePrimarySlots, template, slotItems),
            )
          }
        />
      ))}
      {selectedBounds && (
        <SelectionBoundsOverlay bounds={selectedBounds} scale={scale} flatPreview={flatPreview} />
      )}
      {marqueeRect && <SelectionMarqueeOverlay rect={marqueeRect} scale={scale} />}
    </div>
  );
}

function isSelectableSlot(slot: Slot, template: PageTemplate): boolean {
  return isCanvasSelectableSlot(slot, template);
}

function isDataBindableSlot(slot: Slot, template?: PageTemplate): boolean {
  if (slot.isUploadedBackground) return false;
  if (isDataGroupMarkerSlot(slot)) return false;
  if (isLikelyGeneratePageBackgroundSlot(slot, template)) return false;
  return slot.kind === "text" || slot.kind === "image" || slot.kind === "shape";
}

function isCanvasSelectableSlot(slot: Slot, template: PageTemplate): boolean {
  if (isDataGroupMarkerSlot(slot)) return false;
  if (isLikelyGeneratePageBackgroundSlot(slot, template)) return true;
  return isDataBindableSlot(slot, template) || slot.kind === "section" || slot.kind === "group";
}

function bindingStatusLabel(slot: Slot): string {
  const bindingPath = slot.bindingPath ?? "";
  if (!bindingPath) return "Tĩnh";
  if (bindingPath.startsWith("entity.list:")) return "Danh sách";
  if (bindingPath.includes("entity.name")) return "Tên quán";
  if (bindingPath.includes("entity.address")) return "Địa chỉ";
  if (bindingPath.includes("entity.phone")) return "Số điện thoại";
  if (bindingPath.includes("entity.priceRange")) return "Giá";
  if (bindingPath.includes("entity.openingHours")) return "Giờ mở cửa";
  if (bindingPath.includes("entity.signatureDish")) return "Món nổi bật";
  if (bindingPath.startsWith("asset.cover")) return "Ảnh ngẫu nhiên";
  if (bindingPath.startsWith("asset.random_scope")) return "Ảnh theo nguồn/thư mục";
  if (bindingPath.startsWith("asset.random_global")) return "Ảnh toàn hệ thống";
  if (bindingPath.startsWith("asset.random")) return "Ảnh ngẫu nhiên";
  if (bindingPath.startsWith("asset.")) return "Ảnh";
  return "Dữ liệu";
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

function isBindCanvasInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(BIND_CANVAS_INTERACTIVE_SELECTOR);
}

function slotArea(slot: Slot): number {
  return Math.max(0, slot.width) * Math.max(0, slot.height);
}

function slotFullyContains(container: Slot, item: Slot): boolean {
  return (
    item.x >= container.x &&
    item.y >= container.y &&
    item.x + item.width <= container.x + container.width &&
    item.y + item.height <= container.y + container.height
  );
}

function compareHitTargetSlots(a: ExpandedSlot, b: ExpandedSlot): number {
  const aContainsB = slotFullyContains(a, b);
  const bContainsA = slotFullyContains(b, a);
  if (aContainsB && !bContainsA) return -1;
  if (bContainsA && !aContainsB) return 1;

  const zIndexDelta = (a.zIndex ?? 0) - (b.zIndex ?? 0);
  if (zIndexDelta !== 0) return zIndexDelta;

  const areaDelta = slotArea(b) - slotArea(a);
  if (Math.abs(areaDelta) > 1) return areaDelta;

  return a.renderOrder - b.renderOrder;
}

function getDataGroupSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
): string[] {
  if (slot.dataGroupId) {
    const dataGroupIds = slots
      .filter((item) => item.dataGroupId === slot.dataGroupId && isDataBindableSlot(item, template))
      .map((item) => item.slotId);
    if (dataGroupIds.length > 1) return dataGroupIds;
  }
  return [slot.slotId];
}

function getRenderedTargetKey(slotId: string, slotItems?: RenderedItem[]): string | undefined {
  const item = slotItems?.find((candidate) => candidate.slotId === slotId);
  const entityBindCode = item?.reasonCodes?.find((code) => code.startsWith("entity_bind:"));
  if (entityBindCode) return entityBindCode;
  return item?.entityId ? `entity:${item.entityId}` : undefined;
}

function getRenderedTargetSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
  slotItems?: RenderedItem[],
): string[] {
  const targetKey = getRenderedTargetKey(slot.slotId, slotItems);
  if (!targetKey) return [slot.slotId];

  const ids = slots
    .filter(
      (item) =>
        getRenderedTargetKey(item.slotId, slotItems) === targetKey &&
        isDataBindableSlot(item, template),
    )
    .map((item) => item.slotId);
  return ids.length > 1 ? ids : [slot.slotId];
}

function slotCenterInside(container: Slot, item: Slot): boolean {
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  return (
    centerX >= container.x &&
    centerX <= container.x + container.width &&
    centerY >= container.y &&
    centerY <= container.y + container.height
  );
}

function getContainedDataSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
): string[] {
  if (slot.kind !== "section" && slot.kind !== "group") return [];
  return slots
    .filter(
      (item) =>
        item.slotId !== slot.slotId &&
        isDataBindableSlot(item, template) &&
        !isDataGroupMarkerSlot(item) &&
        slotCenterInside(slot, item),
    )
    .map((item) => item.slotId);
}

function slotCenter(slot: Slot) {
  return {
    x: slot.x + slot.width / 2,
    y: slot.y + slot.height / 2,
  };
}

function isImageLikeBindableSlot(slot: Slot): boolean {
  return slot.kind === "image" || (slot.kind === "shape" && !slot.staticText?.trim());
}

function normalizeFieldText(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isLikelyDataFieldSlot(slot: Slot): boolean {
  if (isImageLikeBindableSlot(slot)) return true;
  if (slot.bindingPath || slot.fieldParts?.length) return true;
  const label = normalizeFieldText(slot.staticText ?? slot.name);
  const compactLabel = label.replace(/\s+/g, "");
  const labels = [
    "ten",
    "ten quan",
    "name",
    "dia chi",
    "address",
    "gia",
    "muc gia",
    "price",
    "so dien thoai",
    "sdt",
    "phone",
    "mo hinh",
    "phong cach",
    "nhom",
  ];
  const compactLabels = [
    "ten",
    "tenquan",
    "name",
    "diachi",
    "address",
    "gia",
    "mucgia",
    "price",
    "sodienthoai",
    "sdt",
    "phone",
    "mohinh",
    "phongcach",
    "nhom",
  ];
  return labels.includes(label) || compactLabels.includes(compactLabel);
}

function rectsOverlapOrTouch(a: Slot, b: Slot, pad = 0): boolean {
  return (
    a.x - pad <= b.x + b.width &&
    a.x + a.width + pad >= b.x &&
    a.y - pad <= b.y + b.height &&
    a.y + a.height + pad >= b.y
  );
}

function isSlotInsideImageCard(anchor: Slot, item: Slot): boolean {
  const center = slotCenter(item);
  const horizontalReach = Math.max(72, anchor.width * 1.38);
  const bottomReach = Math.max(64, anchor.height * 0.58);
  const left = anchor.x - horizontalReach;
  const right = anchor.x + anchor.width + horizontalReach;
  const top = anchor.y - Math.max(12, anchor.height * 0.12);
  const bottom = anchor.y + anchor.height + bottomReach;

  if (center.x < left || center.x > right || center.y < top || center.y > bottom) return false;
  if (item.slotId === anchor.slotId) return true;
  if (isImageLikeBindableSlot(item)) return false;
  if (!isLikelyDataFieldSlot(item)) return false;
  return true;
}

function hasRepeatedBindingPath(anchor: Slot, item: Slot, slots: ExpandedSlot[]): boolean {
  if (!item.bindingPath) return false;
  const previousSamePath = slots.some(
    (candidate) =>
      candidate.slotId !== item.slotId &&
      candidate.bindingPath === item.bindingPath &&
      candidate.y < item.y - Math.max(10, item.height * 0.35) &&
      Math.abs(candidate.x - item.x) <= Math.max(40, item.width * 0.5),
  );
  const nextSamePath = slots.some(
    (candidate) =>
      candidate.slotId !== item.slotId &&
      candidate.bindingPath === item.bindingPath &&
      candidate.y > item.y + Math.max(10, item.height * 0.35) &&
      Math.abs(candidate.x - item.x) <= Math.max(40, item.width * 0.5),
  );
  const anchorBottom = anchor.y + anchor.height;
  return (previousSamePath && item.y > anchorBottom + 12) || (nextSamePath && item.y < anchor.y - 12);
}

function getImageCardSlotIds(
  anchor: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
): string[] {
  if (!isImageLikeBindableSlot(anchor)) return [anchor.slotId];
  const ids = slots
    .filter(
      (item) =>
        isDataBindableSlot(item, template) &&
        isSlotInsideImageCard(anchor, item) &&
        !hasRepeatedBindingPath(anchor, item, slots),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => item.slotId);
  return ids.length > 1 ? ids : [anchor.slotId];
}

function findImageAnchorForSlot(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
): ExpandedSlot | undefined {
  if (isImageLikeBindableSlot(slot)) return slot as ExpandedSlot;
  const center = slotCenter(slot);
  return slots
    .filter((item) => isDataBindableSlot(item, template) && isImageLikeBindableSlot(item))
    .filter((item) => isSlotInsideImageCard(item, slot))
    .sort((a, b) => {
      const centerA = slotCenter(a);
      const centerB = slotCenter(b);
      const distA = Math.abs(center.x - centerA.x) + Math.abs(center.y - centerA.y);
      const distB = Math.abs(center.x - centerB.x) + Math.abs(center.y - centerB.y);
      return distA - distB;
    })[0];
}

function getNearbyTextSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
): string[] {
  const center = slotCenter(slot);
  const ids = slots
    .filter((item) => {
      if (!isDataBindableSlot(item, template) || isImageLikeBindableSlot(item)) return false;
      if (!isLikelyDataFieldSlot(item)) return false;
      const itemCenter = slotCenter(item);
      return (
        Math.abs(itemCenter.x - center.x) <= Math.max(80, slot.width * 1.8) &&
        Math.abs(itemCenter.y - center.y) <= Math.max(95, slot.height * 3)
      );
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => item.slotId);
  return ids.length > 1 ? ids : [slot.slotId];
}

function getSpatialRelatedSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
): string[] {
  if (!isDataBindableSlot(slot, template)) return [slot.slotId];
  const anchor = findImageAnchorForSlot(slot, slots, template);
  if (anchor) {
    const imageCardIds = getImageCardSlotIds(anchor, slots, template);
    if (imageCardIds.length > 1) return imageCardIds;
  }
  return getNearbyTextSlotIds(slot, slots, template);
}

function getActualGroupSelectionIds(slot: Slot, slots: ExpandedSlot[]): string[] {
  if (slot.kind === "group" && slots.some((item) => item.groupId === slot.slotId)) {
    return [slot.slotId];
  }
  if (
    slot.groupId &&
    slots.some((item) => item.slotId === slot.groupId && item.kind === "group")
  ) {
    return [slot.groupId];
  }
  return [];
}

function getReplaceSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
  slotItems?: RenderedItem[],
): string[] {
  const groupSelectionIds = getActualGroupSelectionIds(slot, slots);
  if (groupSelectionIds.length > 0) return groupSelectionIds;

  const dataGroupIds = getDataGroupSlotIds(slot, slots, template);
  if (dataGroupIds.length > 1) return dataGroupIds;

  if (isDataBindableSlot(slot, template)) {
    const spatialIds = getSpatialRelatedSlotIds(slot, slots, template);
    if (spatialIds.length > 1) return spatialIds;
  }

  const relatedIds = getRelatedSlotIds(slot, slots, template, slotItems);
  if (relatedIds.some((slotId) => slotId !== slot.slotId)) return relatedIds;

  return [slot.slotId];
}

function getSelectionIdsForMode(
  slot: Slot,
  mode: BindCanvasSelectionMode,
  slots: ExpandedSlot[],
  template: PageTemplate,
  slotItems?: RenderedItem[],
): string[] {
  if (mode === "replace") {
    if (isLikelyGeneratePageBackgroundSlot(slot, template)) return [slot.slotId];

    const groupSelectionIds = getActualGroupSelectionIds(slot, slots);
    if (groupSelectionIds.length > 0) return groupSelectionIds;

    const dataGroupIds = getDataGroupSlotIds(slot, slots, template);
    if (dataGroupIds.length > 1) return dataGroupIds;

    return [slot.slotId];
  }

  return getRelatedSlotIds(slot, slots, template, slotItems);
}

function getRelatedSlotIds(
  slot: Slot,
  slots: ExpandedSlot[],
  template: PageTemplate,
  slotItems?: RenderedItem[],
): string[] {
  const groupSelectionIds = getActualGroupSelectionIds(slot, slots);
  if (groupSelectionIds.length > 0) return groupSelectionIds;

  const dataGroupIds = getDataGroupSlotIds(slot, slots, template);
  if (dataGroupIds.length > 1) return dataGroupIds;

  const expandedSlot = slot as ExpandedSlot;
  if (expandedSlot.cardGroupId) {
    const cardSlotIds = slots
      .filter(
        (item) =>
          item.cardGroupId === expandedSlot.cardGroupId &&
          item.cardIndex === expandedSlot.cardIndex &&
          isDataBindableSlot(item, template) &&
          !isDataGroupMarkerSlot(item),
      )
      .map((item) => item.slotId);
    if (cardSlotIds.length > 1) return cardSlotIds;
  }
  const containedIds = getContainedDataSlotIds(slot, slots, template);
  if (containedIds.length > 0) return containedIds;

  const spatialIds = getSpatialRelatedSlotIds(slot, slots, template);
  if (spatialIds.length > 1) return spatialIds;

  const renderedTargetIds = getRenderedTargetSlotIds(slot, slots, template, slotItems);
  if (renderedTargetIds.length > 1) return renderedTargetIds;

  return [slot.slotId];
}

function buildSelectionBounds(slots: ExpandedSlot[]) {
  const left = Math.min(...slots.map((slot) => slot.x));
  const top = Math.min(...slots.map((slot) => slot.y));
  const right = Math.max(...slots.map((slot) => slot.x + slot.width));
  const bottom = Math.max(...slots.map((slot) => slot.y + slot.height));
  return { left, top, width: right - left, height: bottom - top, count: slots.length };
}

function SlotHitTarget({
  slot,
  template,
  scale,
  selected,
  flatPreview,
  onSelect,
}: {
  slot: ExpandedSlot;
  template: PageTemplate;
  scale: number;
  selected: boolean;
  flatPreview?: boolean;
  onSelect: (mode: BindCanvasSelectionMode) => void;
}) {
  const isSelectable = isCanvasSelectableSlot(slot, template);
  if (!isSelectable) return null;

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
  label,
  showLabel = true,
  onSelect,
}: {
  slot: ExpandedSlot;
  scale: number;
  flatPreview?: boolean;
  label: string;
  showLabel?: boolean;
  onSelect: (mode: BindCanvasSelectionMode) => void;
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
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.shiftKey) {
          onSelect("group");
          return;
        }
        onSelect(event.metaKey || event.ctrlKey ? "toggle" : "replace");
      }}
    >
      {showLabel ? (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            borderRadius: 4,
            background: "rgba(124, 58, 237, 0.9)",
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            lineHeight: "14px",
            padding: "0 6px",
            pointerEvents: "auto",
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.shiftKey) {
              onSelect("group");
              return;
            }
            onSelect(event.metaKey || event.ctrlKey ? "toggle" : "replace");
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
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
  slot: ExpandedSlot;
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
  const isSelectable = isCanvasSelectableSlot(slot, template);

  const outline = selected
    ? "1px solid hsl(var(--primary) / 0.72)"
    : hasBinding
      ? "2px dashed hsl(var(--primary) / 0.6)"
      : showSafeFrame && isSelectable
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
    cursor: isSelectable ? "pointer" : "default",
    pointerEvents: isSelectable ? "auto" : "none",
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSelectable) return;
    if (e.shiftKey) {
      onSelect("group");
      return;
    }
    onSelect(e.metaKey || e.ctrlKey ? "toggle" : "replace");
  };

  const isGeneratedCoverBackground = isLikelyGeneratePageBackgroundSlot(slot, template);
  const rawSrc =
    slot.kind === "image" || slot.kind === "shape"
      ? isGeneratedCoverBackground
        ? slot.staticImage
        : (planned?.src ?? slot.staticImage)
      : undefined;
  const resolvedBindingImage =
    !isGeneratedCoverBackground &&
    !planned?.src &&
    (slot.kind === "image" || slot.kind === "shape") &&
    slot.bindingPath
      ? resolveImageBinding(
          slot.bindingPath,
          isEntityScopedImageBindingPath(slot.bindingPath) ? entity : undefined,
          assets,
          rawSrc,
          {
            entities: imageResolveEntities,
            source: slot.dataSourceId ? { id: slot.dataSourceId, kind: "sheet", label: slot.dataSourceId } : undefined,
            seed: `${seedKey ?? "bind"}:${slot.originalSlotId ?? slot.slotId}:${slot.slotId}`,
          },
        )
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
          source: slot.dataSourceId ? { id: slot.dataSourceId, kind: "sheet", label: slot.dataSourceId } : undefined,
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
    if (isDataGroupMarkerSlot(slot)) return null;
    const text = slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool, {
          entities: imageResolveEntities,
          source: slot.dataSourceId ? { id: slot.dataSourceId, kind: "sheet", label: slot.dataSourceId } : undefined,
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
        {section?.layoutMode === "poster_list" ? "Danh sách ảnh" : null}
      </div>
    );
  }

  if (slot.kind === "group") {
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
          background: "transparent",
          border: selected ? "1px solid hsl(var(--primary) / 0.72)" : "1px dashed transparent",
        }}
      />
    );
  }

  return null;
}

function CardBadge({ label }: { label: string }) {
  return (
    <div
      data-bind-card-badge="true"
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
