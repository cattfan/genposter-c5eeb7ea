import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "@/storage/useLiveQuery";
import { getSettings, saveSettings } from "@/storage/settings";
import {
  createSystemBackupZip,
  getSystemBackupFileName,
  importSystemBackupFile,
  type SystemBackupSection,
  type SystemBackupScope,
  type SystemBackupImportMode,
} from "@/storage/systemBackup";
import { db } from "@/storage/db";
import type {
  AiProviderConfig,
  AiProviderPreset,
  AppSettings,
  Asset,
  BlobRecord,
  Entity,
} from "@/models";
import { toast } from "sonner";
import saveAs from "file-saver";
import { AI_PRESETS, defaultAiConfig, testAiConfig } from "@/features/ai/aiClient";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Settings as SettingsIcon,
  Image,
  Database,
  Archive,
  Download,
  Upload,
  Trash2,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const UNDO_TOAST_DURATION = 15_000;

const BACKUP_SECTION_OPTIONS: Array<{
  value: SystemBackupSection;
  label: string;
  description: string;
}> = [
  {
    value: "systemData",
    label: "Dữ liệu hệ thống",
    description: "Dữ liệu import, lịch sử, cài đặt, asset và thư viện local.",
  },
  {
    value: "packTemplates",
    label: "Bộ khuôn",
    description: "Bộ khuôn và các trang khuôn đang được dùng.",
  },
  {
    value: "generatePresets",
    label: "Khuôn đổ dữ liệu",
    description: "Khuôn tạo nội dung, kèm bộ khuôn và trang khuôn liên quan.",
  },
];

