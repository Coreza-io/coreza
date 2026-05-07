/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
