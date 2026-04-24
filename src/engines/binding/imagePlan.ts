// Plan ảnh cho cả 1 page: đảm bảo các block ảnh/shape không bị trùng asset.

import type { Asset, AssetRole, Entity, PageTemplate, Slot } from "@/models";

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

function findLockedAsset(pool: Asset[], src: string | undefined): Asset | undefined {
  if (!src) return undefined;
  return pool.find((asset) => asset.sourceValue === src || asset.assetId === src);
}

function buildImagePlanForSlots(
  slots: ImagePlanSlot[],
  resolveEntity: (slot: ImagePlanSlot) => Entity | undefined,
  assets: Asset[],
  seedNamespace = "",
): SlotImagePlan {
  const plan: SlotImagePlan = new Map();
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
      const locked = findLockedAsset(assets, slot.staticImage);
      if (locked) {
        usedGlobalAssetIds.add(locked.assetId);
        plan.set(slot.slotId, {
          src: locked.sourceValue,
          assetId: locked.assetId,
          entityId: locked.entityId,
          fallback: false,
        });
        continue;
      }

      const free = assets.filter((asset) => !usedGlobalAssetIds.has(asset.assetId));
      chosen = pickStableRandom(
        free.length > 0 ? free : assets,
        `${seedPrefix}global:${slot.originalSlotId ?? slot.slotId}`,
      );
      fallback = free.length === 0 && assets.length > 1;
      if (chosen) {
        usedGlobalAssetIds.add(chosen.assetId);
        plan.set(slot.slotId, {
          src: chosen.sourceValue,
          assetId: chosen.assetId,
          entityId: chosen.entityId,
          fallback,
        });
      }
      continue;
    }

    const entity = resolveEntity(slot);
    if (!entity) continue;

    const pool = assets.filter((asset) => asset.entityId === entity.entityId);
    if (pool.length === 0) continue;

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
      const cover = pool.find((asset) => asset.isCover) ?? pool.find((asset) => asset.role === "cover");
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
        chosen = pool.find((asset) => asset.role === role) ?? pool.find((asset) => asset.isCover) ?? pool[0];
        fallback = true;
      }
    }

    if (chosen) {
      usedAssetIds.add(chosen.assetId);
      plan.set(slot.slotId, {
        src: chosen.sourceValue,
        assetId: chosen.assetId,
        entityId: entity.entityId,
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
): SlotImagePlan {
  return buildImagePlanForSlots(slots, resolveEntity, assets, seedNamespace);
}
