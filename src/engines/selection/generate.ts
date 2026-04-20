// Generation: chạy pack template -> tạo các page rendered với items binding

import { nanoid } from "nanoid";
import type {
  Asset,
  Entity,
  GenerationJob,
  ManualOverride,
  PackTemplate,
  PageTemplate,
  RenderedItem,
  RenderedPage,
  Slot,
} from "@/models";
import { selectForSection } from "../selection/engine";
import { pickAssetForEntity } from "../binding/assetSafe";
import type { ScoreContext } from "../scoring/score";

export type PackBindMode = "section" | "one-entity-per-pack" | "one-entity-per-page";

export interface GenerateInput {
  pack: PackTemplate;
  pageTemplates: PageTemplate[];
  entities: Entity[];
  assets: Asset[];
  overrides?: ManualOverride[];
  /** Chế độ bind entity vào page. Mặc định "section" (luồng cũ). */
  mode?: PackBindMode;
  /** Pool entity đã filter sẵn (chỉ dùng cho 2 mode bind theo entity). */
  entityPool?: Entity[];
  /** Bind override per-page-template designer set trong UI. */
  bindOverrides?: Record<string, Record<string, string | undefined>>;
}

export function generatePackJob(input: GenerateInput): GenerationJob {
  const {
    pack,
    pageTemplates,
    entities,
    assets,
    overrides = [],
    mode = "section",
    entityPool = [],
    bindOverrides = {},
  } = input;

  // === Branch: bind theo entity (không section selection) ===
  if (mode === "one-entity-per-pack" || mode === "one-entity-per-page") {
    return generateEntityBindJob(pack, pageTemplates, entityPool, mode, bindOverrides);
  }

  const ctx: ScoreContext = {
    pageEntitiesUsed: new Set(),
    packEntitiesUsed: new Map(),
    packAssetsUsed: new Set(),
  };

  const pageMap = new Map(pageTemplates.map((p) => [p.pageTemplateId, p]));
  const renderedPages: RenderedPage[] = [];

  pack.orderedPages.forEach((pageId, idx) => {
    const tpl = pageMap.get(pageId);
    if (!tpl) return;

    ctx.pageEntitiesUsed.clear(); // reset cho mỗi page

    const items: RenderedItem[] = [];
    const warnings: string[] = [];

    // Xử lý sections trong page
    for (const section of tpl.sections) {
      const ov = overrides.find(
        (o) =>
          o.packTemplateId === pack.packTemplateId &&
          o.pageTemplateId === pageId &&
          o.sectionId === section.sectionId,
      );
      const result = selectForSection({
        section,
        entities,
        assets,
        preferredAssetRoles: ["cover", "facade", "food_closeup", "section_image"],
        pinEntityId: ov?.pinEntityId,
        excludeEntityIds: ov?.excludeEntityIds,
        pinAssetId: ov?.pinAssetId,
        excludeAssetIds: ov?.excludeAssetIds,
        ctx,
      });
      warnings.push(...result.warnings);
      result.items.forEach((it, i) => {
        items.push({
          sectionId: section.sectionId,
          sectionItemId: `${section.sectionId}-${i}`,
          entityId: it.entity.entityId,
          assetId: it.asset?.assetId,
          partnerFlag: it.entity.partnerFlag,
          partnerPriority: it.entity.partnerPriority,
          reasonCodes: it.reasons,
        });
      });
    }

    // Slots image bind (nếu có bindingPath kiểu entity standalone)
    // Đơn giản: nếu cover page và slot kind=image không có staticImage → chọn 1 entity ngẫu nhiên đẹp
    if (tpl.type === "cover") {
      const heroSlot = tpl.slots.find(
        (s) => s.kind === "image" && !s.staticImage && s.allowedAssetRoles?.length,
      );
      if (heroSlot) {
        const partnerEnt = entities.find((e) => e.partnerFlag) ?? entities[0];
        if (partnerEnt) {
          const { asset } = pickAssetForEntity(
            partnerEnt,
            assets,
            heroSlot.allowedAssetRoles,
            ctx,
          );
          if (asset) {
            items.push({
              slotId: heroSlot.slotId,
              entityId: partnerEnt.entityId,
              assetId: asset.assetId,
              partnerFlag: partnerEnt.partnerFlag,
              reasonCodes: ["cover_hero_pick"],
            });
            ctx.packAssetsUsed.add(asset.assetId);
          }
        }
      }
    }

    // Health score
    const healthScore = computeHealth(tpl, items, warnings);
    const state: RenderedPage["state"] =
      healthScore >= 80 ? "accepted" : healthScore >= 50 ? "needs_fix" : "rejected";

    renderedPages.push({
      pageIndex: idx,
      pageFile: `page-${idx + 1}-${slugify(tpl.name)}.png`,
      pageTemplateId: pageId,
      state,
      selected: state !== "rejected",
      healthScore,
      warnings,
      items,
      renderedAt: Date.now(),
    });
  });

  return {
    jobId: nanoid(),
    packTemplateId: pack.packTemplateId,
    packTemplateName: pack.name,
    createdAt: Date.now(),
    pages: renderedPages,
    status: "generated",
  };
}

function computeHealth(tpl: PageTemplate, items: RenderedItem[], warnings: string[]): number {
  let score = 100;
  // Trừ theo warning
  score -= warnings.length * 8;
  // Trừ nếu section thiếu item
  for (const section of tpl.sections) {
    const count = items.filter((i) => i.sectionId === section.sectionId).length;
    if (count < section.minItems) score -= 20;
  }
  // Trừ nếu thiếu asset cho item cần ảnh
  const missingAssets = items.filter(
    (i) => i.sectionItemId && !i.assetId,
  ).length;
  score -= missingAssets * 10;
  return Math.max(0, Math.min(100, score));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export { slugify };
