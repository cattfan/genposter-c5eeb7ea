import { describe, expect, it } from "vitest";
import {
  ENTITY_FIELDS,
  buildSemanticIndexAlternation,
  entityFieldOptionsForUi,
  lookupByAlias,
  lookupByBindingPath,
  lookupByPlaceholder,
  normalizeFieldToken,
} from "./fieldRegistry";
import type { Entity } from "@/models";

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entityId: "e1",
    name: "Quán A",
    partnerFlag: false,
    partnerPriority: 0,
    partnerType: "none",
    campaignTags: [],
    seoKeywords: [],
    status: "active",
    ...overrides,
  } as Entity;
}

describe("fieldRegistry", () => {
  it("lookupByAlias tolerates accents, separators, mixed case", () => {
    expect(lookupByAlias("Tên quán")?.id).toBe("name");
    expect(lookupByAlias("ten_quan")?.id).toBe("name");
    expect(lookupByAlias("TEN QUAN")?.id).toBe("name");
    expect(lookupByAlias("địa chỉ")?.id).toBe("address");
    expect(lookupByAlias("dia_chi")?.id).toBe("address");
    expect(lookupByAlias("SĐT")?.id).toBe("phone");
  });

  it("lookupByAlias falls through unknown tokens", () => {
    expect(lookupByAlias("foo_bar")).toBeUndefined();
    expect(lookupByAlias("")).toBeUndefined();
    expect(lookupByAlias(undefined)).toBeUndefined();
  });

  it("lookupByPlaceholder strips trailing _<n> and matches token", () => {
    expect(lookupByPlaceholder("name_0")?.bindingPath).toBe("entity.name");
    expect(lookupByPlaceholder("name_42")?.bindingPath).toBe("entity.name");
    expect(lookupByPlaceholder("address")?.bindingPath).toBe("entity.address");
    expect(lookupByPlaceholder("signature_dish_3")?.bindingPath).toBe(
      "entity.metadata.signatureDish",
    );
  });

  it("lookupByPlaceholder ignores eyebrow/cta/text (no entity field)", () => {
    expect(lookupByPlaceholder("eyebrow")).toBeUndefined();
    expect(lookupByPlaceholder("cta")).toBeUndefined();
    expect(lookupByPlaceholder("text")).toBeUndefined();
    expect(lookupByPlaceholder("section_title_1")).toBeUndefined();
  });

  it("lookupByBindingPath returns the canonical field", () => {
    expect(lookupByBindingPath("entity.name")?.id).toBe("name");
    expect(lookupByBindingPath("entity.metadata.description")?.id).toBe("description");
    expect(lookupByBindingPath("entity.foo")).toBeUndefined();
  });

  it("normalizeFieldToken normalises NFD, đ, separators", () => {
    expect(normalizeFieldToken("Tên quán")).toBe("ten_quan");
    expect(normalizeFieldToken("Đối tác")).toBe("doi_tac");
    expect(normalizeFieldToken("---name---")).toBe("name");
    expect(normalizeFieldToken("")).toBe("");
  });

  it("ENTITY_FIELDS has unique ids and unique bindingPath", () => {
    const ids = ENTITY_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paths = ENTITY_FIELDS.map((f) => f.bindingPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("entityFieldOptionsForUi excludes fields without placeholder tokens", () => {
    const ids = entityFieldOptionsForUi().map((opt) => opt.id);
    expect(ids).toContain("name");
    expect(ids).toContain("address");
    expect(ids).not.toContain("partnerFlag"); // empty placeholderTokens
    expect(ids).not.toContain("campaignTags");
  });

  it("entityFieldOptionsForUi filters by preview entities and adds samples", () => {
    const entities = [makeEntity({ name: "Quán A", address: "1 Yersin", phone: "" })];
    const options = entityFieldOptionsForUi(entities);
    const nameOpt = options.find((opt) => opt.id === "name");
    const addressOpt = options.find((opt) => opt.id === "address");
    const phoneOpt = options.find((opt) => opt.id === "phone");
    expect(nameOpt?.sample).toBe("Quán A");
    expect(addressOpt?.sample).toBe("1 Yersin");
    expect(phoneOpt).toBeUndefined();
  });

  it("entityFieldOptionsForUi reads metadata fields via storedInMetadata", () => {
    const entities = [
      makeEntity({ metadata: { signatureDish: "Bánh tráng nướng", description: "Quán cũ" } }),
    ];
    const options = entityFieldOptionsForUi(entities);
    expect(options.find((opt) => opt.id === "signatureDish")?.sample).toBe("Bánh tráng nướng");
    expect(options.find((opt) => opt.id === "description")?.sample).toBe("Quán cũ");
  });

  it("buildSemanticIndexAlternation includes entity field tokens and structural keywords", () => {
    const pattern = buildSemanticIndexAlternation();
    expect(pattern).toContain("name");
    expect(pattern).toContain("dia_chi");
    expect(pattern).toContain("item");
    expect(pattern).toContain("list_line");
    // Phải tách bằng "|" và không có khoảng trắng
    expect(pattern.includes(" ")).toBe(false);
    // Phải build được regex hợp lệ
    expect(() => new RegExp(`(?:^|_)(?:${pattern})_(\\d+)(?:_|$)`)).not.toThrow();
  });
});