function getBackupScopeFromSections(sections: SystemBackupSection[]): SystemBackupScope {
  const selected = new Set(sections);
  if (
    selected.has("systemData") &&
    selected.has("packTemplates") &&
    selected.has("generatePresets")
  ) {
    return "all";
  }
  if (selected.size === 1 && selected.has("packTemplates")) return "packTemplates";
  if (selected.size === 1 && selected.has("generatePresets")) return "generatePresets";
  return "custom";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function uniqueAssetBlobKeys(assets: Asset[]) {
  return Array.from(
    new Set(
      assets.map((asset) => asset.blobKey).filter((blobKey): blobKey is string => Boolean(blobKey)),
    ),
  );
}

async function readAssetBlobs(assets: Asset[]): Promise<BlobRecord[]> {
  const blobKeys = uniqueAssetBlobKeys(assets);
  if (blobKeys.length === 0) return [];
  return db.blobs.where("blobKey").anyOf(blobKeys).toArray();
}

async function restoreImportedImages(assets: Asset[], blobs: BlobRecord[]) {
  await db.transaction("rw", [db.assets, db.blobs], async () => {
    if (blobs.length) await db.blobs.bulkPut(blobs);
    if (assets.length) await db.assets.bulkPut(assets);
  });
}

async function restoreImportedData(entities: Entity[], assets: Asset[], blobs: BlobRecord[]) {
  await db.transaction("rw", [db.entities, db.assets, db.blobs], async () => {
    if (entities.length) await db.entities.bulkPut(entities);
    if (blobs.length) await db.blobs.bulkPut(blobs);
    if (assets.length) await db.assets.bulkPut(assets);
  });
}

async function restoreAllLocalData(entities: Entity[], assets: Asset[], blobs: BlobRecord[]) {
  await restoreImportedData(entities, assets, blobs);
}

function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSections, setBackupSections] = useState<SystemBackupSection[]>([
    "systemData",
    "packTemplates",
    "generatePresets",
  ]);
  const [backupIncludeImages, setBackupIncludeImages] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const entities = useLiveQuery(() => db.entities.toArray(), []) ?? [];
  const assets = useLiveQuery(() => db.assets.toArray(), []) ?? [];
  const packTemplatesCount = useLiveQuery(() => db.packTemplates.count(), []) ?? 0;
  const pageTemplatesCount = useLiveQuery(() => db.pageTemplates.count(), []) ?? 0;
  const designDocsCount = useLiveQuery(() => db.designDocuments.count(), []) ?? 0;
  const jobsCount = useLiveQuery(() => db.jobs.count(), []) ?? 0;
  const generatePresetsCount = useLiveQuery(() => db.generatePresets.count(), []) ?? 0;
  const symbolsCount = useLiveQuery(() => db.symbols.count(), []) ?? 0;
  const localImageCount = assets.filter((asset) => asset.blobKey).length;

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
  const backupScope = getBackupScopeFromSections(backupSections);
  const canExportBackup = backupSections.length > 0;

  const setAi = (next: AiProviderConfig) => setS({ ...s, ai: next });

  const toggleBackupSection = (section: SystemBackupSection, checked: boolean) => {
    setBackupSections((current) => {
      if (checked) return Array.from(new Set([...current, section]));
      return current.filter((item) => item !== section);
    });
  };

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
        setTestResult({
          ok: true,
          msg: `Provider OK. Trả về: "${(r.content ?? "").slice(0, 40)}"`,
        });
      } else {
        setTestResult({ ok: false, msg: r.error });
      }
    } finally {
      setTesting(false);
    }
  };

  const exportBackup = async () => {
    setBackupBusy(true);
    try {
      const blob = await createSystemBackupZip({
        sections: backupSections,
        includeImages: backupIncludeImages,
      });
      saveAs(blob, getSystemBackupFileName(Date.now(), backupScope, backupIncludeImages));
      toast.success("Đã tải backup.");
    } catch (error) {
      toast.error(`Lỗi backup: ${errorMessage(error)}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) setPendingImportFile(file);
  };

  const runBackupImport = async (mode: SystemBackupImportMode) => {
    if (!pendingImportFile) return;
    setImportBusy(true);
    try {
      const result = await importSystemBackupFile(pendingImportFile, mode);
      if (result.warning) toast.warning(result.warning, { duration: 8000 });
      toast.success(result.message);
      setPendingImportFile(null);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      toast.error(`Lỗi import backup: ${errorMessage(error)}`);
    } finally {
      setImportBusy(false);
    }
  };

  const clearImportedImages = async () => {
    const snapshotAssets = await db.assets.toArray();
    const snapshotBlobs = await readAssetBlobs(snapshotAssets);

    await db.transaction("rw", [db.assets, db.blobs], async () => {
      await db.assets.clear();
      const blobKeys = uniqueAssetBlobKeys(snapshotAssets);
      if (blobKeys.length) await db.blobs.bulkDelete(blobKeys);
    });

    toast.success(`Đã xoá ${snapshotAssets.length} ảnh đã import`, {
      duration: UNDO_TOAST_DURATION,
      action:
        snapshotAssets.length || snapshotBlobs.length
          ? {
              label: "Khôi phục",
              onClick: () => {
                void restoreImportedImages(snapshotAssets, snapshotBlobs).then(() => {
                  toast.success("Đã khôi phục ảnh");
                });
              },
            }
          : undefined,
    });
  };

  const clearImportedData = async () => {
    const snapshotEntities = await db.entities.toArray();

    await db.transaction("rw", [db.entities], async () => {
      await db.entities.clear();
    });

    toast.success(`Đã xoá ${snapshotEntities.length} dòng dữ liệu đã import`, {
      duration: UNDO_TOAST_DURATION,
      action:
        snapshotEntities.length
          ? {
              label: "Khôi phục",
              onClick: () => {
                void db.entities.bulkPut(snapshotEntities).then(() => {
                  toast.success("Đã khôi phục dữ liệu");
                });
              },
            }
          : undefined,
    });
  };

  const clearAllLocalData = async () => {
    const snapshotEntities = await db.entities.toArray();
    const snapshotAssets = await db.assets.toArray();
    const snapshotBlobs = await readAssetBlobs(snapshotAssets);

    await db.transaction("rw", [db.entities, db.assets, db.blobs], async () => {
      await db.entities.clear();
      await db.assets.clear();
      const blobKeys = uniqueAssetBlobKeys(snapshotAssets);
      if (blobKeys.length) await db.blobs.bulkDelete(blobKeys);
    });

    toast.success("Đã xoá tất cả dữ liệu local", {
      duration: UNDO_TOAST_DURATION,
      action:
        snapshotEntities.length || snapshotAssets.length || snapshotBlobs.length
          ? {
              label: "Khôi phục",
              onClick: () => {
                void restoreAllLocalData(snapshotEntities, snapshotAssets, snapshotBlobs).then(
                  () => {
                    toast.success("Đã khôi phục dữ liệu local");
                  },
                );
              },
            }
          : undefined,
    });
  };

  const clearAllTemplates = async () => {
    const [packs, pages, designs, jobs, presets, symbols, overrides] = await Promise.all([
      db.packTemplates.toArray(),
      db.pageTemplates.toArray(),
      db.designDocuments.toArray(),
      db.jobs.toArray(),
      db.generatePresets.toArray(),
      db.symbols.toArray(),
      db.overrides.toArray(),
    ]);
    const summary = `${packs.length} bộ · ${pages.length} trang · ${designs.length} design · ${jobs.length} lần tạo · ${presets.length} preset · ${symbols.length} symbol`;

    await db.transaction(
      "rw",
      [
        db.packTemplates,
        db.pageTemplates,
        db.designDocuments,
        db.jobs,
        db.generatePresets,
        db.symbols,
        db.overrides,
      ],
      async () => {
        await db.packTemplates.clear();
        await db.pageTemplates.clear();
        await db.designDocuments.clear();
        await db.jobs.clear();
        await db.generatePresets.clear();
        await db.symbols.clear();
        await db.overrides.clear();
      },
    );

    toast.success(`Đã xoá tất cả khuôn mẫu (${summary})`, {
      duration: UNDO_TOAST_DURATION,
      action: {
        label: "Khôi phục",
        onClick: () => {
          void db
            .transaction(
              "rw",
              [
                db.packTemplates,
                db.pageTemplates,
                db.designDocuments,
                db.jobs,
                db.generatePresets,
                db.symbols,
                db.overrides,
              ],
              async () => {
                if (packs.length) await db.packTemplates.bulkPut(packs);
                if (pages.length) await db.pageTemplates.bulkPut(pages);
                if (designs.length) await db.designDocuments.bulkPut(designs);
                if (jobs.length) await db.jobs.bulkPut(jobs);
                if (presets.length) await db.generatePresets.bulkPut(presets);
                if (symbols.length) await db.symbols.bulkPut(symbols);
                if (overrides.length) await db.overrides.bulkPut(overrides);
              },
            )
            .then(() => toast.success("Đã khôi phục khuôn mẫu"));
        },
      },
    });
  };

  return (
    <PageContainer className="max-w-3xl space-y-6">
      <PageHeader
        icon={<SettingsIcon className="size-5" />}
        title="Cài đặt"
        description="Cấu hình AI provider, backup dữ liệu, và các tuỳ chọn khác."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="size-5" />
            Sao lưu & khôi phục
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label>Phạm vi backup</Label>
              <div className="grid gap-2 lg:grid-cols-3">
                {BACKUP_SECTION_OPTIONS.map((option) => {
                  const checked = backupSections.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className="flex min-h-24 cursor-pointer items-start gap-3 rounded-md border bg-background p-3 transition-colors hover:border-primary/40"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleBackupSection(option.value, value === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {!canExportBackup ? (
                <div className="text-xs text-destructive">Chọn ít nhất một mục để backup.</div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
              <div>
                <div className="text-sm font-medium">Backup ảnh local</div>
                <div className="text-xs text-muted-foreground">
                  Tắt để file nhẹ hơn, nhưng ảnh trong IndexedDB không được khôi phục.
                </div>
              </div>
              <Switch checked={backupIncludeImages} onCheckedChange={setBackupIncludeImages} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <div className="font-medium">Tải backup</div>
              <Button
                className="mt-4 w-full"
                onClick={() => void exportBackup()}
                disabled={backupBusy || !canExportBackup}
              >
                {backupBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Tải backup
              </Button>
            </div>

            <div className="rounded-lg border p-4">
              <div className="font-medium">Nhập backup</div>
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => backupInputRef.current?.click()}
                disabled={importBusy}
              >
                <Upload className="size-4" />
                Chọn file backup
              </Button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".zip,.json,application/zip,application/json"
                className="hidden"
                onChange={chooseImportFile}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(pendingImportFile)}
        onOpenChange={(open) => {
          if (!open && !importBusy) setPendingImportFile(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Chọn cách import backup</AlertDialogTitle>
            <AlertDialogDescription>
              File: {pendingImportFile?.name}. Nhập thêm sẽ upsert theo ID. Khôi phục ghi đè sẽ xoá
              toàn bộ dữ liệu local hiện tại rồi restore từ backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importBusy}>Huỷ</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => void runBackupImport("merge")}
              disabled={importBusy}
            >
              {importBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              Nhập thêm
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runBackupImport("replace")}
              disabled={importBusy}
            >
              Khôi phục ghi đè
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle>AI Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tất cả tính năng AI sẽ gọi qua endpoint OpenAI-compatible này. App gửi qua server
            local trước để tránh lỗi CORS của provider.
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
              Lưu local trong trình duyệt. Khi gọi AI, key chỉ được gửi tới server local và
              provider đã cấu hình.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onTest} disabled={testing}>
              {testing ? <Loader2 className="size-4 mr-2 animate-spin" /> : "Test kết nối"}
            </Button>
            {testResult && (
              <span
                className={`flex items-center gap-1 text-sm ${
                  testResult.ok ? "text-green-600" : "text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <XCircle className="size-4" />
                )}
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
                  defaultCanvas: { ...s.defaultCanvas, width: Number(e.target.value) || 1588 },
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
                  defaultCanvas: { ...s.defaultCanvas, height: Number(e.target.value) || 2248 },
                })
              }
            />
          </div>
          <div>
            <Label>Độ nét file tải xuống</Label>
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
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Trash2 />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Tất cả (data)</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {entities.length} dòng, {assets.length} ảnh.
                </div>
              </div>
            </div>
            <Button
              variant="destructive"
              className="mt-4 w-full"
              onClick={() => void clearAllLocalData()}
              disabled={entities.length === 0 && assets.length === 0}
            >
              Xoá tất cả
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Image />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Ảnh</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {assets.length} asset, {localImageCount} ảnh local.
                </div>
              </div>
            </div>
            <Button
              variant="destructive"
              className="mt-4 w-full"
              onClick={() => void clearImportedImages()}
              disabled={assets.length === 0}
            >
              Xoá ảnh
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Database />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Dữ liệu sheet</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {entities.length} dòng dữ liệu.
                </div>
              </div>
            </div>
            <Button
              variant="destructive"
              className="mt-4 w-full"
              onClick={() => void clearImportedData()}
              disabled={entities.length === 0 && assets.length === 0}
            >
              Xoá dữ liệu sheet
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Trash2 />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Khuôn mẫu</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {packTemplatesCount} bộ, {pageTemplatesCount} trang,{" "}
                  {designDocsCount} design, {jobsCount} lần tạo, {generatePresetsCount}{" "}
                  preset, {symbolsCount} symbol.
                </div>
              </div>
            </div>
            <Button
              variant="destructive"
              className="mt-4 w-full"
              onClick={() => void clearAllTemplates()}
              disabled={
                packTemplatesCount === 0 &&
                pageTemplatesCount === 0 &&
                designDocsCount === 0 &&
                jobsCount === 0 &&
                generatePresetsCount === 0 &&
                symbolsCount === 0
              }
            >
              Xoá khuôn mẫu
            </Button>
          </div>
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
    </PageContainer>
  );
}
