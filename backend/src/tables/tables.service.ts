import { Injectable } from "@nestjs/common";
import { getDb } from "../database/sqlite";
import { TableRepository } from "../database/repository";
import type { TableConfig } from "../config/tables";

@Injectable()
export class TablesService {
  private readonly cache = new Map<string, TableRepository>();

  repoFor(table: TableConfig): TableRepository {
    const cached = this.cache.get(table.name);
    if (cached) return cached;
    const repo = new TableRepository(getDb(), table);
    this.cache.set(table.name, repo);
    return repo;
  }
}
