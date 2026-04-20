import { useState, useMemo } from "react";
import { FONTS, FONT_CATEGORIES, type FontCategory } from "./fonts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

export function FontPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (family: string) => void;
}) {
  const [vietnameseOnly, setVietnameseOnly] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<FontCategory, typeof FONTS>();
    FONT_CATEGORIES.forEach((c) => map.set(c, []));
    for (const f of FONTS) {
      if (vietnameseOnly && !f.vietnamese) continue;
      map.get(f.category)!.push(f);
    }
    return map;
  }, [vietnameseOnly]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Font chữ</span>
        <Button
          type="button"
          size="sm"
          variant={vietnameseOnly ? "default" : "ghost"}
          className="h-6 px-2 text-[10px]"
          onClick={() => setVietnameseOnly((v) => !v)}
          title="Chỉ hiển thị font hỗ trợ tiếng Việt"
        >
          <Languages className="size-3 mr-1" /> VI
        </Button>
      </div>
      <Select value={value ?? "Be Vietnam Pro"} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue>
            <span style={{ fontFamily: `'${value ?? "Be Vietnam Pro"}', sans-serif` }}>
              {value ?? "Be Vietnam Pro"}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[420px]">
          {FONT_CATEGORIES.map((cat) => {
            const list = grouped.get(cat) ?? [];
            if (list.length === 0) return null;
            return (
              <SelectGroup key={cat}>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {cat}
                </SelectLabel>
                {list.map((f) => (
                  <SelectItem key={f.family} value={f.family}>
                    <span style={{ fontFamily: `'${f.family}', sans-serif`, fontSize: 16 }}>
                      {f.family}
                    </span>
                    {!f.vietnamese && (
                      <span className="ml-2 text-[9px] text-amber-600">(no VN)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
