// Resolver cho click-to-bind: lấy giá trị thực từ entity/asset theo bindingPath
import type { Asset, AssetRole, Entity, Slot } from "@/models";
import { filterRenderableAssets, getAssetImageSource } from "./assetImage";

export interface BindingFieldOption {
  value: string;
  label: string;
  group: "Cố định" | "Dữ liệu" | "Ảnh";
}

export type EntityListBullet = "dot" | "dash" | "number" | "none";

export interface EntityListBindingConfig {
  fields: string[];
  count: number;
  separator?: string;
  bullet?: EntityListBullet;
  randomize?: boolean;
  prioritizePartner?: boolean;
  seed?: string;
}

export const ENTITY_LIST_BINDING_PREFIX = "entity.list:";
export const ENTITY_COMPOSE_BINDING_PREFIX = "entity.compose:";

export const TEXT_BINDING_OPTIONS: BindingFieldOption[] = [
  { value: "", label: "Cố định (nội dung tĩnh)", group: "Cố định" },
  { value: "entity.name", label: "Tên", group: "Dữ liệu" },
  { value: "entity.address", label: "Địa chỉ", group: "Dữ liệu" },
  { value: "entity.phone", label: "Số điện thoại", group: "Dữ liệu" },
  { value: "entity.priceRange", label: "Giá", group: "Dữ liệu" },
  { value: "entity.style", label: "Phong cách", group: "Dữ liệu" },
  { value: "entity.openingHours", label: "Giờ mở cửa", group: "Dữ liệu" },
  { value: "entity.categoryMain", label: "Mô hình / Bữa ăn", group: "Dữ liệu" },
  { value: "entity.categorySub", label: "Phong cách", group: "Dữ liệu" },
  { value: "entity.signatureDish", label: "Món ăn nổi bật", group: "Dữ liệu" },
];

export const IMAGE_BINDING_OPTIONS: BindingFieldOption[] = [
  { value: "", label: "Cố định", group: "Cố định" },
  { value: "asset.cover", label: "Ảnh theo quán", group: "Ảnh" },
  { value: "asset.random", label: "Ảnh ngẫu nhiên quán", group: "Ảnh" },
  { value: "asset.random_scope", label: "Ảnh ngẫu nhiên chỉ định", group: "Ảnh" },
];

export interface AssetRandomScopeConfig {
  sheetName?: string;
  folder?: string;
}

export const ASSET_RANDOM_SCOPE_BINDING_VALUE = "asset.random_scope";
const ASSET_RANDOM_SCOPE_BINDING_PREFIX = `${ASSET_RANDOM_SCOPE_BINDING_VALUE}:`;
export const ENTITY_SCOPED_TEXT_BINDING_PREFIX = "entity.scoped:";

export interface EntityScopedTextBindingConfig {
  path: string;
  sheetName?: string;
}

