// PageRenderer: render 1 page template + dữ liệu thực ra HTML pixel-chuẩn (1080x...)
// Dùng cho cả preview thumbnail và export PNG

import { useCallback, useMemo } from "react";
import type {
  Asset,
  Entity,
  PageTemplate,
  RenderedItem,
  RenderedPage,
  Section,
  Slot,
} from "@/models";
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
import { getAssetImageSource } from "@/engines/binding/assetImage";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { expandPageWithCardGroups } from "@/engines/binding/cardRepeater";
import { renderRichTextRuns } from "@/features/editor/richText";

const IMAGE_PLACEHOLDER_BACKGROUND =
  "repeating-linear-gradient(135deg, rgba(59,130,246,0.08) 0, rgba(59,130,246,0.08) 14px, #f8fafc 14px, #f8fafc 28px)";

interface Props {
  template: PageTemplate;
  page?: RenderedPage;
  entities: Entity[];
  assets: Asset[];
  scale?: number;
  debug?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
  entity?: Entity;
  entityPool?: Entity[];
  slotItems?: RenderedItem[];
  seedKey?: string;
  showSlotBounds?: boolean;
  hideImagePlaceholderText?: boolean;
}

function isGeneratedCoverBackgroundSlot(slot: Slot, template: PageTemplate) {
  if (slot.kind !== "image" || slot.bindingPath !== "asset.cover") return false;
  const name = slot.name.toLowerCase();
  const coversCanvas =
    slot.x <= template.canvas.width * 0.05 &&
    slot.y <= template.canvas.height * 0.05 &&
    slot.width >= template.canvas.width * 0.84 &&
    slot.height >= template.canvas.height * 0.84;
  return slot.isUploadedBackground || name.includes("mood_background") || coversCanvas;
}

function isGeneratedBackgroundOverlaySlot(slot: Slot) {
  return slot.kind === "shape" && slot.name === "mood_background_overlay";
}

