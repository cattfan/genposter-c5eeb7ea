import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Copy,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Layers,
  Package,
  X,
  FileDown,
  FileUp,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PackTemplate, PageTemplate } from "@/models";
import {
  aiGenerateTemplateFromImage,
  aiGenerateComboFromImages,
  type LayoutFidelity,
} from "@/features/ai/aiFeatures";
import { aiLayoutToTemplateWithQuality } from "@/features/ai/templateFromImage";
import { buildComboFromAiResult, persistCombo } from "@/features/ai/comboFromImages";
import { PageContainer } from "@/components/PageHeader";
import { EmptyState } from "@/components/ux";
import { PackBuilder } from "@/features/packs/PackBuilder";
import { PackPagePreview } from "@/features/packs/PackPagePreview";
import { cn } from "@/lib/utils";
import {
  appendPageToPack,
  createBlankPageTemplate,
  createPackTemplate,
  duplicatePageTemplate,
} from "@/features/packs/packTemplateUtils";
import {
  buildPackTemplateBundle,
  downloadJson,
  importPortableBundle,
  readPortableBundleFile,
  safePortableFileName,
} from "@/features/generate/generatePresetPortability";
import { formatTemplateDisplayName } from "@/lib/templateNames";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

const UNDO_TOAST_DURATION = 15_000;
const AI_IMAGE_MAX_EDGE = 1800;
const AI_IMAGE_REENCODE_THRESHOLD_BYTES = 1_800_000;
const AI_IMAGE_JPEG_QUALITY = 0.92;

function areIdListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function stableOptionalJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function packDraftHasChanges(draft: PackTemplate, persisted: PackTemplate) {
  return (
    draft.name !== persisted.name ||
    (draft.description ?? "") !== (persisted.description ?? "") ||
    (draft.goal ?? "") !== (persisted.goal ?? "") ||
    (draft.tone ?? "") !== (persisted.tone ?? "") ||
    (draft.cta ?? "") !== (persisted.cta ?? "") ||
    !areIdListsEqual(draft.orderedPages, persisted.orderedPages) ||
    !areIdListsEqual(draft.requiredPages, persisted.requiredPages) ||
    !areIdListsEqual(draft.optionalPages, persisted.optionalPages) ||
    stableOptionalJson(draft.captionProfile) !== stableOptionalJson(persisted.captionProfile) ||
    stableOptionalJson(draft.exportDefaults) !== stableOptionalJson(persisted.exportDefaults)
  );
}

function clonePackTemplate(pack: PackTemplate): PackTemplate {
  return structuredClone(pack);
}

function clonePageTemplate(template: PageTemplate): PageTemplate {
  return structuredClone(template);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Đọc ảnh lỗi"));
    r.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Không đọc được kích thước ảnh"));
    img.src = dataUrl;
  });
}

async function readOptimizedImageDataUrl(file: File): Promise<string> {
  const raw = await readFileAsDataUrl(file);
  if (!file.type.startsWith("image/")) return raw;

  try {
    const img = await loadImage(raw);
    const maxEdge = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const scale = maxEdge > AI_IMAGE_MAX_EDGE ? AI_IMAGE_MAX_EDGE / maxEdge : 1;
    if (scale === 1 && file.size <= AI_IMAGE_REENCODE_THRESHOLD_BYTES) return raw;

    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", AI_IMAGE_JPEG_QUALITY);
  } catch {
    return raw;
  }
}

async function loadAiDataColumns(): Promise<string[]> {
  const entities = await db.entities.limit(250).toArray();
  const columns = new Set<string>();
  const corePairs: Array<[keyof (typeof entities)[number], string]> = [
    ["name", "Ten_quan"],
    ["address", "Dia_chi"],
    ["phone", "SDT"],
    ["openingHours", "Gio_mo_cua"],
    ["categoryMain", "Mo_hinh"],
    ["categorySub", "Phong_cach"],
    ["priceRange", "Gia"],
    ["style", "Phong_cach"],
  ];

  for (const entity of entities) {
    for (const [key, label] of corePairs) {
      if (entity[key] != null && String(entity[key]).trim()) columns.add(label);
    }
    for (const key of Object.keys(entity.metadata ?? {})) {
      if (key.trim()) columns.add(key);
    }
  }

  return Array.from(columns);
}

