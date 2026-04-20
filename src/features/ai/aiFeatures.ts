// Các AI feature functions client-side, dùng aiClient.callAi.
// Thay thế server functions trong src/server/aiTemplate.ts (server fn không gọi được localhost).

import { callAi } from "./aiClient";

// ============================================================
// 1. Generate page layout từ 1 ảnh
// ============================================================

const TEMPLATE_TOOL = {
  type: "function" as const,
  function: {
    name: "build_layout",
    description:
      "Tạo khung layout dạng portrait (1080x1350) dựa trên ảnh mẫu. CHỈ tạo placeholder, KHÔNG bịa nội dung text thật.",
    parameters: {
      type: "object",
      properties: {
        canvas: {
          type: "object",
          properties: { bgColor: { type: "string" } },
        },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["text", "image", "shape"] },
              shapeKind: { type: "string", enum: ["rectangle", "circle", "badge"] },
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
              placeholder: { type: "string" },
              style: {
                type: "object",
                properties: {
                  fontSize: { type: "number" },
                  fontWeight: { type: "number" },
                  color: { type: "string" },
                  fill: { type: "string" },
                  borderRadius: { type: "number" },
                  textAlign: { type: "string", enum: ["left", "center", "right"] },
                  textTransform: { type: "string", enum: ["none", "uppercase", "lowercase"] },
                },
              },
            },
            required: ["kind", "x", "y", "w", "h"],
          },
        },
      },
      required: ["canvas", "slots"],
    },
  },
};

const LAYOUT_SYSTEM =
  "Bạn là designer chuyển ảnh mẫu Instagram/Threads thành khung layout JSON. " +
  "Quy tắc TUYỆT ĐỐI:\n" +
  "1. CHỈ tạo khung + placeholder. KHÔNG bịa nội dung text thật.\n" +
  "2. Mọi text phải là placeholder dạng {{tên}}, {{địa chỉ}}, {{giá}}, {{ngày}}, {{tiêu đề}}, {{mô tả}}.\n" +
  "3. Toạ độ x/y/w/h là tỉ lệ 0..1 so với canvas portrait (cao gấp 1.25 rộng).\n" +
  "4. Ảnh đại diện địa điểm dùng kind=shape + shapeKind=circle.\n" +
  "5. Badge giá tiền dùng kind=shape + shapeKind=badge + fill cam '#F97316', kèm 1 text overlay '{{giá}}' màu trắng.\n" +
  "6. Header ngày dùng shape badge fill đỏ '#dc2626' + text '{{tiêu đề}}' trắng.\n" +
  "7. ƯU TIÊN layout gọn, cân đối, ít block: tối đa 12 slot, tối đa 3 nhóm item lặp, chừa margin ngoài 4%.\n" +
  "8. KHÔNG xếp chồng chéo text/image. Mỗi block phải có khoảng thở rõ ràng; tránh item rơi ra mép dưới canvas.\n" +
  "9. Nếu ảnh mẫu quá rối, hãy đơn giản hoá về bố cục editorial sạch thay vì copy y nguyên.\n" +
  "10. Trả về qua tool build_layout, KHÔNG nói gì thêm.";

export async function aiGenerateTemplateFromImage(imageDataUrl: string) {
  const result = await callAi({
    useVisionModel: true,
    messages: [
      { role: "system", content: LAYOUT_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Phân tích ảnh và sinh khung layout JSON theo tool build_layout." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    tools: [TEMPLATE_TOOL],
    tool_choice: { type: "function", function: { name: "build_layout" } },
    temperature: 0.2,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  if (!result.toolArgs) return { ok: false as const, error: "AI không trả layout JSON hợp lệ" };
  return { ok: true as const, layoutJson: JSON.stringify(result.toolArgs) };
}

// ============================================================
// 2. Suggest bindings
// ============================================================

const BIND_TOOL = {
  type: "function" as const,
  function: {
    name: "suggest_bindings",
    description: "Gợi ý bindingPath cho từng slot.",
    parameters: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slotId: { type: "string" },
              suggestedBindingPath: { type: "string" },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
            required: ["slotId", "suggestedBindingPath", "confidence"],
          },
        },
      },
      required: ["suggestions"],
    },
  },
};

