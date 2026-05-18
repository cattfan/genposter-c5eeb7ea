// Templates Gallery — modal grid starter templates khi tạo pack/page mới.
//
// Hiển thị danh sách template có sẵn (từ DB page_templates) để user chọn
// thay vì bắt đầu từ trang trống. Giống Canva "Templates" panel.

import { useMemo, useState } from "react";
import { useLiveQuery } from "@/storage/useLiveQuery";
import { db } from "@/storage/db";
import type { PageTemplate } from "@/models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus } from "lucide-react";

const CATEGORIES = [
  { value: "__all__", label: "Tất cả" },
  { value: "cover", label: "Cover" },
  { value: "itinerary", label: "Lịch trình" },
  { value: "board", label: "Board" },
  { value: "mixed", label: "Tổng hợp" },
];

interface TemplatesGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback khi user chọn 1 template. Trả về template đã clone (id mới). */
  onSelect: (template: PageTemplate | null) => void;
  /** Tiêu đề modal. */
  title?: string;
}

export function TemplatesGallery({
  open,
  onOpenChange,
  onSelect,
  title = "Chọn mẫu trang",
}: TemplatesGalleryProps) {
  const [category, setCategory] = useState("__all__");

  // Lấy tất cả page templates làm nguồn gallery. Sau này có thể filter
  // theo flag `isStarter` hoặc tag riêng.
  const allTemplates = useLiveQuery(() => db.pageTemplates.toArray(), []);

  const filtered = useMemo(() => {
    if (!allTemplates) return [];
    if (category === "__all__") return allTemplates;
    return allTemplates.filter((tpl) => tpl.type === category);
  }, [allTemplates, category]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5 pb-2 border-b">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat.value}
              size="sm"
              variant={category === cat.value ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </Button>
          ))}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {/* Trang trống luôn ở đầu */}
            <button
              type="button"
              className="group flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors hover:border-primary hover:bg-primary/5"
              onClick={() => {
                onSelect(null);
                onOpenChange(false);
              }}
            >
              <Plus className="size-8 text-muted-foreground group-hover:text-primary" />
              <span className="text-xs font-medium">Trang trống</span>
            </button>

            {filtered.map((tpl) => (
              <button
                key={tpl.pageTemplateId}
                type="button"
                className="group flex flex-col overflow-hidden rounded-lg border transition-all hover:border-primary hover:shadow-md"
                onClick={() => {
                  onSelect(tpl);
                  onOpenChange(false);
                }}
              >
                {/* Thumbnail preview */}
                <div
                  className="relative aspect-[3/4] w-full overflow-hidden bg-muted/30"
                  style={{ background: tpl.canvas.background ?? "#f8fafc" }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <FileText className="size-8 text-muted-foreground/40" />
                  </div>
                  {tpl.canvas.backgroundImage && (
                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${tpl.canvas.backgroundImage})` }}
                    />
                  )}
                  <div className="absolute bottom-1 right-1">
                    <Badge variant="secondary" className="text-[9px]">
                      {tpl.slots.length} khối
                    </Badge>
                  </div>
                </div>
                {/* Name */}
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                    {tpl.name}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[9px]">
                    {tpl.type}
                  </Badge>
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Chưa có mẫu nào{category !== "__all__" ? ` loại "${CATEGORIES.find((c) => c.value === category)?.label}"` : ""}. Tạo trang trống rồi thiết kế.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
