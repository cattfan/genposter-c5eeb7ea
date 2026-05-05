// Floating text formatting toolbar — hiện trên text element khi đang edit hoặc select text.
// Khi contentEditable đang active, dùng execCommand để format selection.
// Khi không edit, cập nhật element style trực tiếp.
import { useCallback } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Blend,
  Bold,
  Italic,
  MoveHorizontal,
  Sparkles,
  Strikethrough,
  TypeOutline,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { DesignTextElement, ElementStyle } from "@/models";
import type { TextSelectionRange } from "./richText";

const FONT_SIZE_PRESETS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 120];
const DEFAULT_STROKE_COLOR = "#ffffff";
const DEFAULT_TEXT_SHADOW_COLOR = "#000000";
const DEFAULT_GRADIENT_FROM = "#f97316";
const DEFAULT_GRADIENT_TO = "#ec4899";
const LETTER_SPACING_MIN = -5;
const LETTER_SPACING_MAX = 32;
const LETTER_SPACING_STEP = 0.5;

/** Check if there's a text selection inside a contentEditable */
function hasSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.rangeCount > 0;
}

function safeColor(value: string | undefined, fallback: string): string {
  return value?.startsWith("#") ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function styleNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return clampNumber(typeof value === "number" ? value : fallback, min, max);
}

function shouldAllowNativeToolbarControl(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === "color";
}

function attrSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getSelectionRangeForElement(elementId: string): TextSelectionRange | null {
  const root = document.querySelector(
    `[data-rich-text-editor-id="${attrSelectorValue(elementId)}"]`,
  );
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const selected = range.toString().length;
  if (selected <= 0) return null;
  return { start, end: start + selected };
}

function applyCssToSelection(patch: Partial<ElementStyle>): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const span = document.createElement("span");
  if (patch.fontFamily) span.style.fontFamily = patch.fontFamily;
  if (patch.fontSize) span.style.fontSize = `${patch.fontSize}px`;
  if (patch.fontWeight) span.style.fontWeight = String(patch.fontWeight);
  if (patch.fontStyle) span.style.fontStyle = patch.fontStyle;
  if (patch.textDecoration) span.style.textDecoration = patch.textDecoration;
  if (patch.color) span.style.color = patch.color;
  if (patch.lineHeight != null) span.style.lineHeight = String(patch.lineHeight);
  if (patch.letterSpacing != null) span.style.letterSpacing = `${patch.letterSpacing}px`;
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.addRange(nextRange);
    return true;
  } catch {
    return false;
  }
}

interface TextToolbarProps {
  element: DesignTextElement;
  scale: number;
  canvasWidth: number;
  availableFontFamilies: string[];
  onUpdateStyle: (patch: Partial<ElementStyle>) => void;
  onUpdateTextRunStyle?: (range: TextSelectionRange, patch: Partial<ElementStyle>) => void;
  onUpdateText: (text: string) => void;
}

