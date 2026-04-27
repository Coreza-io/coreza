export function resolveStreamSourceId(
  source: string,
  category?: string,
  assetType?: string,
): string {
  const normalizedAsset = (assetType || "").toLowerCase();
  const normalizedCategory = (category || "").toLowerCase();

  if (source === "alpaca" && normalizedAsset === "crypto") {
    return "alpaca_crypto";
  }
  if (source === "alpaca" && normalizedAsset === "news") {
    return "alpaca_news";
  }
  if (source === "alpaca" && normalizedAsset === "stock") {
    return "alpaca_market";
  }

  if (normalizedCategory) {
    return `${source}_${normalizedCategory}`;
  }

  if (normalizedAsset) {
    return `${source}_${normalizedAsset}`;
  }

  return source;
}
