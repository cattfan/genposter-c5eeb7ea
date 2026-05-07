// Generation: chạy pack template -> tạo các page rendered với items binding

import { nanoid } from "nanoid";
import type {
  Asset,
  Entity,
  GeneratePageConfig,
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
import {
  allocateEntityBindingsForTemplate,
  buildEntityAllocationOrder,
} from "./entityBindAllocator";
import { buildEntityBindingTargets } from "../binding/cardRepeater";
import { parseEntityListBindingPath } from "../binding/dataBinding";

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
  partnerQuotaPerPage?: number;
  prioritizePartner?: boolean;
  onlyPartner?: boolean;
  maxEntities?: number;
  selectedSheet?: string;
  filterMoHinh?: string;
  filterPhongCach?: string;
  pageConfigs?: Record<string, GeneratePageConfig>;
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
    partnerQuotaPerPage = 0,
    prioritizePartner = true,
    onlyPartner = false,
    maxEntities,
    selectedSheet,
    filterMoHinh,
    filterPhongCach,
    pageConfigs = {},
  } = input;

  // === Branch: bind theo entity (không section selection) ===
  if (mode === "one-entity-per-pack" || mode === "one-entity-per-page") {
    return generateEntityBindJob(
      pack,
      pageTemplates,
      entityPool,
      mode,
      bindOverrides,
      partnerQuotaPerPage,
      prioritizePartner,
      onlyPartner,
      maxEntities,
      selectedSheet,
      filterMoHinh,
      filterPhongCach,
      pageConfigs,
    );
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
          const { asset } = pickAssetForEntity(partnerEnt, assets, heroSlot.allowedAssetRoles, ctx);
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

/**
 * Bind theo entity (không section selection, chỉ resolve text/image bindingPath ở renderer).
 * - one-entity-per-pack: mỗi entity sinh đủ pack (orderedPages.length pages)
 * - one-entity-per-page: round-robin entity vào từng page của 1 pack
 */
function generateEntityBindJob(
  pack: PackTemplate,
  pageTemplates: PageTemplate[],
  entityPool: Entity[],
  mode: "one-entity-per-pack" | "one-entity-per-page",
  bindOverrides: Record<string, Record<string, string | undefined>>,
  partnerQuotaPerPage: number,
  prioritizePartner: boolean,
  onlyPartner: boolean,
  maxEntities: number | undefined,
  selectedSheet: string | undefined,
  filterMoHinh: string | undefined,
  filterPhongCach: string | undefined,
  pageConfigs: Record<string, GeneratePageConfig>,
): GenerationJob {
  const pageMap = new Map(pageTemplates.map((p) => [p.pageTemplateId, p]));
  const renderedPages: RenderedPage[] = [];
  const orderedTpls = pack.orderedPages
    .map((id) => pageMap.get(id))
    .filter((t): t is PageTemplate => !!t);

  if (orderedTpls.length === 0 || entityPool.length === 0) {
    return {
      jobId: nanoid(),
      packTemplateId: pack.packTemplateId,
      packTemplateName: pack.name,
      createdAt: Date.now(),
      pages: [],
      status: "generated",
    };
  }

  const applyPageBindOverrides = (
    template: PageTemplate,
    overridesForPage: Record<string, string | undefined> | undefined,
  ): PageTemplate => {
    if (!overridesForPage || Object.keys(overridesForPage).length === 0) return template;
    return {
      ...template,
      slots: template.slots.map((slot) => {
        if (!(slot.slotId in overridesForPage)) return slot;
        const value = overridesForPage[slot.slotId];
        return { ...slot, bindingPath: value ? value : undefined };
      }),
    };
  };

  const resolvePageConfig = (templateId: string) => {
    const pageConfig = pageConfigs[templateId];
    const pageOnlyPartner = pageConfig?.onlyPartner ?? onlyPartner;
    return {
      selectedSheet: pageConfig?.selectedSheet ?? selectedSheet ?? "__all__",
      filterMoHinh: pageConfig?.filterMoHinh ?? filterMoHinh ?? "__all__",
      filterPhongCach: pageConfig?.filterPhongCach ?? filterPhongCach ?? "__all__",
      prioritizePartner: pageConfig?.prioritizePartner ?? prioritizePartner,
      onlyPartner: pageOnlyPartner,
      partnerQuotaPerPage: pageOnlyPartner
        ? Number.MAX_SAFE_INTEGER
        : (pageConfig?.partnerQuotaPerPage ?? partnerQuotaPerPage),
      maxEntities: Math.max(1, Math.floor(pageConfig?.maxEntities ?? maxEntities ?? entityPool.length)),
    };
  };

  const matchesPageSource = (entity: Entity, config: ReturnType<typeof resolvePageConfig>) => {
    if (config.selectedSheet !== "__all__" && entity.sheetName !== config.selectedSheet) {
      return false;
    }
    if (config.filterMoHinh !== "__all__" && entity.categoryMain !== config.filterMoHinh) {
      return false;
    }
    if (config.filterPhongCach !== "__all__" && entity.categorySub !== config.filterPhongCach) {
      return false;
    }
    return true;
  };

  const pageOrderCache = new Map<string, Entity[]>();
  const getPageEntityOrder = (templateId: string): Entity[] => {
    const cached = pageOrderCache.get(templateId);
    if (cached) return cached;
    const config = resolvePageConfig(templateId);
    const scopedEntityPool = entityPool.filter((entity) => matchesPageSource(entity, config));
    const source = config.onlyPartner
      ? scopedEntityPool.filter((entity) => entity.partnerFlag)
      : scopedEntityPool.slice();
    const ordered = buildEntityAllocationOrder(source, config.prioritizePartner).slice(
      0,
      config.maxEntities,
    );
    pageOrderCache.set(templateId, ordered);
    return ordered;
  };

  const templateDemands = new Map(
    orderedTpls.map((tpl) => {
      const pageEntityOrder = getPageEntityOrder(tpl.pageTemplateId);
      return [
        tpl.pageTemplateId,
        Math.max(
          1,
          computeTemplateEntityDemand(
            applyPageBindOverrides(tpl, bindOverrides[tpl.pageTemplateId]),
            pageEntityOrder,
          ),
        ),
      ] as const;
    }),
  );
  const packDemand = Math.max(
    1,
    orderedTpls.reduce((sum, tpl) => sum + (templateDemands.get(tpl.pageTemplateId) ?? 1), 0),
  );
  let pageIndex = 0;
  const pushPage = (
    tpl: PageTemplate,
    pageEntityPool: Entity[],
    perPackIdx: number,
    batchState: { usedEntityIds: Set<string> },
  ) => {
    const owner = pageEntityPool[0];
    if (!owner) return;
    const ov = bindOverrides[tpl.pageTemplateId];
    const effectiveTemplate = applyPageBindOverrides(tpl, ov);
    const targetCount = buildEntityBindingTargets(effectiveTemplate, pageEntityPool).length;
    const shouldPinOwner = mode === "one-entity-per-page" || targetCount <= 1;
    const allocation = allocateEntityBindingsForTemplate({
      template: effectiveTemplate,
      orderedEntities: pageEntityPool,
      pageOwner: shouldPinOwner ? owner : undefined,
      partnerQuota: resolvePageConfig(tpl.pageTemplateId).partnerQuotaPerPage,
      prioritizePartner: resolvePageConfig(tpl.pageTemplateId).prioritizePartner,
      batchState,
    });
    const slugEnt = slugify(owner.name);
    const healthScore = allocation.warnings.length > 0 ? 80 : 100;
    renderedPages.push({
      pageIndex,
      pageFile: `${slugEnt}-p${perPackIdx + 1}-${slugify(tpl.name)}.png`,
      pageTemplateId: tpl.pageTemplateId,
      state: allocation.warnings.length > 0 ? "needs_fix" : "accepted",
      selected: true,
      healthScore,
      warnings: allocation.warnings,
      items: allocation.items,
      renderedAt: Date.now(),
      entityId: owner.entityId,
      entityName: owner.name,
      entityPoolIds: pageEntityPool.map((entity) => entity.entityId),
      bindOverrides: ov,
    });
    pageIndex += 1;
  };

  if (mode === "one-entity-per-pack") {
    const maxPageEntityCount = Math.max(
      0,
      ...orderedTpls.map((tpl) => getPageEntityOrder(tpl.pageTemplateId).length),
    );
    const packCount = Math.max(1, Math.ceil(maxPageEntityCount / packDemand));
    for (let packIdx = 0; packIdx < packCount; packIdx += 1) {
      const batchState = { usedEntityIds: new Set<string>() };
      let packOffset = packIdx * packDemand;
      orderedTpls.forEach((tpl, i) => {
        const demand = templateDemands.get(tpl.pageTemplateId) ?? 1;
        const config = resolvePageConfig(tpl.pageTemplateId);
        const pageEntityPool = selectPageEntityPool(
          getPageEntityOrder(tpl.pageTemplateId),
          packOffset,
          demand,
          config.partnerQuotaPerPage,
          batchState.usedEntityIds,
        );
        pushPage(tpl, pageEntityPool, i, batchState);
        packOffset += demand;
      });
    }
  } else {
    const batchState = { usedEntityIds: new Set<string>() };
    let pageOffset = 0;
    orderedTpls.forEach((tpl, i) => {
      const demand = templateDemands.get(tpl.pageTemplateId) ?? 1;
      const config = resolvePageConfig(tpl.pageTemplateId);
      const pageEntityPool = selectPageEntityPool(
        getPageEntityOrder(tpl.pageTemplateId),
        pageOffset,
        demand,
        config.partnerQuotaPerPage,
        batchState.usedEntityIds,
      );
      pushPage(tpl, pageEntityPool, i, batchState);
      pageOffset += demand;
    });
  }

  return {
    jobId: nanoid(),
    packTemplateId: pack.packTemplateId,
    packTemplateName: pack.name,
    createdAt: Date.now(),
    pages: renderedPages,
    status: "generated",
  };
}

function computeTemplateEntityDemand(template: PageTemplate, entityPool: Entity[]): number {
  const directTargets = buildEntityBindingTargets(template, entityPool).length;
  const listTargets = template.slots.reduce((sum, slot) => {
    const config = parseEntityListBindingPath(slot.bindingPath);
    return sum + (config?.count ?? 0);
  }, 0);
  return directTargets + listTargets;
}

function rotateEntities(entities: Entity[], startIndex: number): Entity[] {
  if (entities.length === 0) return [];
  const offset = ((startIndex % entities.length) + entities.length) % entities.length;
  return [...entities.slice(offset), ...entities.slice(0, offset)];
}

function selectPageEntityPool(
  orderedEntities: Entity[],
  startIndex: number,
  demand: number,
  partnerQuotaPerPage: number,
  usedEntityIds?: Set<string>,
): Entity[] {
  if (orderedEntities.length === 0) return [];
  const required = Math.max(1, Math.min(orderedEntities.length, Math.floor(demand) || 1));
  const partnerQuota = Math.max(
    0,
    Math.min(
      required,
      Number.isFinite(partnerQuotaPerPage) ? Math.floor(partnerQuotaPerPage) : required,
    ),
  );
  const partnerEntities = orderedEntities.filter((entity) => entity.partnerFlag);
  const nonPartnerEntities = orderedEntities.filter((entity) => !entity.partnerFlag);
  const selected: Entity[] = [];
  const selectedIds = new Set<string>();

  const take = (candidates: Entity[], limit: number, unusedOnly: boolean) => {
    let taken = 0;
    for (const entity of rotateEntities(candidates, startIndex)) {
      if (selected.length >= required || limit <= 0) break;
      if (selectedIds.has(entity.entityId)) continue;
      if (unusedOnly && usedEntityIds?.has(entity.entityId)) continue;
      selected.push(entity);
      selectedIds.add(entity.entityId);
      limit -= 1;
      taken += 1;
    }
    return taken;
  };

  const partnerTaken = partnerQuota > 0 ? take(partnerEntities, partnerQuota, true) : 0;
  if (partnerQuota > 0) {
    take(nonPartnerEntities, required - selected.length, true);
  } else {
    take(orderedEntities, required - selected.length, true);
  }
  take(orderedEntities, required - selected.length, true);

  if (selected.length < required && partnerQuota > partnerTaken) {
    take(partnerEntities, partnerQuota - partnerTaken, false);
  }
  if (partnerQuota > 0) {
    take(nonPartnerEntities, required - selected.length, false);
  }
  take(orderedEntities, required - selected.length, false);
  return selected;
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
  const missingAssets = items.filter((i) => i.sectionItemId && !i.assetId).length;
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
