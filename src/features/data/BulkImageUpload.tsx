import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { nanoid } from "nanoid";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  ImagePlus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  entityHasUsableImageAsset,
  getAssetEntityIds,
  getEntityImageReferences,
  getEntityImageReferencesWithAssets,
  isImageReferenceAsset,
  isUsableImageAsset,
  looksLikeDriveReference,
} from "@/features/data/imageReferences";
import { matchFilesToEntities, type MatchResult } from "@/features/data/imageMatcher";
import type { Asset, Entity } from "@/models";
import { db, saveBlob } from "@/storage/db";
import { makeIdbSrc } from "@/storage/imageSrc";
import { getSettings, saveSettings } from "@/storage/settings";
import { cn } from "@/lib/utils";

interface PendingFile {
  file: File;
  relativePath?: string;
  match: MatchResult;
  manualEntityId?: string | null;
  role: Asset["role"];
}

type DriveFailureType = "private" | "not_found" | "not_image" | "too_large" | "unknown";
type DriveFailureFilter = "all" | DriveFailureType;

interface DriveFailure {
  entityId: string;
  entityName: string;
  reference: string;
  error: string;
  type: DriveFailureType;
}

const PREVIEW_PAGE_SIZE = 80;
const PREVIEW_INCREMENT = 80;
const DEFAULT_FUZZY_THRESHOLD = 0.78;
const DRIVE_ENTITY_CONCURRENCY = 4;
const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_ASSETS: Asset[] = [];
const DRIVE_FAILURE_FILTERS: DriveFailureFilter[] = [
  "private",
  "not_found",
  "not_image",
  "too_large",
  "unknown",
  "all",
];

function pendingKey(item: PendingFile): string {
  const path = item.relativePath || item.file.name;
  return `${path}::${item.file.size}::${item.file.lastModified}`;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function classifyDriveFailure(error: string, errorCode?: string): DriveFailureType {
  if (
    errorCode === "private" ||
    /private|quyền|truy cập|access|permission|đăng nhập|sign in/i.test(error)
  ) {
    return "private";
  }
  if (errorCode === "not_found" || /không tìm thấy|not found|404/i.test(error)) return "not_found";
  if (errorCode === "not_image" || /không phải file ảnh/i.test(error)) return "not_image";
  if (errorCode === "too_large" || /25MB|lớn hơn/i.test(error)) return "too_large";
  return "unknown";
}

function labelDriveFailureFilter(filter: DriveFailureFilter) {
  switch (filter) {
    case "private":
      return "Bị private";
    case "not_found":
      return "Không tìm thấy";
    case "not_image":
      return "Không phải ảnh";
    case "too_large":
      return "Quá nặng";
    case "unknown":
      return "Lỗi khác";
    default:
      return "Tất cả";
  }
}

function DriveImportToast({
  done,
  total,
  current,
}: {
  done: number;
  total: number;
  current?: string;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="min-w-64 space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>Tải ảnh Drive</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {done}/{total}
        {current ? ` - ${current}` : ""}
      </div>
    </div>
  );
}

async function collectDirectoryFiles(
  directoryHandle: FileSystemDirectoryHandle,
  prefix = "",
): Promise<Array<{ file: File; relativePath: string }>> {
  const out: Array<{ file: File; relativePath: string }> = [];
  const entries = directoryHandle as FileSystemDirectoryHandle & {
    values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  };

  for await (const entry of entries.values()) {
    if (entry.kind === "file") {
      const file = await entry.getFile();
      if (!isImageFile(file)) continue;
      out.push({
        file,
        relativePath: prefix ? `${prefix}/${entry.name}` : entry.name,
      });
      continue;
    }

    const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(...(await collectDirectoryFiles(entry, childPrefix)));
  }

  return out;
}

async function buildPendingFiles(
  items: Array<{ file: File; relativePath?: string }>,
  entities: Entity[],
): Promise<PendingFile[]> {
  const results: PendingFile[] = [];
  const chunkSize = 80;

  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    const matches = matchFilesToEntities(
      chunk.map((item) => ({
        fileName: item.file.name,
        relativePath:
          item.relativePath ??
          ("webkitRelativePath" in item.file && typeof item.file.webkitRelativePath === "string"
            ? item.file.webkitRelativePath || undefined
            : undefined),
      })),
      entities,
      { fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD },
    );

    results.push(
      ...chunk.map((item, index) => ({
        file: item.file,
        relativePath: item.relativePath,
        match: matches[index],
        manualEntityId: matches[index].autoAssign ? matches[index].matchedEntityId : null,
        role: "cover" as const,
      })),
    );

    await yieldToBrowser();
  }

  return results;
}