export async function aiSuggestBindings(input: {
  slots: Array<{ slotId: string; kind: string; placeholder?: string; staticText?: string }>;
  columns: string[];
}) {
  const result = await callAi({
    messages: [
      {
        role: "system",
        content:
          "Bạn map placeholder text → bindingPath chuẩn. Chỉ chọn 1 trong: " +
          "entity.name, entity.address, entity.phone, entity.priceRange, entity.style, " +
          "entity.openingHours, entity.categoryMain, entity.categorySub, " +
          "asset.cover, asset.byRole:facade, asset.byRole:food_closeup, asset.byRole:space. " +
          "Nếu không chắc, đặt confidence < 0.5.",
      },
      {
        role: "user",
        content:
          "Cột data có sẵn: " +
          JSON.stringify(input.columns) +
          "\n\nSlot list:\n" +
          JSON.stringify(input.slots, null, 2),
      },
    ],
    tools: [BIND_TOOL],
    tool_choice: { type: "function", function: { name: "suggest_bindings" } },
    temperature: 0.1,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  if (!result.toolArgs) return { ok: false as const, error: "AI không trả suggestions" };
  const parsed = result.toolArgs as {
    suggestions?: Array<{
      slotId?: string;
      suggestedBindingPath?: string;
      confidence?: number;
      reason?: string;
    }>;
  };
  const suggestions = (parsed.suggestions ?? [])
    .filter((s) => s && typeof s.slotId === "string" && typeof s.suggestedBindingPath === "string")
    .map((s) => ({
      slotId: String(s.slotId),
      suggestedBindingPath: String(s.suggestedBindingPath),
      confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
      reason: typeof s.reason === "string" ? s.reason : "",
    }));
  return { ok: true as const, suggestions };
}

// ============================================================
// 3. Caption từ entity
// ============================================================

export async function aiCaptionFromEntity(input: {
  entity: Record<string, unknown>;
  style?: "instagram" | "threads" | "facebook";
}) {
  const styleHint = {
    instagram: "Instagram caption: 2-3 dòng, có emoji vừa phải, thêm 5 hashtag liên quan ở cuối.",
    threads: "Threads post: ngắn 1-2 câu, giọng tự nhiên, KHÔNG hashtag.",
    facebook: "Facebook post: 3-5 dòng, dễ đọc, có emoji, KHÔNG hashtag.",
  }[input.style ?? "instagram"];
  const result = await callAi({
    messages: [
      {
        role: "system",
        content:
          "Bạn viết caption tiếng Việt dựa CHỈ trên data JSON. KHÔNG bịa thông tin (giá, địa chỉ, tên món...). " +
          "Nếu data thiếu trường, bỏ qua. " +
          styleHint,
      },
      {
        role: "user",
        content: "Data entity:\n```json\n" + JSON.stringify(input.entity, null, 2) + "\n```",
      },
    ],
    temperature: 0.7,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  return { ok: true as const, caption: (result.content ?? "").trim() };
}

// ============================================================
// 4. Combo từ nhiều ảnh: classify + gen từng page
// ============================================================

const CLASSIFY_TOOL = {
  type: "function" as const,
  function: {
    name: "classify_pages",
    description: "Phân loại từng ảnh + đoán packMeta.",
    parameters: {
      type: "object",
      properties: {
        packMeta: {
          type: "object",
          properties: {
            name: { type: "string" },
            goal: { type: "string" },
            tone: { type: "string" },
            cta: { type: "string" },
          },
          required: ["name"],
        },
        pages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              role: { type: "string", enum: ["cover", "utilities", "day", "outro", "other"] },
              dayNumber: { type: "number" },
              suggestedName: { type: "string" },
            },
            required: ["index", "role", "suggestedName"],
          },
        },
      },
      required: ["packMeta", "pages"],
    },
  },
};

export interface ComboResultPage {
  index: number;
  role: "cover" | "utilities" | "day" | "outro" | "other";
  dayNumber?: number;
  suggestedName: string;
  layoutJson: string;
}

export interface ComboResult {
  ok: true;
  pages: ComboResultPage[];
  packMeta: { name: string; goal?: string; tone?: string; cta?: string };
  warnings: string[];
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function genOnePageWithHint(
  imageDataUrl: string,
  roleHint: string,
): Promise<{ ok: true; layoutJson: string } | { ok: false; error: string }> {
  const result = await callAi({
    useVisionModel: true,
    messages: [
      { role: "system", content: LAYOUT_SYSTEM + `\n8. Hint vai trò page: ${roleHint}` },
      {
        role: "user",
        content: [
          { type: "text", text: `Đây là page có vai trò: ${roleHint}. Sinh khung layout.` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    tools: [TEMPLATE_TOOL],
    tool_choice: { type: "function", function: { name: "build_layout" } },
    temperature: 0.2,
  });
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.toolArgs) return { ok: false, error: "AI không trả layout" };
  return { ok: true, layoutJson: JSON.stringify(result.toolArgs) };
}

export async function aiGenerateComboFromImages(input: {
  images: Array<{ dataUrl: string }>;
  packNameHint?: string;
  onProgress?: (step: string, progress: number) => void;
}): Promise<ComboResult | { ok: false; error: string }> {
  if (input.images.length === 0) return { ok: false, error: "Cần ít nhất 1 ảnh" };

  input.onProgress?.(`Phân loại ${input.images.length} ảnh...`, 10);

  const userContent: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text:
        `Có ${input.images.length} ảnh (index 0..${input.images.length - 1}). ` +
        (input.packNameHint ? `Pack hint: "${input.packNameHint}". ` : "") +
        "Phân loại + suy ra packMeta.",
    },
  ];
  input.images.forEach((im) =>
    userContent.push({ type: "image_url", image_url: { url: im.dataUrl } }),
  );

  const classifyRes = await callAi({
    useVisionModel: true,
    messages: [
      {
        role: "system",
        content:
          "Bạn nhìn tổng thể nhiều ảnh content pack du lịch/ẩm thực → suy ra vai trò mỗi page và pack metadata. " +
          "Quy tắc: ảnh đầu thường cover; ảnh có 'NGÀY X'/lịch trình là day; transport/homestay tổng hợp là utilities; CTA cuối là outro.",
      },
      { role: "user", content: userContent },
    ],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "function", function: { name: "classify_pages" } },
    temperature: 0.2,
  });

  if (!classifyRes.ok) return { ok: false, error: classifyRes.error };
  if (!classifyRes.toolArgs) return { ok: false, error: "AI không phân loại được" };

  const parsed = classifyRes.toolArgs as {
    packMeta?: { name?: string; goal?: string; tone?: string; cta?: string };
    pages?: Array<{
      index?: number;
      role?: ComboResultPage["role"];
      dayNumber?: number;
      suggestedName?: string;
    }>;
  };

  const packMeta = {
    name: parsed.packMeta?.name ?? input.packNameHint ?? "Combo AI",
    goal: parsed.packMeta?.goal,
    tone: parsed.packMeta?.tone,
    cta: parsed.packMeta?.cta,
  };

  const classified = (parsed.pages ?? [])
    .filter((p) => typeof p.index === "number" && p.index! >= 0 && p.index! < input.images.length)
    .map((p) => ({
      index: p.index!,
      role: (p.role ?? "other") as ComboResultPage["role"],
      dayNumber: typeof p.dayNumber === "number" ? p.dayNumber : undefined,
      suggestedName: p.suggestedName ?? `Page ${p.index! + 1}`,
    }));
  for (let i = 0; i < input.images.length; i++) {
    if (!classified.find((c) => c.index === i)) {
      classified.push({
        index: i,
        role: "other" as const,
        dayNumber: undefined,
        suggestedName: `Page ${i + 1}`,
      });
    }
  }
  classified.sort((a, b) => a.index - b.index);

  let done = 0;
  const layouts = await runWithLimit(classified, 3, async (c) => {
      const roleHint =
      c.role === "cover"
        ? "Trang bìa: 1 hero image lớn, tiêu đề lớn, sub-title ngắn, tối đa 5 slot."
        : c.role === "utilities"
          ? "Trang tiện ích: danh sách ngắn 3-4 item card, canh hàng thẳng, tránh nhồi quá nhiều block."
          : c.role === "day"
            ? `Trang lịch trình Ngày ${c.dayNumber ?? "?"}: badge header đỏ, 3-4 item card rõ ràng có ảnh tròn + tên + địa chỉ + badge giá cam, ưu tiên zigzag sạch.`
            : c.role === "outro"
              ? "Trang kết / CTA: ít thành phần, tập trung 1 lời kêu gọi hành động rõ ràng."
              : "Page nội dung tự do nhưng tối đa 8 slot, bố cục sạch và dễ bind dữ liệu.";
    const r = await genOnePageWithHint(input.images[c.index].dataUrl, roleHint);
    done++;
    input.onProgress?.(
      `Dựng ${done}/${classified.length}...`,
      20 + Math.round((70 * done) / classified.length),
    );
    return { classified: c, gen: r };
  });

  const pages: ComboResultPage[] = [];
  const warnings: string[] = [];
  for (const x of layouts) {
    if (x.gen.ok) {
      pages.push({
        index: x.classified.index,
        role: x.classified.role,
        dayNumber: x.classified.dayNumber,
        suggestedName: x.classified.suggestedName,
        layoutJson: x.gen.layoutJson,
      });
    } else {
      warnings.push(`Page ${x.classified.index + 1}: ${x.gen.error}`);
    }
  }

  if (pages.length === 0) {
    return { ok: false, error: "Tất cả page đều fail:\n" + warnings.join("\n") };
  }

  input.onProgress?.("Tạo pack...", 95);
  return { ok: true, pages, packMeta, warnings };
}
