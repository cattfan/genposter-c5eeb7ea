// Server function: fetch CSV từ Google Sheets URL.
// Dùng khi client fetch trực tiếp bị CORS hoặc URL không công khai.

import { createServerFn } from "@tanstack/react-start";

function sheetUrlToCsv(input: string): string | null {
  const m = input.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const id = m[1];
  const gidMatch = input.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

export const fetchSheetCsvServer = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => {
    if (!input || typeof input.url !== "string" || input.url.length === 0) {
      throw new Error("Thiếu url");
    }
    if (input.url.length > 2000) throw new Error("URL quá dài");
    return input;
  })
  .handler(async ({ data }) => {
    const csvUrl = sheetUrlToCsv(data.url);
    if (!csvUrl) {
      return {
        ok: false as const,
        error: "Không nhận diện được link Google Sheets. Hãy dán link share của file sheet.",
      };
    }
    try {
      const res = await fetch(csvUrl, {
        headers: { Accept: "text/csv,*/*" },
        redirect: "follow",
      });
      if (!res.ok) {
        return {
          ok: false as const,
          error: `Google trả về ${res.status}. Hãy đảm bảo sheet đã share "Anyone with the link" hoặc Publish to web.`,
        };
      }
      const text = await res.text();
      // Google trả HTML khi sheet không public — detect sớm
      if (text.trim().startsWith("<")) {
        return {
          ok: false as const,
          error: "Sheet chưa public. File → Share → 'Anyone with the link' (Viewer).",
        };
      }
      return { ok: true as const, csv: text };
    } catch (e) {
      return {
        ok: false as const,
        error: "Không tải được sheet: " + (e instanceof Error ? e.message : String(e)),
      };
    }
  });
