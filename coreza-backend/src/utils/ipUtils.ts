/*
 * Copyright (C) 2024 Coreza
 * IP address utilities for rate limit whitelist matching
 */

import { Request } from 'express';

interface WhitelistConfig {
  ips: string[];
  cidrRanges: string[];
}

/**
 * Normalize IP address (handle IPv4-mapped IPv6, etc.)
 */
export function normalizeIp(ip: string): string {
  if (!ip) return '';
  
  // Remove IPv4-mapped IPv6 prefix
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  
  return ip.toLowerCase();
}

/**
 * Parse CIDR notation into IP and prefix length
 */
function parseCidr(cidr: string): { ip: string; prefixLength: number } | null {
  const parts = cidr.split('/');
  if (parts.length !== 2) return null;
  
  const prefixLength = parseInt(parts[1], 10);
  if (isNaN(prefixLength)) return null;
  
  return { ip: parts[0], prefixLength };
}

/**
 * Convert IPv4 address to 32-bit number
 */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) + num;
  }
  return result >>> 0; // Ensure unsigned
}

/**
 * Check if IPv4 address is in CIDR range
 */
function isIpv4InCidr(ip: string, cidrIp: string, prefixLength: number): boolean {
  const ipNum = ipv4ToNumber(ip);
  const cidrNum = ipv4ToNumber(cidrIp);
  
  if (ipNum === null || cidrNum === null) return false;
  
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

/**
 * Expand IPv6 address to full form
 */
function expandIpv6(ip: string): string | null {
  // Handle :: expansion
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  
  let groups: string[];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill('0000'), ...right];
  } else {
    groups = ip.split(':');
  }
  
  if (groups.length !== 8) return null;
  
  return groups.map(g => g.padStart(4, '0')).join(':');
}

/**
 * Check if IPv6 address is in CIDR range
 */
function isIpv6InCidr(ip: string, cidrIp: string, prefixLength: number): boolean {
  const expandedIp = expandIpv6(ip);
  const expandedCidr = expandIpv6(cidrIp);
  
  if (!expandedIp || !expandedCidr) return false;
  
  // Convert to binary string for comparison
  const ipBin = expandedIp.replace(/:/g, '').split('').map(c => 
    parseInt(c, 16).toString(2).padStart(4, '0')
  ).join('');
  
  const cidrBin = expandedCidr.replace(/:/g, '').split('').map(c => 
    parseInt(c, 16).toString(2).padStart(4, '0')
  ).join('');
  
  return ipBin.substring(0, prefixLength) === cidrBin.substring(0, prefixLength);
}

/**
 * Check if an IP address is within a CIDR range
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;
  
  const normalizedIp = normalizeIp(ip);
  const isIpv6 = normalizedIp.includes(':');
  const isCidrIpv6 = parsed.ip.includes(':');
  
  // IP version must match CIDR version
  if (isIpv6 !== isCidrIpv6) return false;
  
  if (isIpv6) {
    return isIpv6InCidr(normalizedIp, parsed.ip, parsed.prefixLength);
  } else {
    return isIpv4InCidr(normalizedIp, parsed.ip, parsed.prefixLength);
  }
}

/**
 * Check if an IP is in the whitelist (exact match or CIDR)
 */
export function isIpWhitelisted(ip: string, whitelist: WhitelistConfig): boolean {
  if (!ip) return false;
  
  const normalizedIp = normalizeIp(ip);
  
  // Check exact IP match
  for (const whitelistedIp of whitelist.ips) {
    if (normalizeIp(whitelistedIp) === normalizedIp) {
      return true;
    }
  }
  
  // Check CIDR ranges
  for (const cidr of whitelist.cidrRanges) {
    if (isIpInCidr(ip, cidr)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get client IP from request (handles proxies)
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}
