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

import * as fs from 'fs';
import * as path from 'path';

export interface NodeField {
  key: string;
  label?: string;
  type: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  default?: any;
  options?: Array<{ id: string; name: string }>;
  displayOptions?: any;
}

export interface NodeDefinition {
  name: string;
  def?: string;
  description?: string;
  node_type?: string;
  category?: string;
  icon?: string;
  fields?: NodeField[];
  handles?: any[];
  action?: any;
  size?: any;
}

// Cache for loaded node definitions
const nodeDefinitionCache = new Map<string, NodeDefinition | null>();

/**
 * Load a node definition from the frontend JSON files
 */
export function loadNodeDefinition(nodeName: string): NodeDefinition | null {
  // Check cache first
  if (nodeDefinitionCache.has(nodeName)) {
    return nodeDefinitionCache.get(nodeName) || null;
  }

  // Try different possible file paths
  const possiblePaths = [
    // Tool version first
    path.join(__dirname, '../../../src/nodes', `${nodeName}Tool.json`),
    // Base version
    path.join(__dirname, '../../../src/nodes', `${nodeName}.json`),
    // If it already has Tool suffix, try without
    path.join(__dirname, '../../../src/nodes', `${nodeName.replace(/Tool$/, '')}.json`),
    // Try exact name
    path.join(__dirname, '../../../src/nodes', `${nodeName}.json`),
  ];

  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const definition = JSON.parse(content) as NodeDefinition;
        nodeDefinitionCache.set(nodeName, definition);
        console.log(`📋 [NodeDefs] Loaded definition for ${nodeName} from ${path.basename(filePath)}`);
        return definition;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  // Cache the miss to avoid repeated lookups
  nodeDefinitionCache.set(nodeName, null);
  console.log(`⚠️ [NodeDefs] No definition found for ${nodeName}`);
  return null;
}

/**
 * Get fields from a node definition
 */
export function getNodeFields(nodeName: string): NodeField[] {
  const definition = loadNodeDefinition(nodeName);
  return definition?.fields || [];
}

/**
 * Clear the definition cache (useful for development/testing)
 */
export function clearNodeDefinitionCache(): void {
  nodeDefinitionCache.clear();
}
