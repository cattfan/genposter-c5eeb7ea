// Blob upload + serve.
// - POST /api/v1/blobs   (multipart 'file') -> { blobKey, mime, size }
// - GET  /api/v1/blobs/:key -> stream từ filesystem (immutable cache)
//
// Vì blob lớn (ảnh, font), KHÔNG đi qua TablesService (JSON store). Storage
// flat: data/blobs/<blobKey> với 1 row metadata trong bảng blobs SQLite.

import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { existsSync, statSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { createReadStream } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getDataDir, getDb } from "../database/sqlite";

interface BlobRow {
  blob_key: string;
  mime: string;
  size: number;
  created_at: number;
}

@Controller("blobs")
export class BlobsController {
  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 30 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers("x-blob-key") providedKey?: string,
  ): Promise<{ blobKey: string; mime: string; size: number }> {
    if (!file) throw new HttpException("Missing file", HttpStatus.BAD_REQUEST);
    const blobKey = sanitizeKey(providedKey) ?? randomUUID();
    const dataDir = getDataDir();
    await mkdir(join(dataDir, "blobs"), { recursive: true });
    const filePath = join(dataDir, "blobs", blobKey);
    await writeFile(filePath, file.buffer);
    const db = getDb();
    db.prepare(
      `INSERT INTO blobs (blob_key, mime, size, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(blob_key) DO UPDATE SET mime = excluded.mime, size = excluded.size`,
    ).run(blobKey, file.mimetype || "application/octet-stream", file.size, Date.now());
    return { blobKey, mime: file.mimetype || "application/octet-stream", size: file.size };
  }

  /**
   * Batch upload nhiều file trong 1 multipart request -> giảm 95% network
   * overhead khi import folder lớn (5000 ảnh).
   *
   * - Field name: 'files' (multipart array)
   * - Tối đa 50 file/request, mỗi file 30MB
   * - Tự sinh blobKey UUID cho mỗi file (không nhận x-blob-key header)
   * - Trả về mảng kết quả theo đúng thứ tự upload
   */
  @Post("batch")
  @UseInterceptors(
    FilesInterceptor("files", 50, { limits: { fileSize: 30 * 1024 * 1024 } }),
  )
  async batchUpload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<{ blobs: Array<{ blobKey: string; mime: string; size: number }> }> {
    if (!files || files.length === 0) {
      throw new HttpException("Missing files", HttpStatus.BAD_REQUEST);
    }
    const dataDir = getDataDir();
    await mkdir(join(dataDir, "blobs"), { recursive: true });
    const db = getDb();
    const insertStmt = db.prepare(
      `INSERT INTO blobs (blob_key, mime, size, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(blob_key) DO UPDATE SET mime = excluded.mime, size = excluded.size`,
    );

    // Ghi file song song; insert metadata trong 1 SQLite transaction để tận
    // dụng better-sqlite3 sync API + WAL.
    const writes = files.map(async (file) => {
      const blobKey = randomUUID();
      const filePath = join(dataDir, "blobs", blobKey);
      await writeFile(filePath, file.buffer);
      return {
        blobKey,
        mime: file.mimetype || "application/octet-stream",
        size: file.size,
      };
    });
    const results = await Promise.all(writes);

    const insertMany = db.transaction(
      (rows: Array<{ blobKey: string; mime: string; size: number }>) => {
        const now = Date.now();
        for (const row of rows) {
          insertStmt.run(row.blobKey, row.mime, row.size, now);
        }
      },
    );
    insertMany(results);

    return { blobs: results };
  }

  @Get(":key")
  download(@Param("key") key: string, @Res() res: Response): void {
    const sanitized = sanitizeKey(key);
    if (!sanitized) throw new HttpException("Invalid key", HttpStatus.BAD_REQUEST);
    const db = getDb();
    const row = db.prepare(`SELECT * FROM blobs WHERE blob_key = ?`).get(sanitized) as
      | BlobRow
      | undefined;
    const filePath = join(getDataDir(), "blobs", sanitized);
    if (!row || !existsSync(filePath)) throw new NotFoundException();
    const stat = statSync(filePath);
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(filePath).pipe(res);
  }
}

/** Block path traversal hoặc ký tự rare. Chỉ chấp nhận [A-Za-z0-9 _ - .] */
function sanitizeKey(key: string | undefined): string | null {
  if (!key) return null;
  if (!/^[A-Za-z0-9._-]{1,256}$/.test(key)) return null;
  if (key === "." || key === "..") return null;
  return key;
}
