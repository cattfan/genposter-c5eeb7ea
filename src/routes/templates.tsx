import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Pencil, Copy, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import type { PageTemplate } from "@/models";
import { PageRenderer } from "@/features/render/PageRenderer";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tpls = useLiveQuery(() => db.pageTemplates.orderBy("updatedAt").reverse().toArray(), []);

  if (location.pathname !== "/templates") {
    return <Outlet />;
  }

  const createNew = async () => {
    const id = nanoid();
    const tpl: PageTemplate = {
      pageTemplateId: id,
      name: "Page Template mới",
      type: "cover",
      canvas: { width: 1080, height: 1350, background: "#ffffff" },
      slots: [],
      sections: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.pageTemplates.put(tpl);
    toast.success("Đã tạo template mới — mở editor...");
    navigate({ to: "/templates/$id/edit", params: { id } });
  };

  const openEdit = (id: string) => {
    navigate({ to: "/templates/$id/edit", params: { id } });
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Page Templates</h1>
          <p className="text-muted-foreground mt-1">Mỗi page template là 1 layout có thể ghép vào pack.</p>
        </div>
        <Button onClick={createNew}>
          <Plus className="size-4 mr-2" /> Tạo mới
        </Button>
      </div>

      {tpls && tpls.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            Chưa có template nào. Bấm "Tạo mới" hoặc nạp lại demo từ thanh bên.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tpls?.map((t) => (
          <Card key={t.pageTemplateId} className="overflow-hidden">
            <button
              onClick={() => openEdit(t.pageTemplateId)}
              className="block w-full text-left relative hover:opacity-90 transition bg-muted/40"
              style={{ aspectRatio: `${t.canvas.width} / ${t.canvas.height}` }}
            >
              <TemplatePreview tpl={t} />
              <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 bg-black/60 text-white rounded z-10">
                {t.canvas.width}×{t.canvas.height} · {t.slots.length} slot
              </div>
            </button>
            <CardContent className="p-4">
              <div className="font-semibold mb-2 truncate">{t.name}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="default" onClick={() => openEdit(t.pageTemplateId)}>
                  <Pencil className="size-3 mr-1" /> Sửa
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const dup: PageTemplate = {
                      ...t,
                      pageTemplateId: nanoid(),
                      name: t.name + " (copy)",
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    };
                    await db.pageTemplates.put(dup);
                    toast.success("Đã duplicate");
                  }}
                >
                  <Copy className="size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!confirm(`Xóa template "${t.name}"?`)) return;
                    await db.pageTemplates.delete(t.pageTemplateId);
                    toast.success("Đã xóa");
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
