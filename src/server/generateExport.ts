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

function base64ToBuffer(value: string) {
  return Buffer.from(value, "base64");
}

function getExportsRoot() {
  return path.resolve(process.cwd(), "data", "exports");
}

function validateExportInput(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("Thiếu dữ liệu export.");
  }
  const payload = input as {
    exportName?: string;
    bundles?: Array<{
      folderName?: string;
      files?: Array<{
        name?: string;
        base64?: string;
      }>;
    }>;
  };
  if (!Array.isArray(payload.bundles) || payload.bundles.length === 0) {
    throw new Error("Không có bundle để xuất.");
  }
  return {
    exportName: payload.exportName,
    bundles: payload.bundles,
  } as {
    exportName?: string;
    bundles: Array<{
      folderName?: string;
      files?: Array<{
        name?: string;
        base64?: string;
      }>;
    }>;
  };
}

export const exportGenerateBundlesToDataServer = createServerFn({ method: "POST" })
  .inputValidator(validateExportInput)
  .handler(async ({ data }) => {
    const root = getExportsRoot();
    const exportFolderName = safeSegment(data.exportName, "bo-anh");
    const exportFolderPath = path.resolve(root, exportFolderName);

    await mkdir(exportFolderPath, { recursive: true });

    const writtenFiles: string[] = [];

    for (const [bundleIndex, bundle] of data.bundles.entries()) {
      const bundleFolderName = safeSegment(bundle.folderName, `bo-${bundleIndex + 1}`);
      const bundleFolderPath = path.resolve(exportFolderPath, bundleFolderName);
      await mkdir(bundleFolderPath, { recursive: true });

      for (const file of bundle.files ?? []) {
        const fileName = path.basename(file.name || "file");
        const absolutePath = path.resolve(bundleFolderPath, fileName);
        const relative = path.relative(root, absolutePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new Error("Đường dẫn file export không hợp lệ.");
        }
        await writeFile(absolutePath, base64ToBuffer(file.base64 || ""));
        writtenFiles.push(relative.split(path.sep).join("/"));
      }
    }

    return {
      ok: true as const,
      root: exportFolderPath,
      writtenFiles,
    };
  });
