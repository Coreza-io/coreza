// Keep local icons available when a deployment cannot serve /assets/icons URLs.
declare const __BUNDLED_NODE_ICONS__: Record<string, string>;

export const getBundledNodeIcon = (src: string): string | undefined => {
  const svg = __BUNDLED_NODE_ICONS__[src];
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined;
};
