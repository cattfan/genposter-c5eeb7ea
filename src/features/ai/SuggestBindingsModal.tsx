// Modal preview AI suggestions cho binding — designer xác nhận từng dòng hoặc Apply All.

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Slot } from "@/models";
import { TEXT_BINDING_OPTIONS, IMAGE_BINDING_OPTIONS } from "@/engines/binding/dataBinding";

export interface BindSuggestion {
  slotId: string;
  suggestedBindingPath: string;
  confidence: number;
  reason: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suggestions: BindSuggestion[];
  slots: Slot[];
  onApply: (selected: BindSuggestion[]) => void;
}

export function SuggestBindingsModal({ open, onOpenChange, suggestions, slots, onApply }: Props) {
  const slotMap = useMemo(() => new Map(slots.map((s) => [s.slotId, s])), [slots]);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(suggestions.filter((s) => s.confidence >= 0.6).map((s) => s.slotId)),
  );

  const validOptions = useMemo(() => {
    const set = new Set<string>();
    [...TEXT_BINDING_OPTIONS, ...IMAGE_BINDING_OPTIONS].forEach((o) => o.value && set.add(o.value));
    return set;
  }, []);

  const valid = suggestions.filter((s) => slotMap.has(s.slotId) && validOptions.has(s.suggestedBindingPath));

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () => {
    onApply(valid.filter((s) => picked.has(s.slotId)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI gợi ý liên kết dữ liệu</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-muted-foreground">
            {valid.length} gợi ý hợp lệ · đã chọn {picked.size}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(valid.map((s) => s.slotId)))}>
              Chọn tất cả
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Bỏ chọn
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2 pr-2">
            {valid.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                AI không tìm được gợi ý phù hợp.
              </div>
            )}
            {valid.map((s) => {
              const slot = slotMap.get(s.slotId)!;
              const label = slot.staticText ?? slot.name ?? `Slot ${slot.kind}`;
              return (
                <label
                  key={s.slotId}
                  className="flex items-start gap-3 border rounded-md p-3 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox checked={picked.has(s.slotId)} onCheckedChange={() => toggle(s.slotId)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="secondary">{slot.kind}</Badge>
                      <span className="truncate font-medium">{label}</span>
                      <Badge variant={s.confidence >= 0.7 ? "default" : "outline"}>
                        {Math.round(s.confidence * 100)}%
                      </Badge>
                    </div>
                    <div className="text-sm mt-1 font-mono text-primary break-all">
                      → {s.suggestedBindingPath}
                    </div>
                    {s.reason && <div className="text-xs text-muted-foreground mt-1">{s.reason}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button onClick={apply} disabled={picked.size === 0}>
            Áp dụng {picked.size} liên kết
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
