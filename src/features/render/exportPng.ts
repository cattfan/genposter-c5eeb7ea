// Export PNG/ZIP

import { toPng } from "html-to-image";
import JSZip from "jszip";
import { saveBlob } from "./saveBlob";
import { getEmbeddedFontsCss } from "./fontEmbedCss";

export async function nodeToPngBlob(node: HTMLElement, scale = 2): Promise<Blob> {
  await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  const fontEmbedCSS = await getEmbeddedFontsCss();
  const dataUrl = await toPng(node, {
    pixelRatio: scale,
    cacheBust: true,
    // Skip html-to-image's own web-font scanner (which hits SecurityError on
    // cross-origin fonts.googleapis.com stylesheets) and inject our own
    // pre-fetched, fully-inlined @font-face CSS instead.
    skipFonts: true,
    fontEmbedCSS,
  });
  const res = await fetch(dataUrl);
  return await res.blob();
}

export async function downloadPng(node: HTMLElement, fileName: string, scale = 2) {
  const blob = await nodeToPngBlob(node, scale);
  saveBlob(blob, fileName);
}

export async function downloadZip(
  files: Array<{ name: string; blob: Blob }>,
  zipName = "pack.zip",
) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const content = await zip.generateAsync({ type: "blob" });
  saveBlob(content, zipName);
}

export function downloadText(content: string, fileName: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  saveBlob(blob, fileName);
}

export function downloadJSON(obj: unknown, fileName: string) {
  downloadText(JSON.stringify(obj, null, 2), fileName, "application/json;charset=utf-8");
}
