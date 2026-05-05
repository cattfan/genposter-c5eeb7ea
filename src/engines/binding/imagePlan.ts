// Plan ảnh cho cả 1 page: đảm bảo các block ảnh/shape không bị trùng asset.

import type { Asset, AssetRole, Entity, PageTemplate, Slot } from "@/models";
import { filterRenderableAssets, getAssetImageSource } from "./assetImage";
import {
  isAssetRandomScopeBindingPath,
  parseAssetRandomScopeBindingPath,
  type AssetRandomScopeConfig,
} from "./dataBinding";

export interface PlannedImage {
  src: string;
  assetId: string;
  entityId: string;
  fallback?: boolean;
}

export type SlotImagePlan = Map<string, PlannedImage>;

type ImagePlanSlot = Slot & { originalSlotId?: string };

function stableHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isImageBindingSlot(slot: Slot): boolean {
  return (
    (slot.kind === "image" || slot.kind === "shape") &&
    !!slot.bindingPath &&
    slot.bindingPath.startsWith("asset.")
  );
}

function pickBest(pool: Asset[]): Asset | undefined {
  if (pool.length === 0) return undefined;
  return pool.slice().sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];
}

function pickStableRandom(pool: Asset[], seed: string): Asset | undefined {
  if (pool.length === 0) return undefined;
  const ordered = pool.slice().sort((a, b) => a.assetId.localeCompare(b.assetId));
  return ordered[stableHash(seed) % ordered.length];
}

