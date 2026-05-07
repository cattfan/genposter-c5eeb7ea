import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
import * as HeroiconsOutline from "@heroicons/react/24/outline";
import * as HeroiconsSolid from "@heroicons/react/24/solid";
import * as LucideIcons from "lucide-react";
import { getIconData } from "@iconify/utils/lib/icon-set/get-icon";
import { iconToSVG } from "@iconify/utils/lib/svg/build";
import { iconToHTML } from "@iconify/utils/lib/svg/html";
import type { IconifyJSON } from "@iconify/types";
import type { AssetItem } from "@/models";

const NOW = 1;
const LUCIDE_ICON_COLLECTION =
  (LucideIcons as unknown as { icons?: Record<string, unknown> }).icons ?? {};
const ICONIFY_SVG_CACHE = new Map<string, string>();

export type HeroiconComponent = ForwardRefExoticComponent<
  Omit<SVGProps<SVGSVGElement>, "ref"> & RefAttributes<SVGSVGElement>
>;

type IconStyleGroup = "line" | "solid" | "color";
type IconifyCollectionKey = "mdi" | "fa6-solid" | "solar" | "fluent-emoji-flat";
type IconifyCollection = IconifyJSON;
type IconifyMetadata = {
  categories?: Record<string, string[]>;
};
export type CuratedIconifyCollection = {
  collection: IconifyCollectionKey;
  label: string;
  icons: IconifyCollection;
  metadata?: IconifyMetadata;
};

export interface HeroiconAsset extends AssetItem {
  component?: HeroiconComponent;
  iconName: string;
  variant: "outline" | "solid" | "lucide" | "iconify";
  provider: "heroicons" | "lucide" | "iconify";
  collection?: IconifyCollectionKey;
  styleGroup: IconStyleGroup;
  searchText: string;
  svgContent?: string;
}

function titleCaseFromIconName(name: string) {
  return name
    .replace(/Icon$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "d")
    .toLowerCase();
}

function tagsFromIconName(name: string) {
  const tags = titleCaseFromIconName(name).toLowerCase().split(" ").filter(Boolean);
  const searchText = tags.join(" ");
  const aliases: string[] = [];

  if (/(map|pin|location|marker|navigation|compass|route|waypoint|globe)/.test(searchText)) {
    aliases.push(
      "location",
      "place",
      "marker",
      "map marker",
      "gps",
      "address",
      "check in",
      "checkin",
      "dia diem",
      "vi tri",
      "dia chi",
      "ban do",
      "ghim",
      "o dau",
    );
  }
  if (/(phone|call|device-phone|mobile)/.test(searchText)) {
    aliases.push("sdt", "so dien thoai", "dien thoai", "hotline", "lien he");
  }
  if (/(home|house|building|store|shop|hotel|bed|landmark)/.test(searchText)) {
    aliases.push("quan", "cua hang", "khach san", "nha", "toa nha", "dia diem");
  }
  if (/(photo|image|camera|video|gallery|picture)/.test(searchText)) {
    aliases.push("anh", "hinh", "hinh anh", "camera", "media");
  }
  if (/(food|utensil|coffee|cup|wine|beer|pizza|cake|soup)/.test(searchText)) {
    aliases.push("an uong", "mon an", "do an", "cafe", "quan an", "nha hang");
  }
  if (/(star|heart|sparkle|fire|bolt|badge|shield|check|x|plus|minus)/.test(searchText)) {
    aliases.push("danh dau", "noi bat", "tick", "kiem tra", "them", "xoa");
  }
  if (/(calendar|clock|time|alarm)/.test(searchText)) {
    aliases.push("lich", "gio", "thoi gian", "gio mo cua");
  }

  return Array.from(new Set([...tags, ...aliases, ...aliases.map(normalizedSearchText)]));
}

function buildSearchText(name: string, tags: string[]) {
  return normalizedSearchText([name, ...tags].join(" "));
}

function buildHeroiconAssets(collection: Record<string, unknown>, variant: "outline" | "solid") {
  return Object.entries(collection)
    .filter(([name, value]) => name.endsWith("Icon") && !!value)
    .map(([name, value]) => {
      const assetName = `${titleCaseFromIconName(name)} (${variant})`;
      const tags = [...tagsFromIconName(name), "heroicons", variant, "line"];
      return {
        assetId: `heroicon-${variant}-${name}`,
        name: assetName,
        kind: "icon" as const,
        sourceType: "inline" as const,
        sourceValue: `${variant}:${name}`,
        iconName: `${variant}:${name}`,
        variant,
        provider: "heroicons" as const,
        styleGroup: variant === "outline" ? ("line" as const) : ("solid" as const),
        component: value as HeroiconComponent,
        tags,
        searchText: buildSearchText(assetName, tags),
        mime: "image/svg+xml",
        createdAt: NOW,
        updatedAt: NOW,
      };
    });
}

function buildLucideAssets(collection: Record<string, unknown>) {
  return Object.entries(collection)
    .filter(([, value]) => !!value && typeof value === "object" && "$$typeof" in value)
    .map(([name, value]) => {
      const assetName = `${titleCaseFromIconName(name)} (lucide)`;
      const tags = [...tagsFromIconName(name), "lucide", "outline", "line"];
      return {
        assetId: `lucide-${name}`,
        name: assetName,
        kind: "icon" as const,
        sourceType: "inline" as const,
        sourceValue: `lucide:${name}`,
        iconName: `lucide:${name}`,
        variant: "lucide" as const,
        provider: "lucide" as const,
        styleGroup: "line" as const,
        component: value as HeroiconComponent,
        tags,
        searchText: buildSearchText(assetName, tags),
        mime: "image/svg+xml",
        createdAt: NOW,
        updatedAt: NOW,
      };
    });
}

