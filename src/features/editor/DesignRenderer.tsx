import { memo, type CSSProperties, type Ref } from "react";
import type { DesignElement, DesignPage, ElementStyle } from "@/models";
import {
  buildBorder,
  buildBoxShadow,
  buildCssFilter,
  buildFlipTransform,
  buildGradient,
  buildTextStyle,
  shapeBorderRadius,
  shapeClipPath,
} from "@/engines/binding/dataBinding";
import { useResolvedImageSrc } from "@/storage/imageSrc";
import { getHeroiconComponent } from "./designAssets";
import { renderRichTextRuns } from "./richText";

export function DesignRenderer({
  page,
  elements,
  scale = 1,
  className,
  innerRef,
  suppressElementIds = [],
  suppressShapeTextIds = [],
  showGuides = false,
  showGrid = false,
  gridSize = 8,
}: {
  page: DesignPage;
  elements: DesignElement[];
  scale?: number;
  className?: string;
  innerRef?: Ref<HTMLDivElement>;
  suppressElementIds?: string[];
  suppressShapeTextIds?: string[];
  showGuides?: boolean;
  showGrid?: boolean;
  gridSize?: number;
}) {
  const ordered = elements
    .filter((element) => !element.hidden && !suppressElementIds.includes(element.elementId))
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const minorGridSize = Math.max(6, gridSize * scale);
  const majorGridSize = minorGridSize * 5;
  const gridBackground = showGrid
    ? [
        "linear-gradient(to right, rgba(15,23,42,0.18) 1px, transparent 1px)",
        "linear-gradient(to bottom, rgba(15,23,42,0.18) 1px, transparent 1px)",
        "linear-gradient(to right, rgba(15,23,42,0.08) 1px, transparent 1px)",
        "linear-gradient(to bottom, rgba(15,23,42,0.08) 1px, transparent 1px)",
      ]
    : [];
  const imageBackground = page.backgroundImage ? [`url(${page.backgroundImage})`] : [];
  const backgroundImages = [...gridBackground, ...imageBackground].join(", ") || undefined;
  const backgroundSizes =
    [
      ...(showGrid
        ? [
            `${majorGridSize}px ${majorGridSize}px`,
            `${majorGridSize}px ${majorGridSize}px`,
            `${minorGridSize}px ${minorGridSize}px`,
            `${minorGridSize}px ${minorGridSize}px`,
          ]
        : []),
      ...(page.backgroundImage ? ["cover"] : []),
    ].join(", ") || undefined;
  const backgroundPositions =
    [
      ...(showGrid ? ["0 0", "0 0", "0 0", "0 0"] : []),
      ...(page.backgroundImage ? ["center"] : []),
    ].join(", ") || undefined;

  return (
    <div
      ref={innerRef}
      className={className}
      style={{
        position: "relative",
        width: page.width * scale,
        height: page.height * scale,
        background: page.background ?? "#ffffff",
        overflow: "hidden",
        backgroundImage: backgroundImages,
        backgroundSize: backgroundSizes,
        backgroundPosition: backgroundPositions,
      }}
    >
      {ordered.map((element) => (
        <DesignElementNode
          key={element.elementId}
          element={element}
          scale={scale}
          showGuides={showGuides}
          suppressShapeText={suppressShapeTextIds.includes(element.elementId)}
        />
      ))}
    </div>
  );
}

function baseElementStyle(element: DesignElement, scale: number): CSSProperties {
  const flip = buildFlipTransform(element.style);
  const rotation = element.rotation ? `rotate(${element.rotation}deg)` : "";
  const transform = `${rotation}${flip}`.trim() || undefined;

  return {
    position: "absolute",
    left: element.x * scale,
    top: element.y * scale,
    width: element.width * scale,
    height: element.height * scale,
    transform,
    transformOrigin: "center",
    opacity: element.style?.opacity ?? 1,
    boxShadow: buildBoxShadow(element.style, scale),
    contain: "layout paint style",
    zIndex: element.zIndex ?? 0,
  };
}

function resolveAssetSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("idb://")) return undefined;
  return src;
}

