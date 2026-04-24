import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  Layers,
  Loader2,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AnalysisMode,
  AnalysisRecord,
  CompatibilityReport,
  DraftReadiness,
  GapCategory,
  GapItem,
  GapLevel,
  InferredDataRequirement,
  PageTemplate,
} from "@/models";
import { db, saveBlob } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LayoutGuides } from "@/features/render/LayoutGuides";
import { PageRenderer } from "@/features/render/PageRenderer";
import { downloadJSON, downloadText } from "@/features/render/exportPng";
import {
  buildAnalysisSummaryText,
  compatibilityLabelText,
  draftReadinessText,
  runReversePackAnalysis,
} from "@/engines/analysis/reversePackAnalyzer";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { Search } from "lucide-react";

export const Route = createFileRoute("/analysis")({
  component: AnalysisPage,
});

type UploadImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type CompactItem = {
  key: string;
  label: string;
  meta?: string;
};

const GAP_LABELS: Record<GapLevel, string> = {
  have: "Đã có",
  mappable: "Có thể map / suy luận",
  missing_required: "Thiếu bắt buộc",
  missing_optional: "Thiếu nhưng có thể bỏ qua",
  risk: "Rủi ro dữ liệu",
};

const KIND_LABELS: Record<string, string> = {
  data_field: "Field thật",
  asset: "Asset",
  structural: "Cấu trúc",
  manual_literal: "Nhập tay",
};

function modeLabel(mode: AnalysisMode): string {
  if (mode === "deep_draft") return "Phân tích sâu + tạo draft";
  if (mode === "draft_only") return "Chỉ tạo draft giống mẫu";
  return "Phân tích nhanh";
}

function draftBadgeVariant(level: DraftReadiness): "default" | "secondary" | "outline" {
  if (level === "ready") return "default";
  if (level === "needs_data") return "secondary";
  return "outline";
}

function truncate(text: string, max = 140): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function requirementGroups(pack: AnalysisRecord["pack"]) {
  if (pack.dataBlueprintGroups) return pack.dataBlueprintGroups;
  const all = pack.dataBlueprint ?? [];
  return {
    pageLevel: all.filter((item) => item.scope === "page" || item.scope === "pack"),
    sectionLevel: all.filter((item) => item.scope === "section"),
    itemLevel: all.filter((item) => item.scope === "item"),
    assetLevel: all.filter((item) => item.scope === "asset"),
  };
}

function gapItemsByCategory(
  report: CompatibilityReport,
  category: GapCategory,
): Record<GapLevel, GapItem[]> {
  return {
    have: report.groups.have.filter((item) => item.category === category),
    mappable: report.groups.mappable.filter((item) => item.category === category),
    missing_required: report.groups.missing_required.filter((item) => item.category === category),
    missing_optional: report.groups.missing_optional.filter((item) => item.category === category),
    risk: report.groups.risk.filter((item) => item.category === category || category === "field"),
  };
}

function requirementPriority(item: InferredDataRequirement): number {
  let score = item.required ? 100 : 0;
  if (item.kind === "data_field") score += 35;
  else if (item.kind === "asset") score += 30;
  else if (item.kind === "structural") score += 20;
  else score += 5;

  if (item.scope === "item") score += 8;
  else if (item.scope === "section") score += 6;
  else if (item.scope === "page") score += 4;

  return score;
}

function pickRequirementHighlights(
  requirements: InferredDataRequirement[],
  options?: { limit?: number; manualOnly?: boolean; excludeManual?: boolean },
): InferredDataRequirement[] {
  const { limit = 3, manualOnly = false, excludeManual = false } = options ?? {};
  const filtered = requirements.filter((item) => {
    if (manualOnly) return item.kind === "manual_literal" || item.acceptsManualInput;
    if (excludeManual) return item.kind !== "manual_literal" && !item.acceptsManualInput;
    return true;
  });

  return uniqueBy(
    filtered.slice().sort((a, b) => requirementPriority(b) - requirementPriority(a)),
    (item) => item.label,
  ).slice(0, limit);
}

