// Undo History Panel — hiển thị danh sách thao tác đã làm, click để jump.
//
// designStore lưu history.past = DesignDocument[] (snapshot toàn bộ).
// Panel hiển thị mỗi entry = 1 dòng "Bước N" + timestamp relative.
// Click entry -> jump về state đó (undo/redo nhiều bước 1 lúc).

import { Undo2, Redo2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface HistoryPanelProps {
  /** Số snapshot trong past stack. */
  pastCount: number;
  /** Số snapshot trong future stack (redo). */
  futureCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Jump về bước cụ thể trong past. 0 = bước đầu tiên (xa nhất). */
  onJumpToPast?: (index: number) => void;
}

export function HistoryPanel({
  pastCount,
  futureCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onJumpToPast,
}: HistoryPanelProps) {
  const totalSteps = pastCount + futureCount;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          title="Lịch sử thao tác"
        >
          <Clock className="size-3.5" />
          <span className="tabular-nums">{pastCount}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-56 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Lịch sử ({totalSteps} bước)</span>
          <div className="flex gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={!canUndo}
              onClick={onUndo}
              title="Hoàn tác (Ctrl+Z)"
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={!canRedo}
              onClick={onRedo}
              title="Làm lại (Ctrl+Y)"
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="max-h-[240px] overflow-y-auto">
          {totalSteps === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Chưa có thao tác nào.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {/* Future (redo) — hiển thị mờ ở trên */}
              {Array.from({ length: futureCount }, (_, i) => (
                <div
                  key={`future-${i}`}
                  className="rounded px-2 py-1 text-[11px] text-muted-foreground/50"
                >
                  Bước {pastCount + i + 2} (đã hoàn tác)
                </div>
              ))}

              {/* Current state */}
              <div className="rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary ring-1 ring-primary/20">
                Hiện tại (Bước {pastCount + 1})
              </div>

              {/* Past — mới nhất ở trên */}
              {Array.from({ length: pastCount }, (_, i) => {
                const idx = pastCount - 1 - i; // reverse: mới nhất ở trên
                return (
                  <button
                    key={`past-${idx}`}
                    type="button"
                    className={cn(
                      "w-full rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted",
                    )}
                    onClick={() => {
                      // Jump: undo (pastCount - idx) lần
                      if (onJumpToPast) {
                        onJumpToPast(idx);
                      } else {
                        // Fallback: undo N lần
                        const steps = pastCount - idx;
                        for (let s = 0; s < steps; s++) onUndo();
                      }
                    }}
                  >
                    Bước {idx + 1}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