export function BulkImageUpload() {
  const entities = useLiveQuery(() => db.entities.toArray(), []) ?? EMPTY_ENTITIES;
  const allAssets = useLiveQuery(() => db.assets.toArray(), []) ?? EMPTY_ASSETS;
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [matching, setMatching] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveRootUrl, setDriveRootUrl] = useState("");
  const [driveFailures, setDriveFailures] = useState<DriveFailure[]>([]);
  const [driveFailureFilter, setDriveFailureFilter] = useState<DriveFailureFilter>("private");
  const [visibleCount, setVisibleCount] = useState(PREVIEW_PAGE_SIZE);
  const [, setPreviewVersion] = useState(0);
  const previewUrlsRef = useRef(new Map<string, string>());

  useEffect(() => {
    getSettings().then((settings) => setDriveRootUrl(settings.driveRootFolderUrl ?? ""));
  }, []);

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      for (const url of previewUrls.values()) {
        URL.revokeObjectURL(url);
      }
      previewUrls.clear();
    };
  }, []);

  const visiblePending = useMemo(() => pending.slice(0, visibleCount), [pending, visibleCount]);

  useEffect(() => {
    const validKeys = new Set(pending.map(pendingKey));
    for (const [key, url] of previewUrlsRef.current.entries()) {
      if (!validKeys.has(key)) {
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(key);
      }
    }

    let changed = false;
    for (const item of visiblePending) {
      const key = pendingKey(item);
      if (!previewUrlsRef.current.has(key)) {
        previewUrlsRef.current.set(key, URL.createObjectURL(item.file));
        changed = true;
      }
    }
    if (changed) setPreviewVersion((value) => value + 1);
  }, [pending, visiblePending]);

  const finishImportPrep = (next: PendingFile[]) => {
    const autoAssigned =
      entities.length === 1
        ? next.map((item) => ({ ...item, manualEntityId: item.manualEntityId ?? entities[0].entityId }))
        : next;
    setPending(autoAssigned);
    setVisibleCount(Math.min(PREVIEW_PAGE_SIZE, autoAssigned.length));
    const matched = autoAssigned.filter((item) => item.manualEntityId).length;
    const needsReview = autoAssigned.filter((item) => item.match.needsReview).length;
    toast.success(
      `${autoAssigned.length} ảnh, khớp tự động ${matched}/${autoAssigned.length}, cần review ${needsReview}`,
    );
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (entities.length === 0) {
      toast.error("Chưa có quán nào. Hãy import dữ liệu trước.");
      return;
    }

    setMatching(true);
    try {
      await yieldToBrowser();
      const items = Array.from(files)
        .filter(isImageFile)
        .map((file) => ({
          file,
          relativePath:
            "webkitRelativePath" in file && typeof file.webkitRelativePath === "string"
              ? file.webkitRelativePath || undefined
              : undefined,
        }));
      const next = await buildPendingFiles(items, entities);
      finishImportPrep(next);
    } finally {
      setMatching(false);
    }
  };

  const onPickDirectory = async () => {
    if (entities.length === 0) {
      toast.error("Chưa có quán nào. Hãy import dữ liệu trước.");
      return;
    }

    if (!("showDirectoryPicker" in window)) {
      folderInputRef.current?.click();
      return;
    }

    setMatching(true);
    try {
      const picker = window as Window & {
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
      };
      const handle = await picker.showDirectoryPicker();
      const files = await collectDirectoryFiles(handle, handle.name);
      const next = await buildPendingFiles(files, entities);
      finishImportPrep(next);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(
        "Không đọc được thư mục ảnh: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setMatching(false);
    }
  };

  const rerunMatch = () => {
    if (pending.length === 0) return;
    const matchInputs = pending.map((item) => ({
      fileName: item.file.name,
      relativePath:
        "webkitRelativePath" in item.file && typeof item.file.webkitRelativePath === "string"
          ? item.file.webkitRelativePath || undefined
          : undefined,
    }));
    const matches = matchFilesToEntities(matchInputs, entities, {
      fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
    });
    setPending(
      pending.map((item, index) => ({
        ...item,
        match: matches[index],
        manualEntityId: matches[index].autoAssign ? matches[index].matchedEntityId : null,
      })),
    );
    const matched = matches.filter((match) => match.autoAssign && match.matchedEntityId).length;
    const needsReview = matches.filter((match) => match.needsReview).length;
    toast.success(`Đã match lại: ${matched}/${matches.length}, cần review ${needsReview}`);
  };

  const setManual = (idx: number, entityId: string | null) => {
    const next = [...pending];
    next[idx] = { ...next[idx], manualEntityId: entityId };
    setPending(next);
  };

  const setRole = (idx: number, role: Asset["role"]) => {
    const next = [...pending];
    next[idx] = { ...next[idx], role };
    setPending(next);
  };

  const removeRow = (idx: number) => {
    setPending(pending.filter((_, index) => index !== idx));
  };

  const importAll = async () => {
    const ready = pending.filter((item) => item.manualEntityId);
    if (ready.length === 0) {
      toast.error("Không có ảnh nào đã được gán quán");
      return;
    }

    setBusy(true);
    try {
      const newAssets: Asset[] = [];
      const coverCount: Record<string, number> = {};
      const existing = await db.assets.toArray();
      for (const asset of existing) {
        if (asset.isCover) coverCount[asset.entityId] = (coverCount[asset.entityId] ?? 0) + 1;
      }

      for (const item of ready) {
        const entityId = item.manualEntityId!;
        const blobKey = await saveBlob(item.file);
        const isCover = item.role === "cover" && (coverCount[entityId] ?? 0) === 0;
        if (isCover) coverCount[entityId] = (coverCount[entityId] ?? 0) + 1;
        newAssets.push({
          assetId: nanoid(),
          entityId,
          sourceType: "local",
          sourceValue: makeIdbSrc(blobKey),
          blobKey,
          role: item.role,
          isCover,
          qualityScore: 80,
          status: "ok",
        });
      }

      await db.assets.bulkPut(newAssets);
      toast.success(
        `Đã import ${newAssets.length} ảnh vào ${new Set(newAssets.map((asset) => asset.entityId)).size} quán`,
      );
      setPending([]);
    } catch (error) {
      toast.error("Lỗi khi import: " + (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const matchedCount = pending.filter((item) => item.manualEntityId).length;
  const assetEntityIds = useMemo(() => getAssetEntityIds(allAssets), [allAssets]);
  const usableAssets = useMemo(() => allAssets.filter(isUsableImageAsset), [allAssets]);
  const assetsByEntityId = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of allAssets) {
      const group = map.get(asset.entityId) ?? [];
      group.push(asset);
      map.set(asset.entityId, group);
    }
    return map;
  }, [allAssets]);
  const entitiesWithoutImage = useMemo(
    () => entities.filter((entity) => !entityHasUsableImageAsset(entity, assetEntityIds)),
    [assetEntityIds, entities],
  );
  const driveImportCandidates = useMemo(
    () =>
      entities.filter(
        (entity) =>
          !assetEntityIds.has(entity.entityId) &&
          getEntityImageReferencesWithAssets(
            entity,
            assetsByEntityId.get(entity.entityId) ?? [],
          ).length > 0,
      ),
    [assetEntityIds, assetsByEntityId, entities],
  );
  const shouldHighlightDriveDownload =
    driveImportCandidates.length > 0 && !driveBusy && !matching && !busy;
  const driveFailureCounts = useMemo(() => {
    const counts: Record<DriveFailureFilter, number> = {
      all: driveFailures.length,
      private: 0,
      not_found: 0,
      not_image: 0,
      too_large: 0,
      unknown: 0,
    };
    for (const failure of driveFailures) counts[failure.type] += 1;
    return counts;
  }, [driveFailures]);
  const filteredDriveFailures = useMemo(
    () =>
      driveFailureFilter === "all"
        ? driveFailures
        : driveFailures.filter((failure) => failure.type === driveFailureFilter),
    [driveFailureFilter, driveFailures],
  );

  const saveDriveRoot = async () => {
    const settings = await getSettings();
    await saveSettings({ ...settings, driveRootFolderUrl: driveRootUrl.trim() || undefined });
    toast.success("Đã lưu root folder Drive");
  };

  const importDriveImages = async () => {
    if (entities.length === 0) {
      toast.error("Chưa có quán nào. Hãy import dữ liệu trước.");
      return;
    }
    if (driveImportCandidates.length === 0) {
      toast.success("Không có quán thiếu asset có Link Drive để tải.");
      return;
    }

    const rootUrl = driveRootUrl.trim();
    const hasNameOnlyRef = driveImportCandidates.some((entity) =>
      getEntityImageReferencesWithAssets(entity, assetsByEntityId.get(entity.entityId) ?? []).some(
        (reference) => !looksLikeDriveReference(reference),
      ),
    );
    if (hasNameOnlyRef && !rootUrl) {
      toast.error("Có cột Link Drive dạng tên folder. Dán root folder Drive public trước.");
      return;
    }

    setDriveBusy(true);
    setDriveFailures([]);
    const toastId = "drive-image-import";
    const candidates = driveImportCandidates.slice();
    const total = candidates.length;
    let done = 0;
    let imported = 0;
    const coverCount: Record<string, number> = {};

    for (const asset of usableAssets) {
      if (asset.isCover) coverCount[asset.entityId] = (coverCount[asset.entityId] ?? 0) + 1;
    }

    toast.loading(<DriveImportToast done={0} total={total} />, {
      id: toastId,
      duration: Infinity,
    });

    try {
      const { fetchDriveImagesServer } = await import("@/server/driveFetch");
      if (rootUrl) {
        const settings = await getSettings();
        await saveSettings({ ...settings, driveRootFolderUrl: rootUrl });
      }

      const results = await mapWithConcurrency(candidates, DRIVE_ENTITY_CONCURRENCY, async (entity) => {
        const entityAssets: Asset[] = [];
        const entityFailures: DriveFailure[] = [];

        try {
          const references = getEntityImageReferencesWithAssets(
            entity,
            assetsByEntityId.get(entity.entityId) ?? [],
          );
          for (const reference of references) {
            const result = await fetchDriveImagesServer({
              data: {
                reference,
            rootFolderUrl: rootUrl || undefined,
            searchContext: entity.sheetName,
            maxFiles: 20,
              },
            });

            if (!result.ok) {
              const errorCode = "errorCode" in result ? result.errorCode : undefined;
              entityFailures.push({
                entityId: entity.entityId,
                entityName: entity.name,
                reference,
                error: result.error,
                type: classifyDriveFailure(result.error, errorCode),
              });
              continue;
            }

            for (const file of result.files) {
              const blob = base64ToBlob(file.base64, file.mimeType);
              const blobKey = await saveBlob(blob);
              const isCover = (coverCount[entity.entityId] ?? 0) === 0 && entityAssets.length === 0;
              if (isCover) coverCount[entity.entityId] = 1;

              entityAssets.push({
                assetId: nanoid(),
                entityId: entity.entityId,
                sourceType: "local",
                sourceValue: makeIdbSrc(blobKey),
                blobKey,
                role: isCover ? "cover" : "generic",
                isCover,
                qualityScore: 80,
                status: "ok",
              });
            }
          }

          if (entityAssets.length) {
            const staleAssets = (assetsByEntityId.get(entity.entityId) ?? []).filter(
              isImageReferenceAsset,
            );
            await db.transaction("rw", db.assets, db.blobs, async () => {
              if (staleAssets.length) {
                await db.assets.bulkDelete(staleAssets.map((asset) => asset.assetId));
              }
              await db.assets.bulkPut(entityAssets);
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          entityFailures.push({
            entityId: entity.entityId,
            entityName: entity.name,
            reference:
              getEntityImageReferencesWithAssets(
                entity,
                assetsByEntityId.get(entity.entityId) ?? [],
              )[0] ?? entity.name,
            error: message,
            type: classifyDriveFailure(message),
          });
        }

        done += 1;
        imported += entityAssets.length;
        toast.loading(<DriveImportToast done={done} total={total} current={entity.name} />, {
          id: toastId,
          duration: Infinity,
        });
        await yieldToBrowser();

        return {
          imported: entityAssets.length,
          failures: entityFailures,
        };
      });

      const failed = results.flatMap((result) => result.failures);

      setDriveFailures(failed);
      if (failed.some((item) => item.type === "private")) {
        setDriveFailureFilter("private");
      } else if (failed.length) {
        setDriveFailureFilter("all");
      }

      if (imported > 0) {
        const privateCount = failed.filter((item) => item.type === "private").length;
        toast.success(
          `Đã tải ${imported} ảnh Drive cho ${total - failed.length}/${total} quán${
            failed.length
              ? `. Lỗi ${failed.length} quán${privateCount ? `, bị private ${privateCount}` : ""}.`
              : "."
          }`,
          { id: toastId, duration: 8000 },
        );
      } else {
        toast.error(failed[0]?.error ?? "Không tải được ảnh Drive.", { id: toastId, duration: 8000 });
      }
    } catch (error) {
      toast.error("Lỗi tải Drive: " + (error instanceof Error ? error.message : String(error)), {
        id: toastId,
        duration: 8000,
      });
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Ghép ảnh vào quán</CardTitle>
            <CardDescription>
              Tải ảnh từ Drive theo cột Link Drive/imageRef trong sheet, hoặc chọn file thủ công từ máy.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <input
              ref={(node) => {
                folderInputRef.current = node;
              }}
              type="file"
              accept="image/*"
              multiple
              hidden
              {...({
                webkitdirectory: "true",
                directory: "true",
              } as unknown as InputHTMLAttributes<HTMLInputElement>)}
              onChange={(event) => {
                void onFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative inline-flex">
                <Button type="button" disabled={matching}>
                  <ImagePlus /> Chọn ảnh
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={matching}
                  aria-label="Chọn ảnh"
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:pointer-events-none"
                  onChange={(event) => {
                    void onFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={onPickDirectory} disabled={matching}>
                <FolderOpen /> Chọn thư mục
              </Button>
              <Button
                variant="outline"
                onClick={rerunMatch}
                disabled={pending.length === 0 || matching}
              >
                <RefreshCw /> Match lại
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 flex flex-col gap-1">
                <Label>Root folder Google Drive public</Label>
                <p className="text-xs text-muted-foreground">
                  Nếu cột Link Drive là URL file/folder thì không cần root. Nếu là tên folder, app sẽ
                  tìm trong root này.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={driveRootUrl}
                  onChange={(event) => setDriveRootUrl(event.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..."
                />
                <Button type="button" variant="outline" onClick={() => void saveDriveRoot()}>
                  Lưu
                </Button>
              </div>
              <Button
                type="button"
                className={cn(
                  "mt-3",
                  shouldHighlightDriveDownload &&
                    "shadow-md ring-2 ring-primary/40 ring-offset-2 ring-offset-background",
                )}
                onClick={() => void importDriveImages()}
                disabled={driveBusy || matching || busy || driveImportCandidates.length === 0}
              >
                <Download /> Tải ảnh từ Drive ({driveImportCandidates.length})
              </Button>
              {shouldHighlightDriveDownload && (
                <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                  Có {driveImportCandidates.length} quán có link ảnh trong sheet. Bấm nút này để tải
                  ảnh về local.
                </div>
              )}
            </div>

            {matching && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                Đang đọc và match ảnh. Folder lớn có thể mất một lúc.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Tình trạng ảnh</CardTitle>
            <CardDescription>{entities.length} quán trong dữ liệu hiện tại</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-2xl font-semibold">{usableAssets.length}</div>
              <div className="text-sm text-muted-foreground">Ảnh đọc được</div>
              {allAssets.length !== usableAssets.length ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {allAssets.length - usableAssets.length} link cần tải về local
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <div className="text-2xl font-semibold">{entitiesWithoutImage.length}</div>
                {entitiesWithoutImage.length === 0 ? (
                  <CheckCircle2 className="text-primary" />
                ) : (
                  <AlertTriangle className="text-destructive" />
                )}
              </div>
              <div className="text-sm text-muted-foreground">Thiếu ảnh đọc được</div>
            </div>
            {pending.length > 0 ? (
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">
                  {matchedCount}/{pending.length}
                </div>
                <div className="text-sm text-muted-foreground">Ảnh đã gán quán</div>
              </div>
            ) : null}
            {driveFailures.length > 0 ? (
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-semibold">{driveFailureCounts.private}</div>
                  <AlertTriangle className="text-destructive" />
                </div>
                <div className="text-sm text-muted-foreground">Link Drive bị private</div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {driveFailures.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Lọc lỗi tải Drive</CardTitle>
                <CardDescription>
                  Các quán có link Drive không tải được. Mục “Bị private” là file/folder chưa public hoặc cần quyền truy cập.
                </CardDescription>
              </div>
              <Badge variant={driveFailureCounts.private ? "destructive" : "outline"}>
                {driveFailureCounts.private} private
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {DRIVE_FAILURE_FILTERS.map((filter) => {
                const count = driveFailureCounts[filter];
                if (count === 0 && filter !== "all") return null;
                return (
                  <Button
                    key={filter}
                    type="button"
                    size="sm"
                    variant={driveFailureFilter === filter ? "default" : "outline"}
                    onClick={() => setDriveFailureFilter(filter)}
                  >
                    {labelDriveFailureFilter(filter)} ({count})
                  </Button>
                );
              })}
            </div>

            {filteredDriveFailures.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Không có lỗi trong nhóm này.
              </div>
            ) : (
              <div className="grid max-h-72 gap-2 overflow-y-auto text-sm md:grid-cols-2 xl:grid-cols-3">
                {filteredDriveFailures.map((failure) => (
                  <div
                    key={`${failure.entityId}:${failure.reference}`}
                    className="min-w-0 rounded-lg border p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1 size-2 shrink-0 rounded-full ${
                          failure.type === "private" ? "bg-destructive" : "bg-amber-500"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{failure.entityName}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {failure.reference}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{failure.error}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <Card>
          <CardHeader className="flex flex-col gap-3 pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Review trước khi import</CardTitle>
              <CardDescription>
                {pending.length} file, {matchedCount} đã gán, {pending.length - matchedCount} chưa
                gán.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                Hiển thị {Math.min(visibleCount, pending.length)}/{pending.length}
              </Badge>
              {visibleCount < pending.length && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setVisibleCount((count) => Math.min(count + PREVIEW_INCREMENT, pending.length))
                  }
                >
                  Xem thêm {Math.min(PREVIEW_INCREMENT, pending.length - visibleCount)}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setPending([])}>
                Bỏ danh sách
              </Button>
              <Button size="sm" onClick={importAll} disabled={busy || matchedCount === 0}>
                <Upload /> Import {matchedCount} ảnh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="p-3 text-left font-medium text-muted-foreground">Ảnh</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">File</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Match</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Quán</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Vai trò</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePending.map((item, idx) => (
                    <tr key={pendingKey(item)} className="border-t">
                      <td className="p-3">
                        <img
                          src={previewUrlsRef.current.get(pendingKey(item))}
                          alt=""
                          className="size-12 rounded-md object-cover"
                        />
                      </td>
                      <td className="max-w-64 p-3">
                        <div className="truncate font-medium">{item.file.name}</div>
                        {item.match.relativePath ? (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {item.match.relativePath}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              item.match.reason === "exact"
                                ? "default"
                                : item.match.reason === "no_match"
                                  ? "destructive"
                                  : item.match.needsReview
                                    ? "outline"
                                    : "secondary"
                            }
                            className="w-fit"
                          >
                            {item.match.reason === "exact" && "Khớp 100%"}
                            {item.match.reason === "contains" && `Chứa ${item.match.score}%`}
                            {item.match.reason === "fuzzy" && `Gần đúng ${item.match.score}%`}
                            {item.match.reason === "no_match" && "Không khớp"}
                          </Badge>
                          {item.match.needsReview ? (
                            <span className="text-[11px] text-muted-foreground">Cần review</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3">
                        <Select
                          value={item.manualEntityId ?? "__none__"}
                          onValueChange={(value) =>
                            setManual(idx, value === "__none__" ? null : value)
                          }
                        >
                          <SelectTrigger className="h-8 w-60 text-xs">
                            <SelectValue placeholder="Chọn quán" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Bỏ qua</SelectItem>
                            {entities.map((entity) => (
                              <SelectItem key={entity.entityId} value={entity.entityId}>
                                {entity.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3">
                        <Select
                          value={item.role}
                          onValueChange={(value) => setRole(idx, value as Asset["role"])}
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cover">cover</SelectItem>
                            <SelectItem value="facade">facade</SelectItem>
                            <SelectItem value="food_closeup">food_closeup</SelectItem>
                            <SelectItem value="space">space</SelectItem>
                            <SelectItem value="portrait">portrait</SelectItem>
                            <SelectItem value="square_thumb">square_thumb</SelectItem>
                            <SelectItem value="section_image">section_image</SelectItem>
                            <SelectItem value="generic">generic</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeRow(idx)}
                          aria-label="Bỏ ảnh khỏi danh sách import"
                        >
                          <X />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Quán thiếu ảnh đọc được</CardTitle>
            <Badge variant={entitiesWithoutImage.length === 0 ? "default" : "destructive"}>
              {entitiesWithoutImage.length}/{entities.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {entitiesWithoutImage.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tất cả quán đã có ảnh đọc được.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto text-sm md:grid-cols-2 xl:grid-cols-3">
              {entitiesWithoutImage.map((entity) => (
                <div
                  key={entity.entityId}
                  className="flex min-w-0 items-center gap-2 rounded-md border p-2"
                >
                  <span className="size-2 shrink-0 rounded-full bg-destructive" />
                  <span className="truncate">{entity.name}</span>
                  {entity.partnerFlag && (
                    <Badge variant="outline" className="ml-auto">
                      Đối tác
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
