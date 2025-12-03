// Preload icon utility to eliminate loading delays
import { nodeManifest, getNodeIcon, NodeConfig } from "@/nodes/manifest";

// Extract all SVG icon paths from the manifest
const getIconPaths = (): string[] => {
  const iconPaths = Object.values(nodeManifest)
    .map(node => getNodeIcon(node as NodeConfig))
    .filter((icon): icon is string => 
      typeof icon === 'string' && icon.startsWith('/assets/')
    );
  
  // Add any additional icons not in manifest
  iconPaths.push('/assets/icons/support-resistance.svg');
  
  return iconPaths;
};

// Preload images by creating image elements
export const preloadIcons = (): void => {
  const iconPaths = getIconPaths();
  
  console.log(`🔄 Preloading ${iconPaths.length} icons:`, iconPaths);
  
  iconPaths.forEach(iconPath => {
    const img = new Image();
    img.src = iconPath;
    
    img.onload = () => {
      console.log(`✅ Successfully preloaded icon: ${iconPath}`);
    };
    
    img.onerror = () => {
      console.error(`❌ Failed to preload icon: ${iconPath}`);
    };
  });
};

// Export the icon paths for other uses
export { getIconPaths };
