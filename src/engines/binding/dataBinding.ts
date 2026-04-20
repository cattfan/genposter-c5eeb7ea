// Resolver cho click-to-bind: lấy giá trị thực từ entity/asset theo bindingPath
import type { Asset, AssetRole, Entity, Slot } from "@/models";

export interface BindingFieldOption {
  value: string;
  label: string;
  group: "Cố định" | "Entity" | "Asset";
}

export const TEXT_BINDING_OPTIONS: BindingFieldOption[] = [
  { value: "", label: "Cố định (nội dung tĩnh)", group: "Cố định" },
  { value: "entity.name", label: "Tên (entity.name)", group: "Entity" },
  { value: "entity.address", label: "Địa chỉ (entity.address)", group: "Entity" },
  { value: "entity.phone", label: "Số điện thoại (entity.phone)", group: "Entity" },
  { value: "entity.priceRange", label: "Giá (entity.priceRange)", group: "Entity" },
  { value: "entity.style", label: "Phong cách (entity.style)", group: "Entity" },
  { value: "entity.openingHours", label: "Giờ mở cửa (entity.openingHours)", group: "Entity" },
  { value: "entity.categoryMain", label: "Mô hình / Bữa ăn (Mo_hinh)", group: "Entity" },
  { value: "entity.categorySub", label: "Phong cách (Phong_cach)", group: "Entity" },
  { value: "entity.signatureDish", label: "Món ăn nổi bật (Mon_an_noi_bat)", group: "Entity" },
];

export const IMAGE_BINDING_OPTIONS: BindingFieldOption[] = [
  { value: "", label: "Cố định (URL/upload)", group: "Cố định" },
  { value: "asset.cover", label: "Ảnh chính của entity (cover)", group: "Asset" },
  { value: "asset.byRole:facade", label: "Ảnh role: facade", group: "Asset" },
  { value: "asset.byRole:food_closeup", label: "Ảnh role: food_closeup", group: "Asset" },
  { value: "asset.byRole:space", label: "Ảnh role: space", group: "Asset" },
  { value: "asset.byRole:portrait", label: "Ảnh role: portrait", group: "Asset" },
  { value: "asset.byRole:square_thumb", label: "Ảnh role: square_thumb", group: "Asset" },
  { value: "asset.byRole:section_image", label: "Ảnh role: section_image", group: "Asset" },
];

function toDisplayText(value: unknown, fallback: string | undefined): string {
  if (value == null) return fallback ?? "";
  const text = String(value).trim();
  return text || (fallback ?? "");
}

export function resolveTextBinding(
  bindingPath: string | undefined,
  entity: Entity | undefined,
  fallback: string | undefined,
): string {
  if (!bindingPath) return fallback ?? "";
  if (!entity) return `{{${bindingPath}}}`;
  if (bindingPath === "entity.signatureDish") {
    return toDisplayText(entity.metadata?.signatureDish, fallback);
  }
  // Cột raw từ sheet: entity.metadata.<key> (vd entity.metadata.Loai_dich_vu)
  if (bindingPath.startsWith("entity.metadata.")) {
    const key = bindingPath.slice("entity.metadata.".length);
    return toDisplayText(entity.metadata?.[key], fallback);
  }
  if (bindingPath.startsWith("entity.")) {
    const key = bindingPath.slice("entity.".length) as keyof Entity;
    return toDisplayText(entity[key], fallback);
  }
  return fallback ?? "";
}

export function resolveImageBinding(
  bindingPath: string | undefined,
  entity: Entity | undefined,
  assets: Asset[],
  fallback: string | undefined,
): { src?: string; assetId?: string; entityId?: string } {
  if (!bindingPath) return { src: fallback };
  if (!entity) return { src: fallback };
  const pool = assets.filter((a) => a.entityId === entity.entityId);
  if (bindingPath === "asset.cover") {
    const cover = pool.find((a) => a.isCover) ?? pool.find((a) => a.role === "cover") ?? pool[0];
    return cover ? { src: cover.sourceValue, assetId: cover.assetId, entityId: entity.entityId } : { src: fallback };
  }
  if (bindingPath.startsWith("asset.byRole:")) {
    const role = bindingPath.slice("asset.byRole:".length) as AssetRole;
    const found = pool.find((a) => a.role === role) ?? pool.find((a) => a.isCover) ?? pool[0];
    return found ? { src: found.sourceValue, assetId: found.assetId, entityId: entity.entityId } : { src: fallback };
  }
  return { src: fallback };
}

export function slotHasBinding(slot: Slot): boolean {
  return !!slot.bindingPath && slot.bindingPath.length > 0;
}