function normalizeScopeToken(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function entityScopeValues(entity: Entity | undefined, asset: Asset): string[] {
  const values = [
    asset.role,
    entity?.sheetName,
    entity?.categoryMain,
    entity?.categorySub,
    entity?.style,
  ];
  if (entity?.metadata) {
    for (const key of ["folder", "Folder", "Thu_muc", "Thư mục", "Nhom_anh", "Nhóm ảnh"]) {
      const value = entity.metadata[key];
      if (typeof value === "string" || typeof value === "number") values.push(String(value));
    }
  }
  return values.filter((value): value is string => !!value && value.trim().length > 0);
}

function fallbackAssetsForEntity(
  renderableAssets: Asset[],
  entityById: Map<string, Entity>,
  entity: Entity,
): Asset[] {
  const sameSheet = renderableAssets.filter((asset) => {
    const owner = entityById.get(asset.entityId);
    return !!entity.sheetName && owner?.sheetName === entity.sheetName;
  });
  if (sameSheet.length > 0) return sameSheet;

  const sameCategory = renderableAssets.filter((asset) => {
    const owner = entityById.get(asset.entityId);
    return (
      (!!entity.categoryMain && owner?.categoryMain === entity.categoryMain) ||
      (!!entity.categorySub && owner?.categorySub === entity.categorySub)
    );
  });
  return sameCategory.length > 0 ? sameCategory : renderableAssets;
}

function matchesAssetRandomScope(
  asset: Asset,
  entityById: Map<string, Entity>,
  config: AssetRandomScopeConfig,
): boolean {
  const owner = entityById.get(asset.entityId);
  if (config.sheetName && owner?.sheetName !== config.sheetName) return false;
  if (!config.folder) return true;
  const target = normalizeScopeToken(config.folder);
  return entityScopeValues(owner, asset).some((value) => normalizeScopeToken(value) === target);
}

function findLockedAsset(pool: Asset[], src: string | undefined): Asset | undefined {
  if (!src) return undefined;
  return pool.find(
    (asset) =>
      asset.sourceValue === src ||
      getAssetImageSource(asset) === src ||
      asset.blobKey === src ||
      asset.assetId === src,
  );
}

function buildImagePlanForSlots(
  slots: ImagePlanSlot[],
  resolveEntity: (slot: ImagePlanSlot) => Entity | undefined,
  assets: Asset[],
  seedNamespace = "",
  sourceEntities: Entity[] = [],
): SlotImagePlan {
  const plan: SlotImagePlan = new Map();
  const renderableAssets = filterRenderableAssets(assets);
  const entityById = new Map(sourceEntities.map((item) => [item.entityId, item]));
  const usedAssetIdsByEntity = new Map<string, Set<string>>();
  const usedGlobalAssetIds = new Set<string>();
  const seedPrefix = seedNamespace ? `${seedNamespace}:` : "";

  const bindableSlots = slots
    .filter(isImageBindingSlot)
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.slotId.localeCompare(b.slotId));

  for (const slot of bindableSlots) {
    const bindingPath = slot.bindingPath!;
    let chosen: Asset | undefined;
    let fallback = false;

    if (bindingPath === "asset.random_global") {
      const locked = findLockedAsset(renderableAssets, slot.staticImage);
      if (locked) {
        usedGlobalAssetIds.add(locked.assetId);
        plan.set(slot.slotId, {
          src: getAssetImageSource(locked) ?? locked.sourceValue,
          assetId: locked.assetId,
          entityId: locked.entityId,
          fallback: false,
        });
        continue;
      }

      const free = renderableAssets.filter((asset) => !usedGlobalAssetIds.has(asset.assetId));
      chosen = pickStableRandom(
        free.length > 0 ? free : renderableAssets,
        `${seedPrefix}global:${slot.originalSlotId ?? slot.slotId}`,
      );
      fallback = free.length === 0 && renderableAssets.length > 1;
      if (chosen) {
        usedGlobalAssetIds.add(chosen.assetId);
        plan.set(slot.slotId, {
          src: getAssetImageSource(chosen) ?? chosen.sourceValue,
          assetId: chosen.assetId,
          entityId: chosen.entityId,
          fallback,
        });
      }
      continue;
    }

    if (isAssetRandomScopeBindingPath(bindingPath)) {
      const config = parseAssetRandomScopeBindingPath(bindingPath) ?? {};
      const scopedAssets = renderableAssets.filter((asset) =>
        matchesAssetRandomScope(asset, entityById, config),
      );
      const pool = scopedAssets.length > 0 ? scopedAssets : renderableAssets;
      const free = pool.filter((asset) => !usedGlobalAssetIds.has(asset.assetId));
      chosen = pickStableRandom(
        free.length > 0 ? free : pool,
        `${seedPrefix}scope:${config.sheetName ?? "all"}:${config.folder ?? "all"}:${slot.originalSlotId ?? slot.slotId}`,
      );
      fallback = free.length === 0 && pool.length > 1;
      if (chosen) {
        usedGlobalAssetIds.add(chosen.assetId);
        plan.set(slot.slotId, {
          src: getAssetImageSource(chosen) ?? chosen.sourceValue,
          assetId: chosen.assetId,
          entityId: chosen.entityId,
          fallback,
        });
      }
      continue;
    }

    const entity = resolveEntity(slot);
    if (!entity) continue;

    const exactPool = renderableAssets.filter((asset) => asset.entityId === entity.entityId);
    const pool =
      exactPool.length > 0 ? exactPool : fallbackAssetsForEntity(renderableAssets, entityById, entity);
    if (pool.length === 0) continue;
    if (exactPool.length === 0) fallback = true;

    const usedAssetIds = usedAssetIdsByEntity.get(entity.entityId) ?? new Set<string>();
    usedAssetIdsByEntity.set(entity.entityId, usedAssetIds);

    if (bindingPath === "asset.random") {
      const locked = findLockedAsset(pool, slot.staticImage);
      if (locked) {
        chosen = locked;
      } else {
        const free = pool.filter((asset) => !usedAssetIds.has(asset.assetId));
        chosen = pickStableRandom(
          free.length > 0 ? free : pool,
          `${seedPrefix}${entity.entityId}:${slot.originalSlotId ?? slot.slotId}`,
        );
        fallback = free.length === 0 && pool.length > 1;
      }
    } else if (bindingPath === "asset.cover") {
      const cover =
        pool.find((asset) => asset.isCover) ?? pool.find((asset) => asset.role === "cover");
      if (cover && !usedAssetIds.has(cover.assetId)) {
        chosen = cover;
      } else {
        const free = pool.filter((asset) => !usedAssetIds.has(asset.assetId));
        chosen = pickBest(free);
        if (!chosen) {
          chosen = cover ?? pool[0];
          fallback = true;
        }
      }
    } else if (bindingPath.startsWith("asset.byRole:")) {
      const role = bindingPath.slice("asset.byRole:".length) as AssetRole;
      const sameRoleFree = pool.filter(
        (asset) => asset.role === role && !usedAssetIds.has(asset.assetId),
      );
      chosen = pickBest(sameRoleFree);
      if (!chosen) {
        const free = pool.filter((asset) => !usedAssetIds.has(asset.assetId));
        chosen = free.find((asset) => asset.isCover) ?? pickBest(free);
        if (chosen) fallback = true;
      }
      if (!chosen) {
        chosen =
          pool.find((asset) => asset.role === role) ??
          pool.find((asset) => asset.isCover) ??
          pool[0];
        fallback = true;
      }
    }

    if (chosen) {
      usedAssetIds.add(chosen.assetId);
        plan.set(slot.slotId, {
          src: getAssetImageSource(chosen) ?? chosen.sourceValue,
          assetId: chosen.assetId,
          entityId: chosen.entityId,
          fallback,
        });
    }
  }

  return plan;
}

export function buildSlotImagePlan(
  template: PageTemplate,
  entity: Entity | undefined,
  assets: Asset[],
): SlotImagePlan {
  if (!entity) return new Map();
  return buildImagePlanForSlots(template.slots, () => entity, assets, template.pageTemplateId);
}

export function buildExpandedSlotImagePlan(
  slots: ImagePlanSlot[],
  assets: Asset[],
  resolveEntity: (slot: ImagePlanSlot) => Entity | undefined,
  seedNamespace = "",
  sourceEntities: Entity[] = [],
): SlotImagePlan {
  return buildImagePlanForSlots(slots, resolveEntity, assets, seedNamespace, sourceEntities);
}
