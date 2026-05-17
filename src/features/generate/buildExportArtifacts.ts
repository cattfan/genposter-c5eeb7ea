// Helper hợp nhất logic build ZIP cho cả "Tải ZIP" (toàn bộ pack) và
// "Tải bộ" (1 bundle).
//
// Trước khi có file này, PackTabContent.exportZip và exportBundleZip duplicate
// ~140 dòng giống nhau: render PNG → group bundle → build caption.txt &
// doitac.xlsx → JSZip. Cố ý timeout khác nhau (5s vs 8s) — giữ nguyên qua
// option `renderTimeoutMs`.
//
// Hàm trả về cấu trúc bundleArtifacts sẵn sàng truyền cho `downloadMultiBundleZip`.
// Caller chịu trách nhiệm gọi `downloadMultiBundleZip` (vì naming file phụ
// thuộc context: "toàn bộ" vs "1 bundle").

import type { Entity, GenerationJob, RenderedItem } from "@/models";
import { nodeToPngBlob } from "@/features/render/exportPng";
import {
  buildFallbackCaptionBlob,
  buildPartnerWorkbookBlob,
  type ExportPageEntityData,
} from "@/features/generate/exportArtifacts";

export interface BundleArtifactInputPage {
  pageIndex: number;
  /** DOM node để render PNG. Nếu không có, page sẽ bị skip. */
  node: HTMLElement | null;
  /** ExportPageEntityData để build caption + doitac. */
  pageData: ExportPageEntityData;
}

export interface BundleArtifactInputBundle {
  /** Label hiển thị trong caption (e.g. "Bộ 1"). */
  bundleLabel: string;
  pages: BundleArtifactInputPage[];
}

export interface AssembleBundleArtifactsInput {
  packName: string;
  entities: Entity[];
  bundles: BundleArtifactInputBundle[];
  /** Timeout cho mỗi page render PNG (ms). 5s cho exportZip, 8s cho exportBundleZip. */
  renderTimeoutMs?: number;
  /** Tỉ lệ render html-to-image. Mặc định 2x. */
  renderScale?: number;
  /**
   * Callback theo dõi progress: số page đã render thành công + tổng số.
   * `step` là chỉ mục của page trong toàn bộ tasks, không phải bundle local.
   */
  onProgress?: (step: number, totalSteps: number) => void;
}

export interface BundleArtifactOutput {
  bundleLabel: string;
  files: Array<{ name: string; blob: Blob }>;
  /** Số page render thành công. */
  succeeded: number;
  /** Số page bị skip do thiếu node hoặc timeout. */
  failed: number;
}

export interface AssembleBundleArtifactsResult {
  bundles: BundleArtifactOutput[];
  totalRendered: number;
  totalFailed: number;
}

const DEFAULT_RENDER_TIMEOUT_MS = 5_000;
const DEFAULT_RENDER_SCALE = 2;

async function renderNodeWithTimeout(
  node: HTMLElement,
  scale: number,
  timeoutMs: number,
): Promise<Blob> {
  return Promise.race([
    nodeToPngBlob(node, scale),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("render-timeout")), timeoutMs),
    ),
  ]);
}

/**
 * Render PNG cho mọi page (bỏ qua page hỏng), build caption.txt + doitac.xlsx
 * cho mỗi bundle, trả về cấu trúc cho `downloadMultiBundleZip`.
 */
export async function assembleBundleArtifacts(
  input: AssembleBundleArtifactsInput,
): Promise<AssembleBundleArtifactsResult> {
  const renderTimeoutMs = input.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const renderScale = input.renderScale ?? DEFAULT_RENDER_SCALE;
  const totalSteps = input.bundles.reduce((sum, bundle) => sum + bundle.pages.length, 0);

  let stepIndex = 0;
  let totalRendered = 0;
  let totalFailed = 0;
  const out: BundleArtifactOutput[] = [];

  for (const bundle of input.bundles) {
    const pageBlobs: Array<{ blob: Blob; pageData: ExportPageEntityData }> = [];
    let bundleFailed = 0;

    for (const page of bundle.pages) {
      input.onProgress?.(stepIndex, totalSteps);
      stepIndex += 1;
      if (!page.node) {
        bundleFailed += 1;
        continue;
      }
      try {
        const blob = await renderNodeWithTimeout(page.node, renderScale, renderTimeoutMs);
        pageBlobs.push({ blob, pageData: page.pageData });
      } catch {
        bundleFailed += 1;
      }
    }

    totalRendered += pageBlobs.length;
    totalFailed += bundleFailed;

    if (pageBlobs.length === 0) {
      // Bundle rỗng -> bỏ qua, vẫn ghi lại để caller báo lỗi nếu muốn.
      out.push({ bundleLabel: bundle.bundleLabel, files: [], succeeded: 0, failed: bundleFailed });
      continue;
    }

    const files: Array<{ name: string; blob: Blob }> = pageBlobs.map((entry, idx) => ({
      name: `${idx + 1}.png`,
      blob: entry.blob,
    }));

    const captionBlob = buildFallbackCaptionBlob({
      packName: input.packName,
      bundleLabel: bundle.bundleLabel,
      pages: pageBlobs.map((entry) => entry.pageData),
      entities: input.entities,
      variantCount: 3,
    });
    files.push({ name: "caption.txt", blob: captionBlob });

    const xlsxBlob = buildPartnerWorkbookBlob({
      pages: pageBlobs.map((entry) => entry.pageData),
      entities: input.entities,
    });
    files.push({ name: "doitac.xlsx", blob: xlsxBlob });

    out.push({
      bundleLabel: bundle.bundleLabel,
      files,
      succeeded: pageBlobs.length,
      failed: bundleFailed,
    });
  }

  return { bundles: out, totalRendered, totalFailed };
}

/**
 * Convenience: chuyển 1 RenderedPage của GenerationJob về ExportPageEntityData
 * — cùng shape mà cả exportZip và exportBundleZip dùng.
 */
export function toExportPageData(page: GenerationJob["pages"][number]): ExportPageEntityData {
  return {
    pageFile: page.pageFile,
    pageName: page.workingTemplate?.name,
    entityId: page.entityId,
    entityName: page.entityName,
    items: page.items as RenderedItem[] | undefined,
  };
}
