import { describe, expect, it } from "vitest";
import {
  mergeBindingSources,
  resolveAssetsFromContext,
  resolveEntitiesFromContext,
} from "./sourceContext";

const entities = [
  { entityId: "e1", sheetName: "sheet-a" },
  { entityId: "e2", sheetName: "sheet-b" },
] as any[];

const assets = [
  { assetId: "a1", entityId: "e1" },
  { assetId: "a2", entityId: "e2" },
] as any[];

describe("sourceContext", () => {
  it("falls back to secondary source when primary is empty", () => {
    const context = mergeBindingSources(
      { id: "p", kind: "sheet", label: "Primary", entityIds: [] },
      [{ id: "s", kind: "sheet", label: "Secondary", sheetName: "sheet-b" }],
    );

    expect(resolveEntitiesFromContext(context, { entities, assets })).toHaveLength(2);
    expect(resolveAssetsFromContext(context, { entities, assets })).toHaveLength(2);
  });
});
