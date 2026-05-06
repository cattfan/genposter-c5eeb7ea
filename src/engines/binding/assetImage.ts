import type { Asset } from "@/models";
import { isUsableImageAsset } from "@/features/data/imageReferences";

function isDirectImageSource(src: string): boolean {
  return (
    src.startsWith("idb://") ||
    src.startsWith("data:image/") ||
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("blob:")
  );
}

export function getAssetImageSource(asset: Asset | undefined): string | undefined {
  if (!asset) return undefined;
  if (asset.blobKey) return `idb://${asset.blobKey}`;
  if (
    asset.sourceType === "local" &&
    asset.sourceValue &&
    !isDirectImageSource(asset.sourceValue)
  ) {
    return `idb://${asset.sourceValue}`;
  }
  return asset.sourceValue || undefined;
}

export function isRenderableAsset(asset: Asset | undefined): asset is Asset {
  if (!isUsableImageAsset(asset)) return false;
  const src = getAssetImageSource(asset);
  if (!src) return false;
  if (src.startsWith("blob:") && !asset.blobKey) return false;
  return true;
}

export function filterRenderableAssets(assets: Asset[]): Asset[] {
  return assets.filter(isRenderableAsset);
}