export function PageRenderer({
  template,
  page,
  entities,
  assets,
  scale = 1,
  debug = false,
  innerRef,
  entity,
  entityPool,
  slotItems,
  seedKey,
  showSlotBounds = false,
  hideImagePlaceholderText = false,
}: Props) {
  const entityMap = useMemo(
    () => new Map(entities.map((item) => [item.entityId, item])),
    [entities],
  );
  const assetMap = useMemo(() => new Map(assets.map((item) => [item.assetId, item])), [assets]);

  const { width, height, background, backgroundImage } = template.canvas;
  const resolvedBg = useResolvedImageSrc(backgroundImage);
  const bgUsable = resolvedBg && !resolvedBg.startsWith("idb://") ? resolvedBg : undefined;
  const effectiveSlotItems = useMemo(
    () => page?.items ?? slotItems ?? [],
    [page?.items, slotItems],
  );

  const sectionItemsMap = useMemo(() => {
    const map = new Map<string, Array<{ entityId?: string; assetId?: string }>>();
    for (const item of effectiveSlotItems) {
      if (!item.sectionId) continue;
      const bucket = map.get(item.sectionId) ?? [];
      bucket.push({ entityId: item.entityId, assetId: item.assetId });
      map.set(item.sectionId, bucket);
    }
    return map;
  }, [effectiveSlotItems]);

  const slotEntityOverride = useMemo(() => {
    const map = new Map<string, { entityId?: string; assetId?: string }>();
    for (const item of effectiveSlotItems) {
      if (item.slotId) {
        map.set(item.slotId, { entityId: item.entityId, assetId: item.assetId });
      }
    }
    return map;
  }, [effectiveSlotItems]);

  const expanded = useMemo(() => {
    const pool =
      effectiveSlotItems.length > 0
        ? []
        : entityPool && entityPool.length > 0
          ? entityPool
          : entity
            ? [entity]
            : [];
    return expandPageWithCardGroups(template, pool);
  }, [template, entityPool, entity, effectiveSlotItems]);

  const resolveEntityForSlot = useCallback(
    (slot: Slot & { originalSlotId?: string; __cardEntityId?: string }) => {
      const override =
        slotEntityOverride.get(slot.slotId) ??
        slotEntityOverride.get(slot.originalSlotId ?? slot.slotId);
      if (override?.entityId) return entityMap.get(override.entityId);
      if (slot.sectionRefId) {
        const sectionItems = sectionItemsMap.get(slot.sectionRefId) ?? [];
        const firstEntityId = sectionItems.find((item) => item.entityId)?.entityId;
        if (firstEntityId) return entityMap.get(firstEntityId);
      }
      if (effectiveSlotItems.length > 0) return undefined;
      if (slot.__cardEntityId) return entityMap.get(slot.__cardEntityId);
      return entity;
    },
    [effectiveSlotItems.length, entity, entityMap, sectionItemsMap, slotEntityOverride],
  );

  const imageSeedKey = seedKey ?? `${template.pageTemplateId}:${page?.pageIndex ?? "preview"}`;
  const imagePlan: SlotImagePlan = useMemo(
    () =>
      buildExpandedSlotImagePlan(
        expanded.slots,
        assets,
        resolveEntityForSlot,
        imageSeedKey,
        entities,
      ),
    [expanded.slots, assets, resolveEntityForSlot, imageSeedKey, entities],
  );

  return (
    <div
      ref={innerRef}
      data-cpg-page
      style={{
        width: width * scale,
        height: height * scale,
        position: "relative",
        background: background ?? "transparent",
        backgroundImage: bgUsable ? `url(${bgUsable})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        overflow: "hidden",
        isolation: "isolate",
        fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
      }}
    >
      {expanded.slots
        .slice()
        .filter((slot) => !slot.style?.hidden)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.renderOrder - b.renderOrder)
        .map((slot) => (
          <SlotRenderer
            key={slot.slotId}
            slot={slot}
            scale={scale}
            template={template}
            entityMap={entityMap}
            assetMap={assetMap}
            assets={assets}
            allEntities={entities}
            entity={resolveEntityForSlot(slot)}
            entityPool={entityPool}
            sectionItemsMap={sectionItemsMap}
            slotOverride={
              slotEntityOverride.get(slot.slotId) ??
              slotEntityOverride.get(slot.originalSlotId ?? slot.slotId)
            }
            planned={imagePlan.get(slot.slotId)}
            seedKey={imageSeedKey}
            debug={debug}
            showSlotBounds={showSlotBounds}
            hideImagePlaceholderText={hideImagePlaceholderText}
            renderGeneratedOverlay={
              assets.length > 0 || !!entity || !!entityPool?.length || effectiveSlotItems.length > 0
            }
          />
        ))}
    </div>
  );
}

function displayRenderedText(text: string | undefined): string {
  const raw = String(text ?? "");
  if (raw.trim() === "Text mới") return "Chữ mới";
  const token = raw.trim().match(/^\{\{([a-z0-9_]+)\}\}$/i)?.[1];
  if (!token) return raw;
  const base = token.replace(/_\d+$/g, "");
  const labels: Record<string, string> = {
    title: "Tiêu đề",
    subtitle: "Mô tả ngắn",
    eyebrow: "Nhãn nhỏ",
    cta: "CTA",
    section_title: "Tiêu đề nhóm",
    items_group: "Nhóm nội dung",
    name: "Tên mục",
    address: "Địa chỉ",
    phone: "Số điện thoại",
    price: "Giá",
    hours: "Giờ mở cửa",
    category: "Danh mục",
    subcategory: "Nhóm phụ",
    signature_dish: "Món nổi bật",
    description: "Mô tả",
    text: "Chữ mới",
  };
  if (base.startsWith("title")) return "Tiêu đề";
  if (base.startsWith("item")) return "Mục";
  if (base.includes("image")) return "Ảnh";
  return labels[base] ?? token.replace(/_\d+$/g, "").replace(/_/g, " ");
}

function SlotRenderer({
  slot,
  scale,
  template,
  entityMap,
  assetMap,
  assets,
  allEntities,
  entity,
  entityPool,
  sectionItemsMap,
  slotOverride,
  planned,
  seedKey,
  debug,
  showSlotBounds,
  hideImagePlaceholderText,
  renderGeneratedOverlay,
}: {
  slot: Slot;
  scale: number;
  template: PageTemplate;
  entityMap: Map<string, Entity>;
  assetMap: Map<string, Asset>;
  assets: Asset[];
  allEntities: Entity[];
  entity?: Entity;
  entityPool?: Entity[];
  sectionItemsMap: Map<string, Array<{ entityId?: string; assetId?: string }>>;
  slotOverride?: { entityId?: string; assetId?: string };
  planned?: PlannedImage;
  seedKey: string;
  debug?: boolean;
  showSlotBounds?: boolean;
  hideImagePlaceholderText?: boolean;
  renderGeneratedOverlay?: boolean;
}) {
  const flip = buildFlipTransform(slot.style);
  const rot = slot.rotation ? `rotate(${slot.rotation}deg)` : "";
  const transform = (rot + flip).trim() || undefined;

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
  };

  let shapeRawSrc: string | undefined;
  if (slot.kind === "shape") {
    shapeRawSrc = slot.staticImage;
    if (planned?.src) {
      shapeRawSrc = planned.src;
    } else if (slot.bindingPath) {
      const result = resolveImageBinding(slot.bindingPath, entity, assets, shapeRawSrc, {
        entities: allEntities,
        seed: `${seedKey}:${slot.slotId}:shape`,
      });
      if (result.src) shapeRawSrc = result.src;
    }
  }
  const resolvedShapeSrc = useResolvedImageSrc(shapeRawSrc);

  let imageRawSrc: string | undefined;
  let imageEntityIdLog: string | undefined;
  let imageAssetIdLog: string | undefined;
  if (slot.kind === "image") {
    imageRawSrc = isGeneratedCoverBackgroundSlot(slot, template) ? undefined : slot.staticImage;

    if (planned?.src) {
      imageRawSrc = planned.src;
      imageAssetIdLog = planned.assetId;
      imageEntityIdLog = planned.entityId;
    } else if (slot.bindingPath) {
      const result = resolveImageBinding(slot.bindingPath, entity, assets, imageRawSrc, {
        entities: allEntities,
        seed: `${seedKey}:${slot.slotId}:image`,
      });
      if (result.src) {
        imageRawSrc = result.src;
        imageAssetIdLog = result.assetId;
        imageEntityIdLog = result.entityId;
      }
    }

    if (!imageRawSrc && slotOverride?.assetId) {
      const asset = assetMap.get(slotOverride.assetId);
      if (asset) {
        imageRawSrc = getAssetImageSource(asset);
        imageAssetIdLog = asset.assetId;
        imageEntityIdLog = asset.entityId;
      }
    }
  }
  const resolvedImgSrc = useResolvedImageSrc(imageRawSrc);

  if (isGeneratedBackgroundOverlaySlot(slot) && !renderGeneratedOverlay) {
    return null;
  }

  if (slot.kind === "shape") {
    const usableSrc =
      resolvedShapeSrc && !resolvedShapeSrc.startsWith("idb://")
        ? resolvedShapeSrc
        : shapeRawSrc && !shapeRawSrc.startsWith("idb://")
          ? shapeRawSrc
          : undefined;
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
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool, {
          entities: allEntities,
          seed: `${seedKey}:${slot.slotId}:shape-text`,
        })
      : (slot.staticText ?? "");
    const hasShapeText = !!shapeText.trim();
    const textCss = buildTextStyle(slot.style, scale);

    if (isLine) {
      return (
        <div
          style={{
            ...baseStyle,
            background: gradient ?? slot.style?.fill ?? "#000",
            height: Math.max(1, (slot.style?.strokeWidth ?? 2) * scale),
            top:
              (slot.y + slot.height / 2) * scale -
              Math.max(1, (slot.style?.strokeWidth ?? 2) * scale) / 2,
          }}
        >
          <DebugBadge debug={debug} text="line" />
        </div>
      );
    }

    const fillBg = gradient ?? slot.style?.fill ?? "#e5e7eb";
    return (
      <div
        style={{
          ...baseStyle,
          background: usableSrc ? undefined : fillBg,
          borderRadius: radius,
          clipPath: clip,
          border: usableSrc ? undefined : border,
          overflow: "hidden",
        }}
      >
        {usableSrc && (
          <>
            <img
              src={usableSrc}
              crossOrigin="anonymous"
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: fit,
                filter,
                display: "block",
              }}
            />
            {slot.style?.overlayColor && (
              <div
                style={{ position: "absolute", inset: 0, background: slot.style.overlayColor }}
              />
            )}
          </>
        )}
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
            }}
          >
            {displayRenderedText(shapeText)}
          </div>
        )}
        <SlotPreviewBounds kind="shape" show={showSlotBounds && !hasShapeText} />
        <DebugBadge debug={debug} text={`shape${planned?.fallback ? "*" : ""}`} />
      </div>
    );
  }

  if (slot.kind === "image") {
    const isGeneratedCoverBackground = isGeneratedCoverBackgroundSlot(slot, template);
    const usableSrc =
      resolvedImgSrc && !resolvedImgSrc.startsWith("idb://")
        ? resolvedImgSrc
        : imageRawSrc && !imageRawSrc.startsWith("idb://")
          ? imageRawSrc
          : undefined;
    const filter = buildCssFilter(slot.style);
    const objectFit = (
      slot.style?.fit === "stretch" ? "fill" : (slot.style?.fit ?? "cover")
    ) as React.CSSProperties["objectFit"];
    const crop = slot.crop;

    if (isGeneratedCoverBackground && !usableSrc && !renderGeneratedOverlay) {
      return null;
    }

    return (
      <div
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
              crossOrigin="anonymous"
              alt=""
              style={{
                position: "absolute",
                left: `${-crop.x * 100}%`,
                top: `${-crop.y * 100}%`,
                width: `${100 / crop.w}%`,
                height: `${100 / crop.h}%`,
                objectFit: "fill",
                filter,
                display: "block",
              }}
            />
          ) : (
            <img
              src={usableSrc}
              crossOrigin="anonymous"
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit,
                filter,
                display: "block",
              }}
            />
          )
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: IMAGE_PLACEHOLDER_BACKGROUND,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(71,85,105,0.6)",
              fontSize: 10 * scale,
            }}
          >
            {hideImagePlaceholderText ? null : "(chưa có ảnh)"}
          </div>
        )}
        {slot.style?.overlayColor && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: slot.style.overlayColor,
            }}
          />
        )}
        <SlotPreviewBounds kind="image" show={showSlotBounds} />
        <DebugBadge
          debug={debug}
          text={`img${planned?.fallback ? "*" : ""} ${imageEntityIdLog?.slice(0, 4) ?? ""} ${imageAssetIdLog?.slice(0, 4) ?? ""}`}
        />
      </div>
    );
  }

  if (slot.kind === "text") {
    const text = slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, entity, slot.staticText, entityPool, {
          entities: allEntities,
          seed: `${seedKey}:${slot.slotId}:text`,
        })
      : (slot.staticText ?? "Văn bản");
    const textCss = buildTextStyle(slot.style, scale);
    return (
      <div
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
          fallback: displayRenderedText(text),
        })}
        <DebugBadge debug={debug} text="text" />
      </div>
    );
  }

  if (slot.kind === "section") {
    if (!slot.sectionRefId) return null;
    const section = template.sections.find((item) => item.sectionId === slot.sectionRefId);
    if (!section) return null;
    const items = sectionItemsMap.get(section.sectionId) ?? [];
    return (
      <div style={baseStyle}>
        <SectionView
          slot={slot}
          section={section}
          items={items}
          entityMap={entityMap}
          assetMap={assetMap}
          scale={scale}
          width={slot.width}
          height={slot.height}
          debug={debug}
        />
        <SlotPreviewBounds kind="section" show={showSlotBounds} />
      </div>
    );
  }

  return null;
}

function SectionView({
  slot,
  section,
  items,
  entityMap,
  assetMap,
  scale,
  width,
  height,
  debug,
}: {
  slot: Slot;
  section: Section;
  items: Array<{ entityId?: string; assetId?: string }>;
  entityMap: Map<string, Entity>;
  assetMap: Map<string, Asset>;
  scale: number;
  width: number;
  height: number;
  debug?: boolean;
}) {
  const isPosterList = section.layoutMode === "poster_list";
  const baseColor = slot.style?.color ?? (isPosterList ? "#ffffff" : "#0f172a");
  const titleText = section.title?.trim();
  const placeholderCount = Math.max(section.minItems || 0, Math.min(section.maxItems || 4, 4));

  if (isPosterList) {
    const textStyle = buildTextStyle(
      {
        fontFamily: slot.style?.fontFamily ?? "Be Vietnam Pro",
        fontSize: slot.style?.fontSize ?? 28,
        fontWeight: slot.style?.fontWeight ?? 600,
        color: baseColor,
        lineHeight: slot.style?.lineHeight ?? 1.4,
        letterSpacing: slot.style?.letterSpacing ?? 0,
        textAlign: slot.style?.textAlign ?? "left",
        textShadow: slot.style?.textShadow,
        textShadowColor: slot.style?.textShadowColor,
        textShadowBlur: slot.style?.textShadowBlur,
        textShadowX: slot.style?.textShadowX,
        textShadowY: slot.style?.textShadowY,
        textStrokeColor: slot.style?.textStrokeColor,
        textStrokeWidth: slot.style?.textStrokeWidth,
      },
      scale,
    );

    const placeholderLines = Array.from({ length: placeholderCount }, (_, index) => ({
      key: `placeholder-${index}`,
      text: `• {{tên}} - {{địa chỉ}}`,
      muted: true,
    }));

    const posterLines =
      items.length === 0
        ? placeholderLines
        : items.flatMap((item, index) => {
            const entity = item.entityId ? entityMap.get(item.entityId) : undefined;
            if (!entity) return [];
            const line = [entity.name, entity.address].filter(Boolean).join(" - ");
            return [{ key: `${entity.entityId}-${index}`, text: `• ${line}`, muted: false }];
          });

    return (
      <div
        style={{
          width: width * scale,
          height: height * scale,
          display: "flex",
          flexDirection: "column",
          gap: 8 * scale,
          overflow: "hidden",
          padding: (slot.style?.padding ?? 0) * scale,
          background: slot.style?.background ?? "transparent",
        }}
      >
        {titleText ? (
          <div
            style={{
              ...textStyle,
              fontWeight: Math.max(Number(slot.style?.fontWeight ?? 700), 700),
              marginBottom: 4 * scale,
            }}
          >
            {titleText}
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 * scale, flex: 1 }}>
          {posterLines.map((line) => (
            <div
              key={line.key}
              style={{
                ...textStyle,
                color: line.muted ? "rgba(255,255,255,0.6)" : baseColor,
                whiteSpace: "pre-wrap",
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: width * scale,
        height: height * scale,
        background: "rgba(255,255,255,0.85)",
        borderRadius: 24 * scale,
        padding: 24 * scale,
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 12 * scale,
        overflow: "hidden",
      }}
    >
      {titleText ? (
        <div
          style={{
            fontWeight: 800,
            fontSize: 28 * scale,
            color: "#0f172a",
            marginBottom: 4 * scale,
          }}
        >
          {titleText}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 * scale, flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 16 * scale }}>(không có dữ liệu)</div>
        ) : (
          items.map((item, index) => {
            const entity = item.entityId ? entityMap.get(item.entityId) : undefined;
            const asset = item.assetId ? assetMap.get(item.assetId) : undefined;
            if (!entity) return null;
            const isZigzag = section.layoutMode === "zigzag";
            const flipRow = isZigzag && index % 2 === 1;
            const priceFromMeta =
              (entity.metadata?.price as string | number | undefined) ??
              (entity.metadata?.priceUsd as string | number | undefined);
            const priceText =
              entity.priceRange ?? (priceFromMeta != null ? String(priceFromMeta) : undefined);
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  flexDirection: flipRow ? "row-reverse" : "row",
                  gap: 12 * scale,
                  alignItems: "center",
                  padding: 8 * scale,
                  background: entity.partnerFlag ? "rgba(253, 224, 71, 0.25)" : "transparent",
                  borderRadius: 12 * scale,
                }}
              >
                {asset && <ResolvedAssetImage asset={asset} scale={scale} isZigzag={isZigzag} />}
                <div style={{ flex: 1, minWidth: 0, textAlign: flipRow ? "right" : "left" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 22 * scale,
                      color: "#0f172a",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {section.listStyle === "number"
                      ? `${index + 1}. `
                      : section.listStyle === "dot"
                        ? "• "
                        : ""}
                    {entity.name}
                    {entity.partnerFlag && (
                      <span
                        style={{
                          marginLeft: 8 * scale,
                          fontSize: 12 * scale,
                          background: "#facc15",
                          color: "#1f2937",
                          padding: `${2 * scale}px ${6 * scale}px`,
                          borderRadius: 4 * scale,
                        }}
                      >
                        ĐỐI TÁC
                      </span>
                    )}
                  </div>
                  {entity.address && (
                    <div
                      style={{
                        fontSize: 16 * scale,
                        color: "#475569",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      📍 {entity.address}
                    </div>
                  )}
                  {priceText && (
                    <div
                      style={{
                        display: "inline-block",
                        marginTop: 4 * scale,
                        fontSize: 14 * scale,
                        background: "#f97316",
                        color: "#ffffff",
                        fontWeight: 700,
                        padding: `${3 * scale}px ${10 * scale}px`,
                        borderRadius: 9999,
                      }}
                    >
                      {priceText}
                    </div>
                  )}
                </div>
                <DebugBadge
                  debug={debug}
                  text={`${entity.entityId.slice(0, 4)}/${asset?.assetId.slice(0, 4) ?? "-"}`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ResolvedAssetImage({
  asset,
  scale,
  isZigzag,
}: {
  asset: Asset;
  scale: number;
  isZigzag: boolean;
}) {
  const rawSrc = getAssetImageSource(asset);
  const resolvedSrc = useResolvedImageSrc(rawSrc);
  const usableSrc =
    resolvedSrc && !resolvedSrc.startsWith("idb://")
      ? resolvedSrc
      : rawSrc && !rawSrc.startsWith("idb://")
        ? rawSrc
        : undefined;

  if (!usableSrc) return null;

  return (
    <img
      src={usableSrc}
      crossOrigin="anonymous"
      alt=""
      style={{
        width: 80 * scale,
        height: 80 * scale,
        objectFit: "cover",
        borderRadius: isZigzag ? 9999 : 12 * scale,
        flexShrink: 0,
      }}
    />
  );
}

function SlotPreviewBounds({ kind, show }: { kind: Slot["kind"]; show?: boolean }) {
  if (!show) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
        border: "1px dashed rgba(100,116,139,0.55)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.75)",
        background:
          kind === "image"
            ? "repeating-linear-gradient(135deg, rgba(59,130,246,0.08) 0, rgba(59,130,246,0.08) 8px, transparent 8px, transparent 16px)"
            : "rgba(255,255,255,0.02)",
      }}
    />
  );
}

function DebugBadge({ debug, text }: { debug?: boolean; text: string }) {
  if (!debug) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 2,
        left: 2,
        background: "rgba(0,0,0,0.65)",
        color: "#fff",
        fontSize: 9,
        padding: "1px 4px",
        borderRadius: 3,
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      {text}
    </div>
  );
}
