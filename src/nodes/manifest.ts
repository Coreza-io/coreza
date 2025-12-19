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

// Auto-discover all *.json node definitions in this directory
const nodeModules = import.meta.glob('./*.json', { eager: true });

// Node configuration interface
export interface NodeConfig {
  name: string;
  def: string;
  node_type: string;
  category?: string;
  description?: string;
  color?: string;
  parentNode?: string;
  handles: { type: string; position: string; id: string }[];
  auth?: string;
  authFields?: {
    key: string;
    label: string;
    type: string;
    value?: string;
    default?: string;
    placeholder?: string;
    required?: boolean;
  }[];
  authAction?: { url: string; method: string };  
  icon?: string;
  size?: { width: number; height: number };
  action?: { url: string; method: string };
  fields: {
    key: string;
    label: string;
    type: string;
    subFields?: {
      key: string;
      type: string;
      options?: {
        label: string;
        value: string;
      }[];
      placeholder?: string;
    }[];
    options?: {
      id?: string;
      name?: string;
      method?: string;
      label?: string;
      value?: string;
    }[];
    optionsSource?: string;
    required?: boolean;
    placeholder?: string;
    default?: any;
    displayOptions?: {
      show?: {
        [key: string]: string[];
      };
    };
  }[];
}

// Build manifest dynamically from discovered modules
const buildManifest = (): Record<string, NodeConfig> => {
  const manifest: Record<string, NodeConfig> = {};
  
  for (const [path, module] of Object.entries(nodeModules)) {
    const def = (module as any).default || module;
    if (def?.name) {
      manifest[def.name] = def;
    }
  }
  
  return manifest;
};

export const nodeManifest = buildManifest();

export type ManifestEntry = NodeConfig;
