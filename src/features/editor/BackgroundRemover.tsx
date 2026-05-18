// Background Remover — 1-click xoá nền ảnh, giữ subject.
//
// Strategy:
// 1. Ưu tiên: gọi AI backend (nếu có config) qua endpoint /api/v1/ai/remove-background
// 2. Fallback: dùng @imgly/background-removal (WASM, chạy trong browser)
//    ~5MB download lần đầu, sau đó cache. Không cần server.
//
// Component hiển thị nút "Xoá nền" trong inspector khi select image element.

import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface BackgroundRemoverProps {
  /** URL/src ảnh hiện tại của element. */
  imageSrc: string | undefined;
  /** Callback khi xoá nền xong — trả về blob URL mới (PNG transparent). */
  onResult: (newBlobUrl: string) => void;
  /** Có AI backend config không (baseUrl + apiKey). */
  hasAiConfig?: boolean;
}

/**
 * Xoá nền bằng WASM (browser-side). Dùng dynamic import để không bundle
 * 5MB WASM vào main chunk — chỉ load khi user click.
 */
async function removeBackgroundWasm(imageBlob: Blob): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  const result = await removeBackground(imageBlob, {
    output: { format: "image/png" },
  });
  return result;
}

/**
 * Xoá nền qua AI backend. Gửi ảnh lên server, nhận PNG transparent.
 */
async function removeBackgroundAi(imageSrc: string): Promise<Blob> {
  // Fetch ảnh gốc thành blob
  const imageRes = await fetch(imageSrc);
  if (!imageRes.ok) throw new Error("Không tải được ảnh gốc");
  const imageBlob = await imageRes.blob();

  const formData = new FormData();
  formData.append("file", imageBlob);

  const res = await fetch("/api/v1/ai/remove-background", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI lỗi ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.blob();
}

export function BackgroundRemover({
  imageSrc,
  onResult,
  hasAiConfig = false,
}: BackgroundRemoverProps) {
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    if (!imageSrc) {
      toast.error("Element chưa có ảnh");
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Đang xoá nền ảnh...");

    try {
      let resultBlob: Blob;

      if (hasAiConfig) {
        try {
          resultBlob = await removeBackgroundAi(imageSrc);
        } catch (aiErr) {
          // AI fail -> fallback WASM
          console.warn("[BackgroundRemover] AI failed, trying WASM:", aiErr);
          toast.loading("AI lỗi, đang dùng WASM fallback...", { id: toastId });
          const imageRes = await fetch(imageSrc);
          const imageBlob = await imageRes.blob();
          resultBlob = await removeBackgroundWasm(imageBlob);
        }
      } else {
        // Không có AI config -> dùng WASM trực tiếp
        toast.loading("Đang tải model xoá nền (lần đầu ~5MB)...", { id: toastId });
        const imageRes = await fetch(imageSrc);
        const imageBlob = await imageRes.blob();
        resultBlob = await removeBackgroundWasm(imageBlob);
      }

      const url = URL.createObjectURL(resultBlob);
      onResult(url);
      toast.success("Đã xoá nền thành công", { id: toastId });
    } catch (err) {
      toast.error(
        "Xoá nền thất bại: " + (err instanceof Error ? err.message : String(err)),
        { id: toastId },
      );
    } finally {
      setBusy(false);
    }
  };

  if (!imageSrc) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2 text-xs"
      onClick={() => void handleRemove()}
      disabled={busy}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Wand2 className="size-3.5" />
      )}
      Xoá nền ảnh
    </Button>
  );
}
