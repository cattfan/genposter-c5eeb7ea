import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DesignWorkspace } from "./DesignWorkspace";
import { designDocumentToPageTemplate, pageTemplateToDesignDocument } from "./designDocument";
import type { PageTemplate } from "@/models";
import { db } from "@/storage/db";

export function EditorPage() {
  const { id } = useParams({ from: "/templates/$id/edit" });
  const location = useLocation();
  const navigate = useNavigate();
  const routeSearch = location.search as { packId?: unknown };
  const packId = typeof routeSearch.packId === "string" ? routeSearch.packId : undefined;
  const backToTemplates = () => navigate({ to: "/templates", search: { open: packId } });
  const payload = useLiveQuery(async () => {
    const [template, directDocument, linkedDocument] = await Promise.all([
      db.pageTemplates.get(id),
      db.designDocuments.get(id),
      db.designDocuments.where("sourcePageTemplateId").equals(id).first(),
    ]);
    const pack = packId ? await db.packTemplates.get(packId) : undefined;
    const packPages = pack
      ? (await db.pageTemplates.bulkGet(pack.orderedPages)).filter((page): page is PageTemplate =>
          Boolean(page),
        )
      : [];
    return {
      template,
      document: directDocument ?? linkedDocument,
      pack,
      packPages,
    };
  }, [id, packId]);

  const initialDocument = useMemo(() => {
    if (!payload?.template) return null;
    return payload.document ?? pageTemplateToDesignDocument(payload.template, "template");
  }, [payload]);

  if (!payload) {
    return <div className="p-8 text-muted-foreground">Đang tải editor...</div>;
  }

  if (!payload.template || !initialDocument) {
    return (
      <div className="p-8 space-y-4">
        <div className="text-lg font-semibold">Không tìm thấy template</div>
        <Button asChild variant="outline">
          <Link to="/templates" search={{ open: packId }}>
            Quay lại templates
          </Link>
        </Button>
      </div>
    );
  }

  const template = payload.template;

  return (
    <DesignWorkspace
      initialDocument={initialDocument}
      mode="template"
      allowMultiplePages={false}
      autosave
      packPages={payload.packPages}
      activeTemplateId={template.pageTemplateId}
      headerLeading={
        <Button variant="outline" className="h-8" onClick={backToTemplates}>
          <ArrowLeft className="mr-2 size-4" />
          Quay lại
        </Button>
      }
      onOpenTemplatePage={(pageTemplateId) => {
        void navigate({
          to: "/templates/$id/edit",
          params: { id: pageTemplateId },
          search: { packId },
        });
      }}
      onClose={backToTemplates}
      onSave={async (nextDocument) => {
        const nextTemplate = designDocumentToPageTemplate(nextDocument, template);
        await db.transaction("rw", [db.pageTemplates, db.designDocuments], async () => {
          await db.pageTemplates.put(nextTemplate);
          await db.designDocuments.put({
            ...nextDocument,
            designDocumentId: nextDocument.designDocumentId || id,
            sourcePageTemplateId: template.pageTemplateId,
            mode: "template",
            updatedAt: Date.now(),
          });
        });
      }}
    />
  );
}
