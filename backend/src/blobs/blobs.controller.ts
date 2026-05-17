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
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 100 * 1024 * 1024 } }))
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
