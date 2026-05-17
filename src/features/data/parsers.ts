// CSV / JSON / Google Sheets / XLSX parsers

import Papa from "papaparse";

export interface ParsedWorkbookSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ParsedTable {
  headers: string[];
  rows: Record<string, unknown>[];
  sourceSheetName?: string;
  workbookSheets?: ParsedWorkbookSheet[];
}

function collectHeaders(rows: Record<string, unknown>[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  return headers;
}

type XlsxCellLike = {
  w?: string;
  v?: unknown;
  l?: { Target?: string };
};

function normalizeHeaderValue(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cellDisplayValue(cell: XlsxCellLike | undefined) {
  if (!cell) return "";
  const display = String(cell.w ?? "").trim();
  if (display) return display;
  return String(cell.v ?? "").trim();
}

function cellHyperlinkTarget(cell: XlsxCellLike | undefined) {
  return String(cell?.l?.Target ?? "").trim();
}

function resolveCellValue(cell: XlsxCellLike | undefined) {
  const display = cellDisplayValue(cell);
  const hyperlink = cellHyperlinkTarget(cell);
  if (!hyperlink) return display;
  if (!display || display === hyperlink) return hyperlink;
  return `${display} | ${hyperlink}`;
}

function worksheetToRowsWithHyperlinks(
  worksheet: Record<string, XlsxCellLike | string | undefined>,
  utils: typeof import("xlsx").utils,
): Record<string, unknown>[] {
  const rangeRef = worksheet["!ref"];
  if (typeof rangeRef !== "string") return [];

  const range = utils.decode_range(rangeRef);
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const address = utils.encode_cell({ r: range.s.r, c: column });
    const cell = worksheet[address] as XlsxCellLike | undefined;
    headers.push(normalizeHeaderValue(cellDisplayValue(cell), `__empty_${column + 1}`));
  }

  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row: Record<string, unknown> = {};
    let hasValue = false;

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const header = headers[column - range.s.c];
      if (!header) continue;

      const address = utils.encode_cell({ r: rowIndex, c: column });
      const cell = worksheet[address] as XlsxCellLike | undefined;
      const value = resolveCellValue(cell);
      row[header] = value;
      if (value !== "") hasValue = true;
    }

    if (hasValue) rows.push(row);
  }

  return rows;
}

export function parseCsvText(text: string): ParsedTable {
  const res = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  // Trước đây errors của PapaParse bị nuốt -> dòng quote sai / mixed delimiter
  // im lặng biến mất. Ghi console.warn để debug; kèm tóm tắt số dòng hỏng.
  if (res.errors.length > 0) {
    const summary = res.errors
      .slice(0, 3)
      .map((err) => `[row ${err.row ?? "?"}] ${err.code}: ${err.message}`)
      .join("; ");
    const more = res.errors.length > 3 ? ` (+${res.errors.length - 3} more)` : "";
    console.warn(`[parseCsvText] ${res.errors.length} parse error(s): ${summary}${more}`);
  }

  return {
    headers: res.meta.fields ?? [],
    rows: res.data,
  };
}

export async function parseCsvFile(file: File): Promise<ParsedTable> {
  const text = await file.text();
  return parseCsvText(text);
}

export async function parseJsonFile(file: File): Promise<ParsedTable> {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!Array.isArray(data)) {
    throw new Error("JSON phải là một array các object");
  }

  const headers = Object.keys(data[0] ?? {});
  return { headers, rows: data };
}

export async function parseXlsxArrayBuffer(buffer: ArrayBuffer): Promise<ParsedTable> {
  const { read, utils } = await import("xlsx");
  const workbook = read(buffer, {
    type: "array",
    cellDates: false,
  });

  const workbookSheets: ParsedWorkbookSheet[] = [];

  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet?.["!ref"]) continue;

    const rows = worksheetToRowsWithHyperlinks(
      worksheet as Record<string, XlsxCellLike | string | undefined>,
      utils,
    );

    if (rows.length === 0) continue;

    workbookSheets.push({
      name,
      headers: collectHeaders(rows),
      rows,
    });
  }

  if (workbookSheets.length === 0) {
    throw new Error("File Excel không có sheet nào chứa dữ liệu");
  }

  const [firstSheet] = workbookSheets;
  return {
    headers: firstSheet.headers,
    rows: firstSheet.rows,
    sourceSheetName: firstSheet.name,
    workbookSheets,
  };
}

export async function parseXlsxFile(file: File): Promise<ParsedTable> {
  return parseXlsxArrayBuffer(await file.arrayBuffer());
}

export async function parseDataFile(file: File): Promise<ParsedTable> {
  const normalizedName = file.name.toLowerCase();

  if (normalizedName.endsWith(".json")) return parseJsonFile(file);
  if (normalizedName.endsWith(".xlsx")) return parseXlsxFile(file);

  return parseCsvFile(file);
}

/**
 * Convert Google Sheets share link to a public CSV export URL.
 */
export function sheetUrlToCsvUrl(input: string): string | null {
  const match = input.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;

  const id = match[1];
  const gidMatch = input.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

export function sheetUrlToXlsxUrl(input: string): string | null {
  const match = input.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;

  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function startsWithHtml(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64));
  for (const byte of bytes) {
    if (byte <= 32) continue;
    return byte === 60;
  }
  return false;
}

export async function fetchSheetWorkbook(input: string): Promise<ParsedTable> {
  const url = sheetUrlToXlsxUrl(input);
  if (!url) {
    throw new Error("Khong nhan dien duoc link Google Sheets. Hay dan link share cua file sheet.");
  }

  try {
    const res = await fetch(url);
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      if (!startsWithHtml(buffer)) return parseXlsxArrayBuffer(buffer);
    }
  } catch (err) {
    // CORS hoặc network issue: log để debug, fallback xuống server function.
    console.warn(
      "[fetchSheetWorkbook] direct fetch thất bại, dùng server function:",
      err instanceof Error ? err.message : err,
    );
  }

  const { fetchSheetXlsxServer } = await import("@/server/sheetFetch");
  const r = await fetchSheetXlsxServer({ data: { url: input } });
  if (!r.ok) throw new Error(r.error);
  return parseXlsxArrayBuffer(base64ToArrayBuffer(r.base64));
}

export async function fetchSheetCsv(input: string): Promise<ParsedTable> {
  const url = sheetUrlToCsvUrl(input);
  if (!url) {
    throw new Error("Không nhận diện được link Google Sheets. Hãy dán link share của file sheet.");
  }

  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      if (!text.trim().startsWith("<")) return parseCsvText(text);
    }
  } catch (err) {
    // CORS hoặc network issue: log để debug, fallback xuống server function.
    console.warn(
      "[fetchSheetCsv] direct fetch thất bại, dùng server function:",
      err instanceof Error ? err.message : err,
    );
  }

  const { fetchSheetCsvServer } = await import("@/server/sheetFetch");
  const r = await fetchSheetCsvServer({ data: { url: input } });
  if (!r.ok) throw new Error(r.error);
  return parseCsvText(r.csv);
}
