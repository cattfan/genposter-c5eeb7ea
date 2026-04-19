import type { Asset, Entity } from "@/models";

export interface ScoreContext {
  pageIntent?: string;
  sectionCategoryQuery?: string;
  pageEntitiesUsed: Set<string>; // entityId đã dùng trong page hiện tại
  packEntitiesUsed: Map<string, number>; // entityId -> số lần xuất hiện trong pack
  packAssetsUsed: Set<string>;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function scoreEntity(entity: Entity, ctx: ScoreContext): ScoreResult {
  let score = 50;
  const reasons: string[] = [];

  // Partner boost
  if (entity.partnerFlag) {
    const boost = 20 + entity.partnerPriority * 0.3;
    score += boost;
    reasons.push(`boosted_partner_priority(+${boost.toFixed(0)})`);
  }

  // Category match
  if (ctx.sectionCategoryQuery && entity.categoryMain) {
    const cats = ctx.sectionCategoryQuery.split(",").map((s) => s.trim());
    if (cats.includes(entity.categoryMain)) {
      score += 30;
      reasons.push("category_match");
    } else {
      score -= 50;
      reasons.push("excluded_wrong_category");
    }
  }

  // Subcategory bonus
  if (ctx.sectionCategoryQuery && entity.categorySub) {
    const cats = ctx.sectionCategoryQuery.split(",").map((s) => s.trim());
    if (cats.includes(entity.categorySub)) {
      score += 10;
      reasons.push("subcategory_match");
    }
  }

  // Anti-repeat in page
  if (ctx.pageEntitiesUsed.has(entity.entityId)) {
    score -= 200;
    reasons.push("excluded_duplicate_in_page");
  }

  // Anti-repeat in pack (soft)
  const usedInPack = ctx.packEntitiesUsed.get(entity.entityId) ?? 0;
  if (usedInPack > 0) {
    const penalty = usedInPack * 15;
    score -= penalty;
    reasons.push(`downgraded_duplicate_entity(-${penalty})`);
  }

  return { score, reasons };
}

export function scoreAsset(
  asset: Asset,
  preferredRoles: string[] | undefined,
  ctx: ScoreContext,
): ScoreResult {
  let score = asset.qualityScore;
  const reasons: string[] = [];

  if (preferredRoles && preferredRoles.length > 0) {
    if (preferredRoles.includes(asset.role)) {
      score += 30;
      reasons.push(`asset_role_match(${asset.role})`);
    } else {
      score -= 20;
      reasons.push(`asset_role_mismatch(${asset.role})`);
    }
  }

  if (asset.isCover) {
    score += 10;
    reasons.push("asset_is_cover");
  }

  if (ctx.packAssetsUsed.has(asset.assetId)) {
    score -= 25;
    reasons.push("asset_repeat_penalty");
  }

  if (asset.status !== "ok") {
    score -= 100;
    reasons.push(`asset_status_${asset.status}`);
  }

  return { score, reasons };
}
