// Trang "Tạo nội dung" — chỉ là wrapper mỏng quanh <PackTabContent />.
//
// Trước đây file này còn ~700 dòng cho luồng "Generate theo entity" (state
// entityPages, generateByEntity, exportEntityZip, AI caption riêng, side-panel
// bind...) nhưng toàn bộ đã không còn được render — tree return chỉ là
// <PackTabContent />. Đã xoá để giảm bundle, gỡ phụ thuộc vào useBindOverrides
// và buildPublishBundle (các symbol đó chỉ còn dùng ở đây).

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { db } from "@/storage/db";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { useJobStore } from "@/features/generate/jobStore";
import { PackTabContent } from "@/features/generate/PackTabContent";
import { designDocumentToPageTemplate } from "@/features/editor/designDocument";

export const Route = createFileRoute("/generate")({
  component: GeneratePage,
});

function GeneratePage() {
  const packs = useLiveQuery(() => db.packTemplates.toArray(), []);
  const storedTpls = useLiveQuery(() => db.pageTemplates.toArray(), []);
  const designDocuments = useLiveQuery(() => db.designDocuments.toArray(), []);
  const entities = useLiveQuery(() => db.entities.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);

  // Merge designDocuments (canonical mới) vào pageTemplates (legacy) sao cho
  // PackTabContent thấy phiên bản mới nhất của template. Hai đường liên kết
  // (id == pageTemplateId hoặc sourcePageTemplateId) đều ưu tiên document.
  const tpls = useMemo(() => {
    if (!storedTpls) return undefined;
    const documentsByTemplateId = new Map(
      (designDocuments ?? [])
        .filter((document) => document.mode === "template" && document.sourcePageTemplateId)
        .map((document) => [document.sourcePageTemplateId!, document]),
    );
    for (const document of designDocuments ?? []) {
      if (document.mode !== "template") continue;
      if (!documentsByTemplateId.has(document.designDocumentId)) {
        documentsByTemplateId.set(document.designDocumentId, document);
      }
    }
    return storedTpls.map((template) => {
      const document = documentsByTemplateId.get(template.pageTemplateId);
      if (!document) return template;
      return designDocumentToPageTemplate(document, template);
    });
  }, [storedTpls, designDocuments]);

  const sheetOptions = useMemo(() => {
    const set = new Set<string>();
    entities?.forEach((entity) => entity.sheetName && set.add(entity.sheetName));
    return Array.from(set).sort();
  }, [entities]);

  const [packId, setPackId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<"all" | "selected" | "errors" | "partner">("all");
  const { currentJob, setJob, toggleSelected, setSelectedAll, updatePage } = useJobStore();
  const renderRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  return (
    <PageContainer className="max-w-[1600px]">
      <PageHeader icon={<Sparkles className="size-5" />} title="Tạo nội dung" />
      <PackTabContent
        packs={packs ?? []}
        tpls={tpls ?? []}
        entities={entities ?? []}
        assets={assets ?? []}
        currentJob={currentJob}
        setJob={setJob}
        updatePage={updatePage}
        toggleSelected={toggleSelected}
        setSelectedAll={setSelectedAll}
        renderRefs={renderRefs}
        debug={false}
        sheetOptions={sheetOptions}
        packId={packId}
        setPackId={setPackId}
        filter={filter}
        setFilter={setFilter}
      />
    </PageContainer>
  );
}
