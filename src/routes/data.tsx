import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { parseCsvFile, parseJsonFile, fetchSheetCsv, type ParsedTable } from "@/features/data/parsers";
import { autoMap, normalizeRows, standardFieldOptionsLabeled, type FieldMapping } from "@/engines/normalize/normalizer";
import { BulkImageUpload } from "@/features/data/BulkImageUpload";

export const Route = createFileRoute("/data")({
  component: DataPage,
});

function DataPage() {
  const entities = useLiveQuery(() => db.entities.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [busy, setBusy] = useState(false);

  const guessSheetName = (raw: string) => {
    // Lấy gid hoặc tên file để gợi ý
    const gid = raw.match(/[?#&]gid=(\d+)/)?.[1];
    if (gid) return `Sheet_${gid}`;
    return "";
  };

  const onFile = async (file: File) => {
    try {
      setBusy(true);
      const t = file.name.endsWith(".json") ? await parseJsonFile(file) : await parseCsvFile(file);
      setParsed(t);
      setMapping(autoMap(t.headers));
      if (!sheetName) setSheetName(file.name.replace(/\.(csv|json)$/i, ""));
      toast.success(`Đã đọc ${t.rows.length} dòng`);
    } catch (e) {
      toast.error("Lỗi parse file: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSheet = async () => {
    try {
      setBusy(true);
      const t = await fetchSheetCsv(sheetUrl);
      setParsed(t);
      setMapping(autoMap(t.headers));
      if (!sheetName) setSheetName(guessSheetName(sheetUrl) || "Quan_an");
      toast.success(`Đã tải ${t.rows.length} dòng từ Google Sheets`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    if (!parsed) return;
    const finalSheet = sheetName.trim() || "default";
    const { entities: ents, assets: asts, warnings } = normalizeRows(parsed.rows, mapping, finalSheet);
    // Dedupe theo (name + sheetName): xoá entity cũ cùng sheet+name trước khi put
    await db.transaction("rw", [db.entities, db.assets], async () => {
      const existing = await db.entities.where("sheetName").equals(finalSheet).toArray();
      const newKeys = new Set(ents.map((e) => e.name.toLowerCase()));
      const toDelete = existing.filter((e) => newKeys.has(e.name.toLowerCase())).map((e) => e.entityId);
      if (toDelete.length) {
        await db.entities.bulkDelete(toDelete);
        await db.assets.where("entityId").anyOf(toDelete).delete();
      }
      await db.entities.bulkPut(ents);
      await db.assets.bulkPut(asts);
    });
    toast.success(`Đã import ${ents.length} entity vào sheet "${finalSheet}". ${warnings.length} cảnh báo.`);
    setParsed(null);
  };

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Dữ liệu</h1>

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
            <CardHeader><CardTitle>1. Chọn nguồn</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Tên sheet (để gom nhóm dữ liệu, vd: Quan_an, Cafe)</Label>
                <Input
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  placeholder="Quan_an"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Mỗi tab dữ liệu nên có 1 tên sheet riêng. Trang Tạo nội dung sẽ cho lọc theo tên này.
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => fileRef.current?.click()} disabled={busy}>Upload CSV / JSON</Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                />
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label>Hoặc dán link Google Sheets (đã share public hoặc publish CSV)</Label>
                  <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
                </div>
                <Button onClick={onSheet} disabled={!sheetUrl || busy}>Tải</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Mẹo: Trong Google Sheets vào File → Share → "Anyone with the link" hoặc File → Share → Publish to web → CSV.
              </p>
            </CardContent>
          </Card>

          {parsed && (
            <Card>
              <CardHeader><CardTitle>2. Mapping cột</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {parsed.headers.map((h) => (
                    <div key={h} className="flex items-center gap-2">
                      <span className="text-xs flex-1 truncate">{h}</span>
                      <span className="text-muted-foreground">→</span>
                      <Select value={mapping[h] ?? "__ignore__"} onValueChange={(v) => setMapping({ ...mapping, [h]: v })}>
                        <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {standardFieldOptionsLabeled().map((s) => (
                            <SelectItem key={s.value} value={s.value} title={s.value}>
                              {s.label}
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
                <Button onClick={importNow} className="w-full">Import vào project</Button>
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
                  {entities?.map((e) => (
                    <tr key={e.entityId} className="border-t">
                      <td className="p-2 font-medium">{e.name}</td>
                      <td className="p-2 text-xs"><Badge variant="outline">{e.sheetName ?? "—"}</Badge></td>
                      <td className="p-2">{e.categoryMain}</td>
                      <td className="p-2 text-xs">{e.categorySub}</td>
                      <td className="p-2 text-xs text-muted-foreground">{e.address}</td>
                      <td className="p-2">{e.partnerFlag && <Badge variant="default">Đối tác</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {assets?.map((a) => {
              const ent = entities?.find((e) => e.entityId === a.entityId);
              return (
                <Card key={a.assetId} className="overflow-hidden">
                  <div className="aspect-square bg-muted">
                    <img src={a.sourceValue} alt="" className="w-full h-full object-cover" />
                  </div>
                  <CardContent className="p-2">
                    <div className="text-xs font-semibold truncate">{ent?.name}</div>
                    <div className="text-[10px] text-muted-foreground">{a.role}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
