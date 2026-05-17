// Client-side image passthrough — KHÔNG resize, KHÔNG re-encode.
//
// User yêu cầu: giữ nguyên chất lượng ảnh tuyệt đối. Backend filesystem
// (data/blobs/) không có size limit strict, SQLite chỉ lưu metadata, nên
// upload nguyên bản là phương án tốt nhất:
//   - Không decode/encode → không mất chi tiết, không artifact JPEG.
//   - Không Canvas → không block UI, upload nhanh hơn.
//   - File 50MB DSLR vẫn upload được (Multer limit 30MB ở blobs.controller.ts —
//     có thể nâng nếu cần).
//
// Hàm vẫn giữ tên `resizeImageBlob` và signature cũ để 5+ caller không
// phải sửa. Callers: BulkImageUpload, data.tsx addAssetFilesToEntity,
// DesignWorkspace insertAsset/saveSymbol/font upload.

type ResizeOptions = {
  maxEdge?: number;
  reencodeThresholdBytes?: number;
  jpegQuality?: number;
};

/**
 * Trả về blob gốc, không sửa đổi. Tham số được giữ cho tương thích API
 * nhưng đã không còn tác dụng.
 */
export async function resizeImageBlob(
  input: File | Blob,
  _options: ResizeOptions = {},
): Promise<Blob> {
  // Suppress unused param warning while keeping API stable.
  void _options;
  return input;
}
