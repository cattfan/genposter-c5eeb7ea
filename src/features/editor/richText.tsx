import type { CSSProperties, ReactNode } from "react";
import type { DesignTextRun, ElementStyle, Slot } from "@/models";
import { buildTextStyle } from "@/engines/binding/dataBinding";

export interface TextSelectionRange {
  start: number;
  end: number;
}

interface TextSegment {
  start: number;
  end: number;
  style: Partial<ElementStyle>;
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length, Math.floor(value)));
}

function cleanStyle(style: Partial<ElementStyle>): Partial<ElementStyle> {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  ) as Partial<ElementStyle>;
}

function styleKey(style: Partial<ElementStyle>): string {
  return JSON.stringify(cleanStyle(style));
}

export function normalizeTextRuns(textLength: number, runs: DesignTextRun[] = []): TextSegment[] {
  const length = Math.max(0, textLength);
  if (length === 0) return [];
  let segments: TextSegment[] = [{ start: 0, end: length, style: {} }];

  const splitAt = (index: number) => {
    if (index <= 0 || index >= length) return;
    segments = segments.flatMap((segment) => {
      if (index <= segment.start || index >= segment.end) return [segment];
      return [
        { ...segment, end: index },
        { ...segment, start: index },
      ];
    });
  };

  for (const run of runs) {
    const start = clampIndex(run.start, length);
    const end = clampIndex(run.end, length);
    if (end <= start) continue;
    splitAt(start);
    splitAt(end);
    segments = segments.map((segment) =>
      segment.start >= start && segment.end <= end
        ? { ...segment, style: cleanStyle({ ...segment.style, ...run.style }) }
        : segment,
    );
  }

  return mergeTextSegments(segments);
}

function mergeTextSegments(segments: TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    if (segment.end <= segment.start) continue;
    const prev = merged.at(-1);
    if (prev && prev.end === segment.start && styleKey(prev.style) === styleKey(segment.style)) {
      prev.end = segment.end;
    } else {
      merged.push({ ...segment, style: cleanStyle(segment.style) });
    }
  }
  return merged;
}

export function applyTextRunStyle(
  text: string,
  runs: DesignTextRun[] | undefined,
  range: TextSelectionRange,
  patch: Partial<ElementStyle>,
): DesignTextRun[] {
  const length = text.length;
  const start = clampIndex(Math.min(range.start, range.end), length);
  const end = clampIndex(Math.max(range.start, range.end), length);
  if (end <= start) return runs ?? [];

  const segments = normalizeTextRuns(length, runs);
  const withBreaks = normalizeTextRuns(length, [
    ...segments.map((segment) => ({ ...segment, runId: undefined })),
    { start, end, style: patch },
  ]);

  return withBreaks
    .filter((segment) => Object.keys(cleanStyle(segment.style)).length > 0)
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      style: cleanStyle(segment.style),
    }));
}

function inlineTextStyle(style: Slot["style"] | ElementStyle | undefined, scale: number) {
  const css = buildTextStyle(style as Slot["style"], scale) as CSSProperties & {
    WebkitBoxOrient?: string;
    WebkitLineClamp?: number;
  };
  delete css.padding;
  delete css.background;
  delete css.backgroundImage;
  delete css.backgroundClip;
  delete css.display;
  delete css.overflow;
  delete css.WebkitBoxOrient;
  delete css.WebkitLineClamp;
  return css;
}

