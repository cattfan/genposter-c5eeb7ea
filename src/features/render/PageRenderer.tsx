// PageRenderer: render 1 page template + dữ liệu thực ra HTML pixel-chuẩn (1080x...)
// Dùng cho cả preview thumbnail và export PNG (html-to-image)

import { useMemo } from "react";
import type {
  Asset,
  Entity,
  PageTemplate,
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
import { buildSlotImagePlan, type PlannedImage, type SlotImagePlan } from "@/engines/binding/imagePlan";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { expandPageWithCardGroups, type ExpandedSlot } from "@/engines/binding/cardRepeater";

interface Props {
  template: PageTemplate;
  page?: RenderedPage;
  entities: Entity[];
  assets: Asset[];
  scale?: number;
  debug?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
  // Chế độ generate-theo-entity: 1 entity ăn vào tất cả block có bindingPath
  entity?: Entity;
  /** Pool entity dùng cho Card Repeater (template.cardGroups). Mặc định = [entity]. */
  entityPool?: Entity[];
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
}: Props) {
  const entityMap = useMemo(() => new Map(entities.map((e) => [e.entityId, e])), [entities]);
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.assetId, a])), [assets]);

  const { width, height, background, backgroundImage } = template.canvas;
  const resolvedBg = useResolvedImageSrc(backgroundImage);
  const bgUsable = resolvedBg && !resolvedBg.startsWith("idb://") ? resolvedBg : undefined;

  const sectionItemsMap = useMemo(() => {
    const m = new Map<string, Array<{ entityId?: string; assetId?: string }>>();
    if (!page) return m;
    for (const it of page.items) {
      if (!it.sectionId) continue;
      const arr = m.get(it.sectionId) ?? [];
      arr.push({ entityId: it.entityId, assetId: it.assetId });
      m.set(it.sectionId, arr);
    }
    return m;
  }, [page]);

  const slotEntityOverride = useMemo(() => {
    const m = new Map<string, { entityId?: string; assetId?: string }>();
    if (!page) return m;
    for (const it of page.items) {
      if (it.slotId) m.set(it.slotId, { entityId: it.entityId, assetId: it.assetId });
    }
    return m;
  }, [page]);

  // Plan ảnh cấp page: rotate asset không trùng cho các block bind asset.*
  const imagePlan: SlotImagePlan = useMemo(
    () => buildSlotImagePlan(template, entity, assets),
    [template, entity, assets],
  );

  return (
    <div
      ref={innerRef}
      data-cpg-page
      style={{
        width: width * scale,
        height: height * scale,
        position: "relative",
        // Nếu template không set background → để trong suốt (không fallback #fff).
        background: background ?? "transparent",
        backgroundImage: bgUsable ? `url(${bgUsable})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        overflow: "hidden",
        fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
      }}
    >
      {template.slots
        .slice()
        .filter((s) => !s.style?.hidden)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((slot) => (
          <SlotRenderer
            key={slot.slotId}
            slot={slot}
            scale={scale}
            template={template}
            entityMap={entityMap}
            assetMap={assetMap}
            assets={assets}
            entity={entity}
            sectionItemsMap={sectionItemsMap}
            slotOverride={slotEntityOverride.get(slot.slotId)}
            planned={imagePlan.get(slot.slotId)}
            debug={debug}
          />
        ))}
    </div>
  );
}

function SlotRenderer({
  slot,
  scale,
  template,
  entityMap,
  assetMap,
  assets,
  entity,
  sectionItemsMap,
  slotOverride,
  planned,
  debug,
}: {
  slot: Slot;
  scale: number;
  template: PageTemplate;
  entityMap: Map<string, Entity>;
  assetMap: Map<string, Asset>;
  assets: Asset[];
  entity?: Entity;
  sectionItemsMap: Map<string, Array<{ entityId?: string; assetId?: string }>>;
  slotOverride?: { entityId?: string; assetId?: string };
  planned?: PlannedImage;
  debug?: boolean;
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

  if (slot.kind === "shape") {
    // Shape có thể bind ảnh — ưu tiên planned (anti-trùng), fallback resolveImageBinding theo slot, cuối cùng staticImage.
    let rawSrc = slot.staticImage;
    if (planned?.src) {
      rawSrc = planned.src;
    } else if (slot.bindingPath && entity) {
      const r = resolveImageBinding(slot.bindingPath, entity, assets, rawSrc);
      if (r.src) rawSrc = r.src;
    }
    const resolvedShapeSrc = useResolvedImageSrc(rawSrc);
    const usableSrc = resolvedShapeSrc && !resolvedShapeSrc.startsWith("idb://")
      ? resolvedShapeSrc
      : (rawSrc && !rawSrc.startsWith("idb://") ? rawSrc : undefined);
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
          style={{
            ...baseStyle,
            background: gradient ?? slot.style?.fill ?? "#000",
            height: Math.max(1, (slot.style?.strokeWidth ?? 2) * scale),
            top: (slot.y + slot.height / 2) * scale - Math.max(1, (slot.style?.strokeWidth ?? 2) * scale) / 2,
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
              <div style={{ position: "absolute", inset: 0, background: slot.style.overlayColor }} />
            )}
          </>
        )}
        <DebugBadge debug={debug} text={`shape${planned?.fallback ? "*" : ""}`} />
      </div>
    );
  }

  if (slot.kind === "image") {
    let rawSrc = slot.staticImage;
    let entityIdLog: string | undefined;
    let assetIdLog: string | undefined;
    // Ưu tiên: plan ảnh đã rotate cho cả page (chống trùng).
    if (planned?.src) {
      rawSrc = planned.src;
      assetIdLog = planned.assetId;
      entityIdLog = planned.entityId;
    } else if (slot.bindingPath && entity) {
      const r = resolveImageBinding(slot.bindingPath, entity, assets, rawSrc);
      if (r.src) {
        rawSrc = r.src;
        assetIdLog = r.assetId;
        entityIdLog = r.entityId;
      }
    }
    // Fallback: page items override (luồng pack/section cũ)
    if (!rawSrc && slotOverride?.assetId) {
      const a = assetMap.get(slotOverride.assetId);
      if (a) {
        rawSrc = a.sourceValue;
        assetIdLog = a.assetId;
        entityIdLog = a.entityId;
      }
    }
    const resolvedImgSrc = useResolvedImageSrc(rawSrc);
    const usableSrc = resolvedImgSrc && !resolvedImgSrc.startsWith("idb://")
      ? resolvedImgSrc
      : (rawSrc && !rawSrc.startsWith("idb://") ? rawSrc : undefined);
    const filter = buildCssFilter(slot.style);
    const objectFit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const crop = slot.crop;
    return (
      <div style={{ ...baseStyle, overflow: "hidden", borderRadius: (slot.style?.borderRadius ?? 0) * scale }}>
        {usableSrc ? (
          crop ? (
            <img
              src={usableSrc}
              crossOrigin="anonymous"
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
              alt=""
            />
          ) : (
            <img
              src={usableSrc}
              crossOrigin="anonymous"
              style={{
                width: "100%",
                height: "100%",
                objectFit,
                filter,
                display: "block",
              }}
              alt=""
            />
          )
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "rgba(0,0,0,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
              fontSize: 14 * scale,
            }}
          >
            (chưa có ảnh)
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
        <DebugBadge debug={debug} text={`img${planned?.fallback ? "*" : ""} ${entityIdLog?.slice(0, 4) ?? ""} ${assetIdLog?.slice(0, 4) ?? ""}`} />
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
        style={{
          ...baseStyle,
          ...textCss,
        }}
      >
        {text}
        <DebugBadge debug={debug} text="text" />
      </div>
    );
  }

  if (slot.kind === "section") {
    if (!slot.sectionRefId) return null;
    const section = template.sections.find((s) => s.sectionId === slot.sectionRefId);
    if (!section) return null;
    const items = sectionItemsMap.get(section.sectionId) ?? [];
    return (
      <div style={baseStyle}>
        <SectionView
          section={section}
          items={items}
          entityMap={entityMap}
          assetMap={assetMap}
          scale={scale}
          width={slot.width}
          height={slot.height}
          debug={debug}
        />
      </div>
    );
  }

  return null;
}

function SectionView({
  section,
  items,
  entityMap,
  assetMap,
  scale,
  width,
  height,
  debug,
}: {
  section: Section;
  items: Array<{ entityId?: string; assetId?: string }>;
  entityMap: Map<string, Entity>;
  assetMap: Map<string, Asset>;
  scale: number;
  width: number;
  height: number;
  debug?: boolean;
}) {
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
      <div
        style={{
          fontWeight: 800,
          fontSize: 28 * scale,
          color: "#0f172a",
          marginBottom: 4 * scale,
        }}
      >
        {section.title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 * scale, flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 16 * scale }}>(không có dữ liệu)</div>
        ) : (
          items.map((it, idx) => {
            const ent = it.entityId ? entityMap.get(it.entityId) : undefined;
            const asset = it.assetId ? assetMap.get(it.assetId) : undefined;
            if (!ent) return null;
            const isZigzag = section.layoutMode === "zigzag";
            const flipRow = isZigzag && idx % 2 === 1;
            const priceFromMeta =
              (ent.metadata?.price as string | number | undefined) ??
              (ent.metadata?.priceUsd as string | number | undefined);
            const priceText = ent.priceRange ?? (priceFromMeta != null ? String(priceFromMeta) : undefined);
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  flexDirection: flipRow ? "row-reverse" : "row",
                  gap: 12 * scale,
                  alignItems: "center",
                  padding: 8 * scale,
                  background: ent.partnerFlag ? "rgba(253, 224, 71, 0.25)" : "transparent",
                  borderRadius: 12 * scale,
                }}
              >
                {asset && (
                  <img
                    src={asset.sourceValue}
                    crossOrigin="anonymous"
                    style={{
                      width: 80 * scale,
                      height: 80 * scale,
                      objectFit: "cover",
                      borderRadius: isZigzag ? 9999 : 12 * scale,
                      flexShrink: 0,
                    }}
                    alt=""
                  />
                )}
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
                    {section.listStyle === "number" ? `${idx + 1}. ` : section.listStyle === "dot" ? "• " : ""}
                    {ent.name}
                    {ent.partnerFlag && (
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
                  {ent.address && (
                    <div
                      style={{
                        fontSize: 16 * scale,
                        color: "#475569",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      📍 {ent.address}
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
                <DebugBadge debug={debug} text={`${ent.entityId.slice(0, 4)}/${asset?.assetId.slice(0, 4) ?? "-"}`} />
              </div>
            );
          })
        )}
      </div>
    </div>
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
        zIndex: 9999,
      }}
    >
      {text}
    </div>
  );
}
