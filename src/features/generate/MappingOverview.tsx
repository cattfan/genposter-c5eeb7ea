// MappingOverview — bảng trực quan "trường dữ liệu nào của sheet đang được gắn
// vào slot nào trong page hiện tại". Logic core ở [mappingOverview.utils.ts]
// để file này chỉ export component (giúp react-refresh fast-refresh).

import { useMemo } from "react";
import { Loader2, RefreshCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Entity, PageTemplate } from "@/models";
import {
  buildMappingOverview,
  type MappingRow,
} from "./mappingOverview.utils";

interface Props {
  template: PageTemplate | undefined;
  /** Entities thuộc sheet đã chọn (sau khi đã filter). */
  entitiesInSheet: Entity[];
  /** Click slot -> highlight ngoài canvas (PackTabContent gọi setSelectedSlotIds). */
  onSelectSlot?: (slotId: string) => void;
  /** Bấm nút "Tự liên kết theo mẫu" -> chạy autoBindPlaceholders cho template hiện tại. */
  onAutoBind?: () => void;
  /** Có đang chạy auto-bind không (để hiện loader). */
  autoBindBusy?: boolean;
}

export function MappingOverview({
  template,
  entitiesInSheet,
  onSelectSlot,
  onAutoBind,
  autoBindBusy,
}: Props) {
  const summary = useMemo(
    () => buildMappingOverview(template, entitiesInSheet),
    [template, entitiesInSheet],
  );

  if (!template) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        Chọn 1 trang để xem các trường dữ liệu đã liên kết.
      </div>
    );
  }

  const { rows, fieldsWithData, fieldsBound, hasUnboundPlaceholders } = summary;
  const ratioColor =
    fieldsWithData === 0
      ? "text-muted-foreground"
      : fieldsBound === fieldsWithData
        ? "text-emerald-600"
        : fieldsBound * 2 < fieldsWithData
          ? "text-rose-600"
          : "text-amber-600";

  return (
    <div className="space-y-2 rounded-lg border bg-card/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Sparkles className="size-3.5" />
          Trường dữ liệu &rarr; Khối
        </div>
        <span className={`text-xs font-semibold ${ratioColor}`}>
          {fieldsBound}/{fieldsWithData} đã gắn
        </span>
      </div>

      {hasUnboundPlaceholders && onAutoBind && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-full justify-start text-xs"
          onClick={onAutoBind}
          disabled={autoBindBusy}
        >
          {autoBindBusy ? (
            <Loader2 className="mr-2 size-3 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 size-3" />
          )}
          Tự liên kết theo mẫu placeholder
        </Button>
      )}

      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-xs">
          <tbody>
            {rows
              .slice()
              .sort((a, b) => {
                const score = (row: MappingRow) =>
                  (row.hasDataInSheet ? 1 : 0) * 10 +
                  (row.boundSlots.length === 0 ? 5 : 0) +
                  (row.placeholderSlots.length > 0 ? 2 : 0);
                return score(b) - score(a);
              })
              .map((row) => {
                const status = !row.hasDataInSheet
                  ? "no-data"
                  : row.boundSlots.length > 0
                    ? "bound"
                    : row.placeholderSlots.length > 0
                      ? "placeholder"
                      : "missing";
                return (
                  <tr
                    key={row.field.id}
                    className={
                      status === "no-data"
                        ? "text-muted-foreground/60"
                        : "border-t border-border/40"
                    }
                  >
                    <td className="w-[42%] py-1.5 pr-2 align-top">
                      <div className="font-medium">{row.field.labelVi}</div>
                      {!row.hasDataInSheet && (
                        <div className="text-[10px] text-muted-foreground">
                          (sheet chưa có dữ liệu)
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 align-top">
                      {row.boundSlots.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.boundSlots.map((slot) => (
                            <Badge
                              key={slot.slotId}
                              variant="secondary"
                              className="cursor-pointer text-[10px]"
                              onClick={() => onSelectSlot?.(slot.slotId)}
                            >
                              {slot.slotName}
                            </Badge>
                          ))}
                        </div>
                      ) : row.placeholderSlots.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className="text-[10px] text-amber-600">
                            Có mẫu chưa gắn
                          </Badge>
                          {row.placeholderSlots.map((slot) => (
                            <Badge
                              key={slot.slotId}
                              variant="outline"
                              className="cursor-pointer text-[10px]"
                              onClick={() => onSelectSlot?.(slot.slotId)}
                            >
                              {slot.slotName}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {row.hasDataInSheet ? "Chưa gắn vào khối nào" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