export function renderRichTextRuns(params: {
  text: string;
  runs?: DesignTextRun[];
  baseStyle?: ElementStyle | Slot["style"];
  scale: number;
  fallback?: string;
}): ReactNode {
  const { text, runs, baseStyle, scale, fallback } = params;
  if (fallback != null && fallback !== text) return fallback;
  if (!runs?.length) return fallback ?? text;
  const segments = normalizeTextRuns(text.length, runs);
  if (segments.length <= 1 && Object.keys(segments[0]?.style ?? {}).length === 0) {
    return fallback ?? text;
  }
  return segments.map((segment, index) => (
    <span
      key={`${segment.start}:${segment.end}:${index}`}
      style={inlineTextStyle({ ...(baseStyle ?? {}), ...segment.style }, scale)}
    >
      {text.slice(segment.start, segment.end)}
    </span>
  ));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styleToInlineCss(style: Partial<ElementStyle>): string {
  const parts: string[] = [];
  if (style.fontFamily) {
    const family = String(style.fontFamily).replace(/["']/g, "");
    parts.push(`font-family:'${family}'`);
  }
  if (style.fontSize) parts.push(`font-size:${Number(style.fontSize)}px`);
  if (style.fontWeight) parts.push(`font-weight:${style.fontWeight}`);
  if (style.fontStyle) parts.push(`font-style:${style.fontStyle}`);
  if (style.textDecoration) parts.push(`text-decoration:${style.textDecoration}`);
  if (style.color) parts.push(`color:${style.color}`);
  if (typeof style.lineHeight === "number" && Number.isFinite(style.lineHeight)) {
    parts.push(`line-height:${style.lineHeight}`);
  }
  if (typeof style.letterSpacing === "number" && Number.isFinite(style.letterSpacing)) {
    parts.push(`letter-spacing:${style.letterSpacing}px`);
  }
  return parts.join(";");
}

function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function richTextToHtml(
  text: string,
  runs: DesignTextRun[] | undefined,
  baseStyle?: ElementStyle,
): string {
  if (!runs?.length) return textToHtml(text);
  return normalizeTextRuns(text.length, runs)
    .map((segment) => {
      const chunk = textToHtml(text.slice(segment.start, segment.end));
      const css = styleToInlineCss({ ...(baseStyle ?? {}), ...segment.style });
      return css ? `<span style="${escapeHtml(css)}">${chunk}</span>` : chunk;
    })
    .join("");
}

function fontFamily(value: string): string {
  return value
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function collectElementStyle(element: HTMLElement): Partial<ElementStyle> {
  const tag = element.tagName.toLowerCase();
  const style: Partial<ElementStyle> = {};
  if (tag === "b" || tag === "strong") style.fontWeight = 700;
  if (tag === "i" || tag === "em") style.fontStyle = "italic";
  if (tag === "u") style.textDecoration = "underline";
  if (tag === "s" || tag === "strike") style.textDecoration = "line-through";

  const face = element.getAttribute("face");
  const color = element.getAttribute("color");
  if (face) style.fontFamily = fontFamily(face);
  if (color) style.color = color;
  if (element.style.fontFamily) style.fontFamily = fontFamily(element.style.fontFamily);
  if (element.style.fontSize) {
    const size = Number.parseFloat(element.style.fontSize);
    if (Number.isFinite(size)) style.fontSize = size;
  }
  if (element.style.fontWeight) style.fontWeight = element.style.fontWeight;
  if (element.style.fontStyle) style.fontStyle = element.style.fontStyle as ElementStyle["fontStyle"];
  if (element.style.color) style.color = element.style.color;
  if (element.style.textDecoration) {
    style.textDecoration = element.style.textDecoration as ElementStyle["textDecoration"];
  }
  if (element.style.lineHeight) {
    const lineHeight = Number.parseFloat(element.style.lineHeight);
    if (Number.isFinite(lineHeight)) style.lineHeight = lineHeight;
  }
  if (element.style.letterSpacing) {
    const letterSpacing = Number.parseFloat(element.style.letterSpacing);
    if (Number.isFinite(letterSpacing)) style.letterSpacing = letterSpacing;
  }
  return cleanStyle(style);
}

export function parseRichTextEditorContent(root: HTMLElement): {
  text: string;
  textRuns: DesignTextRun[];
} {
  let text = "";
  const runs: DesignTextRun[] = [];

  const visit = (node: Node, inherited: Partial<ElementStyle>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (!value) return;
      const start = text.length;
      text += value;
      const end = text.length;
      const style = cleanStyle(inherited);
      if (Object.keys(style).length > 0) runs.push({ start, end, style });
      return;
    }

    if (!(node instanceof HTMLElement)) return;
    if (node.tagName.toLowerCase() === "br") {
      text += "\n";
      return;
    }
    const nextStyle = cleanStyle({ ...inherited, ...collectElementStyle(node) });
    node.childNodes.forEach((child) => visit(child, nextStyle));
  };

  root.childNodes.forEach((node) => visit(node, {}));
  return { text, textRuns: normalizeTextRuns(text.length, runs) };
}
