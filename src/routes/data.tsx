import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkImageUpload } from "@/features/data/BulkImageUpload";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { Database } from "lucide-react";
import {
  fetchSheetCsv,
  parseDataFile,
  type ParsedTable,
  type ParsedWorkbookSheet,
} from "@/features/data/parsers";
import {
  autoMap,
  normalizeRows,
  standardFieldOptionsLabeled,
  type FieldMapping,
} from "@/engines/normalize/normalizer";
import { db } from "@/storage/db";
import { setLastActiveSheet } from "@/storage/lastSheet";

export const Route = createFileRoute("/data")({
  component: DataPage,
});

function DataPage() {
  const entities = useLiveQuery(() => db.entities.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [mappingsBySheet, setMappingsBySheet] = useState<Record<string, FieldMapping>>({});
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [busy, setBusy] = useState(false);

  const workbookSheets = parsed?.workbookSheets ?? [];
  const isMultiSheetWorkbook = workbookSheets.length > 1;

  const guessSheetName = (raw: string) => {
    const gid = raw.match(/[?#&]gid=(\d+)/)?.[1];
    if (gid) return `Sheet_${gid}`;
    return "";
  };

  const stripImportExtension = (fileName: string) => fileName.replace(/\.(csv|json|xlsx)$/i, "");

  const activateWorkbookSheet = (
    workbook: ParsedWorkbookSheet[],
    nextMappings: Record<string, FieldMapping>,
    sheetToOpen: string,
  ) => {
    const nextSheet = workbook.find((sheet) => sheet.name === sheetToOpen) ?? workbook[0];
    if (!nextSheet) return;

    setParsed({
      headers: nextSheet.headers,
      rows: nextSheet.rows,
      sourceSheetName: nextSheet.name,
      workbookSheets: workbook,
    });
    setMapping(nextMappings[nextSheet.name] ?? autoMap(nextSheet.headers));
  };

  const onFile = async (file: File) => {
    try {
      setBusy(true);
      const nextParsed = await parseDataFile(file);

      if (nextParsed.workbookSheets?.length) {
        const nextMappings = Object.fromEntries(
          nextParsed.workbookSheets.map((sheet) => [sheet.name, autoMap(sheet.headers)]),
        );
        setMappingsBySheet(nextMappings);
        activateWorkbookSheet(
          nextParsed.workbookSheets,
          nextMappings,
          nextParsed.sourceSheetName ?? nextParsed.workbookSheets[0].name,
        );

        if (nextParsed.workbookSheets.length === 1) {
          if (!sheetName) setSheetName(stripImportExtension(file.name));
          toast.success(
            `Đã đọc ${nextParsed.rows.length} dòng từ sheet "${nextParsed.sourceSheetName}"`,
          );
        } else {
          setSheetName("");
          toast.success(
            `Đã đọc ${nextParsed.workbookSheets.length} sheet Excel. Đang xem "${nextParsed.sourceSheetName}"`,
          );
        }

        return;
      }

      setParsed(nextParsed);
      setMappingsBySheet({});
      setMapping(autoMap(nextParsed.headers));
      if (!sheetName) setSheetName(stripImportExtension(file.name));
      toast.success(`Đã đọc ${nextParsed.rows.length} dòng`);
    } catch (e) {
      toast.error("Lỗi parse file: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSheet = async () => {
    try {
      setBusy(true);
      const nextParsed = await fetchSheetCsv(sheetUrl);
      setParsed(nextParsed);
      setMappingsBySheet({});
      setMapping(autoMap(nextParsed.headers));
      if (!sheetName) setSheetName(guessSheetName(sheetUrl) || "Quan_an");
      toast.success(`Đã tải ${nextParsed.rows.length} dòng từ Google Sheets`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateMapping = (header: string, value: string) => {
    setMapping((prev) => {
      const next = { ...prev, [header]: value };
      if (parsed?.sourceSheetName && parsed.workbookSheets?.length) {
        setMappingsBySheet((prevMappings) => ({
          ...prevMappings,
          [parsed.sourceSheetName!]: next,
        }));
      }
      return next;
    });
  };

  const importNow = async () => {
    if (!parsed) return;

    const importSources = parsed.workbookSheets?.length
      ? parsed.workbookSheets
      : [
          {
            name: sheetName.trim() || parsed.sourceSheetName || "default",
            headers: parsed.headers,
            rows: parsed.rows,
          },
        ];

    const plans = importSources.map((source) => {
      const finalSheet =
        parsed.workbookSheets?.length && parsed.workbookSheets.length > 1
          ? source.name.trim() || "default"
          : sheetName.trim() || source.name.trim() || "default";
      const sourceMapping =
        parsed.workbookSheets?.length && parsed.workbookSheets.length > 0
          ? (mappingsBySheet[source.name] ?? autoMap(source.headers))
          : mapping;
      const normalized = normalizeRows(source.rows, sourceMapping, finalSheet);
      return {
        finalSheet,
        ...normalized,
      };
    });

    await db.transaction("rw", [db.entities, db.assets], async () => {
      for (const plan of plans) {
        const existing = await db.entities.where("sheetName").equals(plan.finalSheet).toArray();
        const newKeys = new Set(plan.entities.map((entity) => entity.name.toLowerCase()));
        const toDelete = existing
          .filter((entity) => newKeys.has(entity.name.toLowerCase()))
          .map((entity) => entity.entityId);

        if (toDelete.length) {
          await db.entities.bulkDelete(toDelete);
          await db.assets.where("entityId").anyOf(toDelete).delete();
        }

        await db.entities.bulkPut(plan.entities);
        await db.assets.bulkPut(plan.assets);
      }
    });

    const totalEntities = plans.reduce((sum, plan) => sum + plan.entities.length, 0);
    const totalWarnings = plans.reduce((sum, plan) => sum + plan.warnings.length, 0);
    setLastActiveSheet(parsed.sourceSheetName ?? plans[0]?.finalSheet);

    if (plans.length > 1) {
      toast.success(
        `Đã import ${totalEntities} entity từ ${plans.length} sheet Excel. ${totalWarnings} cảnh báo.`,
      );
    } else {
      toast.success(
        `Đã import ${totalEntities} entity vào sheet "${plans[0].finalSheet}". ${totalWarnings} cảnh báo.`,
      );
    }

    setParsed(null);
    setMappingsBySheet({});
  };

  return (
    <PageContainer>
      <PageHeader
        icon={<Database className="size-5" />}
        title="Dữ liệu"
        description="Import CSV / JSON / Excel, quản lý entity và asset theo từng sheet."
      />

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import">Import dữ liệu</TabsTrigger>
          <TabsTrigger value="images">Ảnh hàng loạt</TabsTrigger>
          <TabsTrigger value="entities">Quán ({entities?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="assets">Ảnh ({assets?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="images">
          <BulkImageUpload />
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>1. Chọn nguồn</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Tên sheet để gom nhóm dữ liệu</Label>
                <Input
                  value={isMultiSheetWorkbook ? "Import theo tên từng sheet Excel" : sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  placeholder="Quan_an"
                  disabled={isMultiSheetWorkbook}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {isMultiSheetWorkbook
                    ? "Workbook nhiều sheet sẽ import theo đúng tên từng tab Excel như Quan_an, Cafe, Homestay."
                    : "Mỗi nguồn dữ liệu nên có 1 tên sheet riêng. Trang Tạo nội dung sẽ cho lọc theo tên này."}
                </p>
              </div>

              <div className="flex gap-2">
                <div className="relative inline-flex">
                  <Button type="button" disabled={busy}>
                    Upload CSV / JSON / XLSX
                  </Button>
                  <input
                    type="file"
                    accept=".csv,.json,.xlsx"
                    aria-label="Upload file CSV, JSON hoặc XLSX"
                    disabled={busy}
                    className="absolute inset-0 cursor-pointer opacity-0 disabled:pointer-events-none"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = "";
                      if (file) void onFile(file);
                    }}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Hỗ trợ CSV, JSON và Excel `.xlsx`. Với workbook nhiều sheet, app sẽ đọc toàn bộ các
                sheet có dữ liệu.
              </p>

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label>Hoặc dán link Google Sheets</Label>
                  <Input
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </div>
                <Button onClick={onSheet} disabled={!sheetUrl || busy}>
                  Tải
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Mẹo: Trong Google Sheets vào File → Share → "Anyone with the link" hoặc File → Share
                → Publish to web → CSV.
              </p>
            </CardContent>
          </Card>

          {parsed && (
            <Card>
              <CardHeader>
                <CardTitle>2. Mapping cột</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isMultiSheetWorkbook && (
                  <div className="space-y-2">
                    <Label className="text-xs">Sheet trong workbook</Label>
                    <div className="flex gap-1 overflow-x-auto pb-1">
                      {workbookSheets.map((sheet) => {
                        const active = sheet.name === parsed.sourceSheetName;
                        return (
                          <button
                            key={sheet.name}
                            type="button"
                            className={
                              "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors " +
                              (active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-muted/40 hover:bg-muted")
                            }
                            onClick={() =>
                              activateWorkbookSheet(workbookSheets, mappingsBySheet, sheet.name)
                            }
                          >
                            {sheet.name} ({sheet.rows.length})
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Khi import, app sẽ nhập toàn bộ {workbookSheets.length} sheet và giữ nguyên
                      tên tab Excel để bạn lọc ở trang Tạo nội dung.
                    </p>
                  </div>
                )}

                {parsed.sourceSheetName && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Sheet Excel đang xem:</span>
                    <Badge variant="secondary">{parsed.sourceSheetName}</Badge>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {parsed.headers.map((header) => (
                    <div key={header} className="flex items-center gap-2">
                      <span className="text-xs flex-1 truncate">{header}</span>
                      <span className="text-muted-foreground">→</span>
                      <Select
                        value={mapping[header] ?? "__ignore__"}
                        onValueChange={(value) => updateMapping(header, value)}
                      >
                        <SelectTrigger className="h-8 w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {standardFieldOptionsLabeled().map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              title={option.value}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                <div>
                  <Label>Preview 5 dòng đầu</Label>
                  <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-48">
                    {JSON.stringify(parsed.rows.slice(0, 5), null, 2)}
                  </pre>
                </div>

                <Button onClick={importNow} className="w-full">
                  {isMultiSheetWorkbook ? "Import toàn bộ workbook" : "Import vào project"}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="entities">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Tên</th>
                    <th className="text-left p-2">Sheet</th>
                    <th className="text-left p-2">Mô hình</th>
                    <th className="text-left p-2">Phong cách</th>
                    <th className="text-left p-2">Địa chỉ</th>
                    <th className="text-left p-2">Đối tác</th>
                  </tr>
                </thead>
                <tbody>
                  {entities?.map((entity) => (
                    <tr key={entity.entityId} className="border-t">
                      <td className="p-2 font-medium">{entity.name}</td>
                      <td className="p-2 text-xs">
                        <Badge variant="outline">{entity.sheetName ?? "—"}</Badge>
                      </td>
                      <td className="p-2">{entity.categoryMain}</td>
                      <td className="p-2 text-xs">{entity.categorySub}</td>
                      <td className="p-2 text-xs text-muted-foreground">{entity.address}</td>
                      <td className="p-2">
                        {entity.partnerFlag && <Badge variant="default">Đối tác</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {assets?.map((asset) => {
              const entity = entities?.find((item) => item.entityId === asset.entityId);
              return (
                <Card key={asset.assetId} className="overflow-hidden">
                  <div className="aspect-square bg-muted">
                    <img src={asset.sourceValue} alt="" className="w-full h-full object-cover" />
                  </div>
                  <CardContent className="p-2">
                    <div className="text-xs font-semibold truncate">{entity?.name}</div>
                    <div className="text-[10px] text-muted-foreground">{asset.role}</div>
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
