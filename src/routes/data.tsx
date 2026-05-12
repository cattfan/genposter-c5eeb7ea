import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
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
import { EmptyState } from "@/components/ux";
import { BulkImageUpload } from "@/features/data/BulkImageUpload";
import {
  cleanImageReferenceValue,
  entityHasUsableImageAsset,
  getAssetEntityIds,
  getEntityImageReferences,
  getEntityImageReferencesWithAssets,
  getImageReferenceEntityIds,
  isUsableImageAsset,
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
import { resizeImageBlob } from "@/storage/imageResize";
import { setLastActiveSheet } from "@/storage/lastSheet";
import { getSettings } from "@/storage/settings";
import { cn } from "@/lib/utils";

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

interface ImportReviewRename {
  sheetName: string;
  oldName: string;
  newName: string;
}

interface ImportReviewSummary {
  newCount: number;
  updateCount: number;
  possibleRenameCount: number;
  staleCount: number;
  renames: ImportReviewRename[];
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
  return STANDARD_FIELD_LABELS.get(field) ?? `Dữ liệu thêm: ${field}`;
}

function optionsForMappingValue(value: string) {
  if (value && value !== "__ignore__" && !isKnownStandardField(value)) {
    return [{ value, label: `Dữ liệu thêm: ${value}` }, ...STANDARD_FIELD_OPTIONS_LABELED];
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

function normalizeEntityImportKey(value: string) {
  return value.trim().normalize("NFC").toLocaleLowerCase("vi");
}

function normalizeLooseEntityName(value: string) {
  return normalizeForCheck(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function entityNameSimilarity(a: string, b: string) {
  const left = normalizeLooseEntityName(a);
  const right = normalizeLooseEntityName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  const leftWords = new Set(left.split(" ").filter((word) => word.length >= 2));
  const rightWords = new Set(right.split(" ").filter((word) => word.length >= 2));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  return overlap / Math.max(leftWords.size, rightWords.size);
}

function classifyImageReferences(references: string[]) {
  let localFolderCount = 0;
  let driveCount = 0;
  let directUrlCount = 0;

  for (const reference of references) {
    const clean = cleanImageReferenceValue(reference);
    if (!clean) continue;
    if (looksLikeDriveReference(clean)) {
      driveCount += 1;
    } else if (looksLikeDirectImageReference(clean)) {
      directUrlCount += 1;
    } else {
      localFolderCount += 1;
    }
  }

  return {
    localFolderCount,
    driveCount,
    directUrlCount,
    total: localFolderCount + driveCount + directUrlCount,
  };
}

function readableImageStatusFromReferences(references: string[]) {
  const counts = classifyImageReferences(references);
  if (counts.driveCount > 0) return "Có link Drive";
  if (counts.localFolderCount > 0) return "Có tên folder";
  if (counts.directUrlCount > 0) return "Có URL ảnh";
  return "Chưa có ảnh";
}

function buildImportReviewSummary(
  plans: Array<{ finalSheet: string; entities: Entity[] }>,
  existingEntities: Entity[],
): ImportReviewSummary {
  let newCount = 0;
  let updateCount = 0;
  let possibleRenameCount = 0;
  let staleCount = 0;
  const renames: ImportReviewRename[] = [];
  const existingBySheet = new Map<string, Entity[]>();

  for (const entity of existingEntities) {
    const sheet = entity.sheetName || "default";
    const group = existingBySheet.get(sheet) ?? [];
    group.push(entity);
    existingBySheet.set(sheet, group);
  }

  for (const plan of plans) {
    const existing = existingBySheet.get(plan.finalSheet) ?? [];
    const existingByName = new Map(
      existing.map((entity) => [normalizeEntityImportKey(entity.name), entity]),
    );
    const incomingKeys = new Set(plan.entities.map((entity) => normalizeEntityImportKey(entity.name)));

    for (const entity of plan.entities) {
      if (existingByName.has(normalizeEntityImportKey(entity.name))) {
        updateCount += 1;
        continue;
      }

      newCount += 1;
      const possibleOld = existing
        .filter((oldEntity) => !incomingKeys.has(normalizeEntityImportKey(oldEntity.name)))
        .map((oldEntity) => ({
          entity: oldEntity,
          score: entityNameSimilarity(oldEntity.name, entity.name),
        }))
        .filter((item) => item.score >= 0.62)
        .sort((a, b) => b.score - a.score)[0];

      if (possibleOld) {
        possibleRenameCount += 1;
        if (renames.length < 5) {
          renames.push({
            sheetName: plan.finalSheet,
            oldName: possibleOld.entity.name,
            newName: entity.name,
          });
        }
      }
    }

    staleCount += existing.filter((entity) => !incomingKeys.has(normalizeEntityImportKey(entity.name))).length;
  }

  return { newCount, updateCount, possibleRenameCount, staleCount, renames };
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

function countFolderOnlyImageReferences(
  sources: ParsedWorkbookSheet[],
  mappings: Record<string, FieldMapping>,
) {
  let count = 0;
  for (const source of sources) {
    const sourceMapping = mappings[source.name] ?? autoMapImportSource(source.headers, source.rows);
    const normalized = normalizeRows(source.rows, sourceMapping, source.name);
    for (const entity of normalized.entities) {
      for (const reference of getEntityImageReferences(entity)) {
        const clean = cleanImageReferenceValue(reference);
        if (!clean) continue;
        if (!looksLikeDriveReference(clean) && !looksLikeDirectImageReference(clean)) count += 1;
      }
    }
  }
  return count;
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
    level === "error" ? "Cần sửa cột" : level === "warn" ? "Cần kiểm tra" : "Cột ổn";
  const summary =
    level === "error"
      ? blocking[0]
      : level === "warn"
        ? `${warnings.length} điểm cần kiểm tra trước khi nhập.`
        : "Các cột chính đang khớp với dữ liệu mẫu.";

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

function summarizeNormalizeWarnings(warnings: string[]) {
  const missingNameRows = warnings
    .map((warning) => warning.match(/Dòng\s+(\d+):\s*thiếu tên/i)?.[1])
    .filter((row): row is string => Boolean(row));
  const missingImageRows = warnings
    .map((warning) => warning.match(/Dòng\s+(\d+)\s+\((.+?)\):\s*không có ảnh/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .slice(0, 3)
    .map((match) => `${match[1]} (${match[2]})`);

  const messages: string[] = [];
  if (missingNameRows.length) {
    const shownRows = missingNameRows.slice(0, 5).join(", ");
    const moreCount = missingNameRows.length - 5;
    messages.push(
      `Không nhập ${missingNameRows.length} dòng vì thiếu cột Tên: dòng ${shownRows}${
        moreCount > 0 ? ` và ${moreCount} dòng khác` : ""
      }.`,
    );
  }
  if (missingImageRows.length) {
    messages.push(`Thiếu link/tên folder ảnh ở dòng ${missingImageRows.join(", ")}.`);
  }
  return messages;
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

function ImportReviewCards({ summary }: { summary: ImportReviewSummary }) {
  const hasRisk = summary.possibleRenameCount > 0 || summary.staleCount > 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        hasRisk ? "border-amber-200 bg-amber-50/70" : "bg-muted/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">Xem trước khi nhập</div>
          <div className="text-xs text-muted-foreground">
            Ảnh local đã ghép sẽ được giữ khi tên quán trong cùng tab không đổi.
          </div>
        </div>
        {hasRisk ? (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            Cần xem lại
          </Badge>
        ) : (
          <Badge variant="secondary">An toàn</Badge>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-background p-2">
          <div className="font-semibold">{summary.newCount}</div>
          <div className="text-xs text-muted-foreground">Dòng mới</div>
        </div>
        <div className="rounded-md bg-background p-2">
          <div className="font-semibold">{summary.updateCount}</div>
          <div className="text-xs text-muted-foreground">Cập nhật</div>
        </div>
        <div className="rounded-md bg-background p-2">
          <div className="font-semibold">{summary.possibleRenameCount}</div>
          <div className="text-xs text-muted-foreground">Có thể đổi tên</div>
        </div>
        <div className="rounded-md bg-background p-2">
          <div className="font-semibold">{summary.staleCount}</div>
          <div className="text-xs text-muted-foreground">Dòng cũ không còn trong sheet</div>
        </div>
      </div>

      {summary.renames.length > 0 ? (
        <div className="mt-3 space-y-1 text-xs text-amber-800">
          {summary.renames.map((item) => (
            <div key={`${item.sheetName}:${item.oldName}:${item.newName}`}>
              {item.sheetName}: “{item.oldName}” có thể đã đổi thành “{item.newName}”
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function looksLikeDirectImageSrc(src: string | undefined | null) {
  return Boolean(src && /^(https?:|data:|blob:|\/|\.\/|\.\.\/|idb:\/\/)/i.test(src));
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|jfif|webp|gif|bmp|avif)$/i.test(file.name);
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
    sourceValue ? getBlobKeyFromSrc(sourceValue) : undefined,
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

    for (const asset of assets.filter(isUsableImageAsset)) {
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
  const assetEntityIds = useMemo(() => getAssetEntityIds(assets), [assets]);
  const imageReferenceEntityIds = useMemo(
    () => getImageReferenceEntityIds(entities, assets),
    [assets, entities],
  );
  const entitiesWithoutRenderableImage = useMemo(
    () => entities.filter((entity) => !entityHasUsableImageAsset(entity, assetEntityIds)),
    [assetEntityIds, entities],
  );
  const entitiesWithReferenceOnly = useMemo(
    () =>
      entitiesWithoutRenderableImage.filter((entity) =>
        imageReferenceEntityIds.has(entity.entityId),
      ),
    [entitiesWithoutRenderableImage, imageReferenceEntityIds],
  );
  const assetsByEntityId = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of assets) {
      const group = map.get(asset.entityId) ?? [];
      group.push(asset);
      map.set(asset.entityId, group);
    }
    return map;
  }, [assets]);
  const imageReferenceEntityCount = useMemo(
    () => imageReferenceEntityIds.size,
    [imageReferenceEntityIds],
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
      return parsed.workbookSheets.map((sheet) => {
        const sheetMapping = mappingsBySheet[sheet.name] ?? autoMapImportSource(sheet.headers, sheet.rows);
        return {
          sheetName: sheet.name,
          included: includedSheets[sheet.name] ?? true,
          ...validateMapping(sheet.headers, sheet.rows, sheetMapping),
        };
      });
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
  const sheetImportSummaries = useMemo(() => {
    if (!parsed) return [];
    const sources = parsed.workbookSheets?.length
      ? parsed.workbookSheets
      : [
          {
            name: sheetName.trim() || parsed.sourceSheetName || "default",
            headers: parsed.headers,
            rows: parsed.rows,
          },
        ];

    return sources.map((source) => {
      const sourceMapping =
        parsed.workbookSheets?.length && parsed.workbookSheets.length > 0
          ? (mappingsBySheet[source.name] ?? autoMapImportSource(source.headers, source.rows))
          : mapping;
      const normalized = normalizeRows(source.rows, sourceMapping, source.name);
      const imageReferenceRows = normalized.entities.filter(
        (entity) => getEntityImageReferences(entity).length > 0,
      ).length;
      const directAssetRows = new Set(normalized.assets.map((asset) => asset.entityId)).size;
      let localFolderRows = 0;
      let driveRows = 0;
      let directUrlRows = directAssetRows;
      for (const entity of normalized.entities) {
        const counts = classifyImageReferences(getEntityImageReferences(entity));
        if (counts.localFolderCount > 0) localFolderRows += 1;
        if (counts.driveCount > 0) driveRows += 1;
        if (counts.directUrlCount > 0) directUrlRows += 1;
      }
      return {
        sheetName: source.name,
        rows: source.rows.length,
        importedEntities: normalized.entities.length,
        skippedRows: normalized.warnings.filter((warning) => /thiếu tên/i.test(warning)).length,
        warningMessages: summarizeNormalizeWarnings(normalized.warnings),
        imageReferenceRows,
        localFolderRows,
        driveRows,
        directUrlRows,
        directAssetRows,
        included: parsed.workbookSheets?.length ? (includedSheets[source.name] ?? true) : true,
      };
    });
  }, [includedSheets, mapping, mappingsBySheet, parsed, sheetName]);
  const importPreviewRows = useMemo(() => {
    if (!parsed) return [];

    const sourceMapping =
      parsed.workbookSheets?.length && parsed.workbookSheets.length > 0
        ? (mappingsBySheet[parsed.sourceSheetName ?? ""] ??
          autoMapImportSource(parsed.headers, parsed.rows))
        : mapping;
    const normalized = normalizeRows(parsed.rows.slice(0, 5), sourceMapping, parsed.sourceSheetName);

    return normalized.entities.map((entity) => ({
      entity,
      imageStatus: readableImageStatusFromReferences(getEntityImageReferences(entity)),
    }));
  }, [mapping, mappingsBySheet, parsed]);
  const importPlansPreview = useMemo(() => {
    if (!parsed) return [];
    const sources = parsed.workbookSheets?.length
      ? parsed.workbookSheets.filter((sheet) => includedSheets[sheet.name] ?? true)
      : [
          {
            name: sheetName.trim() || parsed.sourceSheetName || "default",
            headers: parsed.headers,
            rows: parsed.rows,
          },
        ];

    return sources.map((source) => {
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
        entities: normalized.entities,
      };
    });
  }, [includedSheets, mapping, mappingsBySheet, parsed, sheetName]);
  const importReviewSummary = useMemo(
    () => buildImportReviewSummary(importPlansPreview, entities),
    [entities, importPlansPreview],
  );
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
      const newAssets: Asset[] = [];

      for (const file of files) {
        const resized = await resizeImageBlob(file);
        const blobKey = await saveBlob(resized);
        newAssets.push({
          assetId: nanoid(),
          entityId,
          sourceType: "local",
          sourceValue: makeIdbSrc(blobKey),
          blobKey,
          role: "generic",
          isCover: false,
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
    const folderOnlyCount = countFolderOnlyImageReferences(sources, nextMappings);

    setDriveCheckDone(0);
    setDriveCheckTotal(candidates.length);
    setDriveLinkIssues([]);
    if (candidates.length === 0) {
      if (folderOnlyCount > 0 && !rootFolderUrl) {
        toast.info(
          `Có ${folderOnlyCount} tên folder ảnh trong dữ liệu. Bạn có thể chọn thư mục ảnh từ máy; chỉ cần dán thư mục Drive gốc nếu muốn kiểm tra/tải từ Drive.`,
          { duration: 8000 },
        );
        return;
      }
      toast.info("Không có link Drive trong dữ liệu để kiểm tra quyền.");
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
            `Đã đọc ${nextParsed.workbookSheets.length} nguồn dữ liệu. Đang xem "${nextParsed.sourceSheetName}"`,
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
            `Đã tải ${nextParsed.workbookSheets.length} nguồn dữ liệu từ Google Sheets. Đang xem "${nextParsed.sourceSheetName}"`,
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

  const toggleSheetIncluded = (sheet: string) => {
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
      toast.error("Chưa chọn nguồn nào để nhập.");
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
    const reviewSummary = buildImportReviewSummary(plans, entities);

    await db.transaction("rw", [db.entities, db.assets], async () => {
      for (const plan of plans) {
        const existing = await db.entities.where("sheetName").equals(plan.finalSheet).toArray();
        const existingByName = new Map(
          existing.map((entity) => [normalizeEntityImportKey(entity.name), entity]),
        );
        const directAssetsByGeneratedEntity = new Map<string, Asset[]>();
        for (const asset of plan.assets) {
          const group = directAssetsByGeneratedEntity.get(asset.entityId) ?? [];
          group.push(asset);
          directAssetsByGeneratedEntity.set(asset.entityId, group);
        }

        const entitiesToPut: Entity[] = [];
        const assetsToPut: Asset[] = [];
        for (const entity of plan.entities) {
          const existingEntity = existingByName.get(normalizeEntityImportKey(entity.name));
          const entityId = existingEntity?.entityId ?? entity.entityId;
          entitiesToPut.push({ ...entity, entityId });

          const existingAssets = existingEntity
            ? await db.assets.where("entityId").equals(existingEntity.entityId).toArray()
            : [];
          const existingSourceValues = new Set(
            existingAssets.map((asset) => cleanImageReferenceValue(asset.sourceValue)),
          );
          const directAssets = directAssetsByGeneratedEntity.get(entity.entityId) ?? [];
          for (const asset of directAssets) {
            const cleanSource = cleanImageReferenceValue(asset.sourceValue);
            if (existingSourceValues.has(cleanSource)) continue;
            assetsToPut.push({
              ...asset,
              entityId,
              sourceValue: cleanSource || asset.sourceValue,
              role: asset.role === "cover" ? "generic" : asset.role,
              isCover: false,
            });
          }
        }

        await db.entities.bulkPut(entitiesToPut);
        if (assetsToPut.length) await db.assets.bulkPut(assetsToPut);
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
        ? ` Đã nhận ${totalAssets} ảnh URL trực tiếp. Ảnh đã ghép từ máy vẫn được giữ.`
        : totalImageReferenceEntities > 0
          ? ` Có ${totalImageReferenceEntities} quán có tên folder/link ảnh; có thể tải ảnh từ link trong sheet về data/images.`
          : "";
    setLastActiveSheet(parsed.sourceSheetName ?? plans[0]?.finalSheet);

    if (plans.length > 1) {
      toast.success(
        `Đã nhập ${totalEntities} dòng từ ${plans.length} nguồn. ${totalWarnings} cảnh báo.${imageHint}`,
      );
    } else {
      toast.success(
        `Đã nhập ${totalEntities} dòng vào "${plans[0].finalSheet}". ${totalWarnings} cảnh báo.${imageHint}`,
      );
    }

    if (reviewSummary.possibleRenameCount > 0 || reviewSummary.staleCount > 0) {
      toast.warning(
        `Có ${reviewSummary.possibleRenameCount} dòng có thể đã đổi tên và ${reviewSummary.staleCount} dòng cũ không còn trong nguồn mới. App chưa xoá dữ liệu cũ tự động.`,
        { duration: 9000 },
      );
    }

    setParsed(null);
    setMappingsBySheet({});
    setIncludedSheets({});
    if (totalImageReferenceEntities > 0) {
      setActiveTab("images");
      toast.info(
        "Đã chuyển sang Tải ảnh. Hãy tải ảnh từ link trong sheet, hoặc chọn thư mục ảnh từ máy nếu cần dự phòng.",
        {
          duration: 7000,
        },
      );
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
        description="Nhập entity và ảnh từ Google Sheet, CSV, hoặc upload trực tiếp."
      />

      <div className="mb-4 flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DataStat label="Dòng dữ liệu" value={entities.length} icon={<Store />} />
          <DataStat label="Có tên folder/link ảnh" value={imageReferenceEntityCount} icon={<LinkIcon />} />
          <DataStat label="Chờ ghép/tải ảnh" value={entitiesWithReferenceOnly.length} icon={<ImagePlus />} />
          <DataStat label="Ảnh đọc được" value={assets.filter(isUsableImageAsset).length} icon={<ImageIcon />} />
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(normalizeDataTab(value))}
        className="flex flex-col gap-4"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="import">Nhập dữ liệu</TabsTrigger>
          <TabsTrigger value="images">Tải ảnh ({driveDownloadCandidateCount})</TabsTrigger>
          <TabsTrigger value="entities">Dữ liệu ({entities.length})</TabsTrigger>
          <TabsTrigger value="assets">Ảnh ({assets.filter(isUsableImageAsset).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="mt-0 flex flex-col gap-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Bước 1: Chọn nguồn dữ liệu</CardTitle>
                <CardDescription>Dán link Google Sheet hoặc chọn file Excel/CSV từ máy.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative inline-flex">
                    <Button type="button" disabled={busy}>
                      <Upload /> Chọn file dữ liệu
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
                      <LinkIcon /> Đọc dữ liệu
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bước 2: Kiểm tra trước khi nhập</CardTitle>
                <CardDescription>
                  {parsed
                    ? `${parsed.rows.length} dòng, ${parsed.headers.length} cột`
                    : "Chưa có dữ liệu để xem trước."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {parsed ? (
                  <>
                    {isMultiSheetWorkbook && (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                          Bật/tắt từng tab cần nhập. Tab nào chưa nhận diện được cột tên sẽ báo cần
                          sửa cột trước khi nhập.
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {workbookSheets.map((sheet) => {
                            const active = sheet.name === parsed.sourceSheetName;
                            const included = includedSheets[sheet.name] ?? true;
                            const check = mappingChecks.find((item) => item.sheetName === sheet.name);

                            return (
                              <div
                                key={sheet.name}
                                className={cn(
                                  "rounded-lg border bg-muted/20 p-2",
                                  active && "border-primary bg-primary/5",
                                  !included && "opacity-75",
                                )}
                              >
                                <div className="flex items-start gap-2">
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 text-left"
                                    onClick={() =>
                                      activateWorkbookSheet(workbookSheets, mappingsBySheet, sheet.name)
                                    }
                                  >
                                    <div className="truncate text-sm font-medium">{sheet.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {sheet.rows.length} dòng
                                      {check?.level === "error" ? " · cần sửa cột" : ""}
                                    </div>
                                  </button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={included ? "default" : "outline"}
                                    className="size-8 shrink-0 p-0 text-lg leading-none"
                                    aria-label={included ? `Bỏ qua ${sheet.name}` : `Nhập ${sheet.name}`}
                                    onClick={() => toggleSheetIncluded(sheet.name)}
                                  >
                                    {included ? "-" : "+"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {parsed.sourceSheetName && (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        Nguồn đang xem:
                        <Badge variant="outline">{parsed.sourceSheetName}</Badge>
                        {isMultiSheetWorkbook && (
                          <>
                            <Badge variant={activeSheetIncluded ? "secondary" : "outline"}>
                              {activeSheetIncluded ? "Sẽ nhập" : "Đang bỏ qua"}
                            </Badge>
                          </>
                        )}
                      </div>
                    )}

                    {importPreviewRows.length > 0 ? (
                      <div className="overflow-hidden rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Tên</TableHead>
                              <TableHead>Địa chỉ</TableHead>
                              <TableHead>Nhóm</TableHead>
                              <TableHead>Ảnh/folder</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {importPreviewRows.map(({ entity, imageStatus }) => (
                              <TableRow key={`${entity.sourceRowId}:${entity.name}`}>
                                <TableCell className="font-medium">{entity.name}</TableCell>
                                <TableCell className="max-w-[220px] truncate text-muted-foreground">
                                  {entity.address || "Chưa có"}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {entity.categoryMain || entity.categorySub || "Chưa có"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={imageStatus === "Chưa có ảnh" ? "outline" : "secondary"}
                                  >
                                    {imageStatus}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        Chưa đọc được dòng hợp lệ trong nguồn đang xem.
                      </div>
                    )}

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {sheetImportSummaries.map((summary) => (
                        <div
                          key={summary.sheetName}
                          className="rounded-lg border bg-muted/20 p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{summary.sheetName}</div>
                              <div className="text-xs text-muted-foreground">
                                {summary.rows} dòng gốc,{" "}
                                {summary.included ? `${summary.importedEntities} dòng sẽ nhập` : "đang bỏ qua"}
                              </div>
                            </div>
                            <Badge variant={summary.included ? "secondary" : "outline"}>
                              {summary.included ? "Sẽ nhập" : "Bỏ qua"}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                            <div className="rounded-md bg-background p-2 leading-snug">
                              <div className="font-semibold">{summary.localFolderRows}</div>
                              <div className="text-muted-foreground">Có tên folder</div>
                            </div>
                            <div className="rounded-md bg-background p-2 leading-snug">
                              <div className="font-semibold">{summary.driveRows}</div>
                              <div className="text-muted-foreground">Có link Drive</div>
                            </div>
                            <div className="rounded-md bg-background p-2 leading-snug">
                              <div className="font-semibold">{summary.directUrlRows}</div>
                              <div className="text-muted-foreground">Có URL ảnh</div>
                            </div>
                          </div>
                          {summary.warningMessages.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs text-amber-700">
                              {summary.warningMessages.map((message) => (
                                <div key={message}>{message}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <ImportReviewCards summary={importReviewSummary} />

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
                      <div>
                        <div className="font-medium">Kiểm tra ảnh Drive</div>
                        <div className="text-xs text-muted-foreground">
                          Tùy chọn. Chỉ cần dùng khi sheet có link Drive và muốn kiểm tra link private.
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
                        {driveCheckBusy ? "Đang kiểm tra" : "Kiểm tra Drive"}
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
                        ? `Nhập ${includedSheetCount}/${workbookSheets.length} nguồn`
                        : "Nhập dữ liệu vào app"}
                    </Button>
                    {blockingMappingIssues.length > 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        <XCircle className="mt-0.5 size-4 shrink-0" />
                        <span>{blockingMappingIssues[0]}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-4">
                    <EmptyState
                      icon={<LinkIcon />}
                      title="Chưa có nguồn dữ liệu"
                      description="Dán link Google Sheet hoặc chọn file CSV ở trên để xem dữ liệu mẫu."
                    />
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
                    <CardTitle>Cột dữ liệu</CardTitle>
                    <CardDescription>
                      App tự nhận diện cột. Chỉ sửa mục này khi dữ liệu mẫu bị sai.
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
                                Dùng gợi ý
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
              <CardTitle>Dữ liệu đã nhập</CardTitle>
              <CardDescription>{entities.length} dòng dữ liệu đang lưu trong trình duyệt.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {entities.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={<Database />}
                    title="Chưa có dữ liệu đã nhập"
                    description="Nhập Google Sheet hoặc CSV ở tab 'Nguồn dữ liệu' để bắt đầu."
                    compact
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tên</TableHead>
                      <TableHead>Nguồn</TableHead>
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
                          <Badge variant="outline">{entity.sheetName ?? "Chưa phân nguồn"}</Badge>
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

            {assetGroups.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <EmptyState
                    icon={<ImageIcon />}
                    title="Chưa có ảnh đã nhập"
                    description="Chọn quán ở trên rồi bấm 'Thêm ảnh vào quán' để upload."
                    compact
                  />
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
                  Ảnh sẽ bị xoá khỏi danh sách ảnh của quán. Nếu ảnh này không còn được dùng ở nơi khác,
                  app cũng xoá dữ liệu ảnh khỏi trình duyệt để nhẹ hơn.
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
