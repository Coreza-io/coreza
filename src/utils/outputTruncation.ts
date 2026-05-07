/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export interface TruncationStats {
  totalItems?: number;
  truncatedAt?: number;
  hasMore: boolean;
  type?: 'array' | 'object' | 'string' | 'bars';
}

export interface TruncatedResult {
  data: any;
  stats: TruncationStats;
}

// Configuration for truncation limits
const LIMITS = {
  MAX_ARRAY_PREVIEW: 10,      // Show first 10 items of arrays
  MAX_OBJECT_KEYS: 20,        // Show first 20 keys of objects
  MAX_STRING_LENGTH: 500,     // Truncate strings longer than this
  MAX_DEPTH: 4,               // Maximum nesting depth
  BARS_THRESHOLD: 100,        // Arrays with >100 items that look like bars get special handling
};

/**
 * Detect if an array contains financial bar/candle data
 */
export function isBarsArray(data: any[]): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  
  const sample = data[0];
  if (typeof sample !== 'object' || sample === null) return false;
  
  // Check for common bar data fields
  const barFields = ['t', 'timestamp', 'time', 'date'];
  const priceFields = ['o', 'h', 'l', 'c', 'open', 'high', 'low', 'close'];
  
  const hasTime = barFields.some(f => f in sample);
  const hasPrice = priceFields.some(f => f in sample);
  
  return hasTime && hasPrice;
}

/**
 * Get summary statistics for bars data
 */
export function getBarsStats(bars: any[]): {
  count: number;
  dateRange: string;
  priceRange: string;
} | null {
  if (!bars?.length) return null;
  
  try {
    const first = bars[0];
    const last = bars[bars.length - 1];
    
    // Get timestamp
    const getTime = (bar: any) => bar.t || bar.timestamp || bar.time || bar.date || '';
    const firstTime = getTime(first);
    const lastTime = getTime(last);
    
    // Get prices
    const getLow = (bar: any) => bar.l ?? bar.low ?? 0;
    const getHigh = (bar: any) => bar.h ?? bar.high ?? 0;
    
    // Sample for price range (don't iterate all 2.5M bars)
    const sampleSize = Math.min(bars.length, 1000);
    const step = Math.max(1, Math.floor(bars.length / sampleSize));
    
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    for (let i = 0; i < bars.length; i += step) {
      const low = getLow(bars[i]);
      const high = getHigh(bars[i]);
      if (typeof low === 'number' && low < minPrice) minPrice = low;
      if (typeof high === 'number' && high > maxPrice) maxPrice = high;
    }
    
    return {
      count: bars.length,
      dateRange: `${firstTime} → ${lastTime}`,
      priceRange: minPrice !== Infinity 
        ? `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`
        : 'N/A',
    };
  } catch {
    return { count: bars.length, dateRange: 'N/A', priceRange: 'N/A' };
  }
}

/**
 * Truncate data for display, preserving structure but limiting size
 */
export function truncateForDisplay(data: any, depth = 0): TruncatedResult {
  // Null/undefined pass through
  if (data === null || data === undefined) {
    return { data, stats: { hasMore: false } };
  }

  // Handle arrays
  if (Array.isArray(data)) {
    const total = data.length;
    
    // Check if it's bars data
    if (total > LIMITS.BARS_THRESHOLD && isBarsArray(data)) {
      return {
        data: {
          __truncated: true,
          __type: 'bars',
          __stats: getBarsStats(data),
          __preview: data.slice(0, 3),
        },
        stats: { 
          totalItems: total, 
          truncatedAt: 3, 
          hasMore: true, 
          type: 'bars' 
        },
      };
    }
    
    // Regular array truncation
    if (total > LIMITS.MAX_ARRAY_PREVIEW) {
      const preview = data.slice(0, LIMITS.MAX_ARRAY_PREVIEW).map(
        item => depth < LIMITS.MAX_DEPTH ? truncateForDisplay(item, depth + 1).data : '[...]'
      );
      return {
        data: {
          __truncated: true,
          __type: 'array',
          __total: total,
          __preview: preview,
        },
        stats: { 
          totalItems: total, 
          truncatedAt: LIMITS.MAX_ARRAY_PREVIEW, 
          hasMore: true,
          type: 'array',
        },
      };
    }
    
    // Small array - process each item
    return {
      data: data.map(item => 
        depth < LIMITS.MAX_DEPTH ? truncateForDisplay(item, depth + 1).data : '[...]'
      ),
      stats: { hasMore: false },
    };
  }

  // Handle objects
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    const total = keys.length;
    
    // Check if object has a 'bars' key with large array
    if (data.bars && Array.isArray(data.bars) && data.bars.length > LIMITS.BARS_THRESHOLD) {
      const truncated: any = {};
      for (const key of keys.slice(0, LIMITS.MAX_OBJECT_KEYS)) {
        if (key === 'bars') {
          truncated[key] = truncateForDisplay(data[key], depth + 1).data;
        } else if (depth < LIMITS.MAX_DEPTH) {
          truncated[key] = truncateForDisplay(data[key], depth + 1).data;
        } else {
          truncated[key] = '[...]';
        }
      }
      return {
        data: truncated,
        stats: { totalItems: total, hasMore: total > LIMITS.MAX_OBJECT_KEYS, type: 'object' },
      };
    }
    
    // Regular object truncation
    if (total > LIMITS.MAX_OBJECT_KEYS) {
      const truncated: any = { __truncated: true, __totalKeys: total };
      for (const key of keys.slice(0, LIMITS.MAX_OBJECT_KEYS)) {
        truncated[key] = depth < LIMITS.MAX_DEPTH 
          ? truncateForDisplay(data[key], depth + 1).data 
          : '[...]';
      }
      return {
        data: truncated,
        stats: { totalItems: total, truncatedAt: LIMITS.MAX_OBJECT_KEYS, hasMore: true, type: 'object' },
      };
    }
    
    // Small object - process each key
    const result: any = {};
    for (const key of keys) {
      result[key] = depth < LIMITS.MAX_DEPTH 
        ? truncateForDisplay(data[key], depth + 1).data 
        : '[...]';
    }
    return { data: result, stats: { hasMore: false } };
  }

  // Handle strings
  if (typeof data === 'string' && data.length > LIMITS.MAX_STRING_LENGTH) {
    return {
      data: data.slice(0, LIMITS.MAX_STRING_LENGTH) + '...',
      stats: { totalItems: data.length, truncatedAt: LIMITS.MAX_STRING_LENGTH, hasMore: true, type: 'string' },
    };
  }

  // Primitives pass through
  return { data, stats: { hasMore: false } };
}

/**
 * Get a human-readable summary of data
 */
export function getDataSummary(data: any): string {
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';
  
  if (Array.isArray(data)) {
    if (isBarsArray(data)) {
      return `${data.length.toLocaleString()} bars`;
    }
    return `Array[${data.length.toLocaleString()}]`;
  }
  
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    return `Object with ${keys.length} keys`;
  }
  
  if (typeof data === 'string') {
    return data.length > 50 ? `"${data.slice(0, 50)}..."` : `"${data}"`;
  }
  
  return String(data);
}
