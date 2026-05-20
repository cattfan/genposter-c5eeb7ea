// Displays a compact list of binding issues for a template rendered against a
// sample entity + asset pool. Used on the Generate page so the user can see at
// a glance which slots won't resolve with the currently selected data source.

import { useMemo } from "react";
import { AlertTriangle, Info, TriangleAlert } from "lucide-react";
import type { Asset, Entity, PageTemplate } from "@/models";
import {
  validateTemplateBindings,
  type BindingIssue,
} from "@/engines/binding/validation";
import { cn } from "@/lib/utils";

interface Props {
  template: PageTemplate | undefined;
  entity?: Entity;
  entityPool?: Entity[];
  assets?: Asset[];
  globalAssets?: Asset[];
  activeSheetName?: string;
  onSelectSlot?: (slotId: string) => void;
  className?: string;
  /** Compact header variant for embedding inside existing side panels. */
  compact?: boolean;
}

const LEVEL_COPY: Record<
  BindingIssue["level"],
  { icon: typeof AlertTriangle; label: string; badge: string }
> = {
  missing_field: {
    icon: AlertTriangle,
    label: "Thiếu trường",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  empty: {
    icon: Info,
    label: "Trường trống",
    badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  no_assets: {
    icon: TriangleAlert,
    label: "Thiếu ảnh",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
  unknown_path: {
    icon: AlertTriangle,
    label: "Binding lạ",
    badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  },
};

export function BindingIssuesPanel({
  template,
  entity,
  entityPool,
  assets,
  globalAssets,
  activeSheetName,
  onSelectSlot,
  className,
  compact = false,
}: Props) {
  const issues = useMemo(() => {
    if (!template) return [] as BindingIssue[];
    return validateTemplateBindings(template, {
      entity,
      entityPool,
      assets,
      globalAssets,
      activeSheetName,
    });
  }, [template, entity, entityPool, assets, globalAssets, activeSheetName]);

  if (!template) return null;
  if (issues.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-md border bg-card text-card-foreground shadow-sm",
        compact ? "p-2" : "p-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-amber-500" />
          <span className={cn("text-sm font-medium", compact && "text-xs")}>
            {`${issues.length} binding có thể lỗi`}
          </span>
        </div>
      </div>

      <ul className="mt-2 space-y-1">
        {issues.map((issue) => {
          const levelCopy = LEVEL_COPY[issue.level];
          const Icon = levelCopy.icon;
          return (
            <li key={issue.slotId}>
              <button
                type="button"
                onClick={() => onSelectSlot?.(issue.slotId)}
                className={cn(
                  "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors",
                  onSelectSlot
                    ? "hover:bg-muted cursor-pointer"
                    : "cursor-default",
                )}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
                        levelCopy.badge,
                      )}
                    >
                      {levelCopy.label}
                    </span>
                    <span className="truncate font-medium">
                      {issue.slotName || issue.slotId.slice(0, 6)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {issue.message}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
