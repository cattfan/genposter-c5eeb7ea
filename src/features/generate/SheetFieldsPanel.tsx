// Panel hiển thị các tab sheet (Quan_an, Cafe, Choi_dem...) + danh sách field thật
// trong sheet đó. Click 1 field để bind vào slot đang chọn ở canvas /generate.

import { useMemo } from "react";
import type { Entity, Slot } from "@/models";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Image as ImageIcon, Type, Database, MousePointerClick } from "lucide-react";

const STANDARD_FIELDS: Array<{ key: string; label: string; path: string }> = [
  { key: "name", label: "Tên (Ten)", path: "entity.name" },
  { key: "address", label: "Địa chỉ (Dia_chi)", path: "entity.address" },
  { key: "phone", label: "SĐT (SDT)", path: "entity.phone" },
  { key: "priceRange", label: "Giá", path: "entity.priceRange" },
  { key: "style", label: "Phong cách", path: "entity.style" },
  { key: "openingHours", label: "Giờ mở cửa", path: "entity.openingHours" },
  { key: "categoryMain", label: "Loại / Mô hình", path: "entity.categoryMain" },
  { key: "categorySub", label: "Phong cách phụ", path: "entity.categorySub" },
];

interface FieldItem {
  label: string;
  path: string; // bindingPath
  sample?: string;
  isImageLike: boolean;
}

function looksLikeImageUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:image"))
    return /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/.test(s) ||
      s.includes("googleusercontent") ||
      s.includes("drive.google.com") ||
      s.includes("imgur") ||
      s.includes("cloudinary");
  return false;
}

function truncate(v: unknown, n = 36): string {
  if (v == null) return "";
  const s = String(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function SheetFieldsPanel({
  entities,
  sheetOptions,
  selectedSheet,
  onSelectSheet,
  selectedSlot,
  previewEntity,
  onBindToSelectedSlot,
}: {
  entities: Entity[];
  sheetOptions: string[];
  selectedSheet: string; // "__all__" hoặc tên sheet
  onSelectSheet: (s: string) => void;
  selectedSlot: Slot | undefined;
  previewEntity: Entity | undefined;
  onBindToSelectedSlot: (path: string) => void;
}) {
  // Tập entity thuộc sheet đang xem (để tính union field thật)
  const sheetEntities = useMemo(() => {
    if (selectedSheet === "__all__") return entities;
    return entities.filter((e) => e.sheetName === selectedSheet);
  }, [entities, selectedSheet]);

  const fields: FieldItem[] = useMemo(() => {
    const list: FieldItem[] = [];
    const seen = new Set<string>();

    // 1. Field chuẩn — luôn show nếu có ≥1 entity của sheet có giá trị
    for (const f of STANDARD_FIELDS) {
      const hasValue = sheetEntities.some((e) => {
        const v = (e as unknown as Record<string, unknown>)[f.key];
        return v != null && v !== "";
      });
      if (!hasValue) continue;
      const sample = previewEntity
        ? truncate((previewEntity as unknown as Record<string, unknown>)[f.key])
        : "";
      list.push({ label: f.label, path: f.path, sample, isImageLike: false });
      seen.add(f.path);
    }

    // 2. Field từ entity.metadata (cột raw của sheet, vd Loai_dich_vu, Ten_quan)
    const metaKeys = new Map<string, { count: number; imageHits: number }>();
    for (const e of sheetEntities) {
      if (!e.metadata) continue;
      for (const [k, v] of Object.entries(e.metadata)) {
        if (v == null || v === "") continue;
        const cur = metaKeys.get(k) ?? { count: 0, imageHits: 0 };
        cur.count += 1;
        if (looksLikeImageUrl(v)) cur.imageHits += 1;
        metaKeys.set(k, cur);
      }
    }
    const sortedMeta = Array.from(metaKeys.entries()).sort((a, b) => a[0].localeCompare(b[0], "vi"));
    for (const [k, info] of sortedMeta) {
      const path = `entity.metadata.${k}`;
      if (seen.has(path)) continue;
      const sample = previewEntity ? truncate(previewEntity.metadata?.[k]) : "";
      list.push({
        label: k,
        path,
        sample,
        isImageLike: info.imageHits > 0 && info.imageHits >= info.count * 0.5,
      });
      seen.add(path);
    }

    return list;
  }, [sheetEntities, previewEntity]);

  // Field nào enable cho slot đang chọn
  const slotKind = selectedSlot?.kind;
  const canBindNow = slotKind === "text" || slotKind === "image" || slotKind === "shape";
  const fieldEnabled = (f: FieldItem): boolean => {
    if (!canBindNow) return false;
    if (slotKind === "text") return !f.isImageLike; // text bind text-like
    return f.isImageLike; // image/shape chỉ bind cột chứa URL ảnh (nếu sheet có)
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Database className="size-3" />
        Trường dữ liệu theo sheet
      </div>

      {/* Tabs sheet */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => onSelectSheet("__all__")}
          className={cn(
            "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
            selectedSheet === "__all__"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted",
          )}
        >
          Tất cả
        </button>
        {sheetOptions.map((s) => (
          <button
            key={s}
            onClick={() => onSelectSheet(s)}
            className={cn(
              "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
              selectedSheet === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Hint */}
      {!canBindNow && (
        <div className="text-[11px] text-muted-foreground italic flex items-center gap-1">
          <MousePointerClick className="size-3" />
          Chọn 1 block trên canvas để click field bind data.
        </div>
      )}
      {canBindNow && (
        <div className="text-[11px] text-muted-foreground">
          Click 1 field bên dưới để gán vào block <b>{slotKind}</b> đang chọn.
        </div>
      )}

      {/* Field list */}
      {fields.length === 0 ? (
        <div className="text-[11px] text-muted-foreground border border-dashed rounded p-3 text-center">
          Sheet này chưa có cột dữ liệu nào có giá trị.
        </div>
      ) : (
        <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
          {fields.map((f) => {
            const enabled = fieldEnabled(f);
            const active = selectedSlot?.bindingPath === f.path;
            return (
              <button
                key={f.path}
                disabled={!enabled}
                onClick={() => enabled && onBindToSelectedSlot(f.path)}
                title={f.path}
                className={cn(
                  "w-full text-left rounded border px-2 py-1.5 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : enabled
                      ? "border-border hover:border-primary hover:bg-muted/60 cursor-pointer"
                      : "border-border/50 bg-muted/20 text-muted-foreground/60 cursor-not-allowed",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {f.isImageLike ? (
                    <ImageIcon className="size-3 shrink-0" />
                  ) : (
                    <Type className="size-3 shrink-0" />
                  )}
                  <span className="font-medium truncate flex-1">{f.label}</span>
                  {active && (
                    <Badge variant="outline" className="text-[9px] py-0 h-4">
                      đang bind
                    </Badge>
                  )}
                </div>
                {f.sample && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {f.sample}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}