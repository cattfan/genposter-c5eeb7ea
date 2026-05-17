// Client-side image downscaler used before storing uploads in IndexedDB.
// Goals:
//   • Cap the longest edge at MAX_EDGE (default 2400px) so Dexie blobs stay <2-3MB.
//   • Skip re-encoding small images to avoid unnecessary quality loss.
//   • Fail soft: if something goes wrong we return the original File/Blob.

const DEFAULT_MAX_EDGE = 2400;
const DEFAULT_REENCODE_THRESHOLD_BYTES = 2_000_000;
const DEFAULT_JPEG_QUALITY = 0.92;

const RESIZABLE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

type ResizeOptions = {
  maxEdge?: number;
  reencodeThresholdBytes?: number;
  jpegQuality?: number;
};

function resolveOutputMime(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const lower = input.toLowerCase();
  if (lower === "image/png" || lower === "image/webp") return lower;
  return "image/jpeg";
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh để resize"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas.toBlob trả về null"));
      },
      mime,
      mime === "image/png" ? undefined : quality,
    );
  });
}

/**
 * Downscale an image blob to fit within `maxEdge` pixels on its longest side.
 * Returns the original blob unchanged when it is already small enough, non-image,
 * or resizing fails. Runs in-browser; safe to noop on the server.
 */
export async function resizeImageBlob(input: File | Blob, options: ResizeOptions = {}): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") return input;

  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const threshold = options.reencodeThresholdBytes ?? DEFAULT_REENCODE_THRESHOLD_BYTES;
  const quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  const mime = input.type?.toLowerCase();
  if (!mime || !RESIZABLE_MIME.has(mime)) return input;

  try {
    const img = await loadImageFromBlob(input);
    const natural = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
    if (!natural) return input;

    const scale = natural > maxEdge ? maxEdge / natural : 1;
    // Tiny images or already small-enough JPEG/WebP → skip re-encoding.
    if (scale === 1 && input.size <= threshold) return input;

    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return input;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const outMime = resolveOutputMime(mime, "image/jpeg");
    const encoded = await canvasToBlob(canvas, outMime, quality);

    // Only keep the downscaled blob if it is actually smaller than the source.
    if (encoded.size >= input.size && scale === 1) return input;
    return encoded;
  } catch (err) {
    // Trước đây catch{} im lặng -> resize fail là blob gốc đi thẳng vào Dexie,
    // ảnh nhiều MB sẽ bùng size DB. Log để debug nhưng vẫn trả ảnh gốc (fail-soft).
    console.warn(
      "[resizeImageBlob] fallback to original blob:",
      err instanceof Error ? err.message : err,
    );
    return input;
  }
}
