// Server functions cho AI: gen template từ ảnh, gợi ý bind, viết caption từ data.
// Tất cả gọi Lovable AI Gateway qua LOVABLE_API_KEY (có sẵn ở runtime).

import { createServerFn } from "@tanstack/react-start";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-pro"; // vision + reasoning

interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

interface GatewayTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

async function callGateway(body: {
  model?: string;
  messages: GatewayMessage[];
  tools?: GatewayTool[];
  tool_choice?: { type: "function"; function: { name: string } } | "auto";
  temperature?: number;
}): Promise<
  | { ok: true; content: string | null; toolArgs: unknown | null }
  | { ok: false; status: number; error: string }
> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { ok: false, status: 500, error: "LOVABLE_API_KEY chưa cấu hình" };
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: DEFAULT_MODEL, ...body }),
    });
  } catch (e) {
    return { ok: false, status: 0, error: "Không gọi được AI gateway: " + (e instanceof Error ? e.message : String(e)) };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 429) return { ok: false, status: 429, error: "AI rate limit — thử lại sau 1 phút." };
    if (res.status === 402) return { ok: false, status: 402, error: "Hết credits AI — nạp thêm tại Settings → Workspace → Usage." };
    return { ok: false, status: res.status, error: `AI gateway lỗi ${res.status}: ${txt.slice(0, 300)}` };
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { arguments?: string } }>;
      };
    }>;
  };
  const choice = json.choices?.[0]?.message;
  let toolArgs: unknown = null;
  const argStr = choice?.tool_calls?.[0]?.function?.arguments;
  if (argStr) {
    try {
      toolArgs = JSON.parse(argStr);
    } catch {
      toolArgs = null;
    }
  }
  return { ok: true, content: choice?.content ?? null, toolArgs };
}

// ============================================================
// B1: aiGenerateTemplateFromImage
// ============================================================

