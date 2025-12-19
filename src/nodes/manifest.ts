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

import { NodeConfigSchema, type NodeConfig } from "./schemas/nodeSchema";

// Auto-discover all *.json node definitions in this directory
const nodeModules = import.meta.glob("./*.json", { eager: true });

// Build manifest dynamically from discovered modules
const buildManifest = (): Record<string, NodeConfig> => {
  const manifest: Record<string, NodeConfig> = {};
  
  for (const [path, module] of Object.entries(nodeModules)) {
    const def = (module as any).default || module;

    if (import.meta.env.DEV) {
      const result = NodeConfigSchema.safeParse(def);
      if (!result.success) {
        console.error(`Invalid node config: ${path}`, result.error.errors);
      }
    }

    if (def?.name) {
      manifest[def.name] = def as NodeConfig;
    }
  }
  
  return manifest;
};

export const nodeManifest = buildManifest();

export type ManifestEntry = NodeConfig;
export type { NodeConfig };
export { NodeConfigSchema };
