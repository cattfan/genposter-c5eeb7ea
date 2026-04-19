// Fuzzy match tên file ảnh ↔ tên quán (entity)
// Hỗ trợ tiếng Việt có/không dấu, slug, suffix -1 -2, ignore extension

import type { Entity } from "@/models";

/** Bỏ dấu tiếng Việt + lowercase + chỉ giữ a-z 0-9 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Bỏ extension và suffix kiểu -1, _2, (3) */
export function cleanFileName(fileName: string): string {
  const noExt = fileName.replace(/\.[a-z0-9]+$/i, "");
  const noSuffix = noExt
    .replace(/[-_\s]*\(?\d+\)?$/g, "") // -1, _2, (3)
    .trim();
  return noSuffix || noExt;
}

/** Levenshtein distance (cho fuzzy match khi không exact) */
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array(n + 1)
    .fill(0)
    .map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
    }
  }
  return dp[n];
}

export interface MatchResult {
  fileName: string;
  matchedEntityId: string | null;
  matchedEntityName: string | null;
  score: number; // 0-100
  reason: "exact" | "contains" | "fuzzy" | "no_match";
}

export interface MatchOptions {
  /** Ngưỡng similarity 0..1 cho fuzzy match (mặc định 0.78) */
  fuzzyThreshold?: number;
}

/**
 * Match danh sách file với danh sách entity.
 * Ưu tiên: exact slug → contains → fuzzy (Levenshtein normalized).
 */
export function matchFilesToEntities(
  fileNames: string[],
  entities: Entity[],
  opts: MatchOptions = {},
): MatchResult[] {
  const threshold = opts.fuzzyThreshold ?? 0.78;
  const entitySlugs = entities.map((e) => ({
    entity: e,
    slug: slugify(e.name),
  }));

  return fileNames.map((fn) => {
    const cleaned = cleanFileName(fn);
    const fileSlug = slugify(cleaned);

    // 1. Exact match
    const exact = entitySlugs.find((es) => es.slug === fileSlug);
    if (exact) {
      return {
        fileName: fn,
        matchedEntityId: exact.entity.entityId,
        matchedEntityName: exact.entity.name,
        score: 100,
        reason: "exact",
      };
    }

    // 2. Contains (file slug chứa entity slug hoặc ngược lại)
    let bestContain: { e: typeof entitySlugs[0]; score: number } | null = null;
    for (const es of entitySlugs) {
      if (!es.slug) continue;
      if (fileSlug.includes(es.slug) || es.slug.includes(fileSlug)) {
        const overlap = Math.min(fileSlug.length, es.slug.length) /
          Math.max(fileSlug.length, es.slug.length);
        if (!bestContain || overlap > bestContain.score) {
          bestContain = { e: es, score: overlap };
        }
      }
    }
    if (bestContain && bestContain.score >= 0.5) {
      return {
        fileName: fn,
        matchedEntityId: bestContain.e.entity.entityId,
        matchedEntityName: bestContain.e.entity.name,
        score: Math.round(85 + bestContain.score * 10),
        reason: "contains",
      };
    }

    // 3. Fuzzy via Levenshtein
    let bestFuzzy: { e: typeof entitySlugs[0]; sim: number } | null = null;
    for (const es of entitySlugs) {
      if (!es.slug) continue;
      const dist = lev(fileSlug, es.slug);
      const sim = 1 - dist / Math.max(fileSlug.length, es.slug.length);
      if (!bestFuzzy || sim > bestFuzzy.sim) {
        bestFuzzy = { e: es, sim };
      }
    }
    if (bestFuzzy && bestFuzzy.sim >= threshold) {
      return {
        fileName: fn,
        matchedEntityId: bestFuzzy.e.entity.entityId,
        matchedEntityName: bestFuzzy.e.entity.name,
        score: Math.round(bestFuzzy.sim * 80),
        reason: "fuzzy",
      };
    }

    return {
      fileName: fn,
      matchedEntityId: null,
      matchedEntityName: null,
      score: 0,
      reason: "no_match",
    };
  });
}