function pickGapHighlights(report: CompatibilityReport, limit = 3): GapItem[] {
  return uniqueBy(
    [
      ...report.groups.missing_required,
      ...report.groups.risk,
      ...report.groups.mappable,
      ...report.groups.missing_optional,
    ],
    (item) => item.message,
  ).slice(0, limit);
}

function pickSheetReasonHighlights(report: CompatibilityReport, limit = 3): string[] {
  const topSheet = report.sheets[0];
  const reasons = uniqueBy(topSheet?.reasons ?? [], (item) => item).slice(0, limit);
  if (reasons.length > 0) return reasons.map((item) => truncate(item, 110));
  if (report.reasonSummary) return [truncate(report.reasonSummary, 140)];
  return [];
}

function compactRequirementItems(
  requirements: InferredDataRequirement[],
  limit = 3,
): CompactItem[] {
  return pickRequirementHighlights(requirements, { limit, excludeManual: true }).map((item) => ({
    key: item.requirementId,
    label: item.label,
    meta: KIND_LABELS[item.kind ?? "data_field"] ?? item.kind,
  }));
}

function compactManualItems(requirements: InferredDataRequirement[], limit = 3): CompactItem[] {
  return pickRequirementHighlights(requirements, { limit, manualOnly: true }).map((item) => ({
    key: item.requirementId,
    label: item.label,
    meta: "Có thể nhập tay",
  }));
}

function compactGapItems(report: CompatibilityReport, limit = 3): CompactItem[] {
  return pickGapHighlights(report, limit).map((item) => ({
    key: item.gapId,
    label: truncate(item.message, 120),
  }));
}

