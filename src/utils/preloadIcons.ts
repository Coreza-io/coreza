/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Preload icon utility to eliminate loading delays
import { nodeManifest } from "@/nodes/manifest";

// Extract all SVG icon paths from the manifest
const getIconPaths = (): string[] => {
  const iconPaths = Object.values(nodeManifest)
    .map(node => node.icon)
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