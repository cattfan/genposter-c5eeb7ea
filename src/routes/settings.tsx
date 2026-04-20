import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "@/storage/settings";
import { clearAll } from "@/storage/db";
import { seedDemo } from "@/storage/seed";
import type { AiProviderConfig, AiProviderPreset, AppSettings } from "@/models";
import { toast } from "sonner";
import { AI_PRESETS, defaultAiConfig, testAiConfig } from "@/features/ai/aiClient";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);

  useEffect(() => {
    getSettings().then((loaded) => {
      // Đảm bảo có ai config mặc định
      if (!loaded.ai) loaded.ai = defaultAiConfig("deepseek");
      setS(loaded);
    });
  }, []);

  if (!s) return <div className="p-8">Đang tải...</div>;

  const ai = s.ai ?? defaultAiConfig("deepseek");
  const presetSpec = AI_PRESETS[ai.preset];

  const setAi = (next: AiProviderConfig) => setS({ ...s, ai: next });

  const onPresetChange = (preset: AiProviderPreset) => {
    if (preset === ai.preset) return;
    const fresh = defaultAiConfig(preset);
    // Giữ lại apiKey cũ nếu có (user thường dùng chung 1 key)
    if (ai.apiKey) fresh.apiKey = ai.apiKey;
    setAi(fresh);
    setTestResult(null);
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testAiConfig(ai);
      if (r.ok) {
        setTestResult({ ok: true, msg: `Provider OK. Trả về: "${(r.content ?? "").slice(0, 40)}"` });
      } else {
        setTestResult({ ok: false, msg: r.error });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">Cài đặt</h1>

      <Card>
        <CardHeader>
          <CardTitle>AI Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tất cả tính năng AI (dựng template từ ảnh, gợi ý bind, caption, combo) sẽ gọi qua endpoint
            OpenAI-compatible này. Request gửi <strong>trực tiếp từ browser</strong> nên hỗ trợ cả
            URL local (vd <code>http://localhost:20128/v1</code>).
          </p>

          <div>
            <Label>Preset</Label>
            <Select value={ai.preset} onValueChange={(v) => onPresetChange(v as AiProviderPreset)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AI_PRESETS) as AiProviderPreset[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {AI_PRESETS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{presetSpec.hint}</p>
          </div>

          <div>
            <Label>Base URL</Label>
            <Input
              value={ai.baseUrl}
              onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Model</Label>
              <Input
                value={ai.model}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                placeholder="deepseek-chat"
              />
            </div>
            <div>
              <Label>Vision model (tùy chọn)</Label>
              <Input
                value={ai.visionModel ?? ""}
                onChange={(e) => setAi({ ...ai, visionModel: e.target.value || undefined })}
                placeholder="bỏ trống → dùng cùng Model"
              />
            </div>
          </div>

          <div>
            <Label>API key {presetSpec.needsApiKey ? "" : "(tùy chọn)"}</Label>
            <Input
              type="password"
              value={ai.apiKey ?? ""}
              onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
              placeholder={presetSpec.needsApiKey ? "sk-..." : "(không cần với local LLM)"}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Lưu local trong IndexedDB của trình duyệt, không gửi lên server.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onTest} disabled={testing}>
              {testing ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                "Test kết nối"
              )}
            </Button>
            {testResult && (
              <span
                className={`flex items-center gap-1 text-sm ${
                  testResult.ok ? "text-green-600" : "text-destructive"
                }`}
              >
                {testResult.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                <span className="truncate">{testResult.msg}</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Khổ ảnh mặc định</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <div>
            <Label>Width</Label>
            <Input
              type="number"
              value={s.defaultCanvas.width}
              onChange={(e) =>
                setS({
                  ...s,
                  defaultCanvas: { ...s.defaultCanvas, width: Number(e.target.value) || 1080 },
                })
              }
            />
          </div>
          <div>
            <Label>Height</Label>
            <Input
              type="number"
              value={s.defaultCanvas.height}
              onChange={(e) =>
                setS({
                  ...s,
                  defaultCanvas: { ...s.defaultCanvas, height: Number(e.target.value) || 1350 },
                })
              }
            />
          </div>
          <div>
            <Label>Export scale</Label>
            <Input
              type="number"
              min={1}
              max={4}
              value={s.exportScale}
              onChange={(e) => setS({ ...s, exportScale: Number(e.target.value) || 2 })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dữ liệu local</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            onClick={async () => {
              await seedDemo(true);
              toast.success("Đã nạp lại demo");
            }}
          >
            Nạp lại demo
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!confirm("Xóa toàn bộ dữ liệu local?")) return;
              await clearAll();
              localStorage.removeItem("cpg_seeded_v1");
              toast.success("Đã xóa hết");
              window.location.reload();
            }}
          >
            Xóa toàn bộ dữ liệu
          </Button>
        </CardContent>
      </Card>

      <Button
        onClick={async () => {
          await saveSettings(s);
          toast.success("Đã lưu cài đặt");
        }}
      >
        Lưu cài đặt
      </Button>
    </div>
  );
}
