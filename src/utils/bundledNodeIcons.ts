// Keep local icons available when a deployment cannot serve /assets/icons URLs.
const icons = import.meta.glob<string>("/public/assets/icons/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

export const getBundledNodeIcon = (src: string): string | undefined => {
  const svg = icons[`/public${src}`];
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined;
};
