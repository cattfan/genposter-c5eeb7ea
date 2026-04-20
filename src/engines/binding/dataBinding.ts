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

export function resolveTextBinding(
  bindingPath: string | undefined,
  entity: Entity | undefined,
  fallback: string | undefined,
): string {
  if (!bindingPath) return fallback ?? "";
  if (!entity) return `{{${bindingPath}}}`;
  if (bindingPath === "entity.signatureDish") {
    const v = (entity.metadata?.signatureDish as string | undefined) ?? "";
    return v || (fallback ?? "");
  }
  if (bindingPath.startsWith("entity.")) {
    const key = bindingPath.slice("entity.".length) as keyof Entity;
    const v = entity[key];
    if (v == null || v === "") return fallback ?? "";
    return String(v);
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
