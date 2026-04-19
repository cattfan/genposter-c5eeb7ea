// Asset-safe binding: chọn entity TRƯỚC, asset chỉ lấy từ pool thuộc entityId

import type { Asset, AssetRole, Entity } from "@/models";
import { scoreAsset, type ScoreContext } from "../scoring/score";

export interface BindResult {
  asset: Asset | null;
  reasons: string[];
}

export function pickAssetForEntity(
  entity: Entity,
  allAssets: Asset[],
  preferredRoles: AssetRole[] | undefined,
  ctx: ScoreContext,
): BindResult {
  // CRITICAL: chỉ lấy asset có đúng entityId
  const pool = allAssets.filter((a) => a.entityId === entity.entityId && a.status === "ok");
  if (pool.length === 0) {
    return { asset: null, reasons: ["excluded_missing_asset"] };
  }
  const ranked = pool
    .map((a) => ({ a, ...scoreAsset(a, preferredRoles, ctx) }))
    .sort((x, y) => y.score - x.score);
  const top = ranked[0];
  return {
    asset: top.a,
    reasons:
      top.score < 0
        ? ["fallback_asset_used", ...top.reasons]
        : top.reasons,
  };
}
