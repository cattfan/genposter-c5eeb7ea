import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PackGenerateActionsProps {
  canGenerate: boolean;
  reason: string;
  hasEntities: boolean;
  onGenerate: () => void;
}

export function PackGenerateActions({
  canGenerate,
  reason,
  hasEntities,
  onGenerate,
}: PackGenerateActionsProps) {
  return (
    <div className="border-t pt-3 space-y-2">
      <Button
        onClick={onGenerate}
        disabled={!canGenerate}
        className="w-full"
        title={reason}
      >
        <Sparkles className="size-4 mr-2" /> Tạo bộ ảnh
      </Button>
      <p className={"text-xs " + (canGenerate ? "text-muted-foreground" : "text-destructive")}>
        {reason}
      </p>
      {!hasEntities && (
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href="/data">Nhập dữ liệu từ Google Sheet</a>
        </Button>
      )}
    </div>
  );
}