export function TextToolbar({
  element,
  canvasWidth,
  availableFontFamilies,
  onUpdateStyle,
  onUpdateTextRunStyle,
}: TextToolbarProps) {
  const style = element.style ?? {};
  const isBold = Number(style.fontWeight ?? 400) >= 600;
  const isItalic = style.fontStyle === "italic";
  const isUnderline = style.textDecoration?.includes("underline") ?? false;
  const isStrikethrough = style.textDecoration?.includes("line-through") ?? false;
  const textAlign = style.textAlign ?? "left";
  const hasOutline = Number(style.textStrokeWidth ?? 0) > 0;
  const hasGradient = Boolean(style.gradientEnabled);
  const hasTextShadow = Boolean(style.textShadowColor);
  const lineHeight = styleNumber(style.lineHeight, 1.2, 0.8, 3);
  const letterSpacing = styleNumber(style.letterSpacing, 0, LETTER_SPACING_MIN, LETTER_SPACING_MAX);

  const applyTextStyle = useCallback(
    (patch: Partial<ElementStyle>) => {
      const range = getSelectionRangeForElement(element.elementId);
      if (range && onUpdateTextRunStyle) {
        applyCssToSelection(patch);
        onUpdateTextRunStyle(range, patch);
        return;
      }
      onUpdateStyle(patch);
    },
    [element.elementId, onUpdateStyle, onUpdateTextRunStyle],
  );

  const toggleBold = useCallback(() => {
    if (hasSelection()) {
      applyTextStyle({ fontWeight: 700 });
    } else {
      onUpdateStyle({ fontWeight: isBold ? 400 : 700 });
    }
  }, [applyTextStyle, isBold, onUpdateStyle]);

  const toggleItalic = useCallback(() => {
    if (hasSelection()) {
      applyTextStyle({ fontStyle: "italic" });
    } else {
      onUpdateStyle({ fontStyle: isItalic ? "normal" : "italic" });
    }
  }, [applyTextStyle, isItalic, onUpdateStyle]);

  const toggleUnderline = useCallback(() => {
    if (hasSelection()) {
      applyTextStyle({ textDecoration: "underline" });
    } else {
      const base = style.textDecoration ?? "none";
      const hasU = base.includes("underline");
      const hasS = base.includes("line-through");
      if (hasU) {
        onUpdateStyle({ textDecoration: hasS ? "line-through" : "none" });
      } else {
        onUpdateStyle({ textDecoration: hasS ? "underline line-through" : "underline" });
      }
    }
  }, [applyTextStyle, style.textDecoration, onUpdateStyle]);

  const toggleStrikethrough = useCallback(() => {
    if (hasSelection()) {
      applyTextStyle({ textDecoration: "line-through" });
    } else {
      const base = style.textDecoration ?? "none";
      const hasU = base.includes("underline");
      const hasS = base.includes("line-through");
      if (hasS) {
        onUpdateStyle({ textDecoration: hasU ? "underline" : "none" });
      } else {
        onUpdateStyle({ textDecoration: hasU ? "underline line-through" : "line-through" });
      }
    }
  }, [applyTextStyle, style.textDecoration, onUpdateStyle]);

  const setAlign = useCallback(
    (align: "left" | "center" | "right") => {
      onUpdateStyle({ textAlign: align });
    },
    [onUpdateStyle],
  );

  const toggleOutline = useCallback(() => {
    onUpdateStyle({
      textStrokeWidth: hasOutline ? 0 : Math.max(2, Number(style.textStrokeWidth ?? 0)),
      textStrokeColor: style.textStrokeColor ?? DEFAULT_STROKE_COLOR,
    });
  }, [hasOutline, onUpdateStyle, style.textStrokeColor, style.textStrokeWidth]);

  const toggleGradient = useCallback(() => {
    onUpdateStyle({
      gradientEnabled: !hasGradient,
      gradientFrom: style.gradientFrom ?? DEFAULT_GRADIENT_FROM,
      gradientTo: style.gradientTo ?? DEFAULT_GRADIENT_TO,
      gradientAngle: style.gradientAngle ?? 90,
    });
  }, [hasGradient, onUpdateStyle, style.gradientAngle, style.gradientFrom, style.gradientTo]);

  const toggleTextShadow = useCallback(() => {
    onUpdateStyle({
      textShadowColor: hasTextShadow
        ? undefined
        : (style.textShadowColor ?? DEFAULT_TEXT_SHADOW_COLOR),
      textShadowBlur: hasTextShadow ? undefined : (style.textShadowBlur ?? 8),
      textShadowX: hasTextShadow ? undefined : (style.textShadowX ?? 2),
      textShadowY: hasTextShadow ? undefined : (style.textShadowY ?? 4),
      textShadow: hasTextShadow ? undefined : style.textShadow,
    });
  }, [
    hasTextShadow,
    onUpdateStyle,
    style.textShadow,
    style.textShadowBlur,
    style.textShadowColor,
    style.textShadowX,
    style.textShadowY,
  ]);

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-[-52px] z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-nowrap items-center gap-0.5 whitespace-nowrap rounded-lg border bg-card px-1 py-0.5 shadow-lg"
      style={{
        maxWidth: Math.max(280, canvasWidth - 24),
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!shouldAllowNativeToolbarControl(e.target)) {
          e.preventDefault();
        }
      }}
    >
      {/* Bold */}
      <Button
        size="icon"
        variant={isBold ? "default" : "ghost"}
        className="size-7"
        onClick={toggleBold}
        aria-pressed={isBold}
      >
        <Bold className="size-3.5" />
      </Button>

      {/* Italic */}
      <Button
        size="icon"
        variant={isItalic ? "default" : "ghost"}
        className="size-7"
        onClick={toggleItalic}
        aria-pressed={isItalic}
      >
        <Italic className="size-3.5" />
      </Button>

      {/* Underline */}
      <Button
        size="icon"
        variant={isUnderline ? "default" : "ghost"}
        className="size-7"
        onClick={toggleUnderline}
        aria-pressed={isUnderline}
      >
        <Underline className="size-3.5" />
      </Button>

      {/* Strikethrough */}
      <Button
        size="icon"
        variant={isStrikethrough ? "default" : "ghost"}
        className="size-7"
        onClick={toggleStrikethrough}
        aria-pressed={isStrikethrough}
      >
        <Strikethrough className="size-3.5" />
      </Button>

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Font family */}
      <Select
        value={String(style.fontFamily ?? "Be Vietnam Pro")}
        onValueChange={(value) => applyTextStyle({ fontFamily: value })}
      >
        <SelectTrigger className="h-7 w-[120px] gap-1 border-none px-1.5 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableFontFamilies.map((family) => (
            <SelectItem key={family} value={family} className="text-xs">
              <span style={{ fontFamily: family }}>{family}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Font size */}
      <Select
        value={String(style.fontSize ?? 48)}
        onValueChange={(value) => applyTextStyle({ fontSize: Number(value) })}
      >
        <SelectTrigger className="h-7 w-[56px] gap-0.5 border-none px-1.5 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_SIZE_PRESETS.map((size) => (
            <SelectItem key={size} value={String(size)} className="text-xs">
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Text align */}
      <Button
        size="icon"
        variant={textAlign === "left" ? "default" : "ghost"}
        className="size-7"
        onClick={() => setAlign("left")}
      >
        <AlignLeft className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant={textAlign === "center" ? "default" : "ghost"}
        className="size-7"
        onClick={() => setAlign("center")}
      >
        <AlignCenter className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant={textAlign === "right" ? "default" : "ghost"}
        className="size-7"
        onClick={() => setAlign("right")}
      >
        <AlignRight className="size-3.5" />
      </Button>

      {/* Color */}
      <div className="ml-0.5 flex items-center">
        <Label className="sr-only">Màu chữ</Label>
        <Input
          type="color"
          value={style.color ?? "#0f172a"}
          onInput={(event) => applyTextStyle({ color: event.currentTarget.value })}
          onChange={(event) => applyTextStyle({ color: event.target.value })}
          aria-label="Màu chữ"
          className="size-7 cursor-pointer rounded border p-0.5"
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Khoảng cách dòng"
            title="Khoảng cách dòng"
          >
            <AlignJustify className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-3"
          side="top"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Khoảng cách dòng</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {lineHeight.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[lineHeight]}
              min={0.8}
              max={3}
              step={0.05}
              onValueChange={([value]) => applyTextStyle({ lineHeight: value })}
            />
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={letterSpacing !== 0 ? "default" : "ghost"}
            className="size-7"
            aria-label="Giãn chữ"
            title="Giãn chữ"
          >
            <MoveHorizontal className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-3"
          side="top"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Giãn chữ</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {letterSpacing.toFixed(1)}px
              </span>
            </div>
            <Slider
              value={[letterSpacing]}
              min={LETTER_SPACING_MIN}
              max={LETTER_SPACING_MAX}
              step={LETTER_SPACING_STEP}
              onValueChange={([value]) => applyTextStyle({ letterSpacing: value })}
            />
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Khoảng</Label>
                <Input
                  type="number"
                  value={letterSpacing}
                  min={LETTER_SPACING_MIN}
                  max={LETTER_SPACING_MAX}
                  step={LETTER_SPACING_STEP}
                  onChange={(event) =>
                    applyTextStyle({
                      letterSpacing: clampNumber(
                        Number(event.target.value),
                        LETTER_SPACING_MIN,
                        LETTER_SPACING_MAX,
                      ),
                    })
                  }
                  className="h-8"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => applyTextStyle({ letterSpacing: 0 })}
              >
                Về 0
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="mx-0.5 h-5 w-px bg-border" />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={hasOutline ? "default" : "ghost"}
            className="size-7"
            aria-label="Viền chữ"
            title="Viền chữ"
          >
            <TypeOutline className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-3"
          side="top"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Viền chữ</Label>
              <Button
                size="sm"
                variant={hasOutline ? "default" : "outline"}
                onClick={toggleOutline}
              >
                {hasOutline ? "Bật" : "Tắt"}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Độ dày</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {Number(style.textStrokeWidth ?? 0)}px
                </span>
              </div>
              <Slider
                value={[Number(style.textStrokeWidth ?? 0)]}
                min={0}
                max={12}
                step={1}
                onValueChange={([value]) =>
                  onUpdateStyle({
                    textStrokeWidth: value,
                    textStrokeColor: style.textStrokeColor ?? DEFAULT_STROKE_COLOR,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Màu</Label>
              <Input
                type="color"
                value={safeColor(style.textStrokeColor, DEFAULT_STROKE_COLOR)}
                onChange={(event) =>
                  onUpdateStyle({
                    textStrokeColor: event.target.value,
                    textStrokeWidth: hasOutline ? style.textStrokeWidth : 2,
                  })
                }
                className="h-8 w-12 cursor-pointer p-1"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={hasGradient ? "default" : "ghost"}
            className="size-7"
            aria-label="Màu chuyển"
            title="Màu chuyển"
          >
            <Blend className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-3"
          side="top"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Màu chuyển</Label>
              <Button
                size="sm"
                variant={hasGradient ? "default" : "outline"}
                onClick={toggleGradient}
              >
                {hasGradient ? "Bật" : "Tắt"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Từ</Label>
                <Input
                  type="color"
                  value={safeColor(style.gradientFrom, DEFAULT_GRADIENT_FROM)}
                  onChange={(event) =>
                    onUpdateStyle({
                      gradientEnabled: true,
                      gradientFrom: event.target.value,
                      gradientTo: style.gradientTo ?? DEFAULT_GRADIENT_TO,
                    })
                  }
                  className="h-8 cursor-pointer p-1"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Đến</Label>
                <Input
                  type="color"
                  value={safeColor(style.gradientTo, DEFAULT_GRADIENT_TO)}
                  onChange={(event) =>
                    onUpdateStyle({
                      gradientEnabled: true,
                      gradientFrom: style.gradientFrom ?? DEFAULT_GRADIENT_FROM,
                      gradientTo: event.target.value,
                    })
                  }
                  className="h-8 cursor-pointer p-1"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Góc</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {style.gradientAngle ?? 90}°
                </span>
              </div>
              <Slider
                value={[style.gradientAngle ?? 90]}
                min={0}
                max={360}
                step={15}
                onValueChange={([value]) =>
                  onUpdateStyle({
                    gradientEnabled: true,
                    gradientFrom: style.gradientFrom ?? DEFAULT_GRADIENT_FROM,
                    gradientTo: style.gradientTo ?? DEFAULT_GRADIENT_TO,
                    gradientAngle: value,
                  })
                }
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={hasTextShadow ? "default" : "ghost"}
            className="size-7"
            aria-label="Bóng chữ"
            title="Bóng chữ"
          >
            <Sparkles className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-3"
          side="top"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Bóng chữ</Label>
              <Button
                size="sm"
                variant={hasTextShadow ? "default" : "outline"}
                onClick={toggleTextShadow}
              >
                {hasTextShadow ? "Bật" : "Tắt"}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Màu</Label>
              <Input
                type="color"
                value={safeColor(style.textShadowColor, DEFAULT_TEXT_SHADOW_COLOR)}
                onChange={(event) =>
                  onUpdateStyle({
                    textShadowColor: event.target.value,
                    textShadowBlur: style.textShadowBlur ?? 8,
                    textShadowX: style.textShadowX ?? 2,
                    textShadowY: style.textShadowY ?? 4,
                  })
                }
                className="h-8 w-12 cursor-pointer p-1"
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Mờ</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {Number(style.textShadowBlur ?? 8)}px
                </span>
              </div>
              <Slider
                value={[Number(style.textShadowBlur ?? 8)]}
                min={0}
                max={40}
                step={1}
                onValueChange={([value]) =>
                  onUpdateStyle({
                    textShadowColor: style.textShadowColor ?? DEFAULT_TEXT_SHADOW_COLOR,
                    textShadowBlur: value,
                    textShadowX: style.textShadowX ?? 2,
                    textShadowY: style.textShadowY ?? 4,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">X</Label>
                <Input
                  type="number"
                  value={Number(style.textShadowX ?? 2)}
                  onChange={(event) =>
                    onUpdateStyle({
                      textShadowColor: style.textShadowColor ?? DEFAULT_TEXT_SHADOW_COLOR,
                      textShadowBlur: style.textShadowBlur ?? 8,
                      textShadowX: Number(event.target.value),
                      textShadowY: style.textShadowY ?? 4,
                    })
                  }
                  className="h-8"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Y</Label>
                <Input
                  type="number"
                  value={Number(style.textShadowY ?? 4)}
                  onChange={(event) =>
                    onUpdateStyle({
                      textShadowColor: style.textShadowColor ?? DEFAULT_TEXT_SHADOW_COLOR,
                      textShadowBlur: style.textShadowBlur ?? 8,
                      textShadowX: style.textShadowX ?? 2,
                      textShadowY: Number(event.target.value),
                    })
                  }
                  className="h-8"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
