// Preload Google Fonts stylesheet + inline every @font-face src URL as a
// data URI so html-to-image can embed fonts without hitting the
// cross-origin `cssRules` SecurityError on fonts.googleapis.com.
//
// Google Fonts serves CSS that references woff2 files on fonts.gstatic.com.
// Both are CORS-enabled for `fetch` but NOT for `CSSStyleSheet.cssRules`,
// which is what html-to-image's default web-font scanner uses.
import { buildGoogleFontsUrl } from "@/features/editor/fonts";

let cachedCss: string | null = null;
let pendingPromise: Promise<string> | null = null;

async function fetchAsDataUrl(url: string, mime: string): Promise<string> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function inlineFontUrls(css: string): Promise<string> {
  const urlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[^)"']+)\)/g;
  const matches = Array.from(new Set(Array.from(css.matchAll(urlRegex), (m) => m[1])));
  const entries = await Promise.all(
    matches.map(async (url) => {
      try {
        const dataUrl = await fetchAsDataUrl(url, "font/woff2");
        return [url, dataUrl] as const;
      } catch {
        return [url, url] as const;
      }
    }),
  );
  const map = new Map(entries);
  return css.replace(urlRegex, (_, url: string) => `url(${map.get(url) ?? url})`);
}

export async function getEmbeddedFontsCss(): Promise<string> {
  if (cachedCss) return cachedCss;
  if (pendingPromise) return pendingPromise;
  pendingPromise = (async () => {
    try {
      const res = await fetch(buildGoogleFontsUrl(), {
        mode: "cors",
        credentials: "omit",
        headers: {
          // Google Fonts serves woff2 to any modern browser UA; the default
          // fetch UA is fine.
        },
      });
      if (!res.ok) throw new Error(`Fonts CSS fetch -> ${res.status}`);
      const css = await res.text();
      cachedCss = await inlineFontUrls(css);
      return cachedCss;
    } catch (err) {
      console.warn("[fontEmbedCss] failed to preload Google Fonts", err);
      cachedCss = "";
      return "";
    } finally {
      pendingPromise = null;
    }
  })();
  return pendingPromise;
}
