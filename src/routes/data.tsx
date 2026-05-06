import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  ImagePlus,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Store,
  Trash2,
  Upload,
  XCircle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { BulkImageUpload } from "@/features/data/BulkImageUpload";
import {
  entityHasImageSource,
  getAssetEntityIds,
  getEntityImageReferences,
  getEntityImageReferencesWithAssets,
  looksLikeDirectImageReference,
  looksLikeDriveReference,
} from "@/features/data/imageReferences";
import {
  fetchSheetWorkbook,
  parseDataFile,
  type ParsedTable,
  type ParsedWorkbookSheet,
} from "@/features/data/parsers";
import {
  autoMap,
  normalizeRows,
  standardFieldOptionsLabeled,
  type FieldMapping,
} from "@/engines/normalize/normalizer";
import type { Asset, Entity } from "@/models";
import { db, saveBlob } from "@/storage/db";
import { getBlobKeyFromSrc, makeIdbSrc } from "@/storage/imageSrc";
import { setLastActiveSheet } from "@/storage/lastSheet";
import { getSettings } from "@/storage/settings";

export const Route = createFileRoute("/data")({
  component: DataPage,
});

const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_ASSETS: Asset[] = [];
type DataTab = "import" | "images" | "entities" | "assets";

function normalizeDataTab(value: unknown): DataTab {
  return value === "images" || value === "entities" || value === "assets" ? value : "import";
}

function stripImportExtension(fileName: string) {
  return fileName.replace(/\.(csv|json|xlsx)$/i, "");
}

