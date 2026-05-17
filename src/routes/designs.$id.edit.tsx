import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useLiveQuery } from "@/storage/useLiveQuery";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DesignWorkspace } from "@/features/editor/DesignWorkspace";
import { db } from "@/storage/db";

export const Route = createFileRoute("/designs/$id/edit")({
  component: DesignEditorRoute,
});

function DesignEditorRoute() {
  const { id } = useParams({ from: "/designs/$id/edit" });
  const navigate = useNavigate();
  const document = useLiveQuery(async () => (await db.designDocuments.get(id)) ?? null, [id]);

  if (document === undefined) {
    return <div className="p-8 text-muted-foreground">Đang tải design...</div>;
  }

  if (document === null) {
    return <div className="p-8 text-muted-foreground">Không tìm thấy design.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="outline" onClick={() => navigate({ to: "/designs" })}>
          <ArrowLeft className="mr-2 size-4" />
          Quay lại
        </Button>
        <div>
          <div className="font-semibold">{document.name}</div>
          <div className="text-xs text-muted-foreground">Standalone design document</div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <DesignWorkspace
          initialDocument={document}
          mode="design"
          autosave
          onClose={() => navigate({ to: "/designs" })}
          onSave={async (nextDocument) => {
            await db.designDocuments.put({
              ...nextDocument,
              updatedAt: Date.now(),
            });
          }}
        />
      </div>
    </div>
  );
}
