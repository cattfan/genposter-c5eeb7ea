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
  RotateCcw,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProgressToast } from "@/components/ux";
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
  getImageReferenceEntityIds,
  isImageReferenceAsset,
  isUsableImageAsset,
  looksLikeDriveReference,
} from "@/features/data/imageReferences";
import { matchFilesToEntities, type MatchResult } from "@/features/data/imageMatcher";
import type { Asset, DriveDownloadCheckpoint, Entity } from "@/models";
import { db, saveBlob } from "@/storage/db";
import { makeIdbSrc } from "@/storage/imageSrc";
import { resizeImageBlob } from "@/storage/imageResize";
import { getSettings, saveSettings } from "@/storage/settings";
import { cn } from "@/lib/utils";

interface PendingFile {
  file: File;
  relativePath?: string;
  match: MatchResult;
  manualEntityId?: string | null;
  role: Asset["role"];
}

type DriveFailureType =
  | "private"
  | "not_found"
  | "not_image"
  | "too_large"
  | "network"
  | "throttle"
  | "unknown";
type DriveFailureFilter = "all" | DriveFailureType;
type DriveImageLimit = "all" | number;

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
const DEFAULT_DRIVE_ENTITY_LIMIT = 20;
const DRIVE_IMAGE_LIMIT_OPTIONS: Array<{ value: string; label: string; limit: DriveImageLimit }> = [
  { value: "all", label: "Tất cả ảnh", limit: "all" },
  { value: "5", label: "5 ảnh", limit: 5 },
  { value: "10", label: "10 ảnh", limit: 10 },
  { value: "20", label: "20 ảnh", limit: 20 },
  { value: "50", label: "50 ảnh", limit: 50 },
];
const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_ASSETS: Asset[] = [];
const DRIVE_FAILURE_FILTERS: DriveFailureFilter[] = [
  "private",
  "not_found",
  "not_image",
  "too_large",
  "throttle",
  "network",
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
  if (errorCode === "throttle" || /giới hạn|throttle|quota|rate|429/i.test(error)) return "throttle";
  if (errorCode === "network" || /lỗi mạng|network|timeout|fetch failed/i.test(error)) return "network";
  return "unknown";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function normalizeDriveImageLimit(value: string): DriveImageLimit {
  if (value === "all") return "all";
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : "all";
}

function imageLimitToSelectValue(limit: DriveImageLimit) {
  return limit === "all" ? "all" : String(limit);
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
    case "throttle":
      return "Drive giới hạn";
    case "network":
      return "Lỗi mạng";
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
  bytes,
  skipped,
}: {
  done: number;
  total: number;
  current?: string;
  bytes?: number;
  skipped?: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="min-w-64 space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>Tải ảnh từ sheet</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {done}/{total}
        {current ? ` - ${current}` : ""}
      </div>
      {(bytes || skipped) ? (
        <div className="text-xs text-muted-foreground">
          {bytes ? `Đã tải ${formatBytes(bytes)}` : ""}
          {skipped ? `${bytes ? " · " : ""}Bỏ qua ${skipped} file đã có` : ""}
        </div>
      ) : null}
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
        role: "generic" as const,
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
  const [driveEntityLimit, setDriveEntityLimit] = useState(DEFAULT_DRIVE_ENTITY_LIMIT);
  const [driveImageLimit, setDriveImageLimit] = useState<DriveImageLimit>("all");
  const [driveCheckpoint, setDriveCheckpoint] = useState<DriveDownloadCheckpoint | null>(null);
  const [driveRunStats, setDriveRunStats] = useState({
    done: 0,
    total: 0,
    imported: 0,
    skippedFiles: 0,
    downloadedBytes: 0,
    skippedBytes: 0,
    startedAt: 0,
    current: "",
  });
  const [driveFailures, setDriveFailures] = useState<DriveFailure[]>([]);
  const [driveFailureFilter, setDriveFailureFilter] = useState<DriveFailureFilter>("private");
  const [visibleCount, setVisibleCount] = useState(PREVIEW_PAGE_SIZE);
  const [, setPreviewVersion] = useState(0);
  const previewUrlsRef = useRef(new Map<string, string>());

  useEffect(() => {
    getSettings().then((settings) => {
      setDriveRootUrl(settings.driveRootFolderUrl ?? "");
      setDriveCheckpoint(settings.driveDownloadCheckpoint ?? null);
      if (settings.driveDownloadCheckpoint?.entityLimit) {
        setDriveEntityLimit(settings.driveDownloadCheckpoint.entityLimit);
      }
      if (settings.driveDownloadCheckpoint?.imageLimit) {
        setDriveImageLimit(settings.driveDownloadCheckpoint.imageLimit);
      }
    });
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

  const visiblePending = useMemo(
    () => pending.slice(0, visibleCount).map((item, index) => ({ item, index })),
    [pending, visibleCount],
  );

  useEffect(() => {
    const validKeys = new Set(pending.map(pendingKey));
    for (const [key, url] of previewUrlsRef.current.entries()) {
      if (!validKeys.has(key)) {
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(key);
      }
    }

    let changed = false;
    for (const { item } of visiblePending) {
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
      `${autoAssigned.length} ảnh, tự tìm được quán ${matched}/${autoAssigned.length}, cần xem lại ${needsReview}`,
    );
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (entities.length === 0) {
      toast.error("Chưa có dữ liệu nào. Hãy nhập dữ liệu trước.");
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
      toast.error("Chưa có dữ liệu nào. Hãy nhập dữ liệu trước.");
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
    toast.success(`Đã dò lại ảnh: tìm được ${matched}/${matches.length}, cần xem lại ${needsReview}`);
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
    setPending((current) => current.filter((_, index) => index !== idx));
  };

  const importAll = async () => {
    const ready = pending.filter((item) => item.manualEntityId);
    if (ready.length === 0) {
      toast.error("Không có ảnh nào đã được gán quán");
      return;
    }

    setBusy(true);
    const total = ready.length;
    const progress = createProgressToast({
      initialLabel: `Đang tải ${total} ảnh lên server...`,
      total,
    });
    let completed = 0;
    let failed = 0;
    const newAssets: Asset[] = [];
    const failedItems: Array<{ name: string; reason: string }> = [];

    /**
     * Pool pattern với concurrency 6: balance giữa nhanh và không bão hoà
     * mạng/CPU. Trước đây vòng `for` tuần tự khiến UI đơ với 50+ ảnh.
     * Resize song song trước khi upload để giảm payload (5-10MB -> ~500KB).
     */
    const CONCURRENCY = 6;

    const worker = async (item: (typeof ready)[number]) => {
      try {
        const resized = await resizeImageBlob(item.file);
        const blobKey = await saveBlob(resized);
        newAssets.push({
          assetId: nanoid(),
          entityId: item.manualEntityId!,
          sourceType: "local",
          sourceValue: makeIdbSrc(blobKey),
          blobKey,
          role: item.role === "cover" ? "generic" : item.role,
          isCover: false,
          qualityScore: 80,
          status: "ok",
        });
      } catch (err) {
        failed += 1;
        failedItems.push({
          name: item.file.name,
          reason: err instanceof Error ? err.message : String(err),
        });
      } finally {
        completed += 1;
        progress.update(completed, `Đang tải ảnh lên server...`);
      }
    };

    try {
      for (let i = 0; i < ready.length; i += CONCURRENCY) {
        const batch = ready.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(worker));
      }

      if (newAssets.length > 0) {
        progress.update(total, "Đang lưu vào database...");
        await db.assets.bulkPut(newAssets);
      }

      const entityCount = new Set(newAssets.map((asset) => asset.entityId)).size;
      if (failed === 0) {
        progress.success(`Đã nhập ${newAssets.length} ảnh vào ${entityCount} quán`);
      } else if (newAssets.length > 0) {
        progress.success(
          `Đã nhập ${newAssets.length}/${total} ảnh vào ${entityCount} quán · ${failed} ảnh lỗi`,
        );
        if (failedItems.length > 0) {
          console.warn("[BulkImageUpload] Failed files:", failedItems);
        }
      } else {
        progress.error(`Không nhập được ảnh nào (${failed} lỗi). Xem console để biết chi tiết.`);
      }
      setPending([]);
    } catch (error) {
      progress.error("Lỗi khi nhập ảnh: " + (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const matchedCount = pending.filter((item) => item.manualEntityId).length;
  const assetEntityIds = useMemo(() => getAssetEntityIds(allAssets), [allAssets]);
  const imageReferenceEntityIds = useMemo(
    () => getImageReferenceEntityIds(entities, allAssets),
    [allAssets, entities],
  );
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
  const entitiesWithReferenceOnly = useMemo(
    () =>
      entitiesWithoutImage.filter((entity) => imageReferenceEntityIds.has(entity.entityId)),
    [entitiesWithoutImage, imageReferenceEntityIds],
  );
  const entitiesWithoutAnyImageSource = useMemo(
    () =>
      entitiesWithoutImage.filter((entity) => !imageReferenceEntityIds.has(entity.entityId)),
    [entitiesWithoutImage, imageReferenceEntityIds],
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
  const driveRunLimit = Math.max(1, Math.min(Math.floor(driveEntityLimit || 1), 500));
  const driveRunCandidateCount = Math.min(driveRunLimit, driveImportCandidates.length);
  const driveElapsedSeconds = driveRunStats.startedAt
    ? (Date.now() - driveRunStats.startedAt) / 1000
    : 0;
  const driveSpeed = driveElapsedSeconds > 0 ? driveRunStats.downloadedBytes / driveElapsedSeconds : 0;
  const driveEtaSeconds =
    driveBusy && driveRunStats.done > 0
      ? ((driveRunStats.total - driveRunStats.done) * driveElapsedSeconds) / driveRunStats.done
      : 0;
  const driveFailureCounts = useMemo(() => {
    const counts: Record<DriveFailureFilter, number> = {
      all: driveFailures.length,
      private: 0,
      not_found: 0,
      not_image: 0,
      too_large: 0,
      throttle: 0,
      network: 0,
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
    toast.success("Đã lưu thư mục Drive gốc");
  };

  const saveDriveCheckpoint = async (checkpoint: DriveDownloadCheckpoint) => {
    setDriveCheckpoint(checkpoint);
    const settings = await getSettings();
    await saveSettings({
      ...settings,
      driveRootFolderUrl: driveRootUrl.trim() || settings.driveRootFolderUrl,
      driveDownloadCheckpoint: checkpoint,
    });
  };

  const retryDriveFailures = () => {
    const failedEntityIds = new Set(driveFailures.map((failure) => failure.entityId));
    const failedCandidates = driveImportCandidates.filter((entity) => failedEntityIds.has(entity.entityId));
    if (failedCandidates.length === 0) {
      toast.info("Không còn quán lỗi trong danh sách cần tải.");
      return;
    }
    void importDriveImages(failedCandidates);
  };

  const importDriveImages = async (candidateOverride?: Entity[]) => {
    if (entities.length === 0) {
      toast.error("Chưa có dữ liệu nào. Hãy nhập dữ liệu trước.");
      return;
    }
    const selectedCandidates = candidateOverride ?? driveImportCandidates;
    if (selectedCandidates.length === 0) {
      toast.success("Không có quán thiếu ảnh có link/folder trong sheet để tải.");
      return;
    }

    const rootUrl = driveRootUrl.trim();
    const hasNameOnlyRef = selectedCandidates.some((entity) =>
      getEntityImageReferencesWithAssets(entity, assetsByEntityId.get(entity.entityId) ?? []).some(
        (reference) => !looksLikeDriveReference(reference),
      ),
    );
    if (hasNameOnlyRef && !rootUrl) {
      toast.error("Có cột ảnh dạng tên folder. Dán thư mục Drive gốc public trước, hoặc chọn thư mục ảnh từ máy.");
      return;
    }

    setDriveBusy(true);
    setDriveFailures([]);
    const startedAt = Date.now();
    setDriveRunStats({
      done: 0,
      total: 0,
      imported: 0,
      skippedFiles: 0,
      downloadedBytes: 0,
      skippedBytes: 0,
      startedAt,
      current: "",
    });
    const toastId = "drive-image-import";
    const candidates = selectedCandidates.slice(0, driveRunLimit);
    const total = candidates.length;
    let done = 0;
    let imported = 0;
    let skippedFiles = 0;
    let downloadedBytes = 0;
    let skippedBytes = 0;
    let failedEntitiesSoFar = 0;
    const imageLimit = driveImageLimit;

    await saveDriveCheckpoint({
      updatedAt: Date.now(),
      status: "running",
      totalEntities: total,
      completedEntities: 0,
      importedAssets: 0,
      skippedFiles: 0,
      downloadedBytes: 0,
      failedEntities: 0,
      entityLimit: driveRunLimit,
      imageLimit,
    });

    toast.loading(<DriveImportToast done={0} total={total} />, {
      id: toastId,
      duration: Infinity,
    });

    try {
      const { fetchDriveImagesToDataServer } = await import("@/server/driveFetch");
      if (rootUrl) {
        const settings = await getSettings();
        await saveSettings({
          ...settings,
          driveRootFolderUrl: rootUrl,
          driveDownloadCheckpoint: {
            updatedAt: Date.now(),
            status: "running",
            totalEntities: total,
            completedEntities: 0,
            importedAssets: 0,
            skippedFiles: 0,
            downloadedBytes: 0,
            failedEntities: 0,
            entityLimit: driveRunLimit,
            imageLimit,
          },
        });
      }

      const results = [];
      for (const entity of candidates) {
        const entityAssets: Asset[] = [];
        const entityFailures: DriveFailure[] = [];
        let entitySkippedFiles = 0;
        let entityDownloadedBytes = 0;
        let entitySkippedBytes = 0;

        try {
          const references = getEntityImageReferencesWithAssets(
            entity,
            assetsByEntityId.get(entity.entityId) ?? [],
          );
          for (const reference of references) {
            const result = await fetchDriveImagesToDataServer({
              data: {
                reference,
                rootFolderUrl: rootUrl || undefined,
                searchContext: entity.sheetName,
                entityName: entity.name,
                maxFiles: imageLimit === "all" ? undefined : imageLimit,
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

            const existingUrls = new Set((assetsByEntityId.get(entity.entityId) ?? []).map((asset) => asset.sourceValue));
            entitySkippedFiles += result.skippedExisting ?? 0;
            entityDownloadedBytes += result.downloadedBytes ?? 0;
            entitySkippedBytes += result.skippedBytes ?? 0;
            for (const file of result.files) {
              if (existingUrls.has(file.url)) {
                continue;
              }
              existingUrls.add(file.url);

              entityAssets.push({
                assetId: nanoid(),
                entityId: entity.entityId,
                sourceType: "local",
                sourceValue: file.url,
                role: "generic",
                isCover: false,
                qualityScore: 80,
                status: "ok",
              });
            }
          }

          if (entityAssets.length) {
            const staleAssets = (assetsByEntityId.get(entity.entityId) ?? []).filter(
              isImageReferenceAsset,
            );
            await db.transaction("rw", db.assets, async () => {
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
        if (entityFailures.length) failedEntitiesSoFar += 1;
        skippedFiles += entitySkippedFiles;
        downloadedBytes += entityDownloadedBytes;
        skippedBytes += entitySkippedBytes;
        const nextStats = {
          done,
          total,
          imported,
          skippedFiles,
          downloadedBytes,
          skippedBytes,
          startedAt,
          current: entity.name,
        };
        setDriveRunStats(nextStats);
        await saveDriveCheckpoint({
          updatedAt: Date.now(),
          status: "running",
          totalEntities: total,
          completedEntities: done,
          importedAssets: imported,
          skippedFiles,
          downloadedBytes,
          failedEntities: failedEntitiesSoFar,
          entityLimit: driveRunLimit,
          imageLimit,
        });
        toast.loading(
          <DriveImportToast
            done={done}
            total={total}
            current={entity.name}
            bytes={downloadedBytes}
            skipped={skippedFiles}
          />,
          {
            id: toastId,
            duration: Infinity,
          },
        );
        await yieldToBrowser();

        results.push({
          imported: entityAssets.length,
          failures: entityFailures,
        });
      }

      const failed = results.flatMap((result) => result.failures);
      const failedEntityCount = new Set(failed.map((item) => item.entityId)).size;

      setDriveFailures(failed);
      if (failed.some((item) => item.type === "private")) {
        setDriveFailureFilter("private");
      } else if (failed.length) {
        setDriveFailureFilter("all");
      }

      if (imported > 0) {
        const privateCount = failed.filter((item) => item.type === "private").length;
        toast.success(
          `Đã tải ${imported} ảnh (${formatBytes(downloadedBytes)}) vào data/images cho ${total - failedEntityCount}/${total} quán${
            skippedFiles ? `. Bỏ qua ${skippedFiles} file đã có` : ""
          }${
            failed.length
              ? `. Lỗi ${failedEntityCount} quán${privateCount ? `, bị private ${privateCount}` : ""}.`
              : "."
          }`,
          { id: toastId, duration: 8000 },
        );
      } else {
        toast.error(failed[0]?.error ?? "Không tải được ảnh từ sheet.", { id: toastId, duration: 8000 });
      }
      await saveDriveCheckpoint({
        updatedAt: Date.now(),
        status: failed.length ? "error" : "done",
        totalEntities: total,
        completedEntities: done,
        importedAssets: imported,
        skippedFiles,
        downloadedBytes,
        failedEntities: failedEntityCount,
        entityLimit: driveRunLimit,
        imageLimit,
      });
    } catch (error) {
      toast.error("Lỗi tải ảnh từ sheet: " + (error instanceof Error ? error.message : String(error)), {
        id: toastId,
        duration: 8000,
      });
      await saveDriveCheckpoint({
        updatedAt: Date.now(),
        status: "error",
        totalEntities: total,
        completedEntities: done,
        importedAssets: imported,
        skippedFiles,
        downloadedBytes,
        failedEntities: 1,
        entityLimit: driveRunLimit,
        imageLimit,
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
            <CardTitle>Bước 3: Tải ảnh vào dữ liệu</CardTitle>
            <CardDescription>
              Sheet là nguồn chính. App tải ảnh từ link/folder trong sheet về data/images; chọn ảnh từ máy chỉ là dự phòng.
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
                  <ImagePlus /> Chọn ảnh từ máy
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
                <FolderOpen /> Chọn cả thư mục ảnh
              </Button>
              <Button
                variant="outline"
                onClick={rerunMatch}
                disabled={pending.length === 0 || matching}
              >
                <RefreshCw /> Dò lại ảnh
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 flex flex-col gap-1">
                <Label>Thư mục Drive gốc (tuỳ chọn)</Label>
                <p className="text-xs text-muted-foreground">
                  Không bắt buộc. Nếu chưa có Drive public, cứ chọn thư mục ảnh từ máy ở trên.
                  Chỉ dán mục này khi muốn app tự tải ảnh từ Google Drive.
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
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Số quán tối đa/lượt</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={driveEntityLimit}
                    onChange={(event) =>
                      setDriveEntityLimit(Math.max(1, Math.min(Number(event.target.value) || 1, 500)))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Số ảnh/quán</Label>
                  <Select
                    value={imageLimitToSelectValue(driveImageLimit)}
                    onValueChange={(value) => setDriveImageLimit(normalizeDriveImageLimit(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRIVE_IMAGE_LIMIT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                Lượt này sẽ tải {driveRunCandidateCount}/{driveImportCandidates.length} quán, theo thứ tự từng quán để tránh Drive giới hạn.
                {driveImageLimit === "all" ? " Mỗi quán tải tất cả ảnh tìm thấy trong folder." : ` Mỗi quán tối đa ${driveImageLimit} ảnh.`}
              </div>
              {driveBusy && (
                <div className="mt-3 grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="font-medium">{driveRunStats.done}/{driveRunStats.total}</div>
                    <div>Quán đã xử lý</div>
                  </div>
                  <div>
                    <div className="font-medium">{driveRunStats.imported} ảnh</div>
                    <div>Đã tạo asset</div>
                  </div>
                  <div>
                    <div className="font-medium">{formatBytes(driveSpeed)}/s</div>
                    <div>{formatBytes(driveRunStats.downloadedBytes)} đã tải</div>
                  </div>
                  <div>
                    <div className="font-medium">{driveEtaSeconds ? formatDuration(driveEtaSeconds) : "Đang tính"}</div>
                    <div>Còn lại ước tính</div>
                  </div>
                  {driveRunStats.current ? (
                    <div className="truncate sm:col-span-2 lg:col-span-4">
                      Đang xử lý: {driveRunStats.current}
                      {driveRunStats.skippedFiles ? ` · bỏ qua ${driveRunStats.skippedFiles} file đã có` : ""}
                    </div>
                  ) : null}
                </div>
              )}
              {driveCheckpoint && !driveBusy && (
                <div className="mt-3 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                  Lần tải gần nhất: {driveCheckpoint.completedEntities}/{driveCheckpoint.totalEntities} quán,
                  {` ${driveCheckpoint.importedAssets} ảnh mới, ${driveCheckpoint.skippedFiles} file đã có, ${formatBytes(driveCheckpoint.downloadedBytes)}.`}
                </div>
              )}
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
                <Download /> {driveCheckpoint && driveCheckpoint.status !== "done" ? "Tải tiếp" : "Tải ảnh từ link trong sheet"} ({driveRunCandidateCount})
              </Button>
              {shouldHighlightDriveDownload && (
                <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                  Có {driveImportCandidates.length} quán có tên folder/link ảnh trong sheet. App sẽ tải ảnh về
                  thư mục data/images và không đưa ảnh lên git.
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
                  {allAssets.length - usableAssets.length} tham chiếu ảnh cần ghép/tải thành ảnh đọc được
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-2xl font-semibold">{entitiesWithReferenceOnly.length}</div>
              <div className="text-sm text-muted-foreground">Có tên folder/link, chưa ghép</div>
              {entitiesWithReferenceOnly.length > 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Ví dụ như OLLIN Coffee nếu cột ảnh là tên folder: cần chọn thư mục ảnh từ máy hoặc tải Drive.
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
              <div className="text-sm text-muted-foreground">Chưa có ảnh đọc được</div>
              {entitiesWithoutImage.length > 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Không có nghĩa sheet thiếu ảnh. Dòng có tên folder/link cần ghép local hoặc tải Drive trước.
                </div>
              ) : null}
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
              <Button
                type="button"
                size="sm"
                onClick={retryDriveFailures}
                disabled={driveBusy || matching || busy}
              >
                <RotateCcw /> Tải lại lỗi
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDriveFailures([])}
                disabled={driveBusy}
              >
                Bỏ qua lỗi
              </Button>
            </div>
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
              <CardTitle>Xem lại ảnh trước khi nhập</CardTitle>
              <CardDescription>
                {pending.length} ảnh, {matchedCount} đã tìm được quán, {pending.length - matchedCount} chưa
                tìm thấy.
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
                <Upload /> Nhập {matchedCount} ảnh
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
                    <th className="p-3 text-left font-medium text-muted-foreground">Độ khớp</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Quán</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Vai trò</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePending.map(({ item, index }) => (
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
                            <span className="text-[11px] text-muted-foreground">Cần xem lại</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3">
                        <Select
                          value={item.manualEntityId ?? "__none__"}
                          onValueChange={(value) =>
                            setManual(index, value === "__none__" ? null : value)
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
                          onValueChange={(value) => setRole(index, value as Asset["role"])}
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="facade">Mặt tiền</SelectItem>
                            <SelectItem value="food_closeup">Món/chi tiết</SelectItem>
                            <SelectItem value="space">Không gian</SelectItem>
                            <SelectItem value="portrait">Chân dung</SelectItem>
                            <SelectItem value="square_thumb">Ảnh vuông</SelectItem>
                            <SelectItem value="section_image">Ảnh phụ</SelectItem>
                            <SelectItem value="generic">Khác</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeRow(index)}
                          aria-label="Bỏ ảnh khỏi danh sách nhập"
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
            <CardTitle>Dòng chưa có ảnh đọc được</CardTitle>
            <Badge variant={entitiesWithoutImage.length === 0 ? "default" : "destructive"}>
              {entitiesWithoutImage.length}/{entities.length}
            </Badge>
          </div>
          {entitiesWithReferenceOnly.length > 0 || entitiesWithoutAnyImageSource.length > 0 ? (
            <CardDescription>
              {entitiesWithReferenceOnly.length} dòng đã có tên folder/link nhưng chưa ghép/tải ảnh.
              {entitiesWithoutAnyImageSource.length > 0
                ? ` ${entitiesWithoutAnyImageSource.length} dòng chưa có cột ảnh trong sheet.`
                : ""}
            </CardDescription>
          ) : null}
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
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      imageReferenceEntityIds.has(entity.entityId)
                        ? "bg-amber-500"
                        : "bg-destructive"
                    }`}
                  />
                  <span className="truncate">{entity.name}</span>
                  {imageReferenceEntityIds.has(entity.entityId) ? (
                    <Badge variant="outline" className="ml-auto">
                      Có folder/link
                    </Badge>
                  ) : null}
                  {entity.partnerFlag && (
                    <Badge variant="outline" className={imageReferenceEntityIds.has(entity.entityId) ? "" : "ml-auto"}>
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
