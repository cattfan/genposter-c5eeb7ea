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

export function downloadText(content: string, fileName: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  saveAs(blob, fileName);
}

export function downloadJSON(obj: unknown, fileName: string) {
  downloadText(JSON.stringify(obj, null, 2), fileName, "application/json;charset=utf-8");
}
