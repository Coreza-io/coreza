/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
