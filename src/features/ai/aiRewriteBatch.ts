// AI batch rewrite: tạo N variations của 1 câu text giữ nguyên ý.
// Dùng khi generate bộ ảnh có slot binding "ai.rewrite".

import { callAi } from "./aiClient";

export interface AiRewriteBatchInput {
  /** Câu gốc cần viết lại */
  originalText: string;
  /** Số lượng variation cần tạo */
  count: number;
  /** Gợi ý tone/style (optional) */
  toneHint?: string;
}

export interface AiRewriteBatchResult {
  ok: boolean;
  variations: string[];
  error?: string;
}

/**
 * Gọi AI tạo N variations của 1 câu text, giữ nguyên ý nghĩa.
 * Nếu AI fail → trả về mảng rỗng (caller dùng fallback = text gốc).
 */
export async function aiRewriteBatch(
  input: AiRewriteBatchInput,
): Promise<AiRewriteBatchResult> {
  const { originalText, count, toneHint } = input;
  if (!originalText.trim() || count <= 0) {
    return { ok: true, variations: [] };
  }

  try {
    const result = await callAi({
      messages: [
        {
          role: "system",
          content:
            "Bạn là copywriter tiếng Việt chuyên viết caption social media du lịch Đà Lạt. " +
            "Nhiệm vụ: viết lại câu gốc thành nhiều phiên bản khác nhau, giữ nguyên ý nghĩa và độ dài tương đương. " +
            "Mỗi phiên bản phải tự nhiên, sáng tạo, không lặp từ. " +
            `${toneHint ? `Tone: ${toneHint}. ` : ""}` +
            `Trả về JSON: {"variations":["câu 1","câu 2",...]}. Đúng ${count} câu.`,
        },
        {
          role: "user",
          content: `Câu gốc: "${originalText}"\nSố lượng: ${count}`,
        },
      ],
      temperature: 0.85,
    });

    if (!result.ok) {
      return { ok: false, variations: [], error: result.error };
    }

    const parsed = parseVariationsJson(result.content ?? "");
    if (parsed.length === 0) {
      return { ok: false, variations: [], error: "AI không trả về variations hợp lệ" };
    }

    return { ok: true, variations: parsed.slice(0, count) };
  } catch (e) {
    return {
      ok: false,
      variations: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseVariationsJson(raw: string): string[] {
  const trimmed = raw.trim();
  // Try JSON parse
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { variations?: unknown[] };
      if (Array.isArray(parsed.variations)) {
        return parsed.variations
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0);
      }
    } catch {
      /* fall through */
    }
  }
  // Fallback: split by newlines
  return trimmed
    .split("\n")
    .map((line) => line.replace(/^\d+[.)]\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter((line) => line.length > 5);
}
