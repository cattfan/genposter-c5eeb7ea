// Client-side AI gateway: gọi OpenAI-compatible API trực tiếp từ browser.
// Đọc config từ AppSettings (IndexedDB). Hỗ trợ DeepSeek, Lovable, custom (vd LM Studio, vLLM, ollama).

import { getSettings } from "@/storage/settings";
import type { AiProviderConfig, AiProviderPreset } from "@/models";

export interface AiPresetSpec {
  label: string;
  baseUrl: string;
  model: string;
  visionModel?: string;
  needsApiKey: boolean;
  hint: string;
}

export const AI_PRESETS: Record<AiProviderPreset, AiPresetSpec> = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    needsApiKey: true,
    hint: "Lấy API key tại https://platform.deepseek.com",
  },
  lovable: {
    label: "Lovable AI Gateway",
    baseUrl: "https://ai.gateway.lovable.dev/v1",
    model: "google/gemini-2.5-pro",
    visionModel: "google/gemini-2.5-pro",
    needsApiKey: true,
    hint: "Dán LOVABLE_API_KEY (lấy ở Settings → Workspace → Usage)",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "http://localhost:20128/v1",
    model: "cx/gpt-5.4",
    needsApiKey: false,
    hint: "Tự điền base URL + model name. Hỗ trợ LM Studio, vLLM, ollama, hoặc bất kỳ endpoint OpenAI-compatible nào.",
  },
};

export function defaultAiConfig(preset: AiProviderPreset = "deepseek"): AiProviderConfig {
  const p = AI_PRESETS[preset];
  return {
    preset,
    baseUrl: p.baseUrl,
    model: p.model,
    visionModel: p.visionModel,
    apiKey: "",
  };
}

interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

interface GatewayTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AiCallOptions {
  messages: GatewayMessage[];
  tools?: GatewayTool[];
  tool_choice?: { type: "function"; function: { name: string } } | "auto";
  temperature?: number;
  useVisionModel?: boolean;
  /** Override config (vd test config trước khi save). Nếu không truyền, đọc từ Settings. */
  config?: AiProviderConfig;
}

export type AiCallResult =
  | { ok: true; content: string | null; toolArgs: unknown | null }
  | { ok: false; status: number; error: string };

async function loadConfig(): Promise<AiProviderConfig | null> {
  const s = await getSettings();
  return s.ai ?? null;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

export async function callAi(opts: AiCallOptions): Promise<AiCallResult> {
  const cfg = opts.config ?? (await loadConfig());
  if (!cfg || !cfg.baseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Chưa cấu hình AI provider — vào /settings để dán base URL + model.",
    };
  }
  const url = joinUrl(cfg.baseUrl, "chat/completions");
  const model = opts.useVisionModel && cfg.visionModel ? cfg.visionModel : cfg.model;
  if (!model) {
    return { ok: false, status: 0, error: "Chưa điền model name trong /settings." };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      error:
        `Không gọi được ${url}: ${msg}. ` +
        (cfg.baseUrl.includes("localhost") || cfg.baseUrl.includes("127.0.0.1")
          ? "Kiểm tra: server local đang chạy chưa? CORS có cho phép browser không? (LM Studio mặc định cho phép)."
          : "Kiểm tra mạng / CORS của provider."),
    };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 429) return { ok: false, status: 429, error: "AI rate limit — thử lại sau." };
    if (res.status === 402) return { ok: false, status: 402, error: "Hết credits AI." };
    if (res.status === 401)
      return { ok: false, status: 401, error: "API key sai/hết hạn — kiểm tra /settings." };
    return { ok: false, status: res.status, error: `AI lỗi ${res.status}: ${txt.slice(0, 400)}` };
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

/** Test 1 ping nhỏ để xác nhận provider/key/CORS hoạt động. */
export async function testAiConfig(cfg: AiProviderConfig): Promise<AiCallResult> {
  return callAi({
    config: cfg,
    messages: [
      { role: "system", content: "Reply with exactly the word: OK" },
      { role: "user", content: "ping" },
    ],
    temperature: 0,
  });
}
