import { resolveStreamSourceFromBroker } from "../../brokers/capabilities";

export function resolveStreamSourceId(
  source: string,
  category?: string,
  assetType?: string,
): string {
  return resolveStreamSourceFromBroker(source, assetType, category);
}
