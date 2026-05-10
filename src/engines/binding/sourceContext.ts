import type { Asset, Entity } from "@/models";

export type BindingSourceKind = "page_primary" | "page_secondary" | "sheet" | "entity_pool" | "asset_pool";

export interface BindingSourceDescriptor {
  id: string;
  kind: BindingSourceKind;
  label: string;
  sheetName?: string;
  entityIds?: string[];
  assetIds?: string[];
  notes?: string;
}

export interface BindingSourceContext {
  primary?: BindingSourceDescriptor;
  secondary?: BindingSourceDescriptor[];
}

export interface BindingSourceLookup {
  entities: Entity[];
  assets: Asset[];
}

export function createBindingSourceDescriptor(input: BindingSourceDescriptor): BindingSourceDescriptor {
  return {
    ...input,
    entityIds: input.entityIds?.filter(Boolean),
    assetIds: input.assetIds?.filter(Boolean),
  };
}

export function pickEntitiesForSource(
  source: BindingSourceDescriptor | undefined,
  lookup: BindingSourceLookup,
): Entity[] {
  if (!source) return lookup.entities;
  if (source.entityIds?.length) {
    const ids = new Set(source.entityIds);
    return lookup.entities.filter((entity) => ids.has(entity.entityId));
  }
  if (source.sheetName) {
    return lookup.entities.filter((entity) => entity.sheetName === source.sheetName);
  }
  return lookup.entities;
}

export function pickAssetsForSource(
  source: BindingSourceDescriptor | undefined,
  lookup: BindingSourceLookup,
): Asset[] {
  if (!source) return lookup.assets;
  if (source.assetIds?.length) {
    const ids = new Set(source.assetIds);
    return lookup.assets.filter((asset) => ids.has(asset.assetId));
  }
  if (source.entityIds?.length) {
    const ids = new Set(source.entityIds);
    return lookup.assets.filter((asset) => ids.has(asset.entityId));
  }
  return lookup.assets;
}

export function mergeBindingSources(
  primary: BindingSourceDescriptor | undefined,
  secondary: BindingSourceDescriptor[] | undefined,
): BindingSourceContext {
  return {
    primary,
    secondary: secondary?.filter(Boolean),
  };
}

export function resolveEntitiesFromContext(
  context: BindingSourceContext | undefined,
  lookup: BindingSourceLookup,
): Entity[] {
  const primary = context?.primary ? pickEntitiesForSource(context.primary, lookup) : lookup.entities;
  if (!context?.secondary?.length) return primary;
  return primary.length > 0 ? primary : pickEntitiesForSource(context.secondary[0], lookup);
}

export function resolveAssetsFromContext(
  context: BindingSourceContext | undefined,
  lookup: BindingSourceLookup,
): Asset[] {
  const primary = context?.primary ? pickAssetsForSource(context.primary, lookup) : lookup.assets;
  if (!context?.secondary?.length) return primary;
  return primary.length > 0 ? primary : pickAssetsForSource(context.secondary[0], lookup);
}
