// Generic CRUD controller cho mọi bảng JSON. 1 controller xử lý cả 14 bảng
// (15 bảng - blobs riêng) thay vì viết 14 controller class.
//
// Routes:
//   GET    /api/v1/tables/:slug          -> list (?field=value&limit=...)
//   GET    /api/v1/tables/:slug/count    -> count
//   GET    /api/v1/tables/:slug/:id      -> get one
//   PUT    /api/v1/tables/:slug/:id      -> upsert
//   POST   /api/v1/tables/:slug/bulk     -> bulkPut
//   DELETE /api/v1/tables/:slug          -> clear
//   DELETE /api/v1/tables/:slug/:id      -> delete one
//
// :slug accepts cả kebab (page-templates) và camel (pageTemplates) cho dễ
// migrate frontend.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { TablesService } from "./tables.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import type { Row } from "../database/repository";
import { findTableBySlug } from "../config/tables";

@Controller("tables")
export class TablesController {
  constructor(
    private readonly service: TablesService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get(":slug")
  list(
    @Param("slug") slug: string,
    @Query() rawQuery: Record<string, string>,
  ): { rows: Row[] } {
    const repo = this.repoOrThrow(slug);
    const filter: Record<string, string> = {};
    let limit: number | undefined;
    let offset: number | undefined;
    for (const [key, value] of Object.entries(rawQuery)) {
      if (key === "limit") {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      } else if (key === "offset") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) offset = Math.floor(n);
      } else if (typeof value === "string" && value.length > 0) {
        filter[key] = value;
      }
    }
    return { rows: repo.list(filter, limit, offset) };
  }

  @Get(":slug/count")
  count(@Param("slug") slug: string): { count: number } {
    return { count: this.repoOrThrow(slug).count() };
  }

  @Get(":slug/:id")
  getOne(@Param("slug") slug: string, @Param("id") id: string): Row {
    const row = this.repoOrThrow(slug).get(id);
    if (!row) throw new NotFoundException(`Row ${id} not found in ${slug}`);
    return row;
  }

  @Put(":slug/:id")
  put(
    @Param("slug") slug: string,
    @Param("id") id: string,
    @Body() row: Row,
  ): Row {
    const config = findTableBySlug(slug);
    if (!config) throw new NotFoundException(`Unknown table: ${slug}`);
    if (!row || typeof row !== "object") {
      throw new HttpException("Body must be an object", HttpStatus.BAD_REQUEST);
    }
    // Đảm bảo PK trong body khớp URL.
    const next = { ...row, [config.primaryKey]: id };
    const saved = this.service.repoFor(config).put(next);
    this.realtime.broadcastTableUpdate(config.name);
    return saved;
  }

  @Post(":slug/bulk")
  bulk(
    @Param("slug") slug: string,
    @Body() body: { rows: Row[] },
  ): { count: number } {
    const config = findTableBySlug(slug);
    if (!config) throw new NotFoundException(`Unknown table: ${slug}`);
    if (!Array.isArray(body?.rows)) {
      throw new HttpException("Body must be { rows: Row[] }", HttpStatus.BAD_REQUEST);
    }
    const count = this.service.repoFor(config).bulkPut(body.rows);
    if (count > 0) this.realtime.broadcastTableUpdate(config.name);
    return { count };
  }

  @Delete(":slug")
  clear(@Param("slug") slug: string): { cleared: number } {
    const config = findTableBySlug(slug);
    if (!config) throw new NotFoundException(`Unknown table: ${slug}`);
    const cleared = this.service.repoFor(config).clear();
    if (cleared > 0) this.realtime.broadcastTableUpdate(config.name);
    return { cleared };
  }

  @Delete(":slug/:id")
  deleteOne(
    @Param("slug") slug: string,
    @Param("id") id: string,
  ): { deleted: boolean } {
    const config = findTableBySlug(slug);
    if (!config) throw new NotFoundException(`Unknown table: ${slug}`);
    const deleted = this.service.repoFor(config).delete(id);
    if (deleted) this.realtime.broadcastTableUpdate(config.name);
    return { deleted };
  }

  private repoOrThrow(slug: string) {
    const config = findTableBySlug(slug);
    if (!config) throw new NotFoundException(`Unknown table: ${slug}`);
    return this.service.repoFor(config);
  }
}
