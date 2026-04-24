// Simple Blob-download helper. Replaces `file-saver` (CJS-only package that
// breaks Vite dev ESM named import).
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed by the browser.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
