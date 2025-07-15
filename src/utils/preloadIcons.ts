// Preload icon utility to eliminate loading delays
import { nodeManifest } from "@/nodes/manifest";

// Extract all SVG icon paths from the manifest
const getIconPaths = (): string[] => {
  return Object.values(nodeManifest)
    .map(node => node.icon)
    .filter((icon): icon is string => 
      typeof icon === 'string' && icon.startsWith('/assets/')
    );
};

// Preload images by creating image elements
export const preloadIcons = (): void => {
  const iconPaths = getIconPaths();
  
  iconPaths.forEach(iconPath => {
    const img = new Image();
    img.src = iconPath;
    // Optional: Add error handling
    img.onerror = () => {
      console.warn(`Failed to preload icon: ${iconPath}`);
    };
  });
};

// Export the icon paths for other uses
export { getIconPaths };