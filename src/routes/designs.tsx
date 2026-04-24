import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Copy, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/storage/db";
import { createBlankDesignDocument } from "@/features/editor/designDocument";
import { DesignRenderer } from "@/features/editor/DesignRenderer";
import { PageContainer, PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/designs")({
  component: DesignsPage,
});

function DesignsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const docs = useLiveQuery(() => db.designDocuments.orderBy("updatedAt").reverse().toArray(), []);

  if (location.pathname !== "/designs") {
    return <Outlet />;
  }

  const createNew = async () => {
    const doc = createBlankDesignDocument({
      designDocumentId: nanoid(),
      name: "Untitled Design",
      mode: "design",
    });
    await db.designDocuments.put(doc);
    navigate({ to: "/designs/$id/edit", params: { id: doc.designDocumentId } });
  };

  return (
    <PageContainer>
      <PageHeader
        icon={<Palette className="size-5" />}
        title="Designs"
        description="Workspace đa trang kiểu Canva cho poster, social post và design tĩnh."
        actions={
          <Button onClick={createNew}>
            <Plus className="mr-2 size-4" />
            Tạo design
          </Button>
        }
      />

      {docs && docs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
              <Palette className="size-5" />
            </span>
            <p>Chưa có design nào. Bấm &quot;Tạo design&quot; để bắt đầu.</p>
            <Button onClick={createNew} size="sm">
              <Plus className="mr-2 size-4" /> Tạo design
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {docs?.map((doc) => (
          <Card
            key={doc.designDocumentId}
            className="group overflow-hidden border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
          >
            <button
              className="relative block w-full bg-muted/40 text-left transition hover:opacity-95"
              style={{
                aspectRatio: `${doc.pages[0]?.width ?? 1080} / ${doc.pages[0]?.height ?? 1350}`,
              }}
              onClick={() =>
                navigate({ to: "/designs/$id/edit", params: { id: doc.designDocumentId } })
              }
            >
              <DocumentPreview documentId={doc.designDocumentId} />
              <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
                {doc.pages.length} page
              </div>
            </button>
            <CardContent className="p-4">
              <div className="mb-2 truncate font-semibold">{doc.name}</div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    navigate({ to: "/designs/$id/edit", params: { id: doc.designDocumentId } })
                  }
                >
                  <Pencil className="mr-1 size-3" />
                  Sửa
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const copy = {
                      ...doc,
                      designDocumentId: nanoid(),
                      name: `${doc.name} (copy)`,
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    };
                    await db.designDocuments.put(copy);
                    toast.success("Đã duplicate design");
                  }}
                >
                  <Copy className="size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!confirm(`Xóa design "${doc.name}"?`)) return;
                    await db.designDocuments.delete(doc.designDocumentId);
                    toast.success("Đã xóa design");
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}

function DocumentPreview({ documentId }: { documentId: string }) {
  const doc = useLiveQuery(() => db.designDocuments.get(documentId), [documentId]);
  const page = doc?.pages[0];
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const node = ref.current;
    if (!node || !page) return;
    const resize = () => {
      setScale(Math.min(node.clientWidth / page.width, node.clientHeight / page.height));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [page]);

  if (!doc || !page) {
    return (
      <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
        No preview
      </div>
    );
  }

  const elements = doc.elements.filter((element) => element.pageId === page.pageId);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      >
        <DesignRenderer page={page} elements={elements} scale={scale} />
      </div>
    </div>
  );
}