const TEMPLATE_TOOL: GatewayTool = {
  type: "function",
  function: {
    name: "build_layout",
    description:
      "Tạo khung layout dạng portrait (1080x1350) dựa trên ảnh mẫu. CHỈ tạo placeholder, KHÔNG bịa nội dung text thật.",
    parameters: {
      type: "object",
      properties: {
        canvas: {
          type: "object",
          properties: {
            bgColor: { type: "string", description: "Màu nền hex, vd #0a0a0a" },
          },
        },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["text", "image", "shape"] },
              shapeKind: {
                type: "string",
                enum: ["rectangle", "circle", "badge"],
                description: "Bắt buộc khi kind=shape. Dùng 'badge' cho viên thuốc bo tròn (giá tiền, header).",
              },
              x: { type: "number", description: "Vị trí trái 0..1" },
              y: { type: "number", description: "Vị trí trên 0..1" },
              w: { type: "number", description: "Rộng 0..1" },
              h: { type: "number", description: "Cao 0..1" },
              placeholder: {
                type: "string",
                description:
                  "Với text: dùng placeholder dạng {{tên}}, {{địa chỉ}}, {{giá}}, {{ngày}}, {{tiêu đề}}, {{mô tả}}. Với shape: bỏ trống. Với image: bỏ trống.",
              },
              style: {
                type: "object",
                properties: {
                  fontSize: { type: "number" },
                  fontWeight: { type: "number" },
                  color: { type: "string" },
                  fill: { type: "string", description: "Màu nền shape" },
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

export const aiGenerateTemplateFromImageServer = createServerFn({ method: "POST" })
  .inputValidator((input: { imageDataUrl: string }) => {
    if (!input?.imageDataUrl?.startsWith("data:image/")) {
      throw new Error("imageDataUrl phải là data URL ảnh");
    }
    if (input.imageDataUrl.length > 8_000_000) {
      throw new Error("Ảnh quá lớn (>6MB) — vui lòng resize.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const result = await callGateway({
      messages: [
        {
          role: "system",
          content:
            "Bạn là designer chuyển ảnh mẫu Instagram/Threads thành khung layout JSON. " +
            "Quy tắc TUYỆT ĐỐI:\n" +
            "1. CHỈ tạo khung + placeholder. KHÔNG bịa nội dung text thật.\n" +
            "2. Mọi text phải là placeholder dạng {{tên}}, {{địa chỉ}}, {{giá}}, {{ngày}}, {{tiêu đề}}, {{mô tả}}.\n" +
            "3. Toạ độ x/y/w/h là tỉ lệ 0..1 so với canvas portrait (cao gấp 1.25 rộng).\n" +
            "4. Ảnh đại diện địa điểm dùng kind=shape + shapeKind=circle.\n" +
            "5. Badge giá tiền dùng kind=shape + shapeKind=badge + fill cam '#F97316', kèm 1 text overlay '{{giá}}' màu trắng.\n" +
            "6. Header ngày dùng shape badge fill đỏ '#dc2626' + text '{{tiêu đề}}' trắng.\n" +
            "7. Trả về qua tool build_layout, KHÔNG nói gì thêm.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Phân tích ảnh và sinh khung layout JSON theo tool build_layout." },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
          ],
        },
      ],
      tools: [TEMPLATE_TOOL],
      tool_choice: { type: "function", function: { name: "build_layout" } },
      temperature: 0.2,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    if (!result.toolArgs) return { ok: false as const, error: "AI không trả layout JSON hợp lệ" };
    return { ok: true as const, layout: result.toolArgs };
  });

// ============================================================
// B4: aiSuggestBindings
// ============================================================

const BIND_TOOL: GatewayTool = {
  type: "function",
  function: {
    name: "suggest_bindings",
    description: "Gợi ý bindingPath cho từng slot dựa vào placeholder text và danh sách cột data.",
    parameters: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slotId: { type: "string" },
              suggestedBindingPath: {
                type: "string",
                description:
                  "Một trong: entity.name, entity.address, entity.phone, entity.priceRange, entity.style, entity.openingHours, entity.categoryMain, entity.categorySub, asset.cover, asset.byRole:facade, asset.byRole:food_closeup, asset.byRole:space",
              },
              confidence: { type: "number", description: "0..1" },
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

export const aiSuggestBindingsServer = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      slots: Array<{ slotId: string; kind: string; placeholder?: string; staticText?: string }>;
      columns: string[];
    }) => {
      if (!Array.isArray(input?.slots)) throw new Error("Thiếu slots");
      if (input.slots.length > 60) throw new Error("Quá nhiều slot (>60)");
      if (!Array.isArray(input?.columns)) throw new Error("Thiếu columns");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const result = await callGateway({
      messages: [
        {
          role: "system",
          content:
            "Bạn map placeholder text → bindingPath chuẩn. Chỉ chọn bindingPath từ danh sách enum trong tool. " +
            "Nếu không chắc, đặt confidence < 0.5. KHÔNG bịa bindingPath ngoài enum.",
        },
        {
          role: "user",
          content:
            "Cột data có sẵn: " +
            JSON.stringify(data.columns) +
            "\n\nDanh sách slot:\n" +
            JSON.stringify(data.slots, null, 2),
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
  });

// ============================================================
// B5: aiCaptionFromEntity
// ============================================================

export const aiCaptionFromEntityServer = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      entity: Record<string, unknown>;
      style?: "instagram" | "threads" | "facebook";
    }) => {
      if (!input?.entity || typeof input.entity !== "object") throw new Error("Thiếu entity");
      const json = JSON.stringify(input.entity);
      if (json.length > 8000) throw new Error("Entity quá lớn");
      return { entity: input.entity, style: input.style ?? "instagram" };
    },
  )
  .handler(async ({ data }) => {
    const styleHint = {
      instagram: "Instagram caption: 2-3 dòng, có emoji vừa phải, thêm 5 hashtag liên quan ở cuối.",
      threads: "Threads post: ngắn 1-2 câu, giọng tự nhiên, KHÔNG hashtag.",
      facebook: "Facebook post: 3-5 dòng, dễ đọc, có emoji, KHÔNG hashtag.",
    }[data.style];
    const result = await callGateway({
      messages: [
        {
          role: "system",
          content:
            "Bạn viết caption tiếng Việt dựa CHỈ trên data JSON cung cấp. " +
            "Quy tắc: KHÔNG bịa thông tin (giá, địa chỉ, tên món...) không có trong data. " +
            "Nếu data thiếu trường, bỏ qua trường đó. " +
            styleHint,
        },
        {
          role: "user",
          content: "Data entity:\n```json\n" + JSON.stringify(data.entity, null, 2) + "\n```",
        },
      ],
      temperature: 0.7,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, caption: (result.content ?? "").trim() };
  });
