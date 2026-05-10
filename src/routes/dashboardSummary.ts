import type { Asset, Entity, Job, PackTemplate, PageTemplate } from "@/models";
import { getEntityImageReferencesWithAssets, getImageReferenceEntityIds, isUsableImageAsset } from "@/features/data/imageReferences";

export interface DashboardIssue {
  label: string;
  detail: string;
  to: string;
  search?: { tab: "images" };
  tone: "good" | "warning" | "danger" | "neutral";
}

export interface DashboardSummaryInput {
  packTemplates: PackTemplate[];
  pageTemplates: PageTemplate[];
  entities: Entity[];
  assets: Asset[];
  jobs: Job[];
  blobCount: number;
  presetCount: number;
  analysisCount: number;
  aiConfigured: boolean;
}

export function buildDashboardSummary(input: DashboardSummaryInput) {
  const { packTemplates, pageTemplates, entities, assets, jobs, blobCount, presetCount, analysisCount, aiConfigured } = input;

  const sheetNames = Array.from(
    new Set(entities.map((entity) => entity.sheetName).filter((sheetName): sheetName is string => Boolean(sheetName))),
  );
  const activeEntities = entities.filter((entity) => entity.status === "active").length;
  const partnerEntities = entities.filter((entity) => entity.partnerFlag).length;
  const usableAssets = assets.filter(isUsableImageAsset);
  const localAssets = usableAssets.filter((asset) => asset.blobKey).length;
  const linkAssets = usableAssets.filter((asset) => !asset.blobKey && asset.sourceValue).length;
  const brokenAssets = assets.filter((asset) => asset.status === "broken").length;
  const missingAssets = assets.filter((asset) => asset.status === "missing" || !asset.sourceValue).length;
  const assetEntityIds = new Set(usableAssets.map((asset) => asset.entityId).filter(Boolean));
  const assetsByEntityId = new Map<string, Asset[]>();
  for (const asset of assets) {
    const group = assetsByEntityId.get(asset.entityId) ?? [];
    group.push(asset);
    assetsByEntityId.set(asset.entityId, group);
  }
  const imageReferenceEntityIds = getImageReferenceEntityIds(entities, assets);
  const entitiesWithoutAssets = entities.filter((entity) => !assetEntityIds.has(entity.entityId)).length;
  const entitiesWithReferenceOnly = entities.filter(
    (entity) => !assetEntityIds.has(entity.entityId) && imageReferenceEntityIds.has(entity.entityId),
  ).length;
  const entitiesWithoutAnyImageSource = entities.filter(
    (entity) => !assetEntityIds.has(entity.entityId) && !imageReferenceEntityIds.has(entity.entityId),
  ).length;
  const driveDownloadCandidateCount = entities.filter(
    (entity) =>
      !assetEntityIds.has(entity.entityId) &&
      getEntityImageReferencesWithAssets(entity, assetsByEntityId.get(entity.entityId) ?? []).length > 0,
  ).length;
  const latestJob = jobs[0] ?? null;
  const renderedPages = jobs.reduce((sum, job) => sum + job.pages.length, 0);
  const exportedJobs = jobs.filter((job) => job.status === "exported").length;
  const latestJobWarnings = latestJob?.pages.reduce((sum, page) => sum + page.warnings.length, 0) ?? 0;
  const totalSlots = pageTemplates.reduce((sum, template) => sum + template.slots.length, 0);
  const mappedSlots = pageTemplates.reduce(
    (sum, template) =>
      sum +
      template.slots.filter(
        (slot) => Boolean(slot.bindingPath) || slot.fieldParts?.some((part) => part.kind === "field" && part.bindingPath),
      ).length,
    0,
  );

  const issues: DashboardIssue[] = [];
  if (entities.length === 0) {
    issues.push({
      label: "Chưa có dữ liệu",
      detail: "Nhập XLSX/CSV hoặc Google Sheet trước khi tạo nội dung.",
      to: "/data",
      tone: "danger",
    });
  }
  if (packTemplates.length === 0 || pageTemplates.length === 0) {
    issues.push({
      label: "Chưa có khuôn mẫu",
      detail: "Cần bộ khuôn và trang khuôn để tạo nội dung.",
      to: "/templates",
      tone: "danger",
    });
  }
  if (assets.length === 0) {
    issues.push({
      label: driveDownloadCandidateCount > 0 ? "Chưa ghép/tải ảnh" : "Chưa có ảnh",
      detail:
        driveDownloadCandidateCount > 0
          ? `Có ${driveDownloadCandidateCount} dòng có tên folder/link trong sheet; cần tải ảnh về data/images.`
          : "Dữ liệu có thể đã nhập nhưng chưa có ảnh.",
      to: "/data",
      search: driveDownloadCandidateCount > 0 ? { tab: "images" } : undefined,
      tone: "danger",
    });
  } else if (linkAssets > 0) {
    issues.push({
      label: "Ảnh link chưa tải về",
      detail: `${linkAssets} ảnh đang là đường dẫn, nên tải về để sao lưu đủ ảnh.`,
      to: "/data",
      tone: "warning",
    });
  }
  if (entitiesWithoutAssets > 0) {
    issues.push({
      label: entitiesWithReferenceOnly > 0 ? "Có folder/link nhưng chưa ghép ảnh" : "Dòng chưa có ảnh",
      detail:
        entitiesWithReferenceOnly > 0
          ? `${entitiesWithReferenceOnly} dòng đã có tên folder/link nhưng chưa có ảnh đọc được.`
          : `${entitiesWithoutAssets} dòng chưa có ảnh đọc được.`,
      to: "/data",
      search: driveDownloadCandidateCount > 0 ? { tab: "images" } : undefined,
      tone: assets.length === 0 ? "danger" : "warning",
    });
  }
  if (brokenAssets > 0 || missingAssets > 0) {
    issues.push({
      label: "Ảnh lỗi",
      detail: `${brokenAssets + missingAssets} ảnh đang lỗi hoặc thiếu nguồn.`,
      to: "/data",
      tone: "danger",
    });
  }
  if (!aiConfigured) {
    issues.push({
      label: "AI chưa cấu hình",
      detail: "Thiết lập base URL và model để dùng các tính năng AI.",
      to: "/settings",
      tone: "warning",
    });
  }
  if (latestJobWarnings > 0) {
    issues.push({
      label: "Lần tạo gần nhất có cảnh báo",
      detail: `${latestJobWarnings} cảnh báo trong lần tạo gần nhất.`,
      to: "/history",
      tone: "warning",
    });
  }

  return {
    packTemplates: packTemplates.length,
    pageTemplates: pageTemplates.length,
    entities: entities.length,
    activeEntities,
    partnerEntities,
    sheetCount: sheetNames.length,
    sheetNames,
    assets: assets.length,
    localAssets,
    linkAssets,
    driveDownloadCandidateCount,
    entitiesWithReferenceOnly,
    entitiesWithoutAnyImageSource,
    blobCount,
    brokenAssets,
    missingAssets,
    entitiesWithoutAssets,
    jobs: jobs.length,
    renderedPages,
    exportedJobs,
    latestJobWarnings,
    presetCount,
    analysisCount,
    totalSlots,
    mappedSlots,
    aiConfigured,
    issues,
  };
}
