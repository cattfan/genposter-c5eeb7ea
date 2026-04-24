import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { useJobStore } from "@/features/generate/jobStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  buildFinalManifest,
  buildPartnerProofEntries,
  buildPartnersDetailedCsv,
  buildPartnersSummaryTxt,
  buildRenderManifest,
} from "@/engines/reports/reports";
import type { PartnerProofEntry } from "@/engines/reports/reports";
import { downloadJSON, downloadText } from "@/features/render/exportPng";
import { generateCaptions } from "@/engines/captions/generator";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import type { Asset, CaptionMode, CaptionVariant, Entity } from "@/models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, FileText } from "lucide-react";
import { PageRenderer } from "@/features/render/PageRenderer";
import { PageContainer, PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { currentJob } = useJobStore();
  const entities = useLiveQuery(() => db.entities.toArray(), []) ?? [];
  const assets = useLiveQuery(() => db.assets.toArray(), []) ?? [];
  const tpls = useLiveQuery(() => db.pageTemplates.toArray(), []) ?? [];
  const packs = useLiveQuery(() => db.packTemplates.toArray(), []) ?? [];
  const [mode, setMode] = useState<CaptionMode>("save_post");

  const captions: CaptionVariant[] = useMemo(() => {
    if (!currentJob) return [];
    const pack = packs.find((p) => p.packTemplateId === currentJob.packTemplateId);
    if (!pack) return [];
    return generateCaptions({ job: currentJob, pack, entities, mode, count: 4 });
  }, [currentJob, packs, entities, mode]);

  if (!currentJob) {
    return (
      <PageContainer>
        <PageHeader icon={<FileText className="size-5" />} title="Báo cáo & Caption" />
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
              <FileText className="size-5" />
            </span>
            Chưa có job. Mở &quot;Tạo nội dung&quot; và generate trước.
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const pack = packs.find((p) => p.packTemplateId === currentJob.packTemplateId);
  if (!pack) {
    return (
      <PageContainer>
        <PageHeader icon={<FileText className="size-5" />} title="Báo cáo & Caption" />
        <Card className="border-dashed">
          <CardContent className="p-10 text-center text-muted-foreground">
            Không tìm thấy pack template cho job hiện tại.
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const partnersTxt = buildPartnersSummaryTxt(currentJob, pack, entities, tpls, true);
  const partnersTxtPreview = buildPartnersSummaryTxt(currentJob, pack, entities, tpls, false);
  const csvFinal = buildPartnersDetailedCsv(
    { ...currentJob, pages: currentJob.pages.filter((p) => p.selected) },
    pack,
    entities,
    tpls,
  );
  const csvAll = buildPartnersDetailedCsv(currentJob, pack, entities, tpls);
  const finalManifest = buildFinalManifest(currentJob);
  const previewManifest = buildRenderManifest(currentJob);
  const finalProofs = buildPartnerProofEntries(currentJob, pack, entities, tpls, true);
  const previewProofs = buildPartnerProofEntries(currentJob, pack, entities, tpls, false);

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        icon={<FileText className="size-5" />}
        title="Báo cáo & Caption"
        description={`Job: ${currentJob.packTemplateName}`}
      />

      <Tabs defaultValue="partners">
        <TabsList>
          <TabsTrigger value="partners">Đối tác</TabsTrigger>
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
          <TabsTrigger value="captions">Captions</TabsTrigger>
        </TabsList>

        <TabsContent value="partners" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Final exposure (page đã chọn export)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="text-xs bg-muted p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
                {partnersTxt}
              </pre>
              <div className="flex gap-2">
                <Button onClick={() => downloadText(partnersTxt, "partners_summary.txt")}>
                  Download TXT
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadText(csvFinal, "partners_detailed.csv", "text/csv")}
                >
                  Download CSV
                </Button>
              </div>
            </CardContent>
          </Card>
          <PartnerProofGrid
            title="Final brand proof"
            proofs={finalProofs}
            entities={entities}
            assets={assets}
          />
          <Card>
            <CardHeader>
              <CardTitle>Preview exposure (toàn bộ page generated)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="text-xs bg-muted p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
                {partnersTxtPreview}
              </pre>
              <Button
                variant="outline"
                onClick={() => downloadText(csvAll, "partners_preview.csv", "text/csv")}
              >
                Download CSV preview
              </Button>
            </CardContent>
          </Card>
          <PartnerProofGrid
            title="Preview brand proof"
            proofs={previewProofs}
            entities={entities}
            assets={assets}
          />
        </TabsContent>

        <TabsContent value="manifest" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>final_export_manifest.json</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="text-xs bg-muted p-3 rounded max-h-80 overflow-auto">
                {JSON.stringify(finalManifest, null, 2)}
              </pre>
              <Button onClick={() => downloadJSON(finalManifest, "final_export_manifest.json")}>
                Download
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>render_manifest.json (preview)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                onClick={() => downloadJSON(previewManifest, "render_manifest.json")}
              >
                Download
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="captions" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <span className="text-sm">Mode:</span>
              <Select value={mode} onValueChange={(v) => setMode(v as CaptionMode)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="save_post">save_post</SelectItem>
                  <SelectItem value="newbie_guide">newbie_guide</SelectItem>
                  <SelectItem value="review_pack">review_pack</SelectItem>
                  <SelectItem value="partner_soft">partner_soft</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Caption sinh từ FINAL EXPORT manifest, không từ raw data.
              </span>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {captions.map((c) => {
              const full = `${c.headline}\n\n${c.body}\n\n${c.hashtags.join(" ")}`;
              return (
                <Card key={c.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="font-bold text-sm">{c.headline}</div>
                    <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                    <div className="text-xs text-primary font-medium">{c.hashtags.join(" ")}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(full);
                        toast.success("Đã copy caption");
                      }}
                    >
                      <Copy className="size-3 mr-1" /> Copy full
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function PartnerProofGrid({
  title,
  proofs,
  entities,
  assets,
}: {
  title: string;
  proofs: PartnerProofEntry[];
  entities: Entity[];
  assets: Asset[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {proofs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Không có đối tác nào trong phạm vi này.
          </div>
        ) : (
          <div className="space-y-6">
            {proofs.map((proof) => (
              <div key={proof.entity.entityId} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="font-semibold">{proof.entity.name}</div>
                  <Badge variant="secondary">{proof.pages.length} lần xuất hiện</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {proof.pages.map((meta) => {
                    const template = meta.pageTemplate;
                    if (!template) return null;
                    return (
                      <Card key={`${proof.entity.entityId}-${meta.page.pageIndex}`}>
                        <CardContent className="p-3 space-y-2">
                          <div className="text-sm font-medium">{meta.bundleLabel}</div>
                          <div className="text-xs text-muted-foreground">
                            {template.name} · {meta.displayPageName}
                          </div>
                          <div className="overflow-hidden rounded border bg-muted/30">
                            <PageRenderer
                              template={template}
                              page={meta.page}
                              entities={entities}
                              assets={assets}
                              entity={
                                meta.page.entityId
                                  ? entities.find(
                                      (entity) => entity.entityId === meta.page.entityId,
                                    )
                                  : undefined
                              }
                              scale={220 / template.canvas.width}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
