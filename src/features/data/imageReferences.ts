import type { Asset, Entity } from "@/models";

function normalizeReferenceKey(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function valueParts(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(valueParts);
  if (typeof value === "object") return Object.values(value).flatMap(valueParts);

  return String(value)
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function looksLikeDriveReference(value: string) {
  const trimmed = value.trim();
  return (
    /drive\.google\.com|docs\.google\.com\/uc|googleusercontent\.com/i.test(trimmed) ||
    /^[a-zA-Z0-9_-]{20,}$/.test(trimmed)
  );
}

export function looksLikeDirectImageReference(value: string) {
  const trimmed = value.trim();
  return /^(https?:\/\/|\/|\.\/|\.\.\/).+\.(png|jpe?g|webp|gif|bmp|avif)([?#].*)?$/i.test(
    trimmed,
  );
}

export function looksLikeImageReference(value: string) {
  return looksLikeDriveReference(value) || looksLikeDirectImageReference(value);
}

function isImageReferenceKey(key: string) {
  const normalized = normalizeReferenceKey(key);
  if (!normalized) return false;
  if (["image_ref", "imageref", "image", "images", "img", "photo"].includes(normalized)) {
    return true;
  }

  return /(^|_)(anh|hinh|image|img|photo|drive|folder)($|_)/.test(normalized);
}

export function getEntityImageReferences(entity: Entity): string[] {
  const references = new Set<string>();

  for (const [key, value] of Object.entries(entity.metadata ?? {})) {
    const imageKey = isImageReferenceKey(key);
    for (const part of valueParts(value)) {
      if (imageKey || looksLikeImageReference(part)) references.add(part);
    }
  }

  return [...references];
}

export function entityHasImageReference(entity: Entity) {
  return getEntityImageReferences(entity).length > 0;
}

export function isUsableImageAsset(asset: Asset | undefined): asset is Asset {
  if (!asset) return false;
  if (asset.status === "missing" || asset.status === "broken") return false;
  const source = (asset.blobKey ? `idb://${asset.blobKey}` : asset.sourceValue)?.trim();
  if (!source) return false;
  if (
    asset.blobKey ||
    source.startsWith("idb://") ||
    source.startsWith("blob:") ||
    source.startsWith("data:image/")
  ) {
    return true;
  }
  if (/drive\.google\.com|docs\.google\.com/i.test(source)) return false;
  return looksLikeDirectImageReference(source) || /googleusercontent\.com|cloudinary|imgur/i.test(source);
}

export function isImageReferenceAsset(asset: Asset | undefined): asset is Asset {
  if (!asset?.sourceValue || isUsableImageAsset(asset)) return false;
  return looksLikeImageReference(asset.sourceValue);
}

export function getEntityImageReferencesWithAssets(entity: Entity, assets: Asset[]): string[] {
  const references = new Set(getEntityImageReferences(entity));
  for (const asset of assets) {
    if (asset.entityId !== entity.entityId || !isImageReferenceAsset(asset)) continue;
    references.add(asset.sourceValue.trim());
  }
  return [...references];
}

export function getAssetEntityIds(assets: Asset[]) {
  return new Set(assets.filter(isUsableImageAsset).map((asset) => asset.entityId));
}

export function entityHasUsableImageAsset(entity: Entity, assetEntityIds: Set<string>) {
  return assetEntityIds.has(entity.entityId);
}

export function entityHasImageSource(entity: Entity, assetEntityIds: Set<string>) {
  return entityHasUsableImageAsset(entity, assetEntityIds) || entityHasImageReference(entity);
}
