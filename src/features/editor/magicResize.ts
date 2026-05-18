// Magic Resize — đổi canvas size + tự động reflow elements.
//
// Algorithm:
// 1. Scale position (x, y) theo ratio mới/cũ
// 2. Scale size (width, height) theo ratio
// 3. Giữ nguyên font size (không scale text) — chỉ scale position
// 4. Background image: giữ nguyên (browser sẽ scale-to-fill qua CSS)
//
// Trả về DesignDocument mới (không mutate input).

import type { DesignDocument, DesignElement, DesignPage } from "@/models";

export interface ResizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESIZE_PRESETS: ResizePreset[] = [
  { id: "ig-post", label: "Instagram Post", width: 1080, height: 1080 },
  { id: "ig-story", label: "Instagram Story", width: 1080, height: 1920 },
  { id: "fb-cover", label: "Facebook Cover", width: 820, height: 312 },
  { id: "fb-post", label: "Facebook Post", width: 1200, height: 630 },
  { id: "tiktok", label: "TikTok / Reels", width: 1080, height: 1920 },
  { id: "youtube-thumb", label: "YouTube Thumbnail", width: 1280, height: 720 },
  { id: "a4-portrait", label: "A4 Dọc", width: 2480, height: 3508 },
  { id: "a4-landscape", label: "A4 Ngang", width: 3508, height: 2480 },
  { id: "poster-dalat", label: "Poster Đà Lạt (1588×2248)", width: 1588, height: 2248 },
];

export interface ResizeOptions {
  /** Scale font size theo ratio hay giữ nguyên. Default: false (giữ nguyên). */
  scaleText?: boolean;
}

/**
 * Resize document: đổi canvas size của active page + reflow tất cả elements.
 * Trả về document mới (immutable).
 */
export function resizeDocument(
  document: DesignDocument,
  newWidth: number,
  newHeight: number,
  options: ResizeOptions = {},
): DesignDocument {
  const scaleText = options.scaleText ?? false;
  const activePage = document.pages.find((p) => p.pageId === document.activePageId) ?? document.pages[0];
  if (!activePage) return document;

  const oldWidth = activePage.width;
  const oldHeight = activePage.height;
  if (oldWidth === newWidth && oldHeight === newHeight) return document;

  const scaleX = newWidth / Math.max(1, oldWidth);
  const scaleY = newHeight / Math.max(1, oldHeight);

  // Update page dimensions
  const newPages: DesignPage[] = document.pages.map((page) => {
    if (page.pageId !== activePage.pageId) return page;
    return { ...page, width: newWidth, height: newHeight };
  });

  // Reflow elements on active page
  const newElements: DesignElement[] = document.elements.map((element) => {
    if (element.pageId !== activePage.pageId) return element;
    return reflowElement(element, scaleX, scaleY, scaleText);
  });

  return {
    ...document,
    pages: newPages,
    elements: newElements,
    updatedAt: Date.now(),
  };
}

function reflowElement(
  element: DesignElement,
  scaleX: number,
  scaleY: number,
  scaleText: boolean,
): DesignElement {
  const next: DesignElement = {
    ...element,
    x: Math.round(element.x * scaleX),
    y: Math.round(element.y * scaleY),
    width: Math.round(element.width * scaleX),
    height: Math.round(element.height * scaleY),
  };

  // Scale font size nếu option bật
  if (scaleText && element.style?.fontSize) {
    const avgScale = (scaleX + scaleY) / 2;
    next.style = {
      ...element.style,
      fontSize: Math.round(element.style.fontSize * avgScale),
    };
  }

  return next;
}