function displayEditorText(text: string | undefined): string {
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

function shouldSuppressGeneratedCoverSrc(element: DesignElement): boolean {
  if (element.kind !== "image" && element.kind !== "shape") return false;
  const legacyMeta = (element.meta?.legacy ?? {}) as Record<string, unknown>;
  return (
    element.binding?.path === "asset.cover" &&
    (legacyMeta.isUploadedBackground === true ||
      element.name.toLowerCase().includes("mood_background"))
  );
}

function isGeneratedBackgroundOverlayElement(element: DesignElement): boolean {
  return element.kind === "shape" && element.name === "mood_background_overlay";
}

function EditorGuideBounds({ kind, show }: { kind: DesignElement["kind"]; show: boolean }) {
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

const DesignElementNode = memo(
  function DesignElementNode({
    element,
    scale,
    showGuides,
    suppressShapeText = false,
  }: {
    element: DesignElement;
    scale: number;
    showGuides: boolean;
    suppressShapeText?: boolean;
  }) {
    const style = baseElementStyle(element, scale);
    const legacyMeta = (element.meta?.legacy ?? {}) as Record<string, unknown>;
    const rawSrc = shouldSuppressGeneratedCoverSrc(element) ? undefined : element.src;
    const resolvedSrc = useResolvedImageSrc(
      element.kind === "image" || element.kind === "shape" ? rawSrc : undefined,
    );

    if (isGeneratedBackgroundOverlayElement(element)) {
      return null;
    }

    if (element.kind === "text") {
      const textStyle = buildTextStyle(element.style, scale);
      return (
        <div
          data-rendered-element-id={element.elementId}
          style={{
            ...style,
            ...textStyle,
          }}
        >
          {renderRichTextRuns({
            text: element.text,
            runs: element.textRuns,
            baseStyle: element.style,
            scale,
            fallback: displayEditorText(element.text),
          })}
          <EditorGuideBounds kind={element.kind} show={showGuides} />
        </div>
      );
    }

    if (element.kind === "image") {
      const usableSrc =
        resolvedSrc && !resolvedSrc.startsWith("idb://") ? resolvedSrc : resolveAssetSrc(rawSrc);
      if (shouldSuppressGeneratedCoverSrc(element) && !usableSrc) {
        return null;
      }
      const fit = (
        element.style?.fit === "stretch" ? "fill" : (element.style?.fit ?? "cover")
      ) as CSSProperties["objectFit"];
      const filter = buildCssFilter(element.style);

      return (
        <div
          data-rendered-element-id={element.elementId}
          style={{
            ...style,
            overflow: "hidden",
            borderRadius: (element.style?.borderRadius ?? 0) * scale,
          }}
        >
          {usableSrc ? (
            element.crop ? (
              <img
                src={usableSrc}
                alt=""
                style={{
                  position: "absolute",
                  left: `${-element.crop.x * 100}%`,
                  top: `${-element.crop.y * 100}%`,
                  width: `${100 / element.crop.w}%`,
                  height: `${100 / element.crop.h}%`,
                  objectFit: "fill",
                  filter,
                  display: "block",
                }}
              />
            ) : (
              <img
                src={usableSrc}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: fit,
                  filter,
                  display: "block",
                }}
              />
            )
          ) : (
            <div
              className="grid h-full place-items-center text-xs text-muted-foreground"
              style={{
                background:
                  "repeating-linear-gradient(135deg, rgba(59,130,246,0.08) 0, rgba(59,130,246,0.08) 8px, transparent 8px, transparent 16px)",
              }}
            >
              Image
            </div>
          )}
          {element.style?.overlayColor && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: element.style.overlayColor,
              }}
            />
          )}
          <EditorGuideBounds kind={element.kind} show={showGuides} />
        </div>
      );
    }

    if (element.kind === "shape") {
      const usableSrc =
        resolvedSrc && !resolvedSrc.startsWith("idb://") ? resolvedSrc : resolveAssetSrc(rawSrc);
      if (shouldSuppressGeneratedCoverSrc(element) && !usableSrc && !element.text) {
        return null;
      }
      const gradient = buildGradient(element.style);
      const fill = gradient ?? element.style?.fill ?? "#111827";
      const border = buildBorder(element.style, scale);
      const filter = buildCssFilter(element.style);
      const radius = shapeBorderRadius(element.shapeKind, element.style?.borderRadius, scale);
      const clipPath = element.shapeKind ? shapeClipPath(element.shapeKind) : undefined;
      const fit = (
        element.style?.fit === "stretch" ? "fill" : (element.style?.fit ?? "cover")
      ) as CSSProperties["objectFit"];

      if (element.shapeKind === "line" || element.shapeKind === "divider") {
        return (
          <div
            data-rendered-element-id={element.elementId}
            style={{
              ...style,
              height: Math.max(1, (element.style?.strokeWidth ?? 2) * scale),
              top:
                (element.y + element.height / 2) * scale -
                Math.max(1, (element.style?.strokeWidth ?? 2) * scale) / 2,
              background: fill,
            }}
          >
            <EditorGuideBounds kind={element.kind} show={showGuides} />
          </div>
        );
      }

      return (
        <div
          data-rendered-element-id={element.elementId}
          style={{
            ...style,
            overflow: "hidden",
            background: usableSrc ? undefined : fill,
            borderRadius: radius,
            border: usableSrc ? undefined : border,
            clipPath,
          }}
        >
          {usableSrc && (
            <img
              src={usableSrc}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: fit,
                filter,
                display: "block",
              }}
            />
          )}
          {element.style?.overlayColor && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: element.style.overlayColor,
              }}
            />
          )}
          {element.text && !suppressShapeText ? (
            <div
              style={{
                ...buildTextStyle(element.style, scale),
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent:
                  element.style?.textAlign === "center"
                    ? "center"
                    : element.style?.textAlign === "right"
                      ? "flex-end"
                      : "flex-start",
              }}
            >
              {renderRichTextRuns({
                text: element.text,
                runs: element.textRuns,
                baseStyle: element.style,
                scale,
                fallback: displayEditorText(element.text),
              })}
            </div>
          ) : null}
          {!element.text || suppressShapeText ? (
            <EditorGuideBounds kind={element.kind} show={showGuides} />
          ) : null}
        </div>
      );
    }

    if (element.kind === "frame") {
      const isLegacySection = legacyMeta.slotKind === "section";
      return (
        <div
          style={{
            ...style,
            background: element.background ?? element.style?.background ?? "rgba(255,255,255,0.12)",
            borderRadius: (element.style?.borderRadius ?? 16) * scale,
            border: buildBorder(element.style, scale) ?? "1px dashed rgba(148,163,184,0.55)",
            padding: (element.padding ?? element.style?.padding ?? 0) * scale,
            overflow: "hidden",
          }}
        >
          {isLegacySection ? (
            <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
              Section
            </div>
          ) : null}
          <EditorGuideBounds kind={element.kind} show={showGuides} />
        </div>
      );
    }

    if (element.kind === "group") {
      return null;
    }

    if (element.kind === "icon") {
      const Heroicon = getHeroiconComponent(element.iconName);
      if (Heroicon) {
        return (
          <div
            style={{
              ...style,
              color: element.style?.tint ?? element.style?.color ?? "#0f172a",
            }}
          >
            <Heroicon style={{ width: "100%", height: "100%", display: "block" }} />
          </div>
        );
      }

      if (element.svgContent) {
        return (
          <div
            style={{
              ...style,
              color: element.style?.tint ?? element.style?.color ?? "#0f172a",
            }}
            dangerouslySetInnerHTML={{ __html: element.svgContent }}
          />
        );
      }
    }

    if (element.kind === "table") {
      const cellWidth = element.width / Math.max(element.columns, 1);
      const cellHeight = element.height / Math.max(element.rows, 1);
      return (
        <div
          style={{
            ...style,
            display: "grid",
            gridTemplateColumns: `repeat(${element.columns}, 1fr)`,
            gridTemplateRows: `repeat(${element.rows}, 1fr)`,
            border: buildBorder(element.style, scale) ?? "1px solid rgba(148,163,184,0.6)",
            background: element.style?.fill ?? "rgba(255,255,255,0.9)",
          }}
        >
          {Array.from({ length: element.columns * element.rows }).map((_, index) => {
            const cell = element.cells[index];
            return (
              <div
                key={cell?.cellId ?? index}
                style={{
                  borderRight:
                    index % element.columns === element.columns - 1
                      ? undefined
                      : "1px solid rgba(148,163,184,0.4)",
                  borderBottom:
                    index >= element.columns * (element.rows - 1)
                      ? undefined
                      : "1px solid rgba(148,163,184,0.4)",
                  width: cellWidth * scale,
                  height: cellHeight * scale,
                  padding: 8 * scale,
                  ...buildTextStyle(cell?.style as ElementStyle | undefined, scale),
                }}
              >
                {cell?.text}
              </div>
            );
          })}
        </div>
      );
    }

    const svg = element.svgContent ?? "";
    return (
      <div
        style={{
          ...style,
          color: element.style?.tint ?? element.style?.color ?? "#0f172a",
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  },
  (prev, next) =>
    prev.element === next.element &&
    prev.scale === next.scale &&
    prev.showGuides === next.showGuides,
);
