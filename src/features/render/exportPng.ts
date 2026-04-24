// Export PNG/ZIP

import { toPng } from "html-to-image";
import JSZip from "jszip";
import saveAs from "file-saver";

export async function nodeToPngBlob(node: HTMLElement, scale = 2): Promise<Blob> {
  await (document as any).fonts?.ready;
  const dataUrl = await toPng(node, {
    pixelRatio: scale,
    cacheBust: true,
    skipFonts: false,
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