function PackPreviewThumb({
  template,
  className,
}: {
  template?: PageTemplate;
  className?: string;
}) {
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-md border bg-background", className)}
      style={{
        aspectRatio: template ? `${template.canvas.width} / ${template.canvas.height}` : "4 / 5",
      }}
    >
      {template ? (
        <PackPagePreview tpl={template} />
      ) : (
        <div className="grid size-full place-items-center text-[10px] text-muted-foreground">
          Mất
        </div>
      )}
    </div>
  );
}

function PackSummaryCard({
  pack,
  templateMap,
  active,
  onSelect,
  onDuplicate,
  onExport,
  onDelete,
}: {
  pack: PackTemplate;
  templateMap: Map<string, PageTemplate>;
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const pageItems = pack.orderedPages.map((id) => ({ id, template: templateMap.get(id) }));

  return (
    <div
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm transition-colors",
        active ? "border-primary/60 bg-accent/20" : "hover:border-primary/40",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <div className="truncate text-lg font-semibold">
            {formatTemplateDisplayName(pack.name, "Bộ khuôn")}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            title="Nhân bản bộ khuôn"
            aria-label="Nhân bản bộ khuôn"
            className="shrink-0 text-muted-foreground"
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onExport}
            title="Xuất bộ khuôn"
            aria-label="Xuất bộ khuôn"
            className="shrink-0 text-muted-foreground"
          >
            <FileDown />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            title="Xóa bộ khuôn"
            aria-label="Xóa bộ khuôn"
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <button type="button" className="block w-full p-4 text-left" onClick={onSelect}>
        {pageItems.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Bộ khuôn chưa có trang.
          </div>
        ) : (
          <div className="pack-horizontal-scroll -mx-1 overflow-x-auto px-1 pb-3">
            <div className="flex min-w-full gap-3">
              {pageItems.map(({ id, template }, index) => (
                <div
                  key={`${id}-${index}`}
                  className="w-[150px] shrink-0 rounded-lg border bg-background p-2 shadow-sm sm:w-[170px]"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <div className="grid h-7 min-w-8 place-items-center rounded-md bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                      P{index + 1}
                    </div>
                    <div className="min-w-0 truncate text-sm font-medium">
                      {template
                        ? formatTemplateDisplayName(template.name, "Trang")
                        : "Trang khuôn không tồn tại"}
                    </div>
                  </div>
                  <PackPreviewThumb template={template} className="w-full" />
                </div>
              ))}
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

function TemplatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeSearch = location.search as { open?: unknown };
  const openPackId = typeof routeSearch.open === "string" ? routeSearch.open : undefined;
  const packs = useLiveQuery(() => db.packTemplates.orderBy("updatedAt").reverse().toArray(), []);
  const tpls = useLiveQuery(() => db.pageTemplates.orderBy("updatedAt").reverse().toArray(), []);
  const templateMap = useMemo(
    () => new Map((tpls ?? []).map((template) => [template.pageTemplateId, template])),
    [tpls],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const comboFileRef = useRef<HTMLInputElement>(null);
  const comboAppendFileRef = useRef<HTMLInputElement>(null);
  const portableImportRef = useRef<HTMLInputElement>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [singleOpen, setSingleOpen] = useState(false);
  const [singleFileName, setSingleFileName] = useState("");
  const [singlePreview, setSinglePreview] = useState("");
  const [singleTemplateName, setSingleTemplateName] = useState("");
  const [singleFidelity, setSingleFidelity] = useState<LayoutFidelity>("strict");
  const [singleInstructions, setSingleInstructions] = useState("");
  const [singlePreferVisibleLines, setSinglePreferVisibleLines] = useState(true);

  // Combo state
  const [comboOpen, setComboOpen] = useState(false);
  const [comboFiles, setComboFiles] = useState<File[]>([]);
  const [comboPreviews, setComboPreviews] = useState<string[]>([]);
  const [comboPackName, setComboPackName] = useState("");
  const [comboBusy, setComboBusy] = useState(false);
  const [comboStep, setComboStep] = useState("");
  const [comboProgress, setComboProgress] = useState(0);
  const [editing, setEditing] = useState<PackTemplate | null>(null);
  const packAutosaveErrorRef = useRef(false);

  useEffect(() => {
    if (!packs) return;
    if (packs.length === 0) {
      setEditing(null);
      return;
    }

    if (!openPackId) {
      if (editing) setEditing(null);
      return;
    }

    const bySearch = packs.find((pack) => pack.packTemplateId === openPackId);
    if (!bySearch) {
      setEditing(null);
      return;
    }
    if (
      !editing ||
      editing.packTemplateId !== bySearch.packTemplateId ||
      editing.updatedAt !== bySearch.updatedAt
    ) {
      setEditing({ ...bySearch });
    }
  }, [packs, openPackId, editing]);

  useEffect(() => {
    if (!editing || !packs) return;
    const persisted = packs.find((pack) => pack.packTemplateId === editing.packTemplateId);
    if (!persisted || !packDraftHasChanges(editing, persisted)) return;

    const timeout = window.setTimeout(() => {
      const nextPack = { ...editing, updatedAt: Date.now() };
      void db.packTemplates
        .put(nextPack)
        .then(() => {
          packAutosaveErrorRef.current = false;
        })
        .catch((error) => {
          if (packAutosaveErrorRef.current) return;
          packAutosaveErrorRef.current = true;
          toast.error("Không thể tự lưu bộ khuôn: " + errorMessage(error));
        });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [editing, packs]);

  if (location.pathname !== "/templates") {
    return <Outlet />;
  }

  const createNewPack = async () => {
    const pack = createPackTemplate();
    await db.packTemplates.put(pack);
    setEditing(pack);
    toast.success("Đã tạo bộ khuôn mới");
    navigate({ to: "/templates", search: { open: pack.packTemplateId } });
  };

  const selectPack = (pack: PackTemplate) => {
    setEditing({ ...pack });
    navigate({ to: "/templates", search: { open: pack.packTemplateId } });
  };

  const collapsePack = () => {
    setEditing(null);
    navigate({ to: "/templates", search: { open: undefined } });
  };

  const deletePack = async (pack: PackTemplate) => {
    const deletedPack = clonePackTemplate(pack);
    const wasActive = editing?.packTemplateId === pack.packTemplateId;
    // Snapshot page templates owned exclusively by this pack so we can both
    // delete them atomically and restore on undo.
    const orphanSnapshot: PageTemplate[] = [];
    await db.transaction("rw", [db.packTemplates, db.pageTemplates], async () => {
      await db.packTemplates.delete(pack.packTemplateId);
      const remainingPacks = await db.packTemplates.toArray();
      const stillReferenced = new Set(remainingPacks.flatMap((p) => p.orderedPages));
      const orphanIds = pack.orderedPages.filter((id) => !stillReferenced.has(id));
      if (orphanIds.length > 0) {
        const orphanPages = await db.pageTemplates.bulkGet(orphanIds);
        for (const orphan of orphanPages) {
          if (orphan) orphanSnapshot.push(clonePageTemplate(orphan));
        }
        await db.pageTemplates.bulkDelete(orphanIds);
      }
    });
    if (wasActive) {
      setEditing(null);
      navigate({ to: "/templates", search: { open: undefined } });
    }
    toast.success("Đã xóa bộ khuôn", {
      description: `"${formatTemplateDisplayName(pack.name, "Bộ khuôn")}" và ${orphanSnapshot.length} trang riêng đã bị xoá. Có thể khôi phục trong vài giây.`,
      duration: UNDO_TOAST_DURATION,
      action: {
        label: "Khôi phục",
        onClick: () => {
          void db
            .transaction("rw", [db.packTemplates, db.pageTemplates], async () => {
              await db.packTemplates.put(deletedPack);
              if (orphanSnapshot.length > 0) {
                await db.pageTemplates.bulkPut(orphanSnapshot);
              }
            })
            .then(() => {
              if (wasActive) {
                setEditing(deletedPack);
                navigate({ to: "/templates", search: { open: deletedPack.packTemplateId } });
              }
              toast.success("Đã khôi phục bộ khuôn");
            })
            .catch((error) => {
              toast.error("Không thể khôi phục bộ khuôn: " + errorMessage(error));
            });
        },
      },
    });
  };

  const openEdit = (id: string, packId = editing?.packTemplateId) => {
    navigate({ to: "/templates/$id/edit", params: { id }, search: { packId } });
  };

  const ensureActivePack = async (name?: string) => {
    if (editing) return editing;
    const pack = createPackTemplate({ name });
    await db.packTemplates.put(pack);
    setEditing(pack);
    navigate({ to: "/templates", search: { open: pack.packTemplateId } });
    return pack;
  };

  const duplicatePackTemplate = async (pack: PackTemplate) => {
    const dup: PackTemplate = {
      ...pack,
      packTemplateId: nanoid(),
      name: `${formatTemplateDisplayName(pack.name, "Bộ khuôn")} - bản sao`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.packTemplates.put(dup);
    setEditing(dup);
    toast.success("Đã nhân bản bộ khuôn");
    navigate({ to: "/templates", search: { open: dup.packTemplateId } });
  };

  const duplicatePack = async () => {
    if (!editing) return;
    await duplicatePackTemplate(editing);
  };

  const exportPackTemplate = (pack: PackTemplate) => {
    const pageSet = new Set(pack.orderedPages);
    const pages = (tpls ?? []).filter((template) => pageSet.has(template.pageTemplateId));
    const bundle = buildPackTemplateBundle(pack, pages);
    downloadJson(
      `${safePortableFileName(formatTemplateDisplayName(pack.name, "bo-khuon"))}-bo-khuon.json`,
      bundle,
    );
  };

  const importPortableTemplateBundle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = await readPortableBundleFile(file);
      const result = await importPortableBundle(bundle);
      if (result.packs[0]) {
        setEditing(result.packs[0]);
        navigate({ to: "/templates", search: { open: result.packs[0].packTemplateId } });
      }
      toast.success(
        `Đã nhập ${result.packs.length} bộ, ${result.pages.length} trang, ${result.presets.length} khuôn`,
      );
    } catch (error) {
      toast.error("Không thể nhập khuôn: " + errorMessage(error));
    }
  };

  const createPageInPack = async (presetId?: string) => {
    const pack = await ensureActivePack();
    const pageNumber = pack.orderedPages.length + 1;
    const page = createBlankPageTemplate({
      name: `Trang mới ${pageNumber}`,
      presetId,
    });
    const nextPack = appendPageToPack(pack, page.pageTemplateId);
    await db.transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
      await db.pageTemplates.put(page);
      await db.packTemplates.put(nextPack);
    });
    setEditing(nextPack);
    toast.success(`Đã tạo ${page.name}`);
  };

  const duplicatePageInPack = async (template: PageTemplate) => {
    if (!editing) return;
    const dup = duplicatePageTemplate(template);
    const nextPack = appendPageToPack(editing, dup.pageTemplateId);
    await db.transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
      await db.pageTemplates.put(dup);
      await db.packTemplates.put(nextPack);
    });
    setEditing(nextPack);
    toast.success("Đã nhân bản trang vào bộ khuôn");
  };

  const deletePageFromPack = async (template: PageTemplate) => {
    const deletedTemplate = clonePageTemplate(template);
    const activePackId = editing?.packTemplateId;
    const allPacks = await db.packTemplates.toArray();
    const affectedPacks = allPacks
      .filter((pack) => pack.orderedPages.includes(template.pageTemplateId))
      .map(clonePackTemplate);
    const updatedAt = Date.now();
    const nextEditing =
      editing && editing.orderedPages.includes(template.pageTemplateId)
        ? {
            ...editing,
            orderedPages: editing.orderedPages.filter((id) => id !== template.pageTemplateId),
            requiredPages: editing.requiredPages.filter((id) => id !== template.pageTemplateId),
            optionalPages: editing.optionalPages.filter((id) => id !== template.pageTemplateId),
            updatedAt,
          }
        : editing;

    await db.transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
      await db.pageTemplates.delete(template.pageTemplateId);
      for (const pack of allPacks) {
        if (!pack.orderedPages.includes(template.pageTemplateId)) continue;
        await db.packTemplates.put({
          ...pack,
          orderedPages: pack.orderedPages.filter((id) => id !== template.pageTemplateId),
          requiredPages: pack.requiredPages.filter((id) => id !== template.pageTemplateId),
          optionalPages: pack.optionalPages.filter((id) => id !== template.pageTemplateId),
          updatedAt,
        });
      }
    });
    if (nextEditing) {
      setEditing(nextEditing);
    }
    toast.success("Đã xóa trang", {
      description: `"${formatTemplateDisplayName(template.name, "Trang")}" có thể khôi phục trong vài giây.`,
      duration: UNDO_TOAST_DURATION,
      action: {
        label: "Khôi phục",
        onClick: () => {
          void db
            .transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
              await db.pageTemplates.put(deletedTemplate);
              for (const pack of affectedPacks) {
                await db.packTemplates.put(pack);
              }
            })
            .then(() => {
              const restoredActivePack = activePackId
                ? affectedPacks.find((pack) => pack.packTemplateId === activePackId)
                : undefined;
              if (restoredActivePack) {
                setEditing(restoredActivePack);
                navigate({ to: "/templates", search: { open: restoredActivePack.packTemplateId } });
              }
              toast.success("Đã khôi phục trang");
            })
            .catch((error) => {
              toast.error("Không thể khôi phục trang: " + errorMessage(error));
            });
        },
      },
    });
  };

  const renamePageTemplate = async (template: PageTemplate, name: string) => {
    const nextName = name.trim();
    if (!nextName || nextName === template.name) return;
    await db.pageTemplates.update(template.pageTemplateId, {
      name: nextName,
      updatedAt: Date.now(),
    });
  };

  // === AI gen template từ ảnh ===
  const onPickAiImage = () => fileRef.current?.click();

  const onAiImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const dataUrl = await readOptimizedImageDataUrl(f);
      setSingleFileName(f.name);
      setSinglePreview(dataUrl);
      setSingleTemplateName("AI: " + f.name.replace(/\.[^.]+$/, ""));
      setSingleFidelity("strict");
      setSingleInstructions("");
      setSinglePreferVisibleLines(true);
      setSingleOpen(true);
    } catch (err) {
      toast.error("AI lỗi: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const startSingleImageGeneration = async () => {
    if (!singlePreview) return;
    setAiBusy(true);
    try {
      const dataColumns = await loadAiDataColumns();
      const out = await aiGenerateTemplateFromImage({
        imageDataUrl: singlePreview,
        fidelity: singleFidelity,
        customInstructions: singleInstructions,
        preferVisibleLines: singlePreferVisibleLines,
        dataColumns,
      });
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      const layout = JSON.parse(out.layoutJson);
      const { template: tpl, quality } = aiLayoutToTemplateWithQuality(
        layout,
        singleTemplateName.trim() || "AI: " + singleFileName.replace(/\.[^.]+$/, ""),
        { sourceImageDataUrl: singlePreview },
      );
      if (quality.warnings.length > 0) {
        toast.warning(`${quality.warnings.length} cảnh báo bố cục, nên kiểm tra lại trang khuôn.`);
      }
      const pack = await ensureActivePack(singleTemplateName.trim() || "Bộ khuôn mới");
      const nextPack = appendPageToPack(pack, tpl.pageTemplateId);
      await db.transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
        await db.pageTemplates.put(tpl);
        await db.packTemplates.put(nextPack);
      });
      setEditing(nextPack);
      toast.success("AI dựng xong, đã thêm trang vào bộ khuôn");
      setSingleOpen(false);
      setSinglePreview("");
      setSingleFileName("");
      setSingleTemplateName("");
      setSingleInstructions("");
      setSinglePreferVisibleLines(true);
      openEdit(tpl.pageTemplateId, nextPack.packTemplateId);
    } catch (err) {
      toast.error("AI lỗi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiBusy(false);
    }
  };

  // === AI dựng combo từ nhiều ảnh ===
  const onPickComboImages = () => comboFileRef.current?.click();
  const onAppendComboImages = () => comboAppendFileRef.current?.click();

  const readComboPreviews = (files: File[]) =>
    Promise.all(files.map((file) => readOptimizedImageDataUrl(file)));

  const onComboFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0) return;
    const previews = await readComboPreviews(list);
    setComboFiles(list);
    setComboPreviews(previews);
    setComboPackName("");
    setComboOpen(true);
  };

  const onAppendComboFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0) return;
    const nextFiles = [...comboFiles, ...list];
    const previews = await readComboPreviews(list);
    setComboFiles(nextFiles);
    setComboPreviews((current) => [...current, ...previews]);
  };

  const removeComboImage = (idx: number) => {
    setComboFiles((arr) => arr.filter((_, i) => i !== idx));
    setComboPreviews((arr) => arr.filter((_, i) => i !== idx));
  };

  const startCombo = async () => {
    if (comboPreviews.length === 0) return;
    setComboBusy(true);
    setComboStep(`Phân loại ${comboPreviews.length} ảnh...`);
    setComboProgress(10);
    try {
      const dataColumns = await loadAiDataColumns();
      const out = await aiGenerateComboFromImages({
        images: comboPreviews.map((dataUrl) => ({ dataUrl })),
        packNameHint: comboPackName.trim() || undefined,
        layoutFidelity: "strict",
        customInstructions: undefined,
        preferVisibleLines: false,
        dataColumns,
        onProgress: (step, progress) => {
          setComboStep(step);
          setComboProgress(progress);
        },
      });
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      setComboStep(`Dựng ${out.pages.length} trang, tạo bộ khuôn...`);
      setComboProgress(80);
      const built = buildComboFromAiResult(
        { pages: out.pages, packMeta: out.packMeta },
        comboPackName,
      );
      const packId = await persistCombo(built);
      setComboProgress(100);
      if (out.warnings && out.warnings.length > 0) {
        toast.warning(`Có ${out.warnings.length} trang lỗi, bộ khuôn vẫn tạo được`);
      } else {
        toast.success(
          `Đã tạo bộ khuôn "${formatTemplateDisplayName(built.pack.name, "Bộ khuôn")}" (${built.pages.length} trang)`,
        );
      }
      setComboOpen(false);
      setComboFiles([]);
      setComboPreviews([]);
      navigate({ to: "/templates", search: { open: packId } });
    } catch (err) {
      toast.error("Lỗi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setComboBusy(false);
      setComboStep("");
      setComboProgress(0);
    }
  };

  return (
    <PageContainer className="max-w-[1500px]">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAiImageChange} />
      <input
        ref={comboFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onComboFilesChange}
      />
      <input
        ref={comboAppendFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onAppendComboFilesChange}
      />
      <input
        ref={portableImportRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={importPortableTemplateBundle}
      />
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Package className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">Khuôn mẫu</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
          <Button variant="outline" onClick={() => portableImportRef.current?.click()}>
            <FileUp className="size-4 mr-2" /> Nhập khuôn
          </Button>
          {editing && (
            <Button variant="outline" onClick={() => exportPackTemplate(editing)}>
              <FileDown className="size-4 mr-2" /> Xuất bộ
            </Button>
          )}
          <Button variant="outline" onClick={onPickComboImages} disabled={aiBusy}>
            <Layers className="size-4 mr-2" /> AI tạo ảnh
          </Button>
          <Button onClick={createNewPack}>
            <Plus className="size-4 mr-2" /> Tạo bộ mới
          </Button>
        </div>
      </div>

      <Dialog open={singleOpen} onOpenChange={(o) => !aiBusy && setSingleOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI dựng trang khuôn từ ảnh</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {singlePreview && (
              <div className="overflow-hidden rounded-lg border bg-muted">
                <img
                  src={singlePreview}
                  alt={singleFileName}
                  className="max-h-[420px] w-full object-contain"
                />
              </div>
            )}

            <div>
              <Label>Tên trang khuôn</Label>
              <Input
                value={singleTemplateName}
                onChange={(e) => setSingleTemplateName(e.target.value)}
                placeholder="AI: Tên trang khuôn"
                disabled={aiBusy}
              />
            </div>

            <div>
              <Label>Mức bám sát mẫu</Label>
              <Select
                value={singleFidelity}
                onValueChange={(value) => setSingleFidelity(value as LayoutFidelity)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strict">Bám sát mẫu</SelectItem>
                  <SelectItem value="balanced">Cân bằng</SelectItem>
                  <SelectItem value="creative">Sáng tạo nhẹ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Ghi chú cho AI</Label>
              <Textarea
                value={singleInstructions}
                onChange={(e) => setSingleInstructions(e.target.value)}
                placeholder="Ví dụ: giữ nền tối, title vàng nổi, ảnh bo góc đặt hai bên, chia danh sách thành nhiều cụm giống ảnh mẫu."
                className="mt-2 min-h-[110px]"
                disabled={aiBusy}
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={singlePreferVisibleLines}
                onCheckedChange={(checked) => setSinglePreferVisibleLines(checked === true)}
                disabled={aiBusy}
              />
              <div className="space-y-1">
                <div className="text-sm font-medium">Ưu tiên số dòng thật</div>
                <div className="text-xs text-muted-foreground">
                  Nếu ảnh mẫu nhìn thấy nhiều dòng item riêng biệt, AI sẽ cố giữ từng dòng thay vì
                  gom thành block lớn.
                </div>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSingleOpen(false)} disabled={aiBusy}>
              Huỷ
            </Button>
            <Button onClick={startSingleImageGeneration} disabled={aiBusy || !singlePreview}>
              {aiBusy ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="size-4 mr-2" />
              )}
              Dựng trang khuôn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={comboOpen} onOpenChange={(o) => !comboBusy && setComboOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI dựng combo từ {comboPreviews.length} ảnh</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tên bộ khuôn</Label>
              <Input
                value={comboPackName}
                onChange={(e) => setComboPackName(e.target.value)}
                placeholder="Vd: Đà Lạt 4N3Đ"
                disabled={comboBusy}
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <Label>Ảnh đã chọn</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAppendComboImages}
                  disabled={comboBusy}
                >
                  <Plus /> Thêm ảnh
                </Button>
              </div>
              <div className="mt-2 grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {comboPreviews.map((src, idx) => (
                  <div
                    key={idx}
                    className="relative group aspect-[4/5] rounded overflow-hidden border bg-muted"
                  >
                    <img src={src} alt={`trang-${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute top-1 left-1 text-[10px] bg-black/60 text-white rounded px-1">
                      P{idx + 1}
                    </div>
                    {!comboBusy && (
                      <button
                        onClick={() => removeComboImage(idx)}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {comboBusy && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{comboStep}</div>
                <Progress value={comboProgress} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComboOpen(false)} disabled={comboBusy}>
              Huỷ
            </Button>
            <Button onClick={startCombo} disabled={comboBusy || comboPreviews.length === 0}>
              {comboBusy ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="size-4 mr-2" />
              )}
              Bắt đầu dựng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-4">
        {packs?.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title="Chưa có bộ khuôn"
            description="Tạo bộ khuôn mới để bắt đầu thiết kế poster, hoặc nhập từ file đã xuất."
            action={
              <Button onClick={createNewPack}>
                <Plus className="size-4 mr-2" /> Tạo bộ mới
              </Button>
            }
          />
        ) : null}

        {packs?.map((pack) => {
          const active = editing?.packTemplateId === pack.packTemplateId;
          if (active && editing) {
            return (
              <PackBuilder
                key={pack.packTemplateId}
                pack={editing}
                allTemplates={tpls ?? []}
                onChange={setEditing}
                onDuplicate={duplicatePack}
                onCreatePage={createPageInPack}
                onCreateAiPage={onPickAiImage}
                onDuplicatePage={duplicatePageInPack}
                onDeletePage={deletePageFromPack}
                onRenamePage={renamePageTemplate}
                onDeletePack={() => deletePack(pack)}
                onCollapse={collapsePack}
              />
            );
          }

          return (
            <PackSummaryCard
              key={pack.packTemplateId}
              pack={pack}
              templateMap={templateMap}
              active={active}
              onSelect={() => selectPack(pack)}
              onDuplicate={() => duplicatePackTemplate(pack)}
              onExport={() => exportPackTemplate(pack)}
              onDelete={() => deletePack(pack)}
            />
          );
        })}
      </div>
    </PageContainer>
  );
}
