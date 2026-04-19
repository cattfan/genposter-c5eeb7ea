// Reports: partners summary, partners detailed CSV, manifests

import type { Entity, GenerationJob, PageTemplate, RenderManifest } from "@/models";

export function buildRenderManifest(job: GenerationJob): RenderManifest {
  return {
    jobId: job.jobId,
    generatedAt: job.createdAt,
    pages: job.pages.map((p) => ({
      pageFile: p.pageFile,
      pageTemplateId: p.pageTemplateId,
      selected: p.selected,
      items: p.items,
      warnings: p.warnings,
    })),
  };
}

export function buildFinalManifest(job: GenerationJob): RenderManifest {
  return {
    jobId: job.jobId,
    generatedAt: job.createdAt,
    pages: job.pages
      .filter((p) => p.selected)
      .map((p) => ({
        pageFile: p.pageFile,
        pageTemplateId: p.pageTemplateId,
        selected: true,
        items: p.items,
        warnings: p.warnings,
      })),
  };
}

export function buildPartnersSummaryTxt(
  job: GenerationJob,
  entities: Entity[],
  finalOnly = true,
): string {
  const pages = finalOnly ? job.pages.filter((p) => p.selected) : job.pages;
  const nameMap = new Map(entities.map((e) => [e.entityId, e]));
  const occurMap = new Map<string, { entity: Entity; pages: string[] }>();
  for (const p of pages) {
    for (const it of p.items) {
      if (!it.entityId) continue;
      const ent = nameMap.get(it.entityId);
      if (!ent || !ent.partnerFlag) continue;
      const cur = occurMap.get(it.entityId) ?? { entity: ent, pages: [] };
      if (!cur.pages.includes(p.pageFile)) cur.pages.push(p.pageFile);
      occurMap.set(it.entityId, cur);
    }
  }
  const lines: string[] = [];
  lines.push(`# Báo cáo đối tác - ${job.packTemplateName}`);
  lines.push(`Job: ${job.jobId}`);
  lines.push(`Loại báo cáo: ${finalOnly ? "FINAL EXPORT" : "PREVIEW"}`);
  lines.push(`Tổng số đối tác xuất hiện: ${occurMap.size}`);
  lines.push("");
  for (const { entity, pages } of occurMap.values()) {
    lines.push(`- ${entity.name} (priority ${entity.partnerPriority}) → ${pages.length} page`);
    pages.forEach((pf) => lines.push(`    • ${pf}`));
  }
  return lines.join("\n");
}

export function buildPartnersDetailedCsv(
  job: GenerationJob,
  entities: Entity[],
  pageTemplates: PageTemplate[],
): string {
  const tplMap = new Map(pageTemplates.map((p) => [p.pageTemplateId, p]));
  const entMap = new Map(entities.map((e) => [e.entityId, e]));
  const headers = [
    "job_id",
    "page_file",
    "page_template_id",
    "page_template_name",
    "section_id",
    "slot_id",
    "entity_id",
    "entity_name",
    "partner_flag",
    "partner_priority",
    "asset_id",
    "selected_for_export",
    "rendered_at",
  ];
  const rows: string[][] = [headers];
  for (const p of job.pages) {
    for (const it of p.items) {
      const ent = it.entityId ? entMap.get(it.entityId) : undefined;
      rows.push([
        job.jobId,
        p.pageFile,
        p.pageTemplateId,
        tplMap.get(p.pageTemplateId)?.name ?? "",
        it.sectionId ?? "",
        it.slotId ?? "",
        it.entityId ?? "",
        ent?.name ?? "",
        String(ent?.partnerFlag ?? ""),
        String(ent?.partnerPriority ?? ""),
        it.assetId ?? "",
        String(p.selected),
        new Date(p.renderedAt).toISOString(),
      ]);
    }
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