function buildIconifyCategoryMap(metadata: IconifyMetadata | undefined) {
  const categoryMap = new Map<string, string[]>();
  for (const [category, names] of Object.entries(metadata?.categories ?? {})) {
    const categoryTags = titleCaseFromIconName(category).toLowerCase().split(" ").filter(Boolean);
    for (const name of names) {
      const current = categoryMap.get(name) ?? [];
      categoryMap.set(name, [...current, ...categoryTags]);
    }
  }
  return categoryMap;
}

function inferIconifyStyleGroup(collection: IconifyCollectionKey, name: string): IconStyleGroup {
  if (collection === "fluent-emoji-flat") return "color";
  if (/(outline|outlined|linear|line|broken|thin|light)/i.test(name)) return "line";
  return "solid";
}

const iconifyCollections: Partial<Record<IconifyCollectionKey, IconifyCollection>> = {};
let extendedIconLibraryPromise: Promise<HeroiconAsset[]> | null = null;

function buildIconifyAssets({
  collection,
  icons,
  metadata,
  label,
}: {
  collection: IconifyCollectionKey;
  icons: IconifyCollection;
  metadata?: IconifyMetadata;
  label: string;
}) {
  iconifyCollections[collection] = icons;
  const categoryMap = buildIconifyCategoryMap(metadata);
  return Object.keys(icons.icons).map((name) => {
    const assetName = `${titleCaseFromIconName(name)} (${label})`;
    const styleGroup = inferIconifyStyleGroup(collection, name);
    const tags = [
      ...tagsFromIconName(name),
      ...(categoryMap.get(name) ?? []),
      collection,
      label,
      "iconify",
      styleGroup,
      styleGroup === "color" ? "emoji" : "",
      styleGroup === "color" ? "sticker" : "",
      styleGroup === "color" ? "mau" : "",
    ].filter(Boolean);
    return {
      assetId: `iconify-${collection}-${name}`,
      name: assetName,
      kind: "icon" as const,
      sourceType: "inline" as const,
      sourceValue: `iconify:${collection}:${name}`,
      iconName: `iconify:${collection}:${name}`,
      variant: "iconify" as const,
      provider: "iconify" as const,
      collection,
      styleGroup,
      tags,
      searchText: buildSearchText(assetName, tags),
      mime: "image/svg+xml",
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies HeroiconAsset;
  });
}

const HEROICON_ASSETS: HeroiconAsset[] = [
  ...buildHeroiconAssets(HeroiconsOutline, "outline"),
  ...buildHeroiconAssets(HeroiconsSolid, "solid"),
  ...buildLucideAssets(LUCIDE_ICON_COLLECTION),
].sort((a, b) => a.name.localeCompare(b.name));

export function getBuiltInAssetLibrary(): HeroiconAsset[] {
  return HEROICON_ASSETS;
}

export function loadExtendedIconLibrary(): Promise<HeroiconAsset[]> {
  extendedIconLibraryPromise ??= import("./iconifyCurated").then(
    ({ CURATED_ICONIFY_COLLECTIONS }) =>
      CURATED_ICONIFY_COLLECTIONS.flatMap((entry) =>
        buildIconifyAssets({
          collection: entry.collection,
          icons: entry.icons,
          metadata: entry.metadata,
          label: entry.label,
        }),
      ).sort((a, b) => a.name.localeCompare(b.name)),
  );
  return extendedIconLibraryPromise;
}

export function getHeroiconComponent(iconName: string | undefined): HeroiconComponent | undefined {
  if (!iconName) return undefined;
  const [variant, rawName] = iconName.includes(":")
    ? (iconName.split(":") as [HeroiconAsset["variant"], string])
    : (["outline", iconName] as const);
  const registry =
    variant === "iconify"
      ? undefined
      : variant === "lucide"
        ? LUCIDE_ICON_COLLECTION
        : variant === "solid"
          ? HeroiconsSolid
          : HeroiconsOutline;
  if (!registry) return undefined;
  const found = registry[rawName as keyof typeof registry];
  return found ? (found as HeroiconComponent) : undefined;
}

export function isHeroiconAsset(asset: AssetItem | HeroiconAsset): asset is HeroiconAsset {
  return "iconName" in asset && typeof asset.iconName === "string";
}

export function normalizeIconSearch(value: string) {
  return normalizedSearchText(value);
}

export function getBuiltInIconSvg(asset: HeroiconAsset): string {
  if (asset.svgContent) return asset.svgContent;
  if (asset.provider !== "iconify" || !asset.collection) return "";
  const cached = ICONIFY_SVG_CACHE.get(asset.iconName);
  if (cached) return cached;

  const [, collection, name] = asset.iconName.split(":") as [
    "iconify",
    IconifyCollectionKey,
    string,
  ];
  const iconSet = iconifyCollections[collection];
  if (!iconSet || !name) return "";
  const icon = getIconData(iconSet, name);
  if (!icon) return "";
  const svg = iconToSVG(icon, { width: "1em", height: "1em" });
  const html = iconToHTML(svg.body, {
    ...svg.attributes,
    width: "100%",
    height: "100%",
    preserveAspectRatio: "xMidYMid meet",
  });
  ICONIFY_SVG_CACHE.set(asset.iconName, html);
  return html;
}