function guessSheetName(raw: string) {
  const gid = raw.match(/[?#&]gid=(\d+)/)?.[1];
  if (gid) return `Sheet_${gid}`;
  return "";
}

type MappingCheckLevel = "ok" | "warn" | "error";

interface MappingFieldGuess {
  field: string;
  confidence: number;
  reason: string;
}

interface MappingRowCheck {
  level: MappingCheckLevel;
  message: string;
  suggestion?: string;
}

interface MappingCheckResult {
  level: MappingCheckLevel;
  label: string;
  summary: string;
  rows: Record<string, MappingRowCheck>;
  issues: string[];
  blockingIssues: string[];
}

type DriveLinkIssueType = "private" | "not_found" | "not_image" | "too_large" | "unknown";
type DriveLinkIssueFilter = "all" | DriveLinkIssueType;

interface DriveLinkCandidate {
  sheetName: string;
  rowNumber: number;
  entityName: string;
  reference: string;
}

interface DriveLinkIssue extends DriveLinkCandidate {
  type: DriveLinkIssueType;
  error: string;
}

const STANDARD_FIELD_OPTIONS_LABELED = standardFieldOptionsLabeled();
const STANDARD_FIELD_LABELS = new Map(
  STANDARD_FIELD_OPTIONS_LABELED.map((option) => [option.value, option.label]),
);
const NON_OVERWRITING_FIELDS = new Set(["images", "campaignTags", "seoKeywords"]);
const DRIVE_LINK_ISSUE_FILTERS: DriveLinkIssueFilter[] = [
  "private",
  "not_found",
  "not_image",
  "too_large",
  "unknown",
  "all",
];

function normalizeForCheck(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function cleanSample(value: unknown) {
  return String(value ?? "").trim();
}

function isKnownStandardField(field: string) {
  return STANDARD_FIELD_LABELS.has(field);
}

function labelForField(field: string) {
  return STANDARD_FIELD_LABELS.get(field) ?? `Metadata: ${field}`;
}

function optionsForMappingValue(value: string) {
  if (value && value !== "__ignore__" && !isKnownStandardField(value)) {
    return [{ value, label: `Metadata: ${value}` }, ...STANDARD_FIELD_OPTIONS_LABELED];
  }
  return STANDARD_FIELD_OPTIONS_LABELED;
}

function splitReferenceParts(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(splitReferenceParts);
  if (typeof value === "object") return Object.values(value).flatMap(splitReferenceParts);
  return String(value)
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyDriveIssue(error: string, errorCode?: string): DriveLinkIssueType {
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

function labelDriveIssueFilter(filter: DriveLinkIssueFilter) {
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

function buildDriveIssueCounts(issues: DriveLinkIssue[]) {
  const counts: Record<DriveLinkIssueFilter, number> = {
    all: issues.length,
    private: 0,
    not_found: 0,
    not_image: 0,
    too_large: 0,
    unknown: 0,
  };
  for (const issue of issues) counts[issue.type] += 1;
  return counts;
}

function displayRowNumberFromIndex(rowIndex: number) {
  return rowIndex + 2;
}

function displayRowNumberFromSourceRowId(sourceRowId: unknown) {
  const rowIndex = Number(sourceRowId ?? 0);
  return Number.isFinite(rowIndex) ? displayRowNumberFromIndex(rowIndex) : 0;
}

function inferFieldFromHeader(header: string): MappingFieldGuess | null {
  const text = normalizeForCheck(header).replace(/[_-]+/g, " ");

  if (/^(__empty|empty|stt|no|so thu tu|index|id|\d+)$/.test(text)) {
    return { field: "__ignore__", confidence: 0.95, reason: "cột số thứ tự" };
  }
  if (/(ten|name|title|ten quan|ten dia diem|homestay|hotel)/.test(text)) {
    return { field: "name", confidence: 0.92, reason: "tên cột giống tên quán" };
  }
  if (/(dia chi|address|addr|vi tri|location)/.test(text)) {
    return { field: "address", confidence: 0.92, reason: "tên cột giống địa chỉ" };
  }
  if (/(mo hinh|loai|type|dich vu|category|nhom)/.test(text)) {
    return { field: "categoryMain", confidence: 0.88, reason: "tên cột giống loại dịch vụ" };
  }
  if (/(phong cach|style|concept|vibe)/.test(text)) {
    return { field: "categorySub", confidence: 0.86, reason: "tên cột giống phong cách" };
  }
  if (/(gio|open|time|hour)/.test(text)) {
    return { field: "openingHours", confidence: 0.9, reason: "tên cột giống giờ mở cửa" };
  }
  if (/(thoi diem|khung thoi gian|time slot)/.test(text)) {
    return { field: "timeSlot", confidence: 0.9, reason: "tên cột giống thời điểm" };
  }
  if (/(huong di|duong di|route|direction)/.test(text)) {
    return { field: "direction", confidence: 0.9, reason: "tên cột giống hướng đi" };
  }
  if (/(gia|price|cost|khoang)/.test(text)) {
    return { field: "priceRange", confidence: 0.9, reason: "tên cột giống khoảng giá" };
  }
  if (/(doi tac|partner|sponsor|booking|hop tac)/.test(text)) {
    return { field: "partnerFlag", confidence: 0.9, reason: "tên cột giống cờ đối tác" };
  }
  if (/(mon|dish|highlight|diem nhan|noi bat|dac san)/.test(text)) {
    return { field: "signatureDish", confidence: 0.86, reason: "tên cột giống món/điểm nhấn" };
  }
  if (/(link drive|drive|thu muc anh|folder anh|ten file anh|link anh|link hinh)/.test(text)) {
    return { field: "imageRef", confidence: 0.8, reason: "tên cột giống tên folder/link ảnh" };
  }
  if (/(anh|image|photo|hinh|url)/.test(text)) {
    return { field: "image", confidence: 0.78, reason: "tên cột giống link ảnh" };
  }

  return null;
}

function ratio(values: string[], predicate: (value: string, normalized: string) => boolean) {
  if (values.length === 0) return 0;
  const matched = values.filter((value) => predicate(value, normalizeForCheck(value))).length;
  return matched / values.length;
}

function inferFieldFromSamples(values: string[]): MappingFieldGuess | null {
  if (values.length === 0) return null;

  const driveRatio = ratio(values, (value) => looksLikeDriveReference(value));
  if (driveRatio >= 0.35) {
    return { field: "imageRef", confidence: 0.86, reason: "giá trị giống link Drive ảnh" };
  }

  const directImageRatio = ratio(values, (value) => looksLikeDirectImageReference(value));
  if (directImageRatio >= 0.35) {
    return { field: "image", confidence: 0.82, reason: "giá trị giống link ảnh trực tiếp" };
  }

  const hourRatio = ratio(
    values,
    (value, normalized) =>
      /\b\d{1,2}([:h]\d{0,2})?\s*[-–]\s*\d{1,2}([:h]\d{0,2})?\b/.test(normalized) ||
      /\b(24\/7|ca ngay|full ngay|mo cua|dong cua)\b/.test(normalized) ||
      /\b\d{1,2}:\d{2}\b/.test(value),
  );
  if (hourRatio >= 0.35) {
    return { field: "openingHours", confidence: 0.8, reason: "giá trị giống giờ mở cửa" };
  }

  const priceRatio = ratio(
    values,
    (value, normalized) =>
      /\b\d+([.,]\d+)?\s*(k|nghin|ngan|tr|trieu|vnd|d|đ)\b/.test(normalized) ||
      /\b\d{2,}\s*[-–]\s*\d{2,}\b/.test(normalized) ||
      /\b(mien phi|free|gia|tu)\b/.test(normalized),
  );
  if (priceRatio >= 0.35) {
    return { field: "priceRange", confidence: 0.78, reason: "giá trị giống khoảng giá" };
  }

  const partnerRatio = ratio(values, (_value, normalized) =>
    /^(1|0|x|yes|no|true|false|co|khong|doi tac|partner)$/.test(normalized),
  );
  if (partnerRatio >= 0.65 && new Set(values.map(normalizeForCheck)).size <= 5) {
    return { field: "partnerFlag", confidence: 0.76, reason: "giá trị giống cờ đúng/sai" };
  }

  const addressRatio = ratio(values, (_value, normalized) =>
    /(duong|phuong|quan|tp|thanh pho|hem|pho|street|ward|district|dalat|da lat|\d+\/\d+|\d+\s+[a-z])/.test(
      normalized,
    ),
  );
  if (addressRatio >= 0.45) {
    return { field: "address", confidence: 0.76, reason: "giá trị giống địa chỉ" };
  }

  const phoneRatio = ratio(values, (_value, normalized) =>
    /(\+?84|0)\d[\d\s.-]{7,}/.test(normalized),
  );
  if (phoneRatio >= 0.55) {
    return { field: "phone", confidence: 0.78, reason: "giá trị giống số điện thoại" };
  }

  return null;
}

function collectSamples(rows: Record<string, unknown>[], header: string) {
  return rows
    .slice(0, 40)
    .map((row) => cleanSample(row[header]))
    .filter(Boolean);
}

function autoMapImportSource(
  headers: string[],
  rows: Record<string, unknown>[],
  previousMapping?: FieldMapping,
): FieldMapping {
  const next = autoMap(headers);

  for (const header of headers) {
    const headerGuess = inferFieldFromHeader(header);
    const sampleGuess = inferFieldFromSamples(collectSamples(rows, header));

    if (headerGuess?.field === "__ignore__") {
      next[header] = "__ignore__";
      continue;
    }

    const previousValue = previousMapping?.[header];
    if (previousValue) {
      next[header] = previousValue;
      continue;
    }

    if (sampleGuess?.field === "image") {
      next[header] = "image";
      continue;
    }

    if (headerGuess && (!isKnownStandardField(next[header]) || next[header] === header)) {
      next[header] = headerGuess.field;
    }
  }

  return next;
}

function autoMapWorkbook(
  workbook: ParsedWorkbookSheet[],
  previousMappings: Record<string, FieldMapping>,
) {
  return Object.fromEntries(
    workbook.map((sheet) => [
      sheet.name,
      autoMapImportSource(sheet.headers, sheet.rows, previousMappings[sheet.name]),
    ]),
  );
}

function sheetHasUsableNameMapping(sheet: ParsedWorkbookSheet, mapping: FieldMapping) {
  return sheet.headers.some(
    (header) => (mapping[header] ?? "__ignore__") === "name" && collectSamples(sheet.rows, header).length > 0,
  );
}

function defaultIncludedSheets(
  workbook: ParsedWorkbookSheet[],
  mappings: Record<string, FieldMapping>,
) {
  return Object.fromEntries(
    workbook.map((sheet) => [
      sheet.name,
      sheetHasUsableNameMapping(sheet, mappings[sheet.name] ?? {}) || workbook.length === 1,
    ]),
  );
}

function collectDriveLinkCandidates(
  sources: ParsedWorkbookSheet[],
  mappings: Record<string, FieldMapping>,
  rootFolderUrl?: string,
): DriveLinkCandidate[] {
  const candidates: DriveLinkCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    sheetName: string,
    rowNumber: number,
    entityName: string,
    reference: string,
  ) => {
    const cleanReference = reference.trim();
    if (!cleanReference) return;
    if (!looksLikeDriveReference(cleanReference) && !rootFolderUrl) return;
    const key = `${sheetName}:${rowNumber}:${entityName}:${cleanReference}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ sheetName, rowNumber, entityName, reference: cleanReference });
  };

  for (const source of sources) {
    const sourceMapping = mappings[source.name] ?? autoMapImportSource(source.headers, source.rows);
    const normalized = normalizeRows(source.rows, sourceMapping, source.name);
    const entityById = new Map(normalized.entities.map((entity) => [entity.entityId, entity]));

    for (const entity of normalized.entities) {
      const rowNumber = displayRowNumberFromSourceRowId(entity.sourceRowId);
      for (const reference of getEntityImageReferences(entity)) {
        pushCandidate(source.name, rowNumber, entity.name, reference);
      }
    }

    for (const asset of normalized.assets) {
      const entity = entityById.get(asset.entityId);
      if (!entity || !looksLikeDriveReference(asset.sourceValue)) continue;
      const rowNumber = displayRowNumberFromSourceRowId(entity.sourceRowId);
      pushCandidate(source.name, rowNumber, entity.name, asset.sourceValue);
    }

    source.rows.forEach((row, rowIndex) => {
      for (const value of Object.values(row)) {
        for (const reference of splitReferenceParts(value)) {
          if (looksLikeDriveReference(reference)) {
            const rowNumber = displayRowNumberFromIndex(rowIndex);
            pushCandidate(source.name, rowNumber, `Dòng ${rowNumber}`, reference);
          }
        }
      }
    });
  }

  return candidates;
}

function validateMapping(
  headers: string[],
  rows: Record<string, unknown>[],
  mapping: FieldMapping,
): MappingCheckResult {
  const rowChecks: Record<string, MappingRowCheck> = {};
  const issues = new Set<string>();
  const blockingIssues = new Set<string>();
  const headersByField = new Map<string, string[]>();

  for (const header of headers) {
    const selected = mapping[header] ?? "__ignore__";
    if (selected !== "__ignore__") {
      headersByField.set(selected, [...(headersByField.get(selected) ?? []), header]);
    }
  }

  const nameHeaders = headersByField.get("name") ?? [];
  if (nameHeaders.length === 0) {
    blockingIssues.add("Thiếu cột Tên. App cần field này để tạo entity.");
  } else {
    const filledNameCount = nameHeaders.reduce((count, header) => {
      return count + collectSamples(rows, header).length;
    }, 0);
    if (filledNameCount === 0) {
      blockingIssues.add("Cột Tên đang không có dữ liệu trong preview.");
    }
  }

  for (const [field, mappedHeaders] of headersByField) {
    if (!isKnownStandardField(field) || NON_OVERWRITING_FIELDS.has(field)) continue;
    if (mappedHeaders.length <= 1) continue;

    const message = `${mappedHeaders.join(", ")} cùng map vào ${labelForField(field)}. Khi import, cột sau có thể ghi đè cột trước.`;
    issues.add(message);
    if (field === "name") blockingIssues.add(message);
    for (const header of mappedHeaders) {
      rowChecks[header] = {
        level: field === "name" ? "error" : "warn",
        message,
      };
    }
  }

  for (const header of headers) {
    const selected = mapping[header] ?? "__ignore__";
    const samples = collectSamples(rows, header);
    const headerGuess = inferFieldFromHeader(header);
    const sampleGuess = inferFieldFromSamples(samples);
    const bestGuess =
      headerGuess && headerGuess.confidence >= (sampleGuess?.confidence ?? 0)
        ? headerGuess
        : sampleGuess;

    if (rowChecks[header]) continue;

    if (bestGuess?.field === "__ignore__") {
      if (selected !== "__ignore__") {
        const message = "Cột này giống số thứ tự, thường nên bỏ qua để dữ liệu sạch hơn.";
        issues.add(message);
        rowChecks[header] = { level: "warn", message, suggestion: "__ignore__" };
      }
      continue;
    }

    if (!bestGuess) {
      if (selected !== "__ignore__" && !isKnownStandardField(selected)) {
        rowChecks[header] = {
          level: "ok",
          message: "Cột custom sẽ được lưu vào metadata.",
        };
      }
      continue;
    }

    if (selected === "__ignore__") {
      const message = `Có vẻ là ${labelForField(bestGuess.field)} nhưng đang bỏ qua.`;
      issues.add(message);
      rowChecks[header] = { level: "warn", message, suggestion: bestGuess.field };
      continue;
    }

    if (!isKnownStandardField(selected)) {
      const message = `${bestGuess.reason}, nhưng hiện đang lưu như metadata.`;
      issues.add(message);
      rowChecks[header] = { level: "warn", message, suggestion: bestGuess.field };
      continue;
    }

    if (
      isKnownStandardField(selected) &&
      selected !== bestGuess.field &&
      bestGuess.confidence >= 0.78
    ) {
      const message = `${bestGuess.reason}, nên kiểm tra lại mapping sang ${labelForField(bestGuess.field)}.`;
      issues.add(message);
      rowChecks[header] = { level: "warn", message, suggestion: bestGuess.field };
    }
  }

  const blocking = [...blockingIssues];
  const warnings = [...issues];
  const level: MappingCheckLevel = blocking.length ? "error" : warnings.length ? "warn" : "ok";
  const label =
    level === "error" ? "Cần sửa mapping" : level === "warn" ? "Cần kiểm tra" : "Mapping ổn";
  const summary =
    level === "error"
      ? blocking[0]
      : level === "warn"
        ? `${warnings.length} điểm cần kiểm tra trước khi import.`
        : "Các cột chính đang khớp với dữ liệu preview.";

  return {
    level,
    label,
    summary,
    rows: rowChecks,
    issues: warnings,
    blockingIssues: blocking,
  };
}

function mappingStatusClass(level: MappingCheckLevel) {
  if (level === "error") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (level === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function mappingRowClass(level?: MappingCheckLevel) {
  if (level === "error") return "border-destructive/40 bg-destructive/5";
  if (level === "warn") return "border-amber-200 bg-amber-50/60";
  return "";
}

function DataStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function looksLikeDirectImageSrc(src: string | undefined | null) {
  return Boolean(src && /^(https?:|data:|blob:|\/|\.\/|\.\.\/|idb:\/\/)/i.test(src));
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

function getDirectAssetImageSrc(sourceValue: string | undefined, sourceType: Asset["sourceType"]) {
  if (!sourceValue) return undefined;
  if (sourceValue.startsWith("idb://")) return undefined;
  if (sourceType === "local" && !looksLikeDirectImageSrc(sourceValue)) return undefined;
  return sourceValue;
}

function getAssetBlobKeyCandidates(
  blobKey: string | undefined,
  sourceValue: string | undefined,
  sourceType: Asset["sourceType"],
) {
  const candidates = [
    blobKey,
    getBlobKeyFromSrc(sourceValue),
    sourceType === "local" && !looksLikeDirectImageSrc(sourceValue) ? sourceValue : undefined,
  ].filter((value): value is string => !!value?.trim());

  return [...new Set(candidates)];
}

async function removeAssetAndUnusedBlob(asset: Asset) {
  const blobKeys = getAssetBlobKeyCandidates(asset.blobKey, asset.sourceValue, asset.sourceType);

  await db.transaction("rw", [db.assets, db.blobs], async () => {
    await db.assets.delete(asset.assetId);
    const remainingAssets = await db.assets.toArray();

    for (const blobKey of blobKeys) {
      const stillUsed = remainingAssets.some((item) =>
        getAssetBlobKeyCandidates(item.blobKey, item.sourceValue, item.sourceType).includes(blobKey),
      );
      if (!stillUsed) await db.blobs.delete(blobKey);
    }

    if (asset.isCover) {
      const remainingForEntity = remainingAssets.filter((item) => item.entityId === asset.entityId);
      const hasCover = remainingForEntity.some((item) => item.isCover);
      const nextCover = remainingForEntity[0];
      if (!hasCover && nextCover) {
        await db.assets.update(nextCover.assetId, { isCover: true, role: "cover" });
      }
    }
  });
}

function useAssetImage(asset: Asset) {
  const { assetId, blobKey, sourceType, sourceValue } = asset;
  const [state, setState] = useState<{
    src?: string;
    status: "loading" | "ready" | "missing";
  }>({ status: "loading" });
  const lookup = useMemo(
    () => ({
      candidates: getAssetBlobKeyCandidates(blobKey, sourceValue, sourceType),
      directSrc: getDirectAssetImageSrc(sourceValue, sourceType),
    }),
    [blobKey, sourceType, sourceValue],
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;

    async function resolve() {
      setState({ status: "loading" });
      for (const key of lookup.candidates) {
        const rec = await db.blobs.get(key);
        if (!rec) continue;
        const nextUrl = URL.createObjectURL(rec.blob);
        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setState({ src: objectUrl, status: "ready" });
        return;
      }

      if (!cancelled) {
        setState(
          lookup.directSrc ? { src: lookup.directSrc, status: "ready" } : { status: "missing" },
        );
      }
    }

    void resolve();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, lookup]);

  return state;
}

function AssetCard({
  asset,
  entity,
  index,
  onDelete,
}: {
  asset: Asset;
  entity?: Entity;
  index: number;
  onDelete: (asset: Asset) => void;
}) {
  const { src, status } = useAssetImage(asset);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src, status]);

  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="relative aspect-square bg-muted">
        <Badge className="absolute left-2 top-2 z-10 rounded-md px-1.5 py-0 text-[11px]">
          P{index + 1}
        </Badge>
        <Button
          type="button"
          size="icon"
          variant="destructive"
          className="absolute right-2 top-2 z-10 size-7 opacity-90 shadow-sm"
          onClick={() => onDelete(asset)}
          aria-label="Xoá ảnh khỏi quán"
        >
          <Trash2 className="size-3.5" />
        </Button>
        {asset.isCover ? (
          <Badge
            variant="secondary"
            className="absolute bottom-2 left-2 z-10 rounded-md px-1.5 py-0 text-[11px]"
          >
            cover
          </Badge>
        ) : null}
        {src && !failed ? (
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="grid size-full place-items-center px-3 text-center text-xs text-muted-foreground">
            {status === "missing" || failed ? "Không đọc được ảnh" : "Đang tải ảnh"}
          </div>
        )}
      </div>
      <CardContent className="hidden">
        <div className="truncate text-sm font-semibold">{entity?.name ?? "Không rõ quán"}</div>
      </CardContent>
    </Card>
  );
}

function DataPage() {
  const location = useLocation();
  const routeSearch = location.search as { tab?: unknown };
  const requestedTab = normalizeDataTab(routeSearch.tab);
  const entities = useLiveQuery(() => db.entities.toArray(), []) ?? EMPTY_ENTITIES;
  const assets = useLiveQuery(() => db.assets.toArray(), []) ?? EMPTY_ASSETS;
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [mappingsBySheet, setMappingsBySheet] = useState<Record<string, FieldMapping>>({});
  const [includedSheets, setIncludedSheets] = useState<Record<string, boolean>>({});
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<DataTab>(requestedTab);
  const [driveCheckBusy, setDriveCheckBusy] = useState(false);
  const [driveCheckDone, setDriveCheckDone] = useState(0);
  const [driveCheckTotal, setDriveCheckTotal] = useState(0);
  const [driveLinkIssues, setDriveLinkIssues] = useState<DriveLinkIssue[]>([]);
  const [driveIssueFilter, setDriveIssueFilter] = useState<DriveLinkIssueFilter>("private");
  const [assetActionBusy, setAssetActionBusy] = useState(false);
  const [assetUploadEntityId, setAssetUploadEntityId] = useState("");
  const [assetDeleteTarget, setAssetDeleteTarget] = useState<Asset | null>(null);
  const assetUploadInputRef = useRef<HTMLInputElement | null>(null);
  const assetUploadTargetRef = useRef<string | null>(null);

  const workbookSheets = parsed?.workbookSheets ?? [];
  const isMultiSheetWorkbook = workbookSheets.length > 1;
  const entityMap = useMemo(
    () => new Map(entities.map((entity) => [entity.entityId, entity])),
    [entities],
  );
  const assetGroups = useMemo(() => {
    const groups = new Map<string, { entity?: Entity; entityId: string; assets: Asset[] }>();

    for (const asset of assets) {
      const entity = entityMap.get(asset.entityId);
      const key = entity?.entityId ?? `missing:${asset.entityId}`;
      const current = groups.get(key) ?? {
        entity,
        entityId: asset.entityId,
        assets: [],
      };
      current.assets.push(asset);
      groups.set(key, current);
    }

    return Array.from(groups.values()).sort((a, b) =>
      (a.entity?.name ?? "Không rõ quán").localeCompare(b.entity?.name ?? "Không rõ quán", "vi"),
    );
  }, [assets, entityMap]);
  const sheetCount = useMemo(
    () => new Set(entities.map((entity) => entity.sheetName).filter(Boolean)).size,
    [entities],
  );
  const assetEntityIds = useMemo(() => getAssetEntityIds(assets), [assets]);
  const assetsByEntityId = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of assets) {
      const group = map.get(asset.entityId) ?? [];
      group.push(asset);
      map.set(asset.entityId, group);
    }
    return map;
  }, [assets]);
  const missingImageCount = useMemo(
    () => entities.filter((entity) => !entityHasImageSource(entity, assetEntityIds)).length,
    [assetEntityIds, entities],
  );
  const imageReferenceEntityCount = useMemo(
    () => entities.filter((entity) => getEntityImageReferences(entity).length > 0).length,
    [entities],
  );
  const driveDownloadCandidateCount = useMemo(
    () =>
      entities.filter(
        (entity) =>
          !assetEntityIds.has(entity.entityId) &&
          getEntityImageReferencesWithAssets(
            entity,
            assetsByEntityId.get(entity.entityId) ?? [],
          ).length > 0,
      ).length,
    [assetEntityIds, assetsByEntityId, entities],
  );
  const driveIssueCounts = useMemo(() => buildDriveIssueCounts(driveLinkIssues), [driveLinkIssues]);
  const filteredDriveLinkIssues = useMemo(
    () =>
      driveIssueFilter === "all"
        ? driveLinkIssues
        : driveLinkIssues.filter((issue) => issue.type === driveIssueFilter),
    [driveIssueFilter, driveLinkIssues],
  );
  const mappingChecks = useMemo(() => {
    if (!parsed) return [];

    if (parsed.workbookSheets?.length) {
      return parsed.workbookSheets.map((sheet) => ({
        sheetName: sheet.name,
        included: includedSheets[sheet.name] ?? true,
        ...validateMapping(
          sheet.headers,
          sheet.rows,
          mappingsBySheet[sheet.name] ?? autoMapImportSource(sheet.headers, sheet.rows),
        ),
      }));
    }

    return [
      {
        sheetName: sheetName.trim() || parsed.sourceSheetName || "default",
        included: true,
        ...validateMapping(parsed.headers, parsed.rows, mapping),
      },
    ];
  }, [includedSheets, mapping, mappingsBySheet, parsed, sheetName]);
  const activeMappingCheck =
    mappingChecks.find((check) => check.sheetName === parsed?.sourceSheetName) ?? mappingChecks[0];
  const includedMappingChecks = mappingChecks.filter((check) => check.included);
  const includedSheetCount = parsed?.workbookSheets?.length
    ? parsed.workbookSheets.filter((sheet) => includedSheets[sheet.name] ?? true).length
    : 1;
  const activeSheetIncluded = parsed?.sourceSheetName
    ? (includedSheets[parsed.sourceSheetName] ?? true)
    : true;
  const blockingMappingIssues = includedMappingChecks.flatMap((check) =>
    check.blockingIssues.map((issue) =>
      mappingChecks.length > 1 ? `${check.sheetName}: ${issue}` : issue,
    ),
  );

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  const activateWorkbookSheet = (
    workbook: ParsedWorkbookSheet[],
    nextMappings: Record<string, FieldMapping>,
    sheetToOpen: string,
  ) => {
    const nextSheet = workbook.find((sheet) => sheet.name === sheetToOpen) ?? workbook[0];
    if (!nextSheet) return;

    setParsed({
      headers: nextSheet.headers,
      rows: nextSheet.rows,
      sourceSheetName: nextSheet.name,
      workbookSheets: workbook,
    });
    setMapping(nextMappings[nextSheet.name] ?? autoMapImportSource(nextSheet.headers, nextSheet.rows));
  };

  const resetDriveLinkCheck = () => {
    setDriveCheckBusy(false);
    setDriveCheckDone(0);
    setDriveCheckTotal(0);
    setDriveLinkIssues([]);
    setDriveIssueFilter("private");
  };

  const openAssetUpload = (entityId: string) => {
    assetUploadTargetRef.current = entityId;
    assetUploadInputRef.current?.click();
  };

  const addAssetFilesToEntity = async (event: ChangeEvent<HTMLInputElement>) => {
    const entityId = assetUploadTargetRef.current;
    const files = Array.from(event.currentTarget.files ?? []).filter(isImageFile);
    event.currentTarget.value = "";
    assetUploadTargetRef.current = null;

    if (!entityId || files.length === 0) return;

    setAssetActionBusy(true);
    try {
      const existing = await db.assets.where("entityId").equals(entityId).toArray();
      let hasCover = existing.some((asset) => asset.isCover || asset.role === "cover");
      const newAssets: Asset[] = [];

      for (const file of files) {
        const blobKey = await saveBlob(file);
        const isCover = !hasCover;
        if (isCover) hasCover = true;
        newAssets.push({
          assetId: nanoid(),
          entityId,
          sourceType: "local",
          sourceValue: makeIdbSrc(blobKey),
          blobKey,
          role: isCover ? "cover" : "generic",
          isCover,
          qualityScore: 80,
          status: "ok",
        });
      }

      await db.assets.bulkPut(newAssets);
      const entityName = entityMap.get(entityId)?.name ?? "quán";
      toast.success(`Đã thêm ${newAssets.length} ảnh vào ${entityName}`);
    } catch (error) {
      toast.error("Lỗi thêm ảnh: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setAssetActionBusy(false);
    }
  };

  const deleteSelectedAsset = async () => {
    if (!assetDeleteTarget) return;
    setAssetActionBusy(true);
    try {
      await removeAssetAndUnusedBlob(assetDeleteTarget);
      toast.success("Đã xoá ảnh khỏi quán.");
      setAssetDeleteTarget(null);
    } catch (error) {
      toast.error("Lỗi xoá ảnh: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setAssetActionBusy(false);
    }
  };

  const checkDriveLinksFromSheet = async (
    nextParsed: ParsedTable,
    nextMappings: Record<string, FieldMapping>,
  ) => {
    const sources = nextParsed.workbookSheets?.length
      ? nextParsed.workbookSheets
      : [
          {
            name: sheetName.trim() || nextParsed.sourceSheetName || "default",
            headers: nextParsed.headers,
            rows: nextParsed.rows,
          },
        ];
    const settings = await getSettings();
    const rootFolderUrl = settings.driveRootFolderUrl?.trim();
    const candidates = collectDriveLinkCandidates(sources, nextMappings, rootFolderUrl);

    setDriveCheckDone(0);
    setDriveCheckTotal(candidates.length);
    setDriveLinkIssues([]);
    if (candidates.length === 0) {
      toast.info("Không có link Drive trong sheet để kiểm tra quyền.");
      return;
    }

    setDriveCheckBusy(true);
    const toastId = "sheet-drive-link-check";
    toast.loading(`Đang kiểm tra quyền ${candidates.length} link Drive...`, {
      id: toastId,
      duration: Infinity,
    });

    const issues: DriveLinkIssue[] = [];

    try {
      const { checkDriveReferenceServer } = await import("@/server/driveFetch");
      const resultCache = new Map<
        string,
        ReturnType<typeof checkDriveReferenceServer>
      >();
      let nextIndex = 0;
      let completed = 0;

      const checkCandidate = async (candidate: DriveLinkCandidate) => {
        const cacheKey = `${candidate.sheetName}\u0000${candidate.reference}`;
        let resultPromise = resultCache.get(cacheKey);
        if (!resultPromise) {
          resultPromise = checkDriveReferenceServer({
            data: {
              reference: candidate.reference,
              rootFolderUrl: rootFolderUrl || undefined,
              searchContext: candidate.sheetName,
              maxFiles: 1,
            },
          });
          resultCache.set(cacheKey, resultPromise);
        }

        const result = await resultPromise;
        if (!result.ok) {
          const errorCode = "errorCode" in result ? result.errorCode : undefined;
          issues.push({
            ...candidate,
            error: result.error,
            type: classifyDriveIssue(result.error, errorCode),
          });
        }

        completed += 1;
        setDriveCheckDone(completed);
        await new Promise((resolve) => setTimeout(resolve, 0));
      };

      const concurrency = Math.min(8, candidates.length);
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (nextIndex < candidates.length) {
            const candidate = candidates[nextIndex];
            nextIndex += 1;
            await checkCandidate(candidate);
          }
        }),
      );

      setDriveLinkIssues(issues);
      setDriveIssueFilter(issues.some((issue) => issue.type === "private") ? "private" : "all");

      const privateCount = issues.filter((issue) => issue.type === "private").length;
      if (issues.length === 0) {
        toast.success(`Đã kiểm tra ${candidates.length} link Drive, không thấy link private.`, {
          id: toastId,
          duration: 6000,
        });
      } else {
        toast.warning(
          `Đã kiểm tra ${candidates.length} link Drive: ${issues.length} lỗi${
            privateCount ? `, ${privateCount} bị private` : ""
          }.`,
          { id: toastId, duration: 8000 },
        );
      }
    } catch (error) {
      toast.error("Lỗi kiểm tra quyền Drive: " + (error instanceof Error ? error.message : String(error)), {
        id: toastId,
        duration: 8000,
      });
    } finally {
      setDriveCheckBusy(false);
    }
  };

  const checkCurrentDriveLinks = async () => {
    if (!parsed) return;

    const singleSheetName = parsed.sourceSheetName ?? sheetName.trim();
    const currentMappings = parsed.workbookSheets?.length
      ? {
          ...mappingsBySheet,
          ...(parsed.sourceSheetName ? { [parsed.sourceSheetName]: mapping } : {}),
        }
      : {
          [singleSheetName || "default"]: mapping,
        };

    await checkDriveLinksFromSheet(parsed, currentMappings);
  };

  const onFile = async (file: File) => {
    try {
      setBusy(true);
      resetDriveLinkCheck();
      const nextParsed = await parseDataFile(file);

      if (nextParsed.workbookSheets?.length) {
        const nextMappings = autoMapWorkbook(nextParsed.workbookSheets, mappingsBySheet);
        setMappingsBySheet(nextMappings);
        setIncludedSheets(defaultIncludedSheets(nextParsed.workbookSheets, nextMappings));
        activateWorkbookSheet(
          nextParsed.workbookSheets,
          nextMappings,
          nextParsed.sourceSheetName ?? nextParsed.workbookSheets[0].name,
        );

        if (nextParsed.workbookSheets.length === 1) {
          if (!sheetName) setSheetName(stripImportExtension(file.name));
          toast.success(`Đã đọc ${nextParsed.rows.length} dòng từ "${nextParsed.sourceSheetName}"`);
        } else {
          setSheetName("");
          toast.success(
            `Đã đọc ${nextParsed.workbookSheets.length} sheet Excel. Đang xem "${nextParsed.sourceSheetName}"`,
          );
        }

        return;
      }

      setParsed(nextParsed);
      setMappingsBySheet({});
      setIncludedSheets({});
      setMapping(autoMapImportSource(nextParsed.headers, nextParsed.rows, mapping));
      if (!sheetName) setSheetName(stripImportExtension(file.name));
      toast.success(`Đã đọc ${nextParsed.rows.length} dòng`);
    } catch (error) {
      toast.error("Lỗi parse file: " + (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSheet = async () => {
    try {
      setBusy(true);
      resetDriveLinkCheck();
      const nextParsed = await fetchSheetWorkbook(sheetUrl);

      if (nextParsed.workbookSheets?.length) {
        const nextMappings = autoMapWorkbook(nextParsed.workbookSheets, mappingsBySheet);
        setMappingsBySheet(nextMappings);
        setIncludedSheets(defaultIncludedSheets(nextParsed.workbookSheets, nextMappings));
        activateWorkbookSheet(
          nextParsed.workbookSheets,
          nextMappings,
          nextParsed.sourceSheetName ?? nextParsed.workbookSheets[0].name,
        );

        if (nextParsed.workbookSheets.length === 1) {
          if (!sheetName) {
            setSheetName(nextParsed.sourceSheetName ?? guessSheetName(sheetUrl) ?? "Quan_an");
          }
          toast.success(`Đã tải ${nextParsed.rows.length} dòng từ Google Sheets`);
        } else {
          setSheetName("");
          toast.success(
            `Đã tải ${nextParsed.workbookSheets.length} sheet từ Google Sheets. Đang xem "${nextParsed.sourceSheetName}"`,
          );
        }

        return;
      }

      const nextMapping = autoMapImportSource(nextParsed.headers, nextParsed.rows, mapping);
      setParsed(nextParsed);
      setMappingsBySheet({});
      setIncludedSheets({});
      setMapping(nextMapping);
      if (!sheetName) setSheetName(guessSheetName(sheetUrl) || "Quan_an");
      toast.success(`Đã tải ${nextParsed.rows.length} dòng từ Google Sheets`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateMapping = (header: string, value: string) => {
    setMapping((prev) => {
      const next = { ...prev, [header]: value };
      if (parsed?.sourceSheetName && parsed.workbookSheets?.length) {
        setMappingsBySheet((prevMappings) => ({
          ...prevMappings,
          [parsed.sourceSheetName!]: next,
        }));
        if (value === "name") {
          setIncludedSheets((prevIncluded) => ({
            ...prevIncluded,
            [parsed.sourceSheetName!]: true,
          }));
        }
      }
      return next;
    });
  };

  const toggleCurrentSheetIncluded = () => {
    if (!parsed?.sourceSheetName) return;
    const sheet = parsed.sourceSheetName;
    setIncludedSheets((prev) => ({
      ...prev,
      [sheet]: !(prev[sheet] ?? true),
    }));
  };

  const importNow = async () => {
    if (!parsed) return;
    if (blockingMappingIssues.length) {
      toast.error(blockingMappingIssues[0]);
      return;
    }

    const importSources = parsed.workbookSheets?.length
      ? parsed.workbookSheets.filter((sheet) => includedSheets[sheet.name] ?? true)
      : [
          {
            name: sheetName.trim() || parsed.sourceSheetName || "default",
            headers: parsed.headers,
            rows: parsed.rows,
          },
        ];
    if (importSources.length === 0) {
      toast.error("Chưa chọn sheet nào để import.");
      return;
    }

    const plans = importSources.map((source) => {
      const finalSheet =
        parsed.workbookSheets?.length && parsed.workbookSheets.length > 1
          ? source.name.trim() || "default"
          : sheetName.trim() || source.name.trim() || "default";
      const sourceMapping =
        parsed.workbookSheets?.length && parsed.workbookSheets.length > 0
          ? (mappingsBySheet[source.name] ?? autoMapImportSource(source.headers, source.rows))
          : mapping;
      const normalized = normalizeRows(source.rows, sourceMapping, finalSheet);
      return {
        finalSheet,
        ...normalized,
      };
    });

    await db.transaction("rw", [db.entities, db.assets], async () => {
      for (const plan of plans) {
        const existing = await db.entities.where("sheetName").equals(plan.finalSheet).toArray();
        const newKeys = new Set(plan.entities.map((entity) => entity.name.toLowerCase()));
        const toDelete = existing
          .filter((entity) => newKeys.has(entity.name.toLowerCase()))
          .map((entity) => entity.entityId);

        if (toDelete.length) {
          await db.entities.bulkDelete(toDelete);
          await db.assets.where("entityId").anyOf(toDelete).delete();
        }

        await db.entities.bulkPut(plan.entities);
        await db.assets.bulkPut(plan.assets);
      }
    });

    const totalEntities = plans.reduce((sum, plan) => sum + plan.entities.length, 0);
    const totalWarnings = plans.reduce((sum, plan) => sum + plan.warnings.length, 0);
    const totalAssets = plans.reduce((sum, plan) => sum + plan.assets.length, 0);
    const totalImageReferenceEntities = plans.reduce(
      (sum, plan) =>
        sum + plan.entities.filter((entity) => getEntityImageReferences(entity).length > 0).length,
      0,
    );
    const imageHint =
      totalAssets > 0
        ? ` Đã tạo ${totalAssets} asset ảnh.`
        : totalImageReferenceEntities > 0
          ? ` Có ${totalImageReferenceEntities} quán có link ảnh; mở tab Ghép ảnh để tải Drive.`
          : "";
    setLastActiveSheet(parsed.sourceSheetName ?? plans[0]?.finalSheet);

    if (plans.length > 1) {
      toast.success(
        `Đã import ${totalEntities} entity từ ${plans.length} sheet Excel. ${totalWarnings} cảnh báo.${imageHint}`,
      );
    } else {
      toast.success(
        `Đã import ${totalEntities} entity vào sheet "${plans[0].finalSheet}". ${totalWarnings} cảnh báo.${imageHint}`,
      );
    }

    setParsed(null);
    setMappingsBySheet({});
    setIncludedSheets({});
    if (totalImageReferenceEntities > 0) {
      setActiveTab("images");
      toast.info("Đã chuyển sang Ghép ảnh. Bấm Tải ảnh từ Drive để tải ảnh về local.", {
        duration: 7000,
      });
    } else if (totalAssets > 0) {
      setActiveTab("assets");
    } else {
      setActiveTab("entities");
    }
  };

  return (
    <PageContainer className="max-w-[1500px]">
      <PageHeader
        icon={<Database />}
        title="Dữ liệu"
        description="Import, ghép ảnh và kiểm tra dữ liệu local dùng cho generate."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DataStat label="Quán/entity" value={entities.length} icon={<Store />} />
        <DataStat label="Nguồn ảnh trong sheet" value={imageReferenceEntityCount} icon={<LinkIcon />} />
        <DataStat label="Asset ảnh đã tải" value={assets.length} icon={<ImageIcon />} />
        <DataStat label="Sheet dữ liệu" value={sheetCount || 0} icon={<FileSpreadsheet />} />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(normalizeDataTab(value))}
        className="flex flex-col gap-4"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="images">Ghép ảnh ({driveDownloadCandidateCount})</TabsTrigger>
          <TabsTrigger value="entities">Quán ({entities.length})</TabsTrigger>
          <TabsTrigger value="assets">Ảnh ({assets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="mt-0 flex flex-col gap-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Nguồn import</CardTitle>
                <CardDescription>CSV, JSON, Excel hoặc Google Sheets public.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Tên sheet</Label>
                  <Input
                    value={isMultiSheetWorkbook ? "Theo từng tab Excel" : sheetName}
                    onChange={(event) => setSheetName(event.target.value)}
                    placeholder="Quan_an"
                    disabled={isMultiSheetWorkbook}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative inline-flex">
                    <Button type="button" disabled={busy}>
                      <Upload /> Upload file
                    </Button>
                    <input
                      type="file"
                      accept=".csv,.json,.xlsx"
                      aria-label="Upload file dữ liệu"
                      disabled={busy}
                      className="absolute inset-0 cursor-pointer opacity-0 disabled:pointer-events-none"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void onFile(file);
                      }}
                    />
                  </div>
                  <Badge variant="secondary">CSV / JSON / XLSX</Badge>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Google Sheets</Label>
                  <div className="flex gap-2">
                    <Input
                      value={sheetUrl}
                      onChange={(event) => setSheetUrl(event.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                    />
                    <Button onClick={onSheet} disabled={!sheetUrl || busy} variant="outline">
                      <LinkIcon /> Tải
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Preview import</CardTitle>
                <CardDescription>
                  {parsed
                    ? `${parsed.rows.length} dòng, ${parsed.headers.length} cột`
                    : "Chưa có file nào được đọc."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {parsed ? (
                  <>
                    {isMultiSheetWorkbook && (
                      <div className="flex flex-wrap gap-2">
                        {workbookSheets.map((sheet) => {
                          const active = sheet.name === parsed.sourceSheetName;
                          const included = includedSheets[sheet.name] ?? true;
                          const check = mappingChecks.find((item) => item.sheetName === sheet.name);
                          return (
                            <Button
                              key={sheet.name}
                              type="button"
                              size="sm"
                              variant={active ? "default" : included ? "outline" : "secondary"}
                              className={!included ? "opacity-70" : undefined}
                              onClick={() =>
                                activateWorkbookSheet(workbookSheets, mappingsBySheet, sheet.name)
                              }
                            >
                              {sheet.name} ({sheet.rows.length})
                              {!included ? " - bỏ qua" : check?.level === "error" ? " - cần map" : ""}
                            </Button>
                          );
                        })}
                      </div>
                    )}

                    {parsed.sourceSheetName && (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        Sheet đang xem:
                        <Badge variant="outline">{parsed.sourceSheetName}</Badge>
                        {isMultiSheetWorkbook && (
                          <>
                            <Badge variant={activeSheetIncluded ? "secondary" : "outline"}>
                              {activeSheetIncluded ? "Sẽ import" : "Đang bỏ qua"}
                            </Badge>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={toggleCurrentSheetIncluded}
                            >
                              {activeSheetIncluded ? "Bỏ qua sheet này" : "Import sheet này"}
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/20 p-3 text-xs">
                      {JSON.stringify(parsed.rows.slice(0, 5), null, 2)}
                    </pre>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
                      <div>
                        <div className="font-medium">Kiểm tra link Drive</div>
                        <div className="text-xs text-muted-foreground">
                          Tùy chọn. Dùng khi cần lọc link private hoặc link ảnh lỗi trước khi import.
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={driveCheckBusy}
                        onClick={checkCurrentDriveLinks}
                      >
                        <LinkIcon />
                        {driveCheckBusy ? "Đang kiểm tra" : "Kiểm tra link"}
                      </Button>
                    </div>

                    {(driveCheckBusy || driveCheckTotal > 0 || driveLinkIssues.length > 0) && (
                      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">Kiểm tra quyền ảnh Drive</div>
                            <div className="text-xs text-muted-foreground">
                              {driveCheckBusy
                                ? `Đang kiểm tra ${driveCheckDone}/${driveCheckTotal} link`
                                : driveLinkIssues.length
                                  ? `${driveLinkIssues.length}/${driveCheckTotal} link có lỗi`
                                  : driveCheckTotal > 0
                                    ? `Đã kiểm tra ${driveCheckTotal} link, không thấy link private`
                                    : "Chưa có link Drive để kiểm tra"}
                            </div>
                          </div>
                          {driveLinkIssues.length > 0 && (
                            <Badge variant={driveIssueCounts.private ? "destructive" : "outline"}>
                              {driveIssueCounts.private} private
                            </Badge>
                          )}
                        </div>

                        {driveCheckBusy && driveCheckTotal > 0 && (
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${Math.round((driveCheckDone / driveCheckTotal) * 100)}%`,
                              }}
                            />
                          </div>
                        )}

                        {driveLinkIssues.length > 0 && (
                          <div className="mt-3 flex flex-col gap-3">
                            <div className="flex flex-wrap gap-2">
                              {DRIVE_LINK_ISSUE_FILTERS.map((filter) => {
                                const count = driveIssueCounts[filter];
                                if (count === 0 && filter !== "all") return null;
                                return (
                                  <Button
                                    key={filter}
                                    type="button"
                                    size="sm"
                                    variant={driveIssueFilter === filter ? "default" : "outline"}
                                    onClick={() => setDriveIssueFilter(filter)}
                                  >
                                    {labelDriveIssueFilter(filter)} ({count})
                                  </Button>
                                );
                              })}
                            </div>

                            <div className="grid max-h-60 gap-2 overflow-y-auto md:grid-cols-2">
                              {filteredDriveLinkIssues.map((issue) => (
                                <div
                                  key={`${issue.sheetName}:${issue.rowNumber}:${issue.reference}`}
                                  className="min-w-0 rounded-md border bg-background p-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`size-2 shrink-0 rounded-full ${
                                        issue.type === "private" ? "bg-destructive" : "bg-amber-500"
                                      }`}
                                    />
                                    <div className="min-w-0 truncate font-medium">
                                      {issue.entityName}
                                    </div>
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {issue.sheetName}, dòng {issue.rowNumber}
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {issue.reference}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {issue.error}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <Button
                      onClick={importNow}
                      disabled={blockingMappingIssues.length > 0 || includedSheetCount === 0}
                    >
                      {isMultiSheetWorkbook
                        ? `Import ${includedSheetCount}/${workbookSheets.length} sheet`
                        : "Import vào project"}
                    </Button>
                    {blockingMappingIssues.length > 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        <XCircle className="mt-0.5 size-4 shrink-0" />
                        <span>{blockingMappingIssues[0]}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="grid min-h-72 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                    Chọn một nguồn dữ liệu để xem preview và mapping.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {parsed && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Mapping cột</CardTitle>
                    <CardDescription>
                      Ứng dụng tự kiểm tra header và dữ liệu mẫu trước khi import.
                    </CardDescription>
                  </div>
                  {activeMappingCheck && (
                    <Badge
                      variant="outline"
                      className={`gap-1.5 ${mappingStatusClass(activeMappingCheck.level)}`}
                    >
                      {activeMappingCheck.level === "ok" ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : activeMappingCheck.level === "warn" ? (
                        <AlertTriangle className="size-3.5" />
                      ) : (
                        <XCircle className="size-3.5" />
                      )}
                      {activeMappingCheck.label}
                    </Badge>
                  )}
                </div>
                {activeMappingCheck && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 text-sm ${mappingStatusClass(activeMappingCheck.level)}`}
                  >
                    <div className="font-medium">{activeMappingCheck.summary}</div>
                    {activeMappingCheck.issues.length > 0 && (
                      <div className="mt-1 space-y-1 text-xs opacity-90">
                        {activeMappingCheck.issues.slice(0, 3).map((issue) => (
                          <div key={issue}>• {issue}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid max-h-[420px] gap-2 overflow-y-auto md:grid-cols-2">
                  {parsed.headers.map((header) => {
                    const currentValue = mapping[header] ?? "__ignore__";
                    const rowCheck = activeMappingCheck?.rows[header];

                    return (
                      <div
                        key={header}
                        className={`rounded-lg border p-2 ${mappingRowClass(rowCheck?.level)}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm">{header}</span>
                          <Select
                            value={currentValue}
                            onValueChange={(value) => updateMapping(header, value)}
                          >
                            <SelectTrigger className="h-8 w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {optionsForMappingValue(currentValue).map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  title={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {rowCheck && (
                          <div
                            className={`mt-1 flex items-start gap-1.5 text-xs ${
                              rowCheck.level === "error"
                                ? "text-destructive"
                                : rowCheck.level === "warn"
                                  ? "text-amber-700"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {rowCheck.level === "ok" ? (
                              <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                            ) : rowCheck.level === "warn" ? (
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                            ) : (
                              <XCircle className="mt-0.5 size-3 shrink-0" />
                            )}
                            <span>{rowCheck.message}</span>
                            {rowCheck.suggestion && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="ml-auto h-5 shrink-0 px-1.5 text-xs"
                                onClick={() => updateMapping(header, rowCheck.suggestion!)}
                              >
                                Sửa
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="images" className="mt-0">
          <BulkImageUpload />
        </TabsContent>

        <TabsContent value="entities" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Quán/entity đã import</CardTitle>
              <CardDescription>{entities.length} dòng dữ liệu local.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {entities.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Chưa có dữ liệu import.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tên</TableHead>
                      <TableHead>Sheet</TableHead>
                      <TableHead>Mô hình</TableHead>
                      <TableHead>Phong cách</TableHead>
                      <TableHead>Địa chỉ</TableHead>
                      <TableHead>Đối tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((entity) => (
                      <TableRow key={entity.entityId}>
                        <TableCell className="font-medium">{entity.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{entity.sheetName ?? "Chưa phân sheet"}</Badge>
                        </TableCell>
                        <TableCell>{entity.categoryMain}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {entity.categorySub}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {entity.address}
                        </TableCell>
                        <TableCell>
                          {entity.partnerFlag ? <Badge>Đối tác</Badge> : <span />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets" className="mt-0">
          <div className="flex flex-col gap-4">
            <input
              ref={assetUploadInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => void addAssetFilesToEntity(event)}
            />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Quản lý ảnh theo quán</CardTitle>
                <CardDescription>
                  Chọn quán rồi thêm ảnh thủ công, hoặc xoá từng ảnh đang gắn với quán.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row">
                <Select value={assetUploadEntityId} onValueChange={setAssetUploadEntityId}>
                  <SelectTrigger className="sm:max-w-sm">
                    <SelectValue placeholder="Chọn quán để thêm ảnh" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((entity) => (
                      <SelectItem key={entity.entityId} value={entity.entityId}>
                        {entity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={() => openAssetUpload(assetUploadEntityId)}
                  disabled={!assetUploadEntityId || assetActionBusy}
                >
                  {assetActionBusy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus />}
                  Thêm ảnh vào quán
                </Button>
              </CardContent>
            </Card>

            {assets.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  Chưa có ảnh import.
                </CardContent>
              </Card>
            ) : (
              assetGroups.map((group) => (
                <Card key={group.entity?.entityId ?? group.entityId} className="overflow-hidden">
                  <CardHeader className="border-b p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">
                          {group.entity?.name ?? "Không rõ quán"}
                        </CardTitle>
                        {group.entity?.address ? (
                          <CardDescription className="mt-1 truncate">
                            {group.entity.address}
                          </CardDescription>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{group.assets.length} ảnh</Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openAssetUpload(group.entityId)}
                          disabled={assetActionBusy}
                        >
                          <ImagePlus className="size-4" />
                          Thêm ảnh
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                      {group.assets.map((asset, index) => (
                        <AssetCard
                          key={asset.assetId}
                          asset={asset}
                          entity={group.entity}
                          index={index}
                          onDelete={setAssetDeleteTarget}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <AlertDialog
            open={Boolean(assetDeleteTarget)}
            onOpenChange={(open) => {
              if (!open && !assetActionBusy) setAssetDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Xoá ảnh khỏi quán?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ảnh sẽ bị xoá khỏi danh sách asset. Nếu blob local này không còn ảnh nào khác dùng,
                  app cũng xoá blob trong IndexedDB để nhẹ trình duyệt hơn.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={assetActionBusy}>Huỷ</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => void deleteSelectedAsset()}
                  disabled={assetActionBusy}
                >
                  {assetActionBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Xoá ảnh
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