function cleanScopeValue(value: string | undefined): string | undefined {
  if (!value || value === "__all__") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function buildAssetRandomScopeBindingPath(config: AssetRandomScopeConfig): string {
  const normalized: AssetRandomScopeConfig = {
    sheetName: cleanScopeValue(config.sheetName),
    folder: cleanScopeValue(config.folder),
  };
  return ASSET_RANDOM_SCOPE_BINDING_PREFIX + encodeURIComponent(JSON.stringify(normalized));
}

export function parseAssetRandomScopeBindingPath(
  bindingPath: string | undefined,
): AssetRandomScopeConfig | null {
  if (!bindingPath) return null;
  if (bindingPath === ASSET_RANDOM_SCOPE_BINDING_VALUE) return {};
  if (!bindingPath.startsWith(ASSET_RANDOM_SCOPE_BINDING_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      decodeURIComponent(bindingPath.slice(ASSET_RANDOM_SCOPE_BINDING_PREFIX.length)),
    ) as AssetRandomScopeConfig;
    return {
      sheetName: cleanScopeValue(parsed.sheetName),
      folder: cleanScopeValue(parsed.folder),
    };
  } catch {
    return {};
  }
}

export function isAssetRandomScopeBindingPath(bindingPath: string | undefined): boolean {
  return (
    bindingPath === ASSET_RANDOM_SCOPE_BINDING_VALUE ||
    !!bindingPath?.startsWith(ASSET_RANDOM_SCOPE_BINDING_PREFIX)
  );
}

export function buildEntityScopedTextBindingPath(config: EntityScopedTextBindingConfig): string {
  const path = normalizeEntityTextPath(config.path);
  const sheetName = cleanScopeValue(config.sheetName);
  if (!sheetName) return path;
  return (
    ENTITY_SCOPED_TEXT_BINDING_PREFIX + encodeURIComponent(JSON.stringify({ path, sheetName }))
  );
}

export function parseEntityScopedTextBindingPath(
  bindingPath: string | undefined,
): EntityScopedTextBindingConfig | null {
  if (!bindingPath?.startsWith(ENTITY_SCOPED_TEXT_BINDING_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      decodeURIComponent(bindingPath.slice(ENTITY_SCOPED_TEXT_BINDING_PREFIX.length)),
    ) as Partial<EntityScopedTextBindingConfig>;
    return {
      path: normalizeEntityTextPath(parsed.path ?? "entity.name"),
      sheetName: cleanScopeValue(parsed.sheetName),
    };
  } catch {
    return { path: "entity.name" };
  }
}

export function getEntityScopedTextBindingBasePath(bindingPath: string | undefined): string {
  const scoped = parseEntityScopedTextBindingPath(bindingPath);
  return scoped?.path ?? bindingPath ?? "";
}

function toDisplayText(value: unknown, fallback: string | undefined): string {
  if (value == null) return fallback ?? "";
  const text = String(value).trim();
  return text || (fallback ?? "");
}

function stableHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createSeededRandom(seed: string): () => number {
  let state = stableHash(seed) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function stableShuffle<T>(items: T[], seed: string): T[] {
  const next = items.slice();
  const random = createSeededRandom(seed);
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function pickStableRandomAsset(pool: Asset[], seed: string): Asset | undefined {
  if (pool.length === 0) return undefined;
  const ordered = pool.slice().sort((a, b) => a.assetId.localeCompare(b.assetId));
  return ordered[stableHash(seed) % ordered.length];
}

const ENTITY_FIELD_ALIASES: Record<string, string> = {
  name: "entity.name",
  ten: "entity.name",
  ten_quan: "entity.name",
  title: "entity.name",
  tieu_de: "entity.name",
  hoat_dong: "entity.name",
  dia_diem: "entity.name",
  ten_dia_diem: "entity.name",
  address: "entity.address",
  dia_chi: "entity.address",
  phone: "entity.phone",
  sdt: "entity.phone",
  so_dien_thoai: "entity.phone",
  hotline: "entity.phone",
  price: "entity.priceRange",
  pricerange: "entity.priceRange",
  price_range: "entity.priceRange",
  gia: "entity.priceRange",
  gia_ve_tham_khao_vnd_ve: "entity.priceRange",
  hours: "entity.openingHours",
  openinghours: "entity.openingHours",
  opening_hours: "entity.openingHours",
  gio_mo_cua: "entity.openingHours",
  khung_gio: "entity.openingHours",
  category: "entity.categoryMain",
  categorymain: "entity.categoryMain",
  category_main: "entity.categoryMain",
  mo_hinh: "entity.categoryMain",
  loai_dich_vu: "entity.categoryMain",
  danh_muc: "entity.categoryMain",
  categorysub: "entity.categorySub",
  category_sub: "entity.categorySub",
  subcategory: "entity.categorySub",
  phong_cach: "entity.categorySub",
  style: "entity.style",
  signaturedish: "entity.metadata.signatureDish",
  signature_dish: "entity.metadata.signatureDish",
  mon_an_noi_bat: "entity.metadata.signatureDish",
  mon_noi_bat: "entity.metadata.signatureDish",
  noi_bat: "entity.metadata.signatureDish",
  highlight: "entity.metadata.signatureDish",
  description: "entity.metadata.description",
  desc: "entity.metadata.description",
  mo_ta: "entity.metadata.description",
  ghi_chu: "entity.metadata.description",
  giai_thich: "entity.metadata.description",
};

function normalizeLookupToken(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stripEntityPrefix(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("entity.metadata.")) {
    return trimmed.slice("entity.metadata.".length);
  }
  if (trimmed.startsWith("entity.")) {
    return trimmed.slice("entity.".length);
  }
  if (trimmed.startsWith("metadata.")) {
    return trimmed.slice("metadata.".length);
  }
  return trimmed;
}

function aliasEntityTextPath(path: string): string | undefined {
  const key = normalizeLookupToken(stripEntityPrefix(path));
  return ENTITY_FIELD_ALIASES[key];
}

function metadataPathForField(path: string): string {
  const raw = stripEntityPrefix(path);
  return raw ? `entity.metadata.${raw}` : "entity.name";
}

export function normalizeEntityTextPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "entity.name";
  if (
    trimmed.startsWith(ENTITY_LIST_BINDING_PREFIX) ||
    trimmed.startsWith(ENTITY_COMPOSE_BINDING_PREFIX)
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("entity.metadata.")) return trimmed;
  if (trimmed.startsWith("metadata.")) return `entity.${trimmed}`;
  const alias = aliasEntityTextPath(trimmed);
  if (alias) return alias;
  if (trimmed.startsWith("entity.")) return trimmed;
  return metadataPathForField(trimmed);
}

function readMetadataTextValue(entity: Entity, key: string): string {
  const metadata = entity.metadata ?? {};
  const exact = toDisplayText(metadata[key], undefined);
  if (exact) return exact;

  const target = normalizeLookupToken(key);
  const matchedKey = Object.keys(metadata).find(
    (metadataKey) => normalizeLookupToken(metadataKey) === target,
  );
  return matchedKey ? toDisplayText(metadata[matchedKey], undefined) : "";
}

export function readEntityTextValue(entity: Entity | undefined, path: string): string {
  if (!entity) return "";
  const normalized = normalizeEntityTextPath(path);
  if (normalized === "entity.signatureDish") {
    return (
      toDisplayText(entity.metadata?.signatureDish, undefined) ||
      readMetadataTextValue(entity, stripEntityPrefix(path))
    );
  }
  if (normalized.startsWith("entity.metadata.")) {
    const key = normalized.slice("entity.metadata.".length);
    return (
      readMetadataTextValue(entity, key) || readMetadataTextValue(entity, stripEntityPrefix(path))
    );
  }
  if (normalized.startsWith("entity.")) {
    const key = normalized.slice("entity.".length) as keyof Entity;
    const direct = toDisplayText(entity[key], undefined);
    return direct || readMetadataTextValue(entity, String(key));
  }
  return "";
}

export function isEntityListBindingPath(bindingPath: string | undefined): boolean {
  return !!bindingPath && bindingPath.startsWith(ENTITY_LIST_BINDING_PREFIX);
}

export function isEntityComposeBindingPath(bindingPath: string | undefined): boolean {
  return !!bindingPath && bindingPath.startsWith(ENTITY_COMPOSE_BINDING_PREFIX);
}

export function buildEntityListBindingPath(config: EntityListBindingConfig): string {
  const normalized: EntityListBindingConfig = {
    fields: config.fields.filter(Boolean).map(normalizeEntityTextPath).slice(0, 10),
    count: Math.max(1, Math.min(50, Math.floor(config.count || 1))),
    separator: config.separator ?? " - ",
    bullet: config.bullet ?? "dot",
    randomize: config.randomize ?? true,
    prioritizePartner: config.prioritizePartner ?? true,
    seed: config.seed ?? String(Date.now()),
  };
  return ENTITY_LIST_BINDING_PREFIX + encodeURIComponent(JSON.stringify(normalized));
}

function normalizeEntityListField(field: string): string {
  const trimmed = field.trim();
  const normalized = stripEntityPrefix(trimmed);
  const aliases: Record<string, string> = {
    name: "entity.name",
    ten: "entity.name",
    title: "entity.name",
    address: "entity.address",
    dia_chi: "entity.address",
    phone: "entity.phone",
    sdt: "entity.phone",
    price: "entity.priceRange",
    priceRange: "entity.priceRange",
    hours: "entity.openingHours",
    openingHours: "entity.openingHours",
    category: "entity.categoryMain",
    categoryMain: "entity.categoryMain",
    categorySub: "entity.categorySub",
    signatureDish: "entity.metadata.signatureDish",
    "metadata.signatureDish": "entity.metadata.signatureDish",
    description: "entity.metadata.description",
    "metadata.description": "entity.metadata.description",
  };
  const alias = aliases[normalized] ?? aliasEntityTextPath(trimmed);
  return alias ?? normalizeEntityTextPath(trimmed);
}

function parseBooleanOption(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (/^(false|0|no)$/i.test(value)) return false;
  if (/^(true|1|yes)$/i.test(value)) return true;
  return fallback;
}

function parseFieldListSpec(value: string): string[] {
  return value
    .trim()
    .replace(/^fields=/i, "")
    .split(/[,+|]/)
    .map(normalizeEntityListField)
    .filter(Boolean)
    .slice(0, 10);
}

function parseEntityListShorthand(raw: string): EntityListBindingConfig | null {
  const parts = raw
    .trim()
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const fieldSpec = (parts.shift() ?? "").replace(/^fields=/i, "").trim();
  if (!fieldSpec || fieldSpec.startsWith("{")) return null;

  const fields = parseFieldListSpec(fieldSpec);
  if (fields.length === 0) return null;

  const options = new Map<string, string>();
  for (const part of parts) {
    const [key, ...valueParts] = part.split("=");
    const value = valueParts.join("=").trim();
    if (key && value) options.set(key.trim().toLowerCase(), value);
  }

  const bullet = options.get("bullet");
  return {
    fields,
    count: Math.max(1, Math.min(50, Math.floor(Number(options.get("count")) || 8))),
    separator: options.get("separator") ?? options.get("sep") ?? " - ",
    bullet: ["dot", "dash", "number", "none"].includes(String(bullet))
      ? (bullet as EntityListBullet)
      : "dot",
    randomize: parseBooleanOption(options.get("randomize"), true),
    prioritizePartner: parseBooleanOption(options.get("prioritizepartner"), true),
    seed: options.get("seed") ?? "default",
  };
}

function parseEntityComposeBindingPath(
  bindingPath: string | undefined,
): { fields: string[]; separator: string } | null {
  if (!isEntityComposeBindingPath(bindingPath)) return null;
  const raw = decodeURIComponent(bindingPath!.slice(ENTITY_COMPOSE_BINDING_PREFIX.length));
  const parts = raw
    .trim()
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const fields = parseFieldListSpec(parts.shift() ?? "");
  if (fields.length === 0) return null;

  const options = new Map<string, string>();
  for (const part of parts) {
    const [key, ...valueParts] = part.split("=");
    const value = valueParts.join("=").trim();
    if (key && value) options.set(key.trim().toLowerCase(), value);
  }

  return { fields, separator: options.get("separator") ?? options.get("sep") ?? " - " };
}

export function parseEntityListBindingPath(
  bindingPath: string | undefined,
): EntityListBindingConfig | null {
  if (!isEntityListBindingPath(bindingPath)) return null;
  const raw = bindingPath!.slice(ENTITY_LIST_BINDING_PREFIX.length);
  const decoded = decodeURIComponent(raw);
  try {
    const parsed = JSON.parse(decoded) as Partial<EntityListBindingConfig>;
    const fields = Array.isArray(parsed.fields)
      ? parsed.fields.filter(
          (field): field is string => typeof field === "string" && !!field.trim(),
        )
      : ["entity.name"];
    return {
      fields: fields.length ? fields.map(normalizeEntityTextPath).slice(0, 10) : ["entity.name"],
      count: Math.max(1, Math.min(50, Math.floor(Number(parsed.count) || 8))),
      separator: typeof parsed.separator === "string" ? parsed.separator : " - ",
      bullet: ["dot", "dash", "number", "none"].includes(String(parsed.bullet))
        ? (parsed.bullet as EntityListBullet)
        : "dot",
      randomize: parsed.randomize !== false,
      prioritizePartner: parsed.prioritizePartner !== false,
      seed: typeof parsed.seed === "string" ? parsed.seed : "default",
    };
  } catch {
    return parseEntityListShorthand(decoded);
  }
}

function groupByPartnerPriority(entities: Entity[], seed: string): Entity[] {
  const buckets = new Map<number, Entity[]>();
  for (const entity of entities) {
    const priority = Number(entity.partnerPriority ?? 0);
    const bucket = buckets.get(priority) ?? [];
    bucket.push(entity);
    buckets.set(priority, bucket);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => b[0] - a[0])
    .flatMap(([priority, bucket]) => stableShuffle(bucket, `${seed}:partner-priority:${priority}`));
}

function orderEntitiesForList(
  entities: Entity[],
  config: EntityListBindingConfig,
  bindingPath: string,
): Entity[] {
  const usable = entities.filter((entity) => entity.status !== "archived");
  const seed = config.seed ?? bindingPath;
  const alpha = (items: Entity[]) =>
    items.slice().sort((a, b) => a.name.localeCompare(b.name, "vi"));

  if (config.prioritizePartner) {
    const partners = usable.filter((entity) => entity.partnerFlag);
    const others = usable.filter((entity) => !entity.partnerFlag);
    const partnerOrder = config.randomize
      ? groupByPartnerPriority(partners, seed)
      : partners.sort(
          (a, b) =>
            (b.partnerPriority ?? 0) - (a.partnerPriority ?? 0) ||
            a.name.localeCompare(b.name, "vi"),
        );
    const otherOrder = config.randomize ? stableShuffle(others, `${seed}:others`) : alpha(others);
    return [...partnerOrder, ...otherOrder];
  }

  return config.randomize ? stableShuffle(usable, seed) : alpha(usable);
}

function bulletPrefix(bullet: EntityListBullet, index: number): string {
  if (bullet === "dot") return "• ";
  if (bullet === "dash") return "- ";
  if (bullet === "number") return `${index + 1}. `;
  return "";
}

export function resolveEntityListBinding(
  bindingPath: string,
  entityPool: Entity[] | undefined,
  fallback: string | undefined,
): string {
  const config = parseEntityListBindingPath(bindingPath);
  if (!config) return fallback ?? "";
  const pool = entityPool ?? [];
  if (pool.length === 0) return fallback ?? "";

  const ordered = orderEntitiesForList(pool, config, bindingPath).slice(0, config.count);
  const fields = config.fields.length ? config.fields : ["entity.name"];
  const lines = ordered
    .map((entity, index) => {
      const values = fields
        .map((field) => readEntityTextValue(entity, field))
        .filter((value) => value.trim().length > 0);
      if (values.length === 0) return "";
      return `${bulletPrefix(config.bullet ?? "dot", index)}${values.join(config.separator ?? " - ")}`;
    })
    .filter(Boolean);

  return lines.length ? lines.join("\n") : (fallback ?? "");
}

export function resolveEntityComposeBinding(
  bindingPath: string,
  entity: Entity | undefined,
  fallback: string | undefined,
): string {
  const config = parseEntityComposeBindingPath(bindingPath);
  if (!config || !entity) return fallback ?? "";
  const values = config.fields
    .map((field) => readEntityTextValue(entity, field))
    .filter((value) => value.trim().length > 0);
  return values.length ? values.join(config.separator) : (fallback ?? "");
}

export interface ResolveTextBindingOptions {
  seed?: string;
  entities?: Entity[];
}

function pickScopedTextEntity(
  scoped: EntityScopedTextBindingConfig | null,
  currentEntity: Entity | undefined,
  entityPool: Entity[] | undefined,
  options: ResolveTextBindingOptions | undefined,
): Entity | undefined {
  if (!scoped?.sheetName) return currentEntity;
  const candidates = (options?.entities?.length ? options.entities : (entityPool ?? []))
    .filter((item) => item.status === "active")
    .filter((item) => item.sheetName === scoped.sheetName)
    .sort((a, b) => a.entityId.localeCompare(b.entityId));
  if (candidates.length === 0) return currentEntity;
  const seed = [options?.seed, currentEntity?.entityId, scoped.sheetName, scoped.path]
    .filter(Boolean)
    .join(":");
  return candidates[stableHash(seed) % candidates.length];
}

export function resolveTextBinding(
  bindingPath: string | undefined,
  entity: Entity | undefined,
  fallback: string | undefined,
  entityPool?: Entity[],
  options?: ResolveTextBindingOptions,
): string {
  if (!bindingPath) return fallback ?? "";
  const scoped = parseEntityScopedTextBindingPath(bindingPath);
  const effectivePath = scoped?.path ?? bindingPath;
  const scopedPool = scoped?.sheetName
    ? (options?.entities ?? entityPool ?? []).filter(
        (item) => item.status === "active" && item.sheetName === scoped.sheetName,
      )
    : entityPool;
  const effectiveEntity = pickScopedTextEntity(scoped, entity, entityPool, options);
  if (isEntityListBindingPath(effectivePath)) {
    const pool =
      scopedPool && scopedPool.length > 0
        ? scopedPool
        : entityPool && entityPool.length > 0
          ? entityPool
          : effectiveEntity
            ? [effectiveEntity]
            : [];
    return resolveEntityListBinding(effectivePath, pool, fallback);
  }
  if (isEntityComposeBindingPath(effectivePath)) {
    return resolveEntityComposeBinding(effectivePath, effectiveEntity, fallback);
  }
  if (!effectiveEntity) return fallback ?? `{{${effectivePath}}}`;
  const text = readEntityTextValue(effectiveEntity, effectivePath);
  if (text) return text;
  return fallback ?? "";
}

interface ResolveImageBindingOptions {
  seed?: string;
  entities?: Entity[];
}

function entityScopeValues(entity: Entity | undefined, asset: Asset): string[] {
  const values = [
    asset.role,
    entity?.sheetName,
    entity?.categoryMain,
    entity?.categorySub,
    entity?.style,
  ];
  if (entity?.metadata) {
    for (const key of ["folder", "Folder", "Thu_muc", "Thư mục", "Nhom_anh", "Nhóm ảnh"]) {
      const value = entity.metadata[key];
      if (typeof value === "string" || typeof value === "number") values.push(String(value));
    }
  }
  return values.filter((value): value is string => !!value && value.trim().length > 0);
}

function matchesAssetRandomScope(
  asset: Asset,
  entityById: Map<string, Entity>,
  config: AssetRandomScopeConfig,
): boolean {
  const owner = entityById.get(asset.entityId);
  if (config.sheetName && owner?.sheetName !== config.sheetName) return false;
  if (!config.folder) return true;
  const target = normalizeLookupToken(config.folder);
  return entityScopeValues(owner, asset).some((value) => normalizeLookupToken(value) === target);
}

function fallbackAssetsForEntity(
  renderableAssets: Asset[],
  entityById: Map<string, Entity>,
  entity: Entity,
): Asset[] {
  const sameSheet = renderableAssets.filter((asset) => {
    const owner = entityById.get(asset.entityId);
    return !!entity.sheetName && owner?.sheetName === entity.sheetName;
  });
  if (sameSheet.length > 0) return sameSheet;

  const sameCategory = renderableAssets.filter((asset) => {
    const owner = entityById.get(asset.entityId);
    return (
      (!!entity.categoryMain && owner?.categoryMain === entity.categoryMain) ||
      (!!entity.categorySub && owner?.categorySub === entity.categorySub)
    );
  });
  return sameCategory.length > 0 ? sameCategory : renderableAssets;
}

export function resolveImageBinding(
  bindingPath: string | undefined,
  entity: Entity | undefined,
  assets: Asset[],
  fallback: string | undefined,
  options?: ResolveImageBindingOptions,
): { src?: string; assetId?: string; entityId?: string } {
  if (!bindingPath) return { src: fallback };
  const renderableAssets = filterRenderableAssets(assets);
  if (isAssetRandomScopeBindingPath(bindingPath)) {
    const config = parseAssetRandomScopeBindingPath(bindingPath) ?? {};
    const entityById = new Map((options?.entities ?? []).map((item) => [item.entityId, item]));
    const scopedAssets = renderableAssets.filter((asset) =>
      matchesAssetRandomScope(asset, entityById, config),
    );
    const pool = scopedAssets.length > 0 ? scopedAssets : renderableAssets;
    const randomAsset = pickStableRandomAsset(
      pool,
      options?.seed ??
        `${config.sheetName ?? "all"}:${config.folder ?? "all"}:${entity?.entityId ?? "global"}`,
    );
    return randomAsset
      ? {
          src: getAssetImageSource(randomAsset) ?? randomAsset.sourceValue,
          assetId: randomAsset.assetId,
          entityId: randomAsset.entityId,
        }
      : { src: fallback };
  }
  if (bindingPath === "asset.random_global") {
    const randomAsset = pickStableRandomAsset(
      renderableAssets,
      options?.seed ?? entity?.entityId ?? "global",
    );
    return randomAsset
      ? {
          src: getAssetImageSource(randomAsset) ?? randomAsset.sourceValue,
          assetId: randomAsset.assetId,
          entityId: randomAsset.entityId,
        }
      : { src: fallback };
  }
  if (!entity) return { src: fallback };
  const entityById = new Map((options?.entities ?? []).map((item) => [item.entityId, item]));
  const exactPool = renderableAssets.filter((a) => a.entityId === entity.entityId);
  const pool =
    exactPool.length > 0 ? exactPool : fallbackAssetsForEntity(renderableAssets, entityById, entity);
  if (bindingPath === "asset.random") {
    const randomAsset = pickStableRandomAsset(
      pool,
      options?.seed ?? `${entity.entityId}:asset.random`,
    );
    return randomAsset
      ? {
          src: getAssetImageSource(randomAsset) ?? randomAsset.sourceValue,
          assetId: randomAsset.assetId,
          entityId: randomAsset.entityId,
        }
      : { src: fallback };
  }
  if (bindingPath === "asset.cover") {
    const cover = pool.find((a) => a.isCover) ?? pool.find((a) => a.role === "cover") ?? pool[0];
    return cover
      ? {
          src: getAssetImageSource(cover) ?? cover.sourceValue,
          assetId: cover.assetId,
          entityId: cover.entityId,
        }
      : { src: fallback };
  }
  if (bindingPath.startsWith("asset.byRole:")) {
    const role = bindingPath.slice("asset.byRole:".length) as AssetRole;
    const found = pool.find((a) => a.role === role) ?? pool.find((a) => a.isCover) ?? pool[0];
    return found
      ? {
          src: getAssetImageSource(found) ?? found.sourceValue,
          assetId: found.assetId,
          entityId: found.entityId,
        }
      : { src: fallback };
  }
  return { src: fallback };
}

export function slotHasBinding(slot: Slot): boolean {
  return !!slot.bindingPath && slot.bindingPath.length > 0;
}

// CSS filter string từ SlotStyle
export function buildCssFilter(style: Slot["style"]): string | undefined {
  if (!style) return undefined;
  const parts: string[] = [];
  if (style.brightness != null && style.brightness !== 1)
    parts.push(`brightness(${style.brightness})`);
  if (style.contrast != null && style.contrast !== 1) parts.push(`contrast(${style.contrast})`);
  if (style.saturate != null && style.saturate !== 1) parts.push(`saturate(${style.saturate})`);
  if (style.blur) parts.push(`blur(${style.blur}px)`);
  if (style.hueRotate) parts.push(`hue-rotate(${style.hueRotate}deg)`);
  if (style.grayscale) parts.push(`grayscale(${style.grayscale})`);
  return parts.length ? parts.join(" ") : undefined;
}

export function buildBoxShadow(style: Slot["style"], scale = 1): string | undefined {
  if (!style?.shadowColor || (!style.shadowBlur && !style.shadowX && !style.shadowY))
    return undefined;
  return `${(style.shadowX ?? 0) * scale}px ${(style.shadowY ?? 0) * scale}px ${(style.shadowBlur ?? 0) * scale}px ${style.shadowColor}`;
}

export function buildTextShadow(style: Slot["style"], scale = 1): string | undefined {
  if (!style) return undefined;
  if (style.textShadowColor && (style.textShadowBlur || style.textShadowX || style.textShadowY)) {
    return `${(style.textShadowX ?? 0) * scale}px ${(style.textShadowY ?? 2) * scale}px ${(style.textShadowBlur ?? 6) * scale}px ${style.textShadowColor}`;
  }
  return style.textShadow;
}

function buildTextStrokeFallbackShadow(style: Slot["style"], scale = 1): string | undefined {
  if (!style?.textStrokeColor || !style.textStrokeWidth) return undefined;
  const width = Math.max(0, Math.round(style.textStrokeWidth * scale));
  if (!width) return undefined;
  const offsets: Array<[number, number]> = [];
  for (let x = -width; x <= width; x += 1) {
    for (let y = -width; y <= width; y += 1) {
      if (x === 0 && y === 0) continue;
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= width + 0.25) offsets.push([x, y]);
    }
  }
  return offsets.map(([x, y]) => `${x}px ${y}px 0 ${style.textStrokeColor}`).join(", ");
}

export function buildFlipTransform(style: Slot["style"]): string {
  const sx = style?.flipH ? -1 : 1;
  const sy = style?.flipV ? -1 : 1;
  if (sx === 1 && sy === 1) return "";
  return ` scale(${sx}, ${sy})`;
}

/** Build linear-gradient CSS từ style. Trả về undefined nếu không bật. */
export function buildGradient(style: Slot["style"]): string | undefined {
  if (!style?.gradientEnabled) return undefined;
  const from = style.gradientFrom ?? "#000000";
  const to = style.gradientTo ?? "#ffffff";
  const angle = style.gradientAngle ?? 90;
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

/** Build CSS border từ borderColor/Width/Style. */
export function buildBorder(style: Slot["style"], scale = 1): string | undefined {
  if (!style?.borderColor || !style.borderWidth) return undefined;
  return `${style.borderWidth * scale}px ${style.borderStyle ?? "solid"} ${style.borderColor}`;
}

/** Build CSS style chuẩn cho text — dùng chung 3 nơi (Editor/Bind/Render). */
export function buildTextStyle(style: Slot["style"] | undefined, scale = 1): React.CSSProperties {
  const s = style ?? {};
  const lineHeight =
    typeof s.lineHeight === "number" && Number.isFinite(s.lineHeight)
      ? Math.max(0.8, Math.min(3, s.lineHeight))
      : 1.2;
  const textShadows = [buildTextShadow(s, scale), buildTextStrokeFallbackShadow(s, scale)].filter(
    Boolean,
  );
  const css: React.CSSProperties = {
    color: s.color ?? "#0f172a",
    fontFamily: s.fontFamily ? `'${s.fontFamily}', sans-serif` : "'Be Vietnam Pro', sans-serif",
    fontSize: (s.fontSize ?? 24) * scale,
    fontWeight: s.fontWeight ?? 500,
    fontStyle: s.fontStyle ?? "normal",
    textDecoration: s.textDecoration ?? "none",
    lineHeight,
    letterSpacing: (s.letterSpacing ?? 0) * scale,
    textAlign: s.textAlign ?? "left",
    textTransform: s.textTransform ?? "none",
    textShadow: textShadows.length ? textShadows.join(", ") : undefined,
    padding: (s.padding ?? 0) * scale,
    background: s.background,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: s.maxLines && s.maxLines > 0 ? "hidden" : "visible",
  };
  // Text outline is rendered with text-shadow, not WebKit text-stroke, so stroke cannot cover fill.
  // Gradient text
  if (s.gradientEnabled && s.gradientFrom && s.gradientTo) {
    const grad = buildGradient(s)!;
    css.backgroundImage = grad;
    (css as React.CSSProperties & { WebkitBackgroundClip?: string }).WebkitBackgroundClip = "text";
    css.backgroundClip = "text";
    css.color = "transparent";
    (css as React.CSSProperties & { WebkitTextFillColor?: string }).WebkitTextFillColor =
      "transparent";
    css.background = undefined;
  }
  // Max lines (line clamp)
  if (s.maxLines && s.maxLines > 0) {
    css.display = "-webkit-box";
    (css as React.CSSProperties & { WebkitLineClamp?: number }).WebkitLineClamp = s.maxLines;
    (css as React.CSSProperties & { WebkitBoxOrient?: string }).WebkitBoxOrient = "vertical";
  }
  return css;
}

/** Clip-path CSS theo shapeKind, cho ảnh nằm trong shape. */
export function shapeClipPath(shapeKind: NonNullable<Slot["shapeKind"]>): string | undefined {
  if (shapeKind === "triangle") return "polygon(50% 0%, 100% 100%, 0% 100%)";
  return undefined;
}

/** Border radius CSS theo shapeKind (cho rectangle/circle/badge). */
export function shapeBorderRadius(
  shapeKind: NonNullable<Slot["shapeKind"]> | undefined,
  borderRadius: number | undefined,
  scale = 1,
): number | string | undefined {
  if (shapeKind === "circle") return "50%";
  if (shapeKind === "badge") return 9999;
  return (borderRadius ?? 0) * scale;
}
