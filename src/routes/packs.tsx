import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import type { PackTemplate } from "@/models";
import { useEffect, useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { PackBuilder } from "@/features/packs/PackBuilder";
import { PageContainer, PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/packs")({
  component: PacksPage,
  validateSearch: (s: Record<string, unknown>) => ({
    open: typeof s.open === "string" ? s.open : undefined,
  }),
});

function PacksPage() {
  const search = Route.useSearch();
  const packs = useLiveQuery(() => db.packTemplates.toArray(), []);
  const tpls = useLiveQuery(() => db.pageTemplates.toArray(), []);
  const [editing, setEditing] = useState<PackTemplate | null>(null);

  // Auto-mở pack từ ?open=
  useEffect(() => {
    if (!search.open || !packs) return;
    const found = packs.find((p) => p.packTemplateId === search.open);
    if (found && (!editing || editing.packTemplateId !== found.packTemplateId)) {
      setEditing({ ...found });
    }
  }, [search.open, packs, editing]);

  const createNew = () => {
    setEditing({
      packTemplateId: nanoid(),
      name: "Pack mới",
      orderedPages: [],
      requiredPages: [],
      optionalPages: [],
      captionProfile: { mode: "save_post" },
      exportDefaults: { format: "png", scale: 2 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const onSave = async () => {
    if (!editing) return;
    await db.packTemplates.put({ ...editing, updatedAt: Date.now() });
    toast.success("Đã lưu pack");
  };

  const onDuplicate = async () => {
    if (!editing) return;
    const dup: PackTemplate = {
      ...editing,
      packTemplateId: nanoid(),
      name: editing.name + " (copy)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.packTemplates.put(dup);
    setEditing(dup);
    toast.success("Đã duplicate pack");
  };

  return (
    <PageContainer>
      <PageHeader
        icon={<Package className="size-5" />}
        title="Pack Templates"
        description="Ghép nhiều page template thành 1 combo."
        actions={
          <Button onClick={createNew}>
            <Plus className="size-4 mr-2" /> Tạo pack mới
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <div>
          <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">
            Danh sách
          </h2>
          <div className="space-y-2">
            {packs?.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Chưa có pack. Tạo mới hoặc dùng &quot;AI dựng combo&quot; ở /templates.
                </CardContent>
              </Card>
            )}
            {packs?.map((p) => (
              <Card
                key={p.packTemplateId}
                className={`cursor-pointer border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-sm ${
                  editing?.packTemplateId === p.packTemplateId ? "border-primary bg-accent/40" : ""
                }`}
                onClick={() => setEditing({ ...p })}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.orderedPages.length} page
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`Xóa pack "${p.name}"?`)) {
                        await db.packTemplates.delete(p.packTemplateId);
                        if (editing?.packTemplateId === p.packTemplateId) setEditing(null);
                        toast.success("Đã xóa");
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          {!editing && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Package className="size-5" />
                </span>
                Chọn 1 pack để sửa hoặc tạo mới.
              </CardContent>
            </Card>
          )}
          {editing && (
            <PackBuilder
              pack={editing}
              allTemplates={tpls ?? []}
              onChange={setEditing}
              onSave={onSave}
              onDuplicate={onDuplicate}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}
