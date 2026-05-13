import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DesignWorkspace } from "./DesignWorkspace";
import { designDocumentToPageTemplate, pageTemplateToDesignDocument } from "./designDocument";
import type { PageTemplate } from "@/models";
import { db } from "@/storage/db";
import {
  appendPageToPack,
  createBlankPageTemplate,
  duplicatePageTemplate,
} from "@/features/packs/packTemplateUtils";
import { clonePageTemplate } from "@/features/generate/templateState";

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
      onCreatePackPage={
        packId
          ? async () => {
              const pack = await db.packTemplates.get(packId);
              if (!pack) return;
              const pageNumber = pack.orderedPages.length + 1;
              const newPage = createBlankPageTemplate({ name: `Trang mới ${pageNumber}` });
              const nextPack = appendPageToPack(pack, newPage.pageTemplateId);
              await db.transaction(
                "rw",
                [db.pageTemplates, db.packTemplates],
                async () => {
                  await db.pageTemplates.put(newPage);
                  await db.packTemplates.put(nextPack);
                },
              );
              toast.success(`Đã thêm ${newPage.name}`);
              void navigate({
                to: "/templates/$id/edit",
                params: { id: newPage.pageTemplateId },
                search: { packId },
              });
            }
          : undefined
      }
      onDuplicatePackPage={
        packId
          ? async (pageTemplateId) => {
              const pack = await db.packTemplates.get(packId);
              const source = await db.pageTemplates.get(pageTemplateId);
              if (!pack || !source) return;
              const dup = duplicatePageTemplate(source);
              const nextPack = appendPageToPack(pack, dup.pageTemplateId);
              await db.transaction(
                "rw",
                [db.pageTemplates, db.packTemplates],
                async () => {
                  await db.pageTemplates.put(dup);
                  await db.packTemplates.put(nextPack);
                },
              );
              toast.success(`Đã nhân bản ${source.name}`);
              void navigate({
                to: "/templates/$id/edit",
                params: { id: dup.pageTemplateId },
                search: { packId },
              });
            }
          : undefined
      }
      onDeletePackPage={
        packId
          ? async (pageTemplateId) => {
              const pack = await db.packTemplates.get(packId);
              if (!pack) return;
              if (pack.orderedPages.length <= 1) {
                toast.error("Không thể xóa trang cuối cùng trong bộ");
                return;
              }
              const target = await db.pageTemplates.get(pageTemplateId);
              if (!target) return;
              const nextPack = {
                ...pack,
                orderedPages: pack.orderedPages.filter((id) => id !== pageTemplateId),
                requiredPages: pack.requiredPages.filter((id) => id !== pageTemplateId),
                optionalPages: pack.optionalPages.filter((id) => id !== pageTemplateId),
                updatedAt: Date.now(),
              };
              // Move to another page before deleting
              const nextPageId =
                nextPack.orderedPages[0] ?? pack.orderedPages.find((id) => id !== pageTemplateId);
              await db.transaction(
                "rw",
                [db.pageTemplates, db.packTemplates, db.designDocuments],
                async () => {
                  await db.pageTemplates.delete(pageTemplateId);
                  await db.packTemplates.put(nextPack);
                  // Also clean up any design document linked to this page
                  const linkedDocs = await db.designDocuments
                    .where("sourcePageTemplateId")
                    .equals(pageTemplateId)
                    .toArray();
                  for (const doc of linkedDocs) {
                    await db.designDocuments.delete(doc.designDocumentId);
                  }
                  // Keep a clone in case of snapshot references
                  void clonePageTemplate(target);
                },
              );
              toast.success(`Đã xóa ${target.name}`);
              if (nextPageId && nextPageId !== pageTemplateId) {
                void navigate({
                  to: "/templates/$id/edit",
                  params: { id: nextPageId },
                  search: { packId },
                });
              }
            }
          : undefined
      }
      onReorderPackPage={
        packId
          ? async (pageTemplateId, toIndex) => {
              const pack = await db.packTemplates.get(packId);
              if (!pack) return;
              const fromIndex = pack.orderedPages.indexOf(pageTemplateId);
              if (fromIndex < 0 || fromIndex === toIndex) return;
              const next = [...pack.orderedPages];
              next.splice(fromIndex, 1);
              next.splice(toIndex, 0, pageTemplateId);
              await db.packTemplates.put({
                ...pack,
                orderedPages: next,
                updatedAt: Date.now(),
              });
              toast.success("Đã đổi vị trí trang");
            }
          : undefined
      }
      onRenamePackPage={
        packId
          ? async (pageTemplateId, newName) => {
              const page = await db.pageTemplates.get(pageTemplateId);
              if (!page) return;
              await db.pageTemplates.put({
                ...page,
                name: newName,
                updatedAt: Date.now(),
              });
              toast.success(`Đã đổi tên thành "${newName}"`);
            }
          : undefined
      }
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