// CSS filter string từ SlotStyle
export function buildCssFilter(style: Slot["style"]): string | undefined {
  if (!style) return undefined;
  const parts: string[] = [];
  if (style.brightness != null && style.brightness !== 1) parts.push(`brightness(${style.brightness})`);
  if (style.contrast != null && style.contrast !== 1) parts.push(`contrast(${style.contrast})`);
  if (style.saturate != null && style.saturate !== 1) parts.push(`saturate(${style.saturate})`);
  if (style.blur) parts.push(`blur(${style.blur}px)`);
  if (style.hueRotate) parts.push(`hue-rotate(${style.hueRotate}deg)`);
  if (style.grayscale) parts.push(`grayscale(${style.grayscale})`);
  return parts.length ? parts.join(" ") : undefined;
}

export function buildBoxShadow(style: Slot["style"], scale = 1): string | undefined {
  if (!style?.shadowColor || (!style.shadowBlur && !style.shadowX && !style.shadowY)) return undefined;
  return `${(style.shadowX ?? 0) * scale}px ${(style.shadowY ?? 0) * scale}px ${(style.shadowBlur ?? 0) * scale}px ${style.shadowColor}`;
}

export function buildFlipTransform(style: Slot["style"]): string {
  const sx = style?.flipH ? -1 : 1;
  const sy = style?.flipV ? -1 : 1;
  if (sx === 1 && sy === 1) return "";
  return ` scale(${sx}, ${sy})`;
}

/** Build linear-gradient CSS từ style. Trả về undefined nếu không bật. */
export function buildGradient(style: Slot["style"]): string | undefined {
  if (!style?.gradientEnabled) return undefined;
  const from = style.gradientFrom ?? "#000000";
  const to = style.gradientTo ?? "#ffffff";
  const angle = style.gradientAngle ?? 90;
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

/** Build CSS border từ borderColor/Width/Style. */
export function buildBorder(style: Slot["style"], scale = 1): string | undefined {
  if (!style?.borderColor || !style.borderWidth) return undefined;
  return `${style.borderWidth * scale}px ${style.borderStyle ?? "solid"} ${style.borderColor}`;
}

/** Build CSS style chuẩn cho text — dùng chung 3 nơi (Editor/Bind/Render). */
export function buildTextStyle(style: Slot["style"] | undefined, scale = 1): React.CSSProperties {
  const s = style ?? {};
  const css: React.CSSProperties = {
    color: s.color ?? "#0f172a",
    fontFamily: s.fontFamily ? `'${s.fontFamily}', sans-serif` : "'Be Vietnam Pro', sans-serif",
    fontSize: (s.fontSize ?? 24) * scale,
    fontWeight: s.fontWeight ?? 500,
    fontStyle: s.fontStyle ?? "normal",
    textDecoration: s.textDecoration ?? "none",
    lineHeight: s.lineHeight ?? 1.2,
    letterSpacing: (s.letterSpacing ?? 0) * scale,
    textAlign: s.textAlign ?? "left",
    textTransform: s.textTransform ?? "none",
    textShadow: s.textShadow,
    padding: (s.padding ?? 0) * scale,
    background: s.background,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "hidden",
  };
  // Text stroke (webkit)
  if (s.textStrokeWidth && s.textStrokeColor) {
    (css as React.CSSProperties & { WebkitTextStroke?: string }).WebkitTextStroke =
      `${s.textStrokeWidth * scale}px ${s.textStrokeColor}`;
  } else if (s.textStroke) {
    (css as React.CSSProperties & { WebkitTextStroke?: string }).WebkitTextStroke = s.textStroke;
  }
  // Gradient text
  if (s.gradientEnabled && s.gradientFrom && s.gradientTo) {
    const grad = buildGradient(s)!;
    css.backgroundImage = grad;
    (css as React.CSSProperties & { WebkitBackgroundClip?: string }).WebkitBackgroundClip = "text";
    css.backgroundClip = "text";
    css.color = "transparent";
    (css as React.CSSProperties & { WebkitTextFillColor?: string }).WebkitTextFillColor = "transparent";
    css.background = undefined;
  }
  // Max lines (line clamp)
  if (s.maxLines && s.maxLines > 0) {
    css.display = "-webkit-box";
    (css as React.CSSProperties & { WebkitLineClamp?: number }).WebkitLineClamp = s.maxLines;
    (css as React.CSSProperties & { WebkitBoxOrient?: string }).WebkitBoxOrient = "vertical";
  }
  return css;
}

/** Clip-path CSS theo shapeKind, cho ảnh nằm trong shape. */
export function shapeClipPath(shapeKind: NonNullable<Slot["shapeKind"]>): string | undefined {
  if (shapeKind === "triangle") return "polygon(50% 0%, 100% 100%, 0% 100%)";
  return undefined;
}

/** Border radius CSS theo shapeKind (cho rectangle/circle/badge). */
export function shapeBorderRadius(
  shapeKind: NonNullable<Slot["shapeKind"]> | undefined,
  borderRadius: number | undefined,
  scale = 1,
): number | string | undefined {
  if (shapeKind === "circle") return "50%";
  if (shapeKind === "badge") return 9999;
  return (borderRadius ?? 0) * scale;
}
