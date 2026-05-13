// Floating text formatting toolbar — hiện trên text element khi đang edit hoặc select text.
// Khi contentEditable đang active, dùng execCommand để format selection.
// Khi không edit, cập nhật element style trực tiếp.
import { useCallback } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  Blend,
  Bold,
  Circle,
  Eye,
  Italic,
  Minus,
  MoveHorizontal,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareDashed,
  Strikethrough,
  TypeOutline,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "./ColorPicker";
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
import type { DesignShapeElement, DesignTextElement, ElementStyle } from "@/models";
import type { TextSelectionRange } from "./richText";
import { TEXT_EFFECT_PRESETS, buildTextEffectPatch, type TextEffectPreset } from "./textEffects";

const FONT_SIZE_PRESETS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 120];
const DEFAULT_STROKE_COLOR = "#ffffff";
const DEFAULT_TEXT_SHADOW_COLOR = "#000000";
const DEFAULT_GRADIENT_FROM = "#f97316";
const DEFAULT_GRADIENT_TO = "#ec4899";
const LETTER_SPACING_MIN = -5;
const LETTER_SPACING_MAX = 32;
const LETTER_SPACING_STEP = 0.5;
const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 300;
const FONT_SIZE_STEP = 2;
const TEXT_TRANSFORM_OPTIONS: Array<{
  value: NonNullable<ElementStyle["textTransform"]>;
  label: string;
}> = [
  { value: "none", label: "Aa" },
  { value: "uppercase", label: "AA" },
  { value: "lowercase", label: "aa" },
  { value: "capitalize", label: "Aa Từng từ" },
];

