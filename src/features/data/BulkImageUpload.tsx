import { useState } from "react";
import { nanoid } from "nanoid";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveBlob } from "@/storage/db";
import { matchFilesToEntities, type MatchResult } from "@/features/data/imageMatcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import type { Asset } from "@/models";

interface PendingFile {
  file: File;
  match: MatchResult;
  manualEntityId?: string | null; // override
  role: Asset["role"];
}

export function BulkImageUpload() {
  const entities = useLiveQuery(() => db.entities.toArray(), []) ?? [];
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [threshold, setThreshold] = useState(0.78);
  const [busy, setBusy] = useState(false);

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (entities.length === 0) {
      toast.error("Chưa có quán nào. Hãy import dữ liệu CSV/Sheet trước.");
      return;
    }
    const arr = Array.from(files);
    const fileNames = arr.map((f) => f.name);
    const matches = matchFilesToEntities(fileNames, entities, { fuzzyThreshold: threshold });
    const next: PendingFile[] = arr.map((f, i) => ({
      file: f,
      match: matches[i],
      manualEntityId: matches[i].matchedEntityId,
      role: "cover",
    }));
    setPending(next);
    const matched = next.filter((p) => p.manualEntityId).length;
    toast.success(`${arr.length} ảnh • Khớp tự động: ${matched}/${arr.length}`);
  };

  const rerunMatch = () => {
    if (pending.length === 0) return;
    const fileNames = pending.map((p) => p.file.name);
    const matches = matchFilesToEntities(fileNames, entities, { fuzzyThreshold: threshold });
    setPending(
      pending.map((p, i) => ({
        ...p,
        match: matches[i],
        manualEntityId: matches[i].matchedEntityId,
      })),
    );
    const matched = matches.filter((m) => m.matchedEntityId).length;
    toast.success(`Đã match lại: ${matched}/${matches.length}`);
  };

  const setManual = (idx: number, entityId: string | null) => {
    const next = [...pending];
    next[idx] = { ...next[idx], manualEntityId: entityId };
    setPending(next);
  };

  const setRole = (idx: number, role: Asset["role"]) => {
    const next = [...pending];
    next[idx] = { ...next[idx], role };
    setPending(next);
  };

  const removeRow = (idx: number) => {
    setPending(pending.filter((_, i) => i !== idx));
  };

  const importAll = async () => {
    const ready = pending.filter((p) => p.manualEntityId);
    if (ready.length === 0) {
      toast.error("Không có ảnh nào đã được gán quán");
      return;
    }
    setBusy(true);
    try {
      const newAssets: Asset[] = [];
      // Đếm sẵn cover hiện tại của từng entity để không tạo trùng cover
      const coverCount: Record<string, number> = {};
      const existing = await db.assets.toArray();
      for (const a of existing) {
        if (a.isCover) coverCount[a.entityId] = (coverCount[a.entityId] ?? 0) + 1;
      }

      for (const p of ready) {
        const entityId = p.manualEntityId!;
        const blobKey = await saveBlob(p.file);
        const url = URL.createObjectURL(p.file);
        const isCover = p.role === "cover" && (coverCount[entityId] ?? 0) === 0;
        if (isCover) coverCount[entityId] = (coverCount[entityId] ?? 0) + 1;
        newAssets.push({
          assetId: nanoid(),
          entityId,
          sourceType: "local",
          sourceValue: url,
          blobKey,
          role: p.role,
          isCover,
          qualityScore: 80,
          status: "ok",
        });
      }
      await db.assets.bulkPut(newAssets);
      toast.success(`Đã import ${newAssets.length} ảnh local vào ${new Set(newAssets.map((a) => a.entityId)).size} quán`);
      setPending([]);
    } catch (e) {
      toast.error("Lỗi khi import: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const matchedCount = pending.filter((p) => p.manualEntityId).length;

  // Báo cáo: quán nào còn thiếu ảnh
  const allAssets = useLiveQuery(() => db.assets.toArray(), []) ?? [];
  const entitiesWithoutImage = entities.filter(
    (e) => !allAssets.some((a) => a.entityId === e.entityId),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Upload ảnh local hàng loạt + Auto-match theo tên quán</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>1. Đặt tên file ảnh theo tên quán (có thể bỏ dấu, dùng <code>-1</code>, <code>-2</code> cho ảnh phụ).</p>
            <p>2. Chọn nhiều ảnh cùng lúc bên dưới. App sẽ tự gán ảnh vào đúng quán.</p>
            <p>3. Kiểm tra cột "Quán" — chỉnh tay nếu match sai — rồi bấm Import.</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.target.files)}
              className="text-sm"
            />
            <div className="flex items-center gap-2 text-xs">
              <span>Ngưỡng fuzzy:</span>
              <div className="w-32">
                <Slider
                  value={[threshold * 100]}
                  min={50}
                  max={95}
                  step={1}
                  onValueChange={(v) => setThreshold(v[0] / 100)}
                />
              </div>
              <span className="font-mono">{Math.round(threshold * 100)}%</span>
              <Button size="sm" variant="outline" onClick={rerunMatch} disabled={pending.length === 0}>
                Match lại
              </Button>
            </div>
          </div>

          {pending.length > 0 && (
            <div className="border rounded">
              <div className="flex items-center justify-between p-2 bg-muted text-sm">
                <span>
                  {pending.length} file • Đã gán: <strong>{matchedCount}</strong> • Chưa gán:{" "}
                  <strong>{pending.length - matchedCount}</strong>
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPending([])}>
                    Xoá hết
                  </Button>
                  <Button size="sm" onClick={importAll} disabled={busy || matchedCount === 0}>
                    Import {matchedCount} ảnh
                  </Button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Preview</th>
                      <th className="text-left p-2">Tên file</th>
                      <th className="text-left p-2">Match</th>
                      <th className="text-left p-2">Quán (chỉnh tay nếu sai)</th>
                      <th className="text-left p-2">Vai trò</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((p, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-2">
                          <img
                            src={URL.createObjectURL(p.file)}
                            alt=""
                            className="w-12 h-12 object-cover rounded"
                          />
                        </td>
                        <td className="p-2 font-mono max-w-48 truncate">{p.file.name}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              p.match.reason === "exact"
                                ? "default"
                                : p.match.reason === "no_match"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {p.match.reason === "exact" && "Khớp 100%"}
                            {p.match.reason === "contains" && `Chứa ${p.match.score}%`}
                            {p.match.reason === "fuzzy" && `Gần đúng ${p.match.score}%`}
                            {p.match.reason === "no_match" && "Không khớp"}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Select
                            value={p.manualEntityId ?? "__none__"}
                            onValueChange={(v) => setManual(idx, v === "__none__" ? null : v)}
                          >
                            <SelectTrigger className="h-7 w-56 text-xs">
                              <SelectValue placeholder="-- chọn quán --" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— Bỏ qua —</SelectItem>
                              {entities.map((e) => (
                                <SelectItem key={e.entityId} value={e.entityId}>
                                  {e.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Select value={p.role} onValueChange={(v) => setRole(idx, v as Asset["role"])}>
                            <SelectTrigger className="h-7 w-32 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cover">cover</SelectItem>
                              <SelectItem value="facade">facade</SelectItem>
                              <SelectItem value="food_closeup">food_closeup</SelectItem>
                              <SelectItem value="space">space</SelectItem>
                              <SelectItem value="portrait">portrait</SelectItem>
                              <SelectItem value="square_thumb">square_thumb</SelectItem>
                              <SelectItem value="section_image">section_image</SelectItem>
                              <SelectItem value="generic">generic</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Button size="sm" variant="ghost" onClick={() => removeRow(idx)}>
                            ✕
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Quán còn thiếu ảnh{" "}
            <Badge variant={entitiesWithoutImage.length === 0 ? "default" : "destructive"}>
              {entitiesWithoutImage.length}/{entities.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entitiesWithoutImage.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tất cả quán đã có ít nhất 1 ảnh ✅</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs max-h-64 overflow-y-auto">
              {entitiesWithoutImage.map((e) => (
                <div key={e.entityId} className="flex items-center gap-2 p-1 bg-muted/50 rounded">
                  <span className="font-mono text-muted-foreground">·</span>
                  <span className="truncate">{e.name}</span>
                  {e.partnerFlag && (
                    <Badge variant="outline" className="text-[10px]">
                      P
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
