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

/**
 * Helper functions to handle both old and new node schema formats.
 * 
 * Old format: flat properties (icon, color, description at root)
 * New format: nested in ui object (ui.icon, ui.color, ui.description)
 */

type AnyNodeDef = Record<string, any>;

/**
 * Get the icon path from a node definition, handling both schema formats
 */
export function getNodeIcon(node: AnyNodeDef): string | undefined {
  // Old format: flat icon property
  if (typeof node.icon === 'string') {
    return node.icon;
  }
  // New format: nested in ui object
  if (node.ui && typeof node.ui.icon === 'string') {
    return node.ui.icon;
  }
  return undefined;
}

/**
 * Get the description from a node definition, handling both schema formats
 */
export function getNodeDescription(node: AnyNodeDef): string | undefined {
  // Old format: flat description property
  if (typeof node.description === 'string') {
    return node.description;
  }
  // New format: nested in ui object
  if (node.ui && typeof node.ui.description === 'string') {
    return node.ui.description;
  }
  return undefined;
}

/**
 * Get the color from a node definition, handling both schema formats
 */
export function getNodeColor(node: AnyNodeDef): string | undefined {
  // Old format: flat color property
  if (typeof node.color === 'string') {
    return node.color;
  }
  // New format: nested in ui object
  if (node.ui && typeof node.ui.color === 'string') {
    return node.ui.color;
  }
  return undefined;
}

/**
 * Get the display label from a node definition
 * Falls back to name if label not present
 */
export function getNodeLabel(node: AnyNodeDef): string {
  // New format has explicit label
  if (typeof node.label === 'string') {
    return node.label;
  }
  // Old format uses name as display
  return node.name || 'Unknown Node';
}