/** Check if there's a text selection inside a contentEditable */
function hasSelection(): boolean {
  if (typeof window === "undefined") return false;
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

function buildPreviewStyleForPreset(preset: TextEffectPreset): React.CSSProperties {
  const s = preset.style;
  const style: React.CSSProperties = {
    color: s.color ?? "#0f172a",
  };
  if (s.gradientEnabled && s.gradientFrom && s.gradientTo) {
    style.background = `linear-gradient(${s.gradientAngle ?? 135}deg, ${s.gradientFrom}, ${s.gradientTo})`;
    style.WebkitBackgroundClip = "text";
    style.backgroundClip = "text";
    style.color = "transparent";
  }
  if (s.textShadowColor) {
    const x = s.textShadowX ?? 0;
    const y = s.textShadowY ?? 0;
    const blur = s.textShadowBlur ?? 0;
    style.textShadow = `${x}px ${y}px ${blur}px ${s.textShadowColor}`;
  }
  if (s.textStrokeColor && Number(s.textStrokeWidth ?? 0) > 0) {
    (style as React.CSSProperties & { WebkitTextStroke?: string }).WebkitTextStroke = `${s.textStrokeWidth}px ${s.textStrokeColor}`;
  }
  return style;
}

function ToolbarColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={label} title={label}>
          <span className="size-4 rounded-sm border" style={{ background: value }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        side="top"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ColorPicker value={value} onChange={onChange} onPreview={onChange} onCommit={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function attrSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getSelectionRangeForElement(elementId: string): TextSelectionRange | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
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
  if (typeof document === "undefined" || typeof window === "undefined") return false;
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
  if (patch.textTransform) span.style.textTransform = patch.textTransform;
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
  element: DesignTextElement | DesignShapeElement;
  availableFontFamilies: string[];
  onUpdateStyle: (patch: Partial<ElementStyle>) => void;
  onUpdateElement?: (patch: Partial<DesignShapeElement>) => void;
  onUpdateTextRunStyle?: (range: TextSelectionRange, patch: Partial<ElementStyle>) => void;
  onUpdateText: (text: string) => void;
  mode?: "auto" | "text" | "shape";
}

export function TextToolbar({
  element,
  availableFontFamilies,
  onUpdateStyle,
  onUpdateElement,
  onUpdateTextRunStyle,
  mode = "auto",
}: TextToolbarProps) {
  const style = element.style ?? {};
  const showShapeControls = element.kind === "shape" && mode !== "text";
  const isLine =
    element.kind === "shape" && (element.shapeKind === "line" || element.shapeKind === "divider");
  const isBold = Number(style.fontWeight ?? 400) >= 600;
  const isItalic = style.fontStyle === "italic";
  const isUnderline = style.textDecoration?.includes("underline") ?? false;
  const isStrikethrough = style.textDecoration?.includes("line-through") ?? false;
  const textAlign = style.textAlign ?? "left";
  const textVerticalAlign = style.textVerticalAlign ?? "top";
  const hasOutline = Number(style.textStrokeWidth ?? 0) > 0;
  const hasGradient = Boolean(style.gradientEnabled);
  const hasTextShadow = Boolean(style.textShadowColor);
  const lineHeight = styleNumber(style.lineHeight, 1.2, 0.8, 3);
  const letterSpacing = styleNumber(style.letterSpacing, 0, LETTER_SPACING_MIN, LETTER_SPACING_MAX);
  const fontSize = styleNumber(style.fontSize, 48, FONT_SIZE_MIN, FONT_SIZE_MAX);
  const fontSizeOptions = Array.from(new Set([...FONT_SIZE_PRESETS, Math.round(fontSize)])).sort(
    (a, b) => a - b,
  );
  const opacity = styleNumber(style.opacity, 1, 0, 1);
  const textTransform = style.textTransform ?? "none";
  const shapeStrokeWidth = styleNumber(
    isLine ? style.strokeWidth : style.borderWidth,
    isLine ? 4 : 0,
    0,
    32,
  );
  const shapeRadius = styleNumber(style.borderRadius, 0, 0, 240);
  const shapeFill = safeColor(style.fill, isLine ? "#0f172a" : "#f97316");
  const shapeBorderColor = safeColor(style.borderColor, "#0f172a");

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

  const setVerticalAlign = useCallback(
    (align: NonNullable<ElementStyle["textVerticalAlign"]>) => {
      onUpdateStyle({ textVerticalAlign: align });
    },
    [onUpdateStyle],
  );

  const setShapeKind = useCallback(
    (shapeKind: NonNullable<DesignShapeElement["shapeKind"]>) => {
      if (element.kind !== "shape" || !onUpdateElement) return;
      const stylePatch: Partial<ElementStyle> = {};
      if (shapeKind === "circle") {
        stylePatch.borderRadius = 9999;
      } else if (shapeKind === "line" || shapeKind === "divider") {
        stylePatch.fill = style.fill ?? "#0f172a";
        stylePatch.strokeWidth = Math.max(2, Number(style.strokeWidth ?? 4));
        stylePatch.borderWidth = undefined;
      } else {
        stylePatch.borderRadius = Math.min(Number(style.borderRadius ?? 18), 160);
      }

      onUpdateElement({
        shapeKind,
        height:
          shapeKind === "line" || shapeKind === "divider"
            ? Math.max(12, element.height)
            : element.height,
        style: {
          ...(element.style ?? {}),
          ...stylePatch,
        },
      });
    },
    [
      element.height,
      element.style,
      element.kind,
      onUpdateElement,
      style.borderRadius,
      style.fill,
      style.strokeWidth,
    ],
  );

  const updateFontSize = useCallback(
    (nextSize: number) => {
      applyTextStyle({
        fontSize: clampNumber(Math.round(nextSize), FONT_SIZE_MIN, FONT_SIZE_MAX),
      });
    },
    [applyTextStyle],
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
      className="pointer-events-auto absolute left-1/2 top-[-68px] z-50 flex w-max -translate-x-1/2 flex-nowrap items-center gap-0.5 overflow-visible whitespace-nowrap rounded-md bg-card/95 px-1 py-0.5 shadow-lg ring-1 ring-border/70"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {showShapeControls ? (
        <>
          <Button
            size="icon"
            variant={!isLine && element.shapeKind !== "circle" ? "default" : "ghost"}
            className="size-7"
            onClick={() => setShapeKind("rectangle")}
            aria-label="Chữ nhật"
            title="Chữ nhật"
          >
            <Square className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant={element.shapeKind === "circle" ? "default" : "ghost"}
            className="size-7"
            onClick={() => setShapeKind("circle")}
            aria-label="Hình tròn"
            title="Hình tròn"
          >
            <Circle className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant={isLine ? "default" : "ghost"}
            className="size-7"
            onClick={() => setShapeKind("line")}
            aria-label="Đường thẳng"
            title="Đường thẳng"
          >
            <Minus className="size-3.5" />
          </Button>

          <div className="mx-0.5 h-5 w-px bg-border" />

          <ToolbarColorInput
            label={isLine ? "Màu đường" : "Màu nền"}
            value={shapeFill}
            onChange={(color) => onUpdateStyle({ fill: color })}
          />

          {!isLine ? (
            <ToolbarColorInput
              label="Màu viền"
              value={shapeBorderColor}
              onChange={(color) =>
                onUpdateStyle({
                  borderColor: color,
                  borderWidth: Math.max(1, Number(style.borderWidth ?? 2)),
                  borderStyle: style.borderStyle ?? "solid",
                })
              }
            />
          ) : null}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant={shapeStrokeWidth > 0 ? "default" : "ghost"}
                className="size-7"
                aria-label={isLine ? "Độ dày đường" : "Độ dày viền"}
                title={isLine ? "Độ dày đường" : "Độ dày viền"}
              >
                <SlidersHorizontal className="size-3.5" />
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
                  <Label className="text-xs font-medium">
                    {isLine ? "Độ dày đường" : "Độ dày viền"}
                  </Label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(shapeStrokeWidth)}px
                  </span>
                </div>
                <Slider
                  value={[shapeStrokeWidth]}
                  min={0}
                  max={32}
                  step={1}
                  onValueChange={([value]) =>
                    onUpdateStyle(
                      isLine
                        ? { strokeWidth: value }
                        : {
                            borderWidth: value,
                            borderColor: style.borderColor ?? "#0f172a",
                            borderStyle: style.borderStyle ?? "solid",
                          },
                    )
                  }
                />
                {!isLine ? (
                  <Select
                    value={style.borderStyle ?? "solid"}
                    onValueChange={(value) =>
                      onUpdateStyle({
                        borderStyle: value as ElementStyle["borderStyle"],
                        borderWidth: Math.max(1, Number(style.borderWidth ?? 2)),
                        borderColor: style.borderColor ?? "#0f172a",
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="solid">Liền</SelectItem>
                      <SelectItem value="dashed">Đứt đoạn</SelectItem>
                      <SelectItem value="dotted">Chấm</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>

          {!isLine ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant={element.shapeKind === "circle" || shapeRadius > 0 ? "default" : "ghost"}
                  className="size-7"
                  aria-label="Bo góc"
                  title="Bo góc"
                >
                  <SquareDashed className="size-3.5" />
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
                    <Label className="text-xs font-medium">Bo góc</Label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {element.shapeKind === "circle" ? "tròn" : `${Math.round(shapeRadius)}px`}
                    </span>
                  </div>
                  <Slider
                    value={[element.shapeKind === "circle" ? 160 : shapeRadius]}
                    min={0}
                    max={160}
                    step={2}
                    onValueChange={([value]) => onUpdateStyle({ borderRadius: value })}
                  />
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant={opacity < 1 ? "default" : "ghost"}
                className="size-7"
                aria-label="Độ mờ"
                title="Độ mờ"
              >
                <Eye className="size-3.5" />
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
                  <Label className="text-xs font-medium">Độ mờ</Label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <Slider
                  value={[opacity]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={([value]) => onUpdateStyle({ opacity: value })}
                />
              </div>
            </PopoverContent>
          </Popover>
        </>
      ) : (
        <>
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
      <div className="flex h-7 items-center rounded-md border bg-background">
        <Button
          size="icon"
          variant="ghost"
          className="size-7 rounded-r-none"
          onClick={() => updateFontSize(fontSize - FONT_SIZE_STEP)}
          aria-label="Giảm cỡ chữ"
          title="Giảm cỡ chữ"
        >
          <Minus className="size-3.5" />
        </Button>
        <input
          type="number"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          value={Math.round(fontSize)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) updateFontSize(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          list="font-size-presets"
          className="h-7 w-[56px] border-x border-y-0 bg-transparent px-1.5 text-center text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label="Cỡ chữ"
        />
        <datalist id="font-size-presets">
          {fontSizeOptions.map((size) => (
            <option key={size} value={size} />
          ))}
        </datalist>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 rounded-l-none"
          onClick={() => updateFontSize(fontSize + FONT_SIZE_STEP)}
          aria-label="Tăng cỡ chữ"
          title="Tăng cỡ chữ"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

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

      <div className="mx-0.5 h-5 w-px bg-border" />

      <Button
        size="icon"
        variant={textVerticalAlign === "top" ? "default" : "ghost"}
        className="size-7"
        onClick={() => setVerticalAlign("top")}
        aria-label="Chữ lên trên"
        title="Chữ lên trên"
      >
        <AlignStartHorizontal className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant={textVerticalAlign === "middle" ? "default" : "ghost"}
        className="size-7"
        onClick={() => setVerticalAlign("middle")}
        aria-label="Chữ giữa khung"
        title="Chữ giữa khung"
      >
        <AlignCenterHorizontal className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant={textVerticalAlign === "bottom" ? "default" : "ghost"}
        className="size-7"
        onClick={() => setVerticalAlign("bottom")}
        aria-label="Chữ xuống cuối khung"
        title="Chữ xuống cuối khung"
      >
        <AlignEndHorizontal className="size-3.5" />
      </Button>

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Vertical writing mode + curve controls */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={
              style.textLayout && style.textLayout !== "horizontal"
                ? "default"
                : Math.abs(style.textCurve ?? 0) > 0
                  ? "default"
                  : "ghost"
            }
            className="size-7"
            aria-label="Hướng / cong chữ"
            title="Hướng chữ và text curve"
          >
            <span className="text-[11px] font-bold leading-none">↕</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" side="bottom" align="end">
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium">Hướng chữ</Label>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <Button
                  size="sm"
                  variant={
                    !style.textLayout || style.textLayout === "horizontal"
                      ? "default"
                      : "outline"
                  }
                  onClick={() => onUpdateStyle({ textLayout: "horizontal" })}
                  className="h-7 text-xs"
                >
                  Ngang
                </Button>
                <Button
                  size="sm"
                  variant={style.textLayout === "vertical-rl" ? "default" : "outline"}
                  onClick={() => onUpdateStyle({ textLayout: "vertical-rl" })}
                  className="h-7 text-xs"
                  title="Trên xuống, cột phải → trái"
                >
                  Dọc RL
                </Button>
                <Button
                  size="sm"
                  variant={style.textLayout === "vertical-lr" ? "default" : "outline"}
                  onClick={() => onUpdateStyle({ textLayout: "vertical-lr" })}
                  className="h-7 text-xs"
                  title="Trên xuống, cột trái → phải"
                >
                  Dọc LR
                </Button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Cong chữ</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(style.textCurve ?? 0)}°
                </span>
              </div>
              <Slider
                value={[style.textCurve ?? 0]}
                min={-170}
                max={170}
                step={5}
                onValueChange={([value]) => onUpdateStyle({ textCurve: value })}
                className="mt-1"
              />
              <div className="mt-1 flex justify-between gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 flex-1 text-[10px]"
                  onClick={() => onUpdateStyle({ textCurve: -90 })}
                >
                  Cười
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 flex-1 text-[10px]"
                  onClick={() => onUpdateStyle({ textCurve: 0 })}
                >
                  Phẳng
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 flex-1 text-[10px]"
                  onClick={() => onUpdateStyle({ textCurve: 90 })}
                >
                  Khóc
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Dùng cho text ngắn, không tương thích với rich-text run riêng lẻ.
              </p>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Color */}
      <div className="ml-0.5 flex items-center">
        <Label className="sr-only">Màu chữ</Label>
        <ToolbarColorInput
          label="Màu chữ"
          value={style.color ?? "#0f172a"}
          onChange={(color) => applyTextStyle({ color })}
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={textTransform !== "none" ? "default" : "ghost"}
            className="size-7"
            aria-label="Kiểu chữ hoa thường"
            title="Kiểu chữ hoa thường"
          >
            <span className="text-[11px] font-bold leading-none">Aa</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-44 p-2"
          side="top"
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-1">
            {TEXT_TRANSFORM_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={textTransform === option.value ? "default" : "ghost"}
                className="h-8 justify-start"
                onClick={() => applyTextStyle({ textTransform: option.value })}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

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

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={opacity < 1 ? "default" : "ghost"}
            className="size-7"
            aria-label="Độ mờ"
            title="Độ mờ"
          >
            <Eye className="size-3.5" />
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
              <Label className="text-xs font-medium">Độ mờ</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {Math.round(opacity * 100)}%
              </span>
            </div>
            <Slider
              value={[opacity]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={([value]) => onUpdateStyle({ opacity: value })}
            />
          </div>
        </PopoverContent>
      </Popover>

      <div className="mx-0.5 h-5 w-px bg-border" />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Hiệu ứng chữ"
            title="Hiệu ứng chữ (neon, outline, gradient…)"
          >
            <Sparkles className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" side="bottom" align="end">
          <div className="mb-1 flex items-center justify-between px-1">
            <Label className="text-xs font-medium">Hiệu ứng chữ</Label>
            <button
              type="button"
              onClick={() =>
                onUpdateStyle(buildTextEffectPatch(TEXT_EFFECT_PRESETS[0]))
              }
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {TEXT_EFFECT_PRESETS.filter((preset) => preset.id !== "none").map((preset) => {
              const previewStyle = buildPreviewStyleForPreset(preset);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onUpdateStyle(buildTextEffectPatch(preset))}
                  className="group flex flex-col items-start gap-1 rounded-md border bg-background px-2 py-1.5 text-left transition-colors hover:border-primary hover:bg-accent"
                  title={preset.description}
                >
                  <span
                    className="text-sm font-bold leading-tight"
                    style={previewStyle}
                  >
                    Aa
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">
                    {preset.label}
                  </span>
                </button>
              );
            })}
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
              <ToolbarColorInput
                label="Màu viền chữ"
                value={safeColor(style.textStrokeColor, DEFAULT_STROKE_COLOR)}
                onChange={(color) =>
                  onUpdateStyle({
                    textStrokeColor: color,
                    textStrokeWidth: hasOutline ? style.textStrokeWidth : 2,
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
                <ToolbarColorInput
                  label="Từ"
                  value={safeColor(style.gradientFrom, DEFAULT_GRADIENT_FROM)}
                  onChange={(color) =>
                    onUpdateStyle({
                      gradientEnabled: true,
                      gradientFrom: color,
                      gradientTo: style.gradientTo ?? DEFAULT_GRADIENT_TO,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Đến</Label>
                <ToolbarColorInput
                  label="Đến"
                  value={safeColor(style.gradientTo, DEFAULT_GRADIENT_TO)}
                  onChange={(color) =>
                    onUpdateStyle({
                      gradientEnabled: true,
                      gradientFrom: style.gradientFrom ?? DEFAULT_GRADIENT_FROM,
                      gradientTo: color,
                    })
                  }
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
              <ToolbarColorInput
                label="Màu bóng chữ"
                value={safeColor(style.textShadowColor, DEFAULT_TEXT_SHADOW_COLOR)}
                onChange={(color) =>
                  onUpdateStyle({
                    textShadowColor: color,
                    textShadowBlur: style.textShadowBlur ?? 8,
                    textShadowX: style.textShadowX ?? 2,
                    textShadowY: style.textShadowY ?? 4,
                  })
                }
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
        </>
      )}
    </div>
  );
}
