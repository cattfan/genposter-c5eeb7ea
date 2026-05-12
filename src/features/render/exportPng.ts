// Export PNG/ZIP

import { toPng } from "html-to-image";
import JSZip from "jszip";
import saveAs from "file-saver";

const TRANSPARENT_IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function formatExportError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error instanceof Event) {
    const target = error.target as HTMLElement | null;
    const src =
      target instanceof HTMLImageElement || target instanceof HTMLSourceElement
        ? target.src || target.getAttribute("src")
        : target?.getAttribute?.("src");
    return src ? `Không tải được ảnh: ${src}` : "Không tải được một ảnh trong khung xuất";
  }
  const text = String(error ?? "");
  return text === "[object Event]" ? "Không tải được một ảnh trong khung xuất" : text;
}

export async function nodeToPngBlob(node: HTMLElement, scale = 2): Promise<Blob> {
  await document.fonts?.ready;
  const dataUrl = await toPng(node, {
    pixelRatio: scale,
    cacheBust: true,
    skipFonts: false,
    imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
    onImageErrorHandler: () => undefined,
  });
  const res = await fetch(dataUrl);
  return await res.blob();
}

export async function downloadPng(node: HTMLElement, fileName: string, scale = 2) {
  const blob = await nodeToPngBlob(node, scale);
  saveAs(blob, fileName);
}

export async function downloadZip(
  files: Array<{ name: string; blob: Blob }>,
  zipName = "pack.zip",
) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, zipName);
}

/**
 * Build a ZIP with multiple bundles organized in subfolders (Bo1, Bo2, ...).
 * Each bundle's files are placed inside its subfolder.
 * If only one bundle, files are placed at root (no subfolder).
 */
export async function downloadMultiBundleZip(
  bundles: Array<{ files: Array<{ name: string; blob: Blob }> }>,
  zipName = "pack.zip",
) {
  const zip = new JSZip();
  if (bundles.length === 1) {
    // Single bundle: flat structure at root
    for (const f of bundles[0].files) zip.file(f.name, f.blob);
  } else {
    // Multiple bundles: each in Bo1/, Bo2/, etc.
    for (let i = 0; i < bundles.length; i++) {
      const folder = zip.folder(`Bo${i + 1}`)!;
      for (const f of bundles[i].files) folder.file(f.name, f.blob);
    }
  }
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, zipName);
}

export function downloadText(content: string, fileName: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  saveAs(blob, fileName);
}

/**
 * Format a ZIP filename with template name and current timestamp.
 * Pattern: {templateName}-{DD}-{MM}-{YYYY}-{HH}-{mm}
 * If single bundle, appends version suffix: {templateName}_v{N}-{DD}-{MM}-{YYYY}-{HH}-{mm}
 */
export function formatZipFileName(
  templateName: string,
  options?: { version?: number },
): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");

  // Sanitize template name for filename safety
  const unsafeChars = /[<>:"/\\|?*]+/g;
  const safeName = templateName
    .replace(unsafeChars, "-")
    .replace(/[\x00-\x1f]/g, "") // eslint-disable-line no-control-regex
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim() || "bo-anh";

  const versionSuffix = options?.version != null ? `_v${options.version}` : "";
  return `${safeName}${versionSuffix}-${dd}-${mm}-${yyyy}-${hh}-${min}`;
}

export function downloadJSON(obj: unknown, fileName: string) {
  downloadText(JSON.stringify(obj, null, 2), fileName, "application/json;charset=utf-8");
}
