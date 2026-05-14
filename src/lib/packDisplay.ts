import type { Entity, GenerationJob, PackTemplate, PageTemplate, RenderedPage } from "@/models";
import { slugify } from "@/engines/selection/generate";
import { formatTemplateDisplayName } from "@/lib/templateNames";

export interface BundlePageMeta {
  page: RenderedPage;
  pageTemplate?: PageTemplate;
  bundleIndex: number;
  bundleLabel: string;
  pageOrderInBundle: number;
  displayPageName: string;
  hasPartnerExposure: boolean;
  partnerEntityIds: string[];
}

export interface BundleGroup {
  bundleIndex: number;
  bundleLabel: string;
  pages: BundlePageMeta[];
}

function getBundleIndex(pageIndex: number, bundleSize: number, totalPages: number): number {
  if (bundleSize <= 0) return 1;
  if (totalPages <= bundleSize) return 1;
  return Math.floor(pageIndex / bundleSize) + 1;
}

export function buildBundlePageMeta(
  job: GenerationJob,
  pack: PackTemplate,
  pageTemplates: PageTemplate[],
  entities: Entity[],
): BundlePageMeta[] {
  const templateMap = new Map(pageTemplates.map((template) => [template.pageTemplateId, template]));
  const entityMap = new Map(entities.map((entity) => [entity.entityId, entity]));
  const bundleSize = Math.max(1, pack.orderedPages.length);

  return job.pages.map((page, index) => {
    const pageTemplate = page.workingTemplate ?? templateMap.get(page.pageTemplateId);
    const bundleIndex = getBundleIndex(index, bundleSize, job.pages.length);
    const bundleLabel = `Bộ ${bundleIndex}`;
    const pageOrderInBundle = index % bundleSize;
    const ownerEntity = page.entityId ? entityMap.get(page.entityId) : undefined;
    const partnerEntityIds =
      ownerEntity?.partnerFlag && page.entityId
        ? [page.entityId]
        : [];

    return {
      page,
      pageTemplate,
      bundleIndex,
      bundleLabel,
      pageOrderInBundle,
      displayPageName: `${slugify(formatTemplateDisplayName(pack.name, "bo-khuon"))}-${slugify(formatTemplateDisplayName(pageTemplate?.name ?? page.pageTemplateId, "trang"))}-bo${bundleIndex}.png`,
      hasPartnerExposure: partnerEntityIds.length > 0,
      partnerEntityIds,
    };
  });
}

export function buildBundleGroups(
  job: GenerationJob,
  pack: PackTemplate,
  pageTemplates: PageTemplate[],
  entities: Entity[],
): BundleGroup[] {
  const pages = buildBundlePageMeta(job, pack, pageTemplates, entities);
  const groups = new Map<number, BundleGroup>();

  for (const page of pages) {
    const group = groups.get(page.bundleIndex) ?? {
      bundleIndex: page.bundleIndex,
      bundleLabel: page.bundleLabel,
      pages: [],
    };
    group.pages.push(page);
    groups.set(page.bundleIndex, group);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    pages: group.pages
      .slice()
      .sort(
        (a, b) => a.pageOrderInBundle - b.pageOrderInBundle || a.page.pageIndex - b.page.pageIndex,
      ),
  }));
}
