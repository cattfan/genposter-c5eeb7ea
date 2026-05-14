import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";

function stripDiacritics(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d");
}

function safeSegment(value: string | undefined, fallback: string) {
  const segment = stripDiacritics(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return segment || fallback;
}

function validatePresetExportInput(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("Thiếu dữ liệu bộ khuôn.");
  }
  const payload = input as {
    fileName?: string;
    payload?: unknown;
  };
  if (!payload.fileName || typeof payload.fileName !== "string") {
    throw new Error("Thiếu tên file export.");
  }
  return {
    fileName: payload.fileName,
    payload: payload.payload,
  };
}

export const exportPresetJsonToDataServer = createServerFn({ method: "POST" })
  .inputValidator(validatePresetExportInput)
  .handler(async ({ data }) => {
    const exportsRoot = path.resolve(process.cwd(), "data", "presets");
    await mkdir(exportsRoot, { recursive: true });

    const fileName = `${safeSegment(data.fileName.replace(/\.json$/i, ""), "generate-preset")}.json`;
    const absolutePath = path.resolve(exportsRoot, fileName);
    const relative = path.relative(process.cwd(), absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Đường dẫn export không hợp lệ.");
    }

    await writeFile(absolutePath, JSON.stringify(data.payload, null, 2), "utf-8");

    return {
      ok: true as const,
      absolutePath,
      relativePath: relative.split(path.sep).join("/"),
    };
  });
