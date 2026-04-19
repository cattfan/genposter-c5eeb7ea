// PartnerAwareSelectionEngine (priorityShuffleV2)

import type { Asset, AssetRole, Entity, PartnerMode, Section } from "@/models";
import { scoreEntity, type ScoreContext } from "../scoring/score";
import { pickAssetForEntity } from "../binding/assetSafe";

export interface SelectionRequest {
  section: Section;
  entities: Entity[];
  assets: Asset[];
  preferredAssetRoles?: AssetRole[];
  pinEntityId?: string;
  excludeEntityIds?: string[];
  pinAssetId?: string;
  excludeAssetIds?: string[];
  ctx: ScoreContext;
}

export interface SelectionItem {
  entity: Entity;
  asset: Asset | null;
  reasons: string[];
  score: number;
}

export interface SelectionResult {
  items: SelectionItem[];
  warnings: string[];
}

export function selectForSection(req: SelectionRequest): SelectionResult {
  const {
    section,
    entities,
    assets,
    preferredAssetRoles,
    pinEntityId,
    excludeEntityIds,
    excludeAssetIds,
    ctx,
  } = req;

  const warnings: string[] = [];
  const exclude = new Set(excludeEntityIds ?? []);

  // 1. Filter theo section
  const cats = section.categoryQuery?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  let pool = entities.filter((e) => {
    if (e.status !== "active") return false;
    if (exclude.has(e.entityId)) return false;
    if (cats.length > 0 && e.categoryMain && !cats.includes(e.categoryMain)) return false;
    return true;
  });

  // 2. Score
  const ranked = pool
    .map((e) => ({ entity: e, ...scoreEntity(e, { ...ctx, sectionCategoryQuery: section.categoryQuery }) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // 3. Áp partner mode
  const mode: PartnerMode = section.partnerMode;
  let ordered = applyPartnerMode(ranked, mode, section.maxItems);

  // 4. Pin
  if (pinEntityId) {
    const pinned = entities.find((e) => e.entityId === pinEntityId);
    if (pinned) {
      ordered = [
        { entity: pinned, score: 999, reasons: ["pinned_by_user"] },
        ...ordered.filter((r) => r.entity.entityId !== pinEntityId),
      ];
    }
  }

  // 5. Lấy max items
  const taken = ordered.slice(0, section.maxItems);

  // 6. Bind asset (asset-safe)
  const items: SelectionItem[] = [];
  const assetExclude = new Set(excludeAssetIds ?? []);
  for (const r of taken) {
    const filteredAssets = assets.filter((a) => !assetExclude.has(a.assetId));
    const bind = pickAssetForEntity(r.entity, filteredAssets, preferredAssetRoles, ctx);
    if (!bind.asset && section.imageMode === "anchor_entity") {
      warnings.push(`Section "${section.title}": ${r.entity.name} không có ảnh phù hợp`);
    }
    items.push({
      entity: r.entity,
      asset: bind.asset,
      reasons: [...r.reasons, ...bind.reasons],
      score: r.score,
    });
    ctx.pageEntitiesUsed.add(r.entity.entityId);
    ctx.packEntitiesUsed.set(
      r.entity.entityId,
      (ctx.packEntitiesUsed.get(r.entity.entityId) ?? 0) + 1,
    );
    if (bind.asset) ctx.packAssetsUsed.add(bind.asset.assetId);
  }

  if (items.length < section.minItems) {
    warnings.push(
      `Section "${section.title}": chỉ chọn được ${items.length}/${section.minItems} item tối thiểu`,
    );
  }

  return { items, warnings };
}

function applyPartnerMode<T extends { entity: Entity; score: number; reasons: string[] }>(
  ranked: T[],
  mode: PartnerMode,
  maxItems: number,
): T[] {
  const partners = ranked.filter((r) => r.entity.partnerFlag);
  const others = ranked.filter((r) => !r.entity.partnerFlag);
  switch (mode) {
    case "strict_partner":
      return [...partners, ...others];
    case "priority_partner":
      return [...partners, ...others];
    case "balanced_partner": {
      // Đan xen: tối đa 60% partner
      const maxPartner = Math.ceil(maxItems * 0.6);
      const taken: T[] = [];
      let pIdx = 0;
      let oIdx = 0;
      while (taken.length < maxItems && (pIdx < partners.length || oIdx < others.length)) {
        const partnerCount = taken.filter((t) => t.entity.partnerFlag).length;
        if (pIdx < partners.length && partnerCount < maxPartner) {
          taken.push(partners[pIdx++]);
        } else if (oIdx < others.length) {
          taken.push(others[oIdx++]);
        } else if (pIdx < partners.length) {
          taken.push(partners[pIdx++]);
        }
      }
      return taken;
    }
  }
}
