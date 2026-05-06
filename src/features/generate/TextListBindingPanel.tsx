import { useEffect, useMemo, useState } from "react";
import { ListChecks, Plus, Shuffle, X } from "lucide-react";
import type { Entity, Slot } from "@/models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildEntityListBindingPath,
  parseEntityListBindingPath,
  resolveEntityListBinding,
  type EntityListBullet,
} from "@/engines/binding/dataBinding";

export interface TextListFieldOption {
  path: string;
  label: string;
  sample?: string;
}

const NONE_VALUE = "__none__";
const MAX_FIELD_COUNT = 10;

export function TextListBindingPanel({
  selectedSlot,
  fieldOptions,
  entityPool,
  prioritizePartnerDefault,
  onApply,
}: {
  selectedSlot?: Slot;
  fieldOptions: TextListFieldOption[];
  entityPool: Entity[];
  prioritizePartnerDefault: boolean;
  onApply: (bindingPath: string) => void;
}) {
  const defaultField = useMemo(
    () =>
      fieldOptions.find((field) => field.path === "entity.name")?.path ??
      fieldOptions[0]?.path ??
      "entity.name",
    [fieldOptions],
  );
  const [fields, setFields] = useState<string[]>([defaultField]);
  const [count, setCount] = useState(12);
  const [separator, setSeparator] = useState(" - ");
  const [bullet, setBullet] = useState<EntityListBullet>("dot");
  const [randomize, setRandomize] = useState(true);
  const [prioritizePartner, setPrioritizePartner] = useState(prioritizePartnerDefault);
  const [seed, setSeed] = useState(() => String(Date.now()));

  useEffect(() => {
    const parsed = parseEntityListBindingPath(selectedSlot?.bindingPath);
    if (parsed) {
      setFields(parsed.fields.length ? parsed.fields.slice(0, MAX_FIELD_COUNT) : [defaultField]);
      setCount(parsed.count);
      setSeparator(parsed.separator ?? " - ");
      setBullet(parsed.bullet ?? "dot");
      setRandomize(parsed.randomize !== false);
      setPrioritizePartner(parsed.prioritizePartner !== false);
      setSeed(parsed.seed ?? "default");
      return;
    }

    setFields([defaultField]);
    setCount(Math.min(12, Math.max(1, entityPool.length || 12)));
    setSeparator(" - ");
    setBullet("dot");
    setRandomize(true);
    setPrioritizePartner(prioritizePartnerDefault);
    setSeed(String(Date.now()));
  }, [
    selectedSlot?.slotId,
    selectedSlot?.bindingPath,
    defaultField,
    entityPool.length,
    prioritizePartnerDefault,
  ]);

  const optionList = useMemo(() => {
    const map = new Map<string, TextListFieldOption>();
    fieldOptions.forEach((field) => map.set(field.path, field));
    fields
      .filter((field) => field !== NONE_VALUE)
      .forEach((field) => {
        if (!map.has(field)) map.set(field, { path: field, label: field });
      });
    return Array.from(map.values());
  }, [fieldOptions, fields]);

  const selectedFields = useMemo(
    () => fields.filter((field) => field !== NONE_VALUE),
    [fields],
  );
  const buildPath = (nextSeed = seed) =>
    buildEntityListBindingPath({
      fields: selectedFields,
      count,
      separator,
      bullet,
      randomize,
      prioritizePartner,
      seed: nextSeed,
    });

  const previewBindingPath = useMemo(() => {
    if (selectedFields.length === 0) return "";
    return buildEntityListBindingPath({
      fields: selectedFields,
      count,
      separator,
      bullet,
      randomize,
      prioritizePartner,
      seed,
    });
  }, [selectedFields, count, separator, bullet, randomize, prioritizePartner, seed]);

  const previewText = useMemo(
    () => (previewBindingPath ? resolveEntityListBinding(previewBindingPath, entityPool, "") : ""),
    [previewBindingPath, entityPool],
  );

  const setFieldAt = (index: number, value: string) => {
    setFields((current) => current.map((field, i) => (i === index ? value : field)));
  };

  const addField = () => {
    setFields((current) =>
      current.length >= MAX_FIELD_COUNT ? current : [...current, NONE_VALUE],
    );
  };

  const removeFieldAt = (index: number) => {
    setFields((current) => {
      if (current.length <= 1) return current;
      return current.filter((_, i) => i !== index);
    });
  };

  const applyCurrent = (nextSeed = seed) => {
    if (selectedFields.length === 0) return;
    onApply(buildPath(nextSeed));
  };

  const randomAgain = () => {
    const nextSeed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSeed(nextSeed);
    applyCurrent(nextSeed);
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <ListChecks className="size-3.5" />
          Danh sách trong khung chữ
        </div>
        <Badge variant="outline" className="text-[10px]">
          {entityPool.length} dòng
        </Badge>
      </div>

      <div className="space-y-2">
        {fields.map((fieldValue, index) => (
          <div key={`${index}-${fieldValue}`} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">Trường {index + 1}</Label>
              {fields.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => removeFieldAt(index)}
                  title="Bỏ trường này"
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
            <Select
              value={fieldValue ?? NONE_VALUE}
              onValueChange={(value) => setFieldAt(index, value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {index > 0 && <SelectItem value={NONE_VALUE}>Không dùng</SelectItem>}
                {optionList.map((field) => (
                  <SelectItem key={field.path} value={field.path}>
                    {field.label}
                    {field.sample ? ` · ${field.sample}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-full justify-center text-xs"
          onClick={addField}
          disabled={fields.length >= MAX_FIELD_COUNT}
        >
          <Plus className="mr-1 size-3" /> Thêm trường
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px]">Số dòng</Label>
          <Input
            className="h-8 text-xs"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(event) =>
              setCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
            }
          />
        </div>
        <div>
          <Label className="text-[11px]">Dấu đầu dòng</Label>
          <Select value={bullet} onValueChange={(value) => setBullet(value as EntityListBullet)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dot">• Chấm đầu dòng</SelectItem>
              <SelectItem value="dash">- Gạch đầu dòng</SelectItem>
              <SelectItem value="number">1. Số thứ tự</SelectItem>
              <SelectItem value="none">Không dùng</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-[11px]">Ký tự nối trường</Label>
        <Input
          className="h-8 text-xs"
          value={separator}
          onChange={(event) => setSeparator(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={randomize} onCheckedChange={(value) => setRandomize(!!value)} />
          Xáo trộn danh sách khi tạo ảnh
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={prioritizePartner}
            onCheckedChange={(value) => setPrioritizePartner(!!value)}
          />
          Ưu tiên dữ liệu đối tác
        </label>
      </div>

      {previewText ? (
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-[11px] leading-relaxed">
          {previewText}
        </pre>
      ) : (
        <div className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
          Chưa có dòng xem trước phù hợp.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => applyCurrent()}
          disabled={selectedFields.length === 0}
        >
          <ListChecks className="size-3 mr-1" /> Áp dụng
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={randomAgain}
          disabled={!randomize || selectedFields.length === 0}
        >
          <Shuffle className="size-3 mr-1" /> Xáo trộn lại
        </Button>
      </div>
    </div>
  );
}