function requirementScopeTitle(title: string, items: InferredDataRequirement[]) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={item.requirementId}
            className="max-w-full rounded-lg border bg-muted/20 px-3 py-2 text-xs"
          >
            <div className="font-medium">{item.label}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline">{KIND_LABELS[item.kind ?? "data_field"] ?? item.kind}</Badge>
              <Badge variant={item.required ? "default" : "secondary"}>
                {item.required ? "Bắt buộc" : "Tuỳ chọn"}
              </Badge>
              {item.acceptsManualInput && <Badge variant="secondary">Có thể nhập tay</Badge>}
            </div>
            {(item.bindCandidate || item.bindCandidates?.length || item.notes) && (
              <div className="mt-1 break-words text-muted-foreground">
                {item.bindCandidate && <div>Bind gợi ý: {item.bindCandidate}</div>}
                {item.minRecords ? <div>Cần khoảng {item.minRecords} record</div> : null}
                {item.notes ? <div>{item.notes}</div> : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function gapColumn(title: string, items: GapItem[]) {
  return (
    <div className="rounded-lg border bg-muted/10 p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">Không có mục nào.</div>
      ) : (
        <ul className="space-y-2 text-xs">
          {items.map((item) => (
            <li key={item.gapId} className="rounded bg-background px-2 py-1.5">
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompactList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: CompactItem[];
  emptyText?: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
      <div className="text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyText ?? "Không có mục nào."}</div>
      ) : (
        <ul className="space-y-2 text-xs">
          {items.map((item) => (
            <li key={item.key} className="rounded bg-background px-2 py-1.5">
              <div>{item.label}</div>
              {item.meta ? <div className="mt-1 text-muted-foreground">{item.meta}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnalysisPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const entities = useLiveQuery(() => db.entities.toArray(), []) ?? [];
  const assets = useLiveQuery(() => db.assets.toArray(), []) ?? [];
  const analyses =
    useLiveQuery(() => db.analyses.orderBy("createdAt").reverse().toArray(), []) ?? [];

  const [mode, setMode] = useState<AnalysisMode>("quick");
  const [images, setImages] = useState<UploadImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [currentRecord, setCurrentRecord] = useState<AnalysisRecord | null>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, [images]);

  useEffect(() => {
    const ids = currentRecord?.draft?.pageTemplates.map((item) => item.pageTemplateId) ?? [];
    setSelectedDraftIds(ids);
  }, [currentRecord?.analysisId, currentRecord?.draft?.pageTemplates]);

  const pickFiles = () => fileRef.current?.click();

  const onFiles = (list: FileList | null) => {
    const nextFiles = Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
    if (nextFiles.length === 0) return;
    setImages((prev) => [
      ...prev,
      ...nextFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((image) => image.id !== id);
    });
  };

  const runAnalysis = async () => {
    if (images.length === 0) {
      toast.error("Chưa có ảnh để phân tích.");
      return;
    }
    setBusy(true);
    setProgressText("Đang lưu ảnh và gọi AI phân tích...");
    try {
      const uploaded = await Promise.all(
        images.map(async (image) => ({
          name: image.file.name,
          dataUrl: await image.file.arrayBuffer().then(
            (buffer) =>
              new Promise<string>((resolve, reject) => {
                const blob = new Blob([buffer], { type: image.file.type });
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              }),
          ),
          blobKey: await saveBlob(image.file),
        })),
      );

      const result = await runReversePackAnalysis({
        images: uploaded,
        mode,
        entities,
        assets,
        onProgress: (step) => setProgressText(step),
      });

      const now = Date.now();
      const record: AnalysisRecord = {
        analysisId: crypto.randomUUID(),
        title: result.pack.title,
        mode,
        imageBlobKeys: uploaded.map((image) => image.blobKey),
        imageNames: uploaded.map((image) => image.name),
        imageOrder: uploaded.map((image) => image.blobKey),
        pack: result.pack,
        draft: result.draft,
        createdAt: now,
        updatedAt: now,
      };

      await db.analyses.put(record);
      setCurrentRecord(record);
      toast.success("Đã phân tích xong bộ ảnh.");
    } catch (error) {
      toast.error("Phân tích lỗi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  const saveWholeDraft = async () => {
    if (!currentRecord?.draft?.packTemplate) return;
    await db.transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
      await db.pageTemplates.bulkPut(currentRecord.draft!.pageTemplates);
      await db.packTemplates.put(currentRecord.draft!.packTemplate!);
    });
    toast.success("Đã lưu cả bộ draft.");
  };

  const saveDraftPage = async (pageTemplate: PageTemplate) => {
    await db.pageTemplates.put(pageTemplate);
    toast.success(`Đã lưu page "${pageTemplate.name}".`);
  };

  const saveSelectedDrafts = async () => {
    const pageTemplates =
      currentRecord?.draft?.pageTemplates.filter((item) =>
        selectedDraftIds.includes(item.pageTemplateId),
      ) ?? [];
    if (pageTemplates.length === 0) {
      toast.error("Chưa chọn mẫu nào để lưu.");
      return;
    }
    await db.pageTemplates.bulkPut(pageTemplates);
    toast.success(`Đã lưu ${pageTemplates.length} page template đã chọn.`);
  };

  const toggleDraftSelection = (pageTemplateId: string, checked: boolean) => {
    setSelectedDraftIds((prev) =>
      checked
        ? [...new Set([...prev, pageTemplateId])]
        : prev.filter((id) => id !== pageTemplateId),
    );
  };

  const exportArtifacts = (record: AnalysisRecord) => {
    downloadJSON(record.pack, "analysis_summary.json");
    downloadJSON(record.pack.compatibility, "compatibility_report.json");
    downloadJSON(record.draft ?? {}, "draft_template_suggestion.json");
    downloadText(buildAnalysisSummaryText(record.pack), "analysis_summary_vi.txt");
  };

  const dataGroups = useMemo(
    () => (currentRecord ? requirementGroups(currentRecord.pack) : null),
    [currentRecord],
  );

  const quickNeedItems = useMemo(
    () => (currentRecord ? compactRequirementItems(currentRecord.pack.dataBlueprint ?? [], 5) : []),
    [currentRecord],
  );

  const quickMissingItems = useMemo(
    () => (currentRecord ? compactGapItems(currentRecord.pack.compatibility, 5) : []),
    [currentRecord],
  );

  const quickManualItems = useMemo(
    () => (currentRecord ? compactManualItems(currentRecord.pack.dataBlueprint ?? [], 5) : []),
    [currentRecord],
  );
  const isDraftOnly = currentRecord?.mode === "draft_only";

  return (
    <PageContainer className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      <PageHeader
        icon={<Search className="size-5" />}
        title="Phân tích bộ ảnh"
        description="Quăng một hoặc nhiều ảnh mẫu vào để AI phân tích cấu trúc, dữ liệu cần có và khả năng tái tạo."
        actions={
          <>
            <Button variant="outline" onClick={pickFiles} disabled={busy}>
              <Layers className="mr-2 size-4" />
              Chọn ảnh
            </Button>
            <Select value={mode} onValueChange={(value) => setMode(value as AnalysisMode)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick">Phân tích nhanh</SelectItem>
                <SelectItem value="deep_draft">Phân tích sâu + tạo draft</SelectItem>
                <SelectItem value="draft_only">Chỉ tạo draft giống mẫu</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runAnalysis} disabled={busy || images.length === 0}>
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              Phân tích
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Ảnh đầu vào</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{modeLabel(mode)}</Badge>
            <Badge variant="outline">Phân tích theo đúng thứ tự hiện tại</Badge>
          </div>
          {images.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              Chưa có ảnh nào. Bấm "Chọn ảnh" để bắt đầu.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {images.map((image, index) => (
                <Card key={image.id} className="overflow-hidden">
                  <div className="aspect-[4/5] bg-muted">
                    <img
                      src={image.previewUrl}
                      alt={image.file.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <CardContent className="space-y-2 p-2">
                    <div className="truncate text-xs font-semibold">
                      Ảnh {index + 1} · {image.file.name}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => moveImage(index, -1)}
                        disabled={index === 0 || busy}
                      >
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => moveImage(index, 1)}
                        disabled={index === images.length - 1 || busy}
                      >
                        <ArrowDown className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeImage(image.id)}
                        disabled={busy}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {busy && <div className="text-sm text-muted-foreground">{progressText}</div>}
        </CardContent>
      </Card>

      {currentRecord && (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Pack Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <b>Tên pack dự đoán:</b> {currentRecord.pack.title}
                </div>
                <div>
                  <b>Tổng số ảnh:</b> {currentRecord.pack.imageCount}
                </div>
                <div>
                  <b>Mức độ tương thích:</b> {currentRecord.pack.compatibility.score}/100 ·{" "}
                  {compatibilityLabelText(currentRecord.pack.compatibility.label)}
                </div>
                {currentRecord.pack.compatibility.bestMatchSheet && (
                  <div>
                    <b>Sheet nổi bật:</b> {currentRecord.pack.compatibility.bestMatchSheet}
                  </div>
                )}
                <div>
                  <b>Cấu trúc pack:</b>
                </div>
                <ul className="list-disc space-y-1 pl-5">
                  {currentRecord.pack.structureSummary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="pt-2">
                  <Button variant="outline" onClick={() => exportArtifacts(currentRecord)}>
                    <Download className="mr-2 size-4" />
                    Export kết quả
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>UI Blueprint</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {currentRecord.pack.uiBlueprint.map((line, index) => (
                  <div key={index} className="rounded border bg-muted/20 p-3">
                    {line}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {!isDraftOnly && (
            <Card>
              <CardHeader>
                <CardTitle>Data Blueprint</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <CompactList
                    title="Bạn cần chuẩn bị"
                    items={quickNeedItems}
                    emptyText="Chưa có requirement nổi bật."
                  />
                  <CompactList
                    title="Thiếu đáng chú ý"
                    items={quickMissingItems}
                    emptyText="Không có thiếu hụt đáng chú ý."
                  />
                  <CompactList
                    title="Có thể nhập tay"
                    items={quickManualItems}
                    emptyText="Không có text nhập tay nổi bật."
                  />
                </div>

                {dataGroups && (
                  <Accordion type="single" collapsible>
                    <AccordionItem value="data-blueprint-detail">
                      <AccordionTrigger>Xem chi tiết Data Blueprint</AccordionTrigger>
                      <AccordionContent className="space-y-4">
                        {requirementScopeTitle("Field page-level", dataGroups.pageLevel)}
                        {requirementScopeTitle("Field section-level", dataGroups.sectionLevel)}
                        {requirementScopeTitle("Field item-level", dataGroups.itemLevel)}
                        {requirementScopeTitle("Asset-level", dataGroups.assetLevel)}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          {!isDraftOnly && (
            <Card>
              <CardHeader>
                <CardTitle>Page-by-page Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {currentRecord.pack.pages.map((page, index) => {
                  const fieldGaps = gapItemsByCategory(page.compatibility, "field");
                  const assetGaps = gapItemsByCategory(page.compatibility, "asset");
                  const structuralGaps = gapItemsByCategory(page.compatibility, "structure");
                  const reasonHighlights = pickSheetReasonHighlights(page.compatibility, 3);
                  const requirementHighlights = compactRequirementItems(page.requiredFields, 3);
                  const pageGapHighlights = compactGapItems(page.compatibility, 3);
                  const manualHighlights = compactManualItems(page.requiredFields, 2);

                  return (
                    <div key={page.pageIndex} className="space-y-4 rounded-xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="font-semibold">
                            Ảnh {index + 1} · {page.suggestedName}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {truncate(page.summary, 180)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{page.pageType}</Badge>
                          <Badge variant="secondary">
                            {page.compatibility.score}/100 ·{" "}
                            {compatibilityLabelText(page.compatibility.label)}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
                          <div className="text-sm font-medium">Sheet phù hợp nhất</div>
                          <div className="text-sm font-semibold">
                            {page.compatibility.bestMatchSheet ?? "Chưa xác định"}
                          </div>
                          {reasonHighlights.length > 0 ? (
                            <ul className="space-y-2 text-xs text-muted-foreground">
                              {reasonHighlights.map((reason) => (
                                <li key={reason}>• {reason}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {page.compatibility.reasonSummary ?? "Chưa có nhận định chi tiết."}
                            </div>
                          )}
                        </div>

                        <CompactList
                          title="Cần chuẩn bị"
                          items={requirementHighlights}
                          emptyText="Không có requirement nổi bật."
                        />

                        <CompactList
                          title="Thiếu đáng chú ý"
                          items={pageGapHighlights}
                          emptyText="Không có thiếu hụt đáng chú ý."
                        />
                      </div>

                      {manualHighlights.length > 0 && (
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="text-sm font-medium">Có thể nhập tay</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {manualHighlights.map((item) => (
                              <Badge key={item.key} variant="secondary">
                                {item.label}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      <Accordion type="single" collapsible>
                        <AccordionItem value={`page-detail-${page.pageIndex}`}>
                          <AccordionTrigger>Xem chi tiết</AccordionTrigger>
                          <AccordionContent className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                              <div className="space-y-2 xl:col-span-1">
                                <div className="text-sm font-medium">Sheet phù hợp nhất</div>
                                <div className="rounded-lg border bg-muted/10 p-3 text-sm">
                                  <div className="font-semibold">
                                    {page.compatibility.bestMatchSheet ?? "Chưa xác định"}
                                  </div>
                                  <div className="mt-1 text-muted-foreground">
                                    {page.compatibility.reasonSummary ??
                                      "Chưa có nhận định chi tiết."}
                                  </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                  <div className="rounded-lg border bg-muted/10 p-2">
                                    <div className="font-medium">Field</div>
                                    <div className="mt-1 text-muted-foreground">
                                      {fieldGaps.have.length +
                                        fieldGaps.mappable.length +
                                        fieldGaps.missing_required.length +
                                        fieldGaps.missing_optional.length +
                                        fieldGaps.risk.length}{" "}
                                      mục
                                    </div>
                                  </div>
                                  <div className="rounded-lg border bg-muted/10 p-2">
                                    <div className="font-medium">Asset</div>
                                    <div className="mt-1 text-muted-foreground">
                                      {assetGaps.have.length +
                                        assetGaps.mappable.length +
                                        assetGaps.missing_required.length +
                                        assetGaps.missing_optional.length +
                                        assetGaps.risk.length}{" "}
                                      mục
                                    </div>
                                  </div>
                                  <div className="rounded-lg border bg-muted/10 p-2">
                                    <div className="font-medium">Cấu trúc</div>
                                    <div className="mt-1 text-muted-foreground">
                                      {structuralGaps.have.length +
                                        structuralGaps.mappable.length +
                                        structuralGaps.missing_required.length +
                                        structuralGaps.missing_optional.length +
                                        structuralGaps.risk.length}{" "}
                                      mục
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-2 xl:col-span-2">
                                <div className="text-sm font-medium">Top 3 sheet phù hợp</div>
                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                                  {page.compatibility.sheets.slice(0, 3).map((sheet) => (
                                    <div
                                      key={sheet.sheetName}
                                      className="rounded-lg border p-3 text-sm"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="font-semibold">{sheet.sheetName}</div>
                                        <Badge variant="outline">
                                          {sheet.score}/100 · {compatibilityLabelText(sheet.label)}
                                        </Badge>
                                      </div>
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        {sheet.reasonSummary || "Chưa có reason summary."}
                                      </div>
                                      {sheet.reasons && sheet.reasons.length > 0 && (
                                        <ul className="mt-2 space-y-1 text-xs">
                                          {sheet.reasons.slice(0, 3).map((reason) => (
                                            <li key={reason}>• {reason}</li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="text-sm font-medium">Field cần có</div>
                              <div className="rounded-lg border bg-muted/10 p-3">
                                <div className="flex flex-wrap gap-2">
                                  {page.requiredFields.map((field) => (
                                    <div
                                      key={field.requirementId}
                                      className="rounded-lg border bg-background px-3 py-2 text-xs"
                                    >
                                      <div className="font-medium">{field.label}</div>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        <Badge variant="outline">
                                          {KIND_LABELS[field.kind ?? "data_field"] ?? field.kind}
                                        </Badge>
                                        <Badge variant={field.required ? "default" : "secondary"}>
                                          {field.required ? "Bắt buộc" : "Tuỳ chọn"}
                                        </Badge>
                                      </div>
                                      {(field.bindCandidate || field.notes || field.minRecords) && (
                                        <div className="mt-1 text-muted-foreground">
                                          {field.bindCandidate ? (
                                            <div>Bind: {field.bindCandidate}</div>
                                          ) : null}
                                          {field.minRecords ? (
                                            <div>Cần khoảng {field.minRecords} record</div>
                                          ) : null}
                                          {field.notes ? <div>{field.notes}</div> : null}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="text-sm font-medium">Gợi ý dữ liệu còn thiếu</div>
                              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                {(Object.keys(GAP_LABELS) as GapLevel[]).map((level) => (
                                  <div key={level}>
                                    {gapColumn(GAP_LABELS[level], page.compatibility.groups[level])}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                              {gapColumn("Field-level gaps", [
                                ...fieldGaps.have,
                                ...fieldGaps.mappable,
                                ...fieldGaps.missing_required,
                                ...fieldGaps.missing_optional,
                                ...fieldGaps.risk,
                              ])}
                              {gapColumn("Asset gaps", [
                                ...assetGaps.have,
                                ...assetGaps.mappable,
                                ...assetGaps.missing_required,
                                ...assetGaps.missing_optional,
                                ...assetGaps.risk,
                              ])}
                              {gapColumn("Structural gaps", [
                                ...structuralGaps.have,
                                ...structuralGaps.mappable,
                                ...structuralGaps.missing_required,
                                ...structuralGaps.missing_optional,
                                ...structuralGaps.risk,
                              ])}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {currentRecord.draft && (
            <Card>
              <CardHeader>
                <CardTitle>Tạo bản nháp</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <div>
                      <b>Draft readiness:</b>{" "}
                      {currentRecord.draft.readinessLabel ??
                        draftReadinessText(currentRecord.draft.readiness ?? "skeleton_only")}
                    </div>
                    {currentRecord.draft.warnings.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {currentRecord.draft.warnings.slice(0, 3).join(" · ")}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selectedDraftIds.length} mẫu đang chọn</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedDraftIds(
                          currentRecord.draft?.pageTemplates.map((item) => item.pageTemplateId) ??
                            [],
                        )
                      }
                    >
                      Chọn tất cả
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSelectedDraftIds([])}>
                      Bỏ chọn
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveSelectedDrafts}
                      disabled={selectedDraftIds.length === 0}
                    >
                      <Save className="mr-2 size-4" />
                      Lưu mẫu đã chọn
                    </Button>
                    <Button size="sm" variant="secondary" onClick={saveWholeDraft}>
                      <Save className="mr-2 size-4" />
                      Lưu cả bộ
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(currentRecord.draft.pageDrafts ?? []).map((draftPage) => {
                    const pageTemplate = currentRecord.draft!.pageTemplates.find(
                      (item) => item.pageTemplateId === draftPage.pageTemplateId,
                    );
                    if (!pageTemplate) return null;
                    const checked = selectedDraftIds.includes(draftPage.pageTemplateId);
                    return (
                      <Card
                        key={draftPage.pageTemplateId}
                        className={checked ? "border-primary ring-1 ring-primary/40" : undefined}
                      >
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) =>
                                  toggleDraftSelection(draftPage.pageTemplateId, value === true)
                                }
                                aria-label={`Chọn mẫu ${draftPage.pageName}`}
                              />
                              <div className="space-y-1">
                                <div className="font-medium">{draftPage.pageName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {draftPage.pageType}
                                </div>
                              </div>
                            </div>
                            <Badge variant={draftBadgeVariant(draftPage.readiness)}>
                              {draftPage.readinessLabel}
                            </Badge>
                          </div>

                          <DraftTemplatePreview tpl={pageTemplate} />

                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{draftPage.sectionCount} section</Badge>
                            <Badge variant="outline">
                              {draftPage.estimatedItemCount || 0} item ước lượng
                            </Badge>
                            <Badge variant="outline">{draftPage.autoBindingCount} auto-bind</Badge>
                          </div>

                          {draftPage.warnings.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {draftPage.warnings.slice(0, 3).join(" · ")}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => saveDraftPage(pageTemplate)}
                            >
                              <Save className="mr-1 size-3" />
                              Lưu page này
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                await saveDraftPage(pageTemplate);
                                navigate({
                                  to: "/templates/$id/edit",
                                  params: { id: pageTemplate.pageTemplateId },
                                });
                              }}
                            >
                              <Eye className="mr-1 size-3" />
                              Mở trong editor
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lịch sử phân tích</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {analyses.length === 0 ? (
            <div className="text-sm text-muted-foreground">Chưa có lần phân tích nào.</div>
          ) : (
            analyses.map((analysis) => (
              <div
                key={analysis.analysisId}
                className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
              >
                <div>
                  <div className="font-medium">{analysis.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(analysis.createdAt).toLocaleString("vi-VN")} ·{" "}
                    {modeLabel(analysis.mode)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentRecord(analysis)}>
                    <Eye className="mr-1 size-3" />
                    Mở lại
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportArtifacts(analysis)}>
                    <Download className="mr-1 size-3" />
                    Export
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await db.analyses.delete(analysis.analysisId);
                      if (currentRecord?.analysisId === analysis.analysisId) {
                        setCurrentRecord(null);
                      }
                      toast.success("Đã xoá lịch sử phân tích.");
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function DraftTemplatePreview({ tpl }: { tpl: PageTemplate }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.18);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      setScale(Math.min(width / tpl.canvas.width, height / tpl.canvas.height));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tpl.canvas.width, tpl.canvas.height]);

  const isEmpty = tpl.slots.length === 0;

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-lg border bg-muted/30"
      style={{ aspectRatio: `${tpl.canvas.width} / ${tpl.canvas.height}` }}
    >
      <LayoutGuides width={tpl.canvas.width} height={tpl.canvas.height} scale={scale} />
      {isEmpty ? (
        <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wider text-muted-foreground">
          {tpl.type} · trống
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        >
          <PageRenderer template={tpl} entities={[]} assets={[]} scale={scale} />
        </div>
      )}
    </div>
  );
}
