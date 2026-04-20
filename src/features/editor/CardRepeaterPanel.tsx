// Panel nhỏ trong properties: cấu hình Card Repeater cho group đang chọn.
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Repeat, X } from "lucide-react";
import type { CardGroupConfig, PageTemplate } from "@/models";

interface Props {
  groupId: string;
  template: PageTemplate;
  onChange: (next: CardGroupConfig[] | undefined) => void;
}

export function CardRepeaterPanel({ groupId, template, onChange }: Props) {
  const all = template.cardGroups ?? [];
  const cfg = all.find((g) => g.groupId === groupId);
  const slotCount = template.slots.filter((s) => s.groupId === groupId).length;

  const upsert = (patch: Partial<CardGroupConfig>) => {
    const next: CardGroupConfig = {
      groupId,
      repeatCount: 4,
      gap: 16,
      direction: "vertical",
      ...cfg,
      ...patch,
    };
    const others = all.filter((g) => g.groupId !== groupId);
    onChange([...others, next]);
  };

  const remove = () => {
    const others = all.filter((g) => g.groupId !== groupId);
    onChange(others.length ? others : undefined);
  };

  if (!cfg) {
    return (
      <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Repeat className="size-4 text-primary" /> Card Repeater
        </div>
        <p className="text-xs text-muted-foreground">
          Group này có <b>{slotCount}</b> slot. Biến nó thành "card mẫu" để app tự lặp lại N lần,
          mỗi card bind 1 entity khác nhau từ pool đã filter.
        </p>
        <Button size="sm" className="w-full" onClick={() => upsert({})}>
          <Repeat className="size-3 mr-1" /> Bật Card Repeater (4 cards dọc)
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Repeat className="size-4 text-primary" /> Card Repeater
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={remove} title="Tắt repeater">
          <X className="size-3" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Group <b>{slotCount}</b> slot sẽ được clone thành <b>{cfg.repeatCount}</b> card khi render.
        Mỗi card auto bind 1 entity từ pool.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Số card</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={cfg.repeatCount}
            onChange={(e) => upsert({ repeatCount: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Khoảng cách (px)</Label>
          <Input
            type="number"
            min={0}
            value={cfg.gap}
            onChange={(e) => upsert({ gap: Math.max(0, Number(e.target.value) || 0) })}
            className="h-8"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Hướng lặp</Label>
        <Select
          value={cfg.direction}
          onValueChange={(v) => upsert({ direction: v as "vertical" | "horizontal" })}
        >
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="vertical">Dọc (xuống dưới)</SelectItem>
            <SelectItem value="horizontal">Ngang (sang phải)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Lọc theo Sheet (tùy chọn)</Label>
        <Input
          placeholder="vd: Homestay (để trống = dùng pool gốc)"
          value={cfg.entitySource?.sheetName ?? ""}
          onChange={(e) =>
            upsert({
              entitySource: e.target.value
                ? { ...cfg.entitySource, sheetName: e.target.value }
                : undefined,
            })
          }
          className="h-8"
        />
      </div>
    </div>
  );
}
