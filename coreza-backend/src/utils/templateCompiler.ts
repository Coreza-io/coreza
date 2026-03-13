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

import { WorkflowNode } from "../nodes/types";

/**
 * Template Pre-Compilation
 * ========================
 * Parses {{ $json.x.y }} and {{ $('Node').json.x.y }} templates at workflow
 * load time into direct accessor functions, eliminating per-bar regex parsing,
 * path splitting, and pickJsonSource probing.
 */

// Matches the same patterns as resolveReferences but used once at compile time
const TEMPLATE_REGEX =
  /\{\{\s*(?:(?:\$\(\s*(?:'([^']+)'|"([^"]+)")\s*\)\s*\.json)|(?:\$node\[\s*(?:"([^"]+)"|'([^']+)')\s*\]\s*\.json)|(?:\$json))(?:(?:\s*\.\s*)|\s*)([^}]*)\s*\}\}/g;

// Detects unsupported dynamic patterns that must fall back to runtime resolution
const UNSUPPORTED_PATTERNS = /\$parentStore|\$env|\$execution/;

type AccessorFn = (allNodeData: Record<string, any>, input: any) => any;

export interface CompiledNodeParams {
  hasTemplates: boolean;
  /** For nodes with zero templates — just return these directly */
  staticParams?: Record<string, any>;
  /** For nodes with templates — resolves all params in one call */
  resolve?: (allNodeData: Record<string, any>, input: any) => Record<string, any>;
  /** Keys that need runtime fallback resolution (unsupported patterns) */
  fallbackKeys?: string[];
}

/**
 * Resolve a display name / label to a node ID at compile time.
 * Same logic as resolveNodeKey in resolveReferences.ts but executed once.
 */
function resolveNodeKeyStatic(
  nodeName: string,
  nodeIdSet: Set<string>,
  nodes: WorkflowNode[],
): string {
  if (!nodeName) return nodeName;
  // Already an ID?
  if (nodeIdSet.has(nodeName)) return nodeName;
  // Search by display name / label
  const candidate = nodes.find(
    (n) =>
      (n as any).id === nodeName ||
      (n as any).label === nodeName ||
      (n as any).name === nodeName ||
      (n as any).data?.title === nodeName ||
      (n as any).data?.name === nodeName ||
      (n as any).data?.label === nodeName ||
      (n as any).data?.displayName === nodeName,
  );
  return candidate?.id ?? nodeName;
}

/**
 * pickJsonSource at runtime — tries the most common shapes first.
 * This is the same fallback chain as resolveReferences.ts but we inline it
 * into compiled accessors so it only runs when the shape is unknown.
 */
function pickJsonSource(d: any): any {
  if (d == null) return d;
  if (d.json !== undefined) return d.json;
  if (d.output?.json !== undefined) return d.output.json;
  if (d.output !== undefined) return d.output;
  if (d.input?.json !== undefined) return d.input.json;
  if (d.input !== undefined) return d.input;
  if (d.data?.output?.json !== undefined) return d.data.output.json;
  if (d.data?.output !== undefined) return d.data.output;
  if (d.data?.input?.json !== undefined) return d.data.input.json;
  if (d.data?.input !== undefined) return d.data.input;
  return d;
}

/**
 * Build a one-shot shape extractor that caches the data path on first call.
 * Eliminates repeated pickJsonSource probing after the first bar.
 */
function buildShapeExtractor(sample: any): (d: any) => any {
  if (sample == null) return pickJsonSource;
  if (sample.json !== undefined) return (d: any) => d.json;
  if (sample.output?.json !== undefined) return (d: any) => d.output.json;
  if (sample.output !== undefined) return (d: any) => d.output;
  if (sample.input?.json !== undefined) return (d: any) => d.input.json;
  if (sample.input !== undefined) return (d: any) => d.input;
  if (sample.data?.output?.json !== undefined) return (d: any) => d.data.output.json;
  if (sample.data?.output !== undefined) return (d: any) => d.data.output;
  if (sample.data?.input?.json !== undefined) return (d: any) => d.data.input.json;
  if (sample.data?.input !== undefined) return (d: any) => d.data.input;
  return (d: any) => d;
}

/**
 * Format a value for mixed-string interpolation.
 */
function formatMixedValue(val: any): string {
  if (val === undefined) return "";
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object" && val !== null) return JSON.stringify(val);
  return String(val);
}

/**
 * Build a fast property accessor from a dot-path like "data.currentValue".
 * Only handles simple dot/bracket paths (no slices, no negative indices).
 * Returns null if the path contains advanced syntax that needs runtime parsing.
 */
function buildPathAccessor(path: string): ((obj: any) => any) | null {
  if (!path) return (obj: any) => obj;

  // Bail on slice syntax or anything we can't statically compile
  if (path.includes(":") || path.includes("[")) {
    // Check if it's simple bracket notation like [0] or ["key"]
    const simpleBracket = /\[(\d+)\]/g;
    const withoutSimple = path.replace(simpleBracket, ".$1");
    if (withoutSimple.includes("[")) return null; // complex bracket, bail
    path = withoutSimple;
  }

  const keys = path.split(".").filter(Boolean);
  if (keys.length === 0) return (obj: any) => obj;

  // Generate an optimized accessor for common depths
  if (keys.length === 1) {
    const k = keys[0];
    return (obj: any) => obj?.[k];
  }
  if (keys.length === 2) {
    const [k1, k2] = keys;
    return (obj: any) => obj?.[k1]?.[k2];
  }
  if (keys.length === 3) {
    const [k1, k2, k3] = keys;
    return (obj: any) => obj?.[k1]?.[k2]?.[k3];
  }

  // General case
  return (obj: any) => {
    let result = obj;
    for (let i = 0; i < keys.length; i++) {
      if (result == null) return undefined;
      result = result[keys[i]];
    }
    return result;
  };
}

/**
 * Compile a single template string into an accessor function.
 *
 * For a pure template (entire string is one {{ }} expression), the accessor
 * preserves the original type (number, object, etc.).
 *
 * For mixed strings ("prefix {{ X }} suffix"), the accessor returns a string
 * with interpolated values.
 *
 * Returns null if the template uses unsupported patterns and must fall back
 * to runtime resolution.
 */
function compileTemplate(
  templateStr: string,
  nodeIdSet: Set<string>,
  nodes: WorkflowNode[],
): AccessorFn | null {
  // Check for unsupported dynamic patterns
  if (UNSUPPORTED_PATTERNS.test(templateStr)) return null;

  // Collect all matches
  const matches: Array<{
    fullMatch: string;
    start: number;
    end: number;
    accessor: AccessorFn;
  }> = [];

  let m: RegExpExecArray | null;
  TEMPLATE_REGEX.lastIndex = 0;

  while ((m = TEMPLATE_REGEX.exec(templateStr))) {
    const [full, g1, g1b, g2, g3, rawPath] = m;
    const nodeName = (g1 || g1b || g2 || g3 || "").trim();
    const cleanPath = (rawPath || "").trim().replace(/^[.\s]+/, "");

    const pathAccessor = buildPathAccessor(cleanPath);
    if (!pathAccessor) return null; // complex path, fall back

    let accessor: AccessorFn;

    if (nodeName) {
      // Cross-node reference: {{ $('NodeName').json.path }}
      const resolvedId = resolveNodeKeyStatic(nodeName, nodeIdSet, nodes);
      let cachedExtractor: ((d: any) => any) | null = null;
      accessor = (allNodeData, _input) => {
        const nodeData = allNodeData[resolvedId];
        if (nodeData === undefined) return undefined;
        if (!cachedExtractor) {
          cachedExtractor = buildShapeExtractor(nodeData);
        }
        return pathAccessor(cachedExtractor(nodeData));
      };
    } else {
      // Input reference: {{ $json.path }}
      let cachedExtractor: ((d: any) => any) | null = null;
      accessor = (_allNodeData, input) => {
        if (!cachedExtractor) {
          cachedExtractor = buildShapeExtractor(input);
        }
        return pathAccessor(cachedExtractor(input));
      };
    }

    matches.push({
      fullMatch: full,
      start: m.index,
      end: m.index + full.length,
      accessor,
    });
  }

  if (matches.length === 0) return null; // no templates found (shouldn't happen)

  // Pure template: entire string is a single {{ }} expression
  const isPure =
    matches.length === 1 &&
    matches[0].start === 0 &&
    matches[0].end === templateStr.length;

  if (isPure) {
    const acc = matches[0].accessor;
    return (allNodeData, input) => {
      const value = acc(allNodeData, input);
      return value === undefined ? null : value;
    };
  }

  // Mixed string: build segments for concatenation
  const segments: Array<{ type: "static"; value: string } | { type: "dynamic"; accessor: AccessorFn }> = [];
  let lastEnd = 0;

  for (const match of matches) {
    if (match.start > lastEnd) {
      segments.push({ type: "static", value: templateStr.slice(lastEnd, match.start) });
    }
    segments.push({ type: "dynamic", accessor: match.accessor });
    lastEnd = match.end;
  }
  if (lastEnd < templateStr.length) {
    segments.push({ type: "static", value: templateStr.slice(lastEnd) });
  }

  // Fast path: single dynamic segment with static prefix/suffix (common case)
  if (segments.length === 3 && segments[0].type === "static" && segments[2].type === "static") {
    const prefix = (segments[0] as any).value;
    const suffix = (segments[2] as any).value;
    const acc = (segments[1] as any).accessor;
    return (allNodeData: Record<string, any>, input: any) => {
      const val = acc(allNodeData, input);
      return prefix + formatMixedValue(val) + suffix;
    };
  }

  return (allNodeData: Record<string, any>, input: any) => {
    let result = "";
    for (const seg of segments) {
      if (seg.type === "static") {
        result += seg.value;
      } else {
        result += formatMixedValue((seg as any).accessor(allNodeData, input));
      }
    }
    return result;
  };
}

/**
 * Recursively compile a value (mirrors resolveDeep structure).
 * Returns { compiled: true, accessor } if compilable, or { compiled: false } if fallback needed.
 */
function compileValue(
  value: any,
  nodeIdSet: Set<string>,
  nodes: WorkflowNode[],
): { compiled: true; accessor: AccessorFn } | { compiled: true; staticValue: any } | { compiled: false } {
  if (typeof value === "string") {
    if (!value.includes("{{")) {
      return { compiled: true, staticValue: value };
    }
    const accessor = compileTemplate(value, nodeIdSet, nodes);
    if (!accessor) return { compiled: false };
    return { compiled: true, accessor };
  }

  if (Array.isArray(value)) {
    const compiledItems: Array<{ accessor?: AccessorFn; staticValue?: any }> = [];
    for (const item of value) {
      const result = compileValue(item, nodeIdSet, nodes);
      if (!result.compiled) return { compiled: false };
      compiledItems.push(result as any);
    }
    // Check if all items are static
    const allStatic = compiledItems.every((c) => "staticValue" in c);
    if (allStatic) {
      return { compiled: true, staticValue: compiledItems.map((c) => (c as any).staticValue) };
    }
    return {
      compiled: true,
      accessor: (allNodeData, input) =>
        compiledItems.map((c) =>
          "accessor" in c ? (c as any).accessor(allNodeData, input) : (c as any).staticValue,
        ),
    };
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    const compiledEntries: Array<{ key: string; accessor?: AccessorFn; staticValue?: any }> = [];
    for (const [k, v] of entries) {
      const result = compileValue(v, nodeIdSet, nodes);
      if (!result.compiled) return { compiled: false };
      compiledEntries.push({ key: k, ...(result as any) });
    }
    const allStatic = compiledEntries.every((c) => "staticValue" in c);
    if (allStatic) {
      const staticObj: Record<string, any> = {};
      for (const c of compiledEntries) staticObj[c.key] = (c as any).staticValue;
      return { compiled: true, staticValue: staticObj };
    }
    return {
      compiled: true,
      accessor: (allNodeData, input) => {
        const result: Record<string, any> = {};
        for (const c of compiledEntries) {
          result[c.key] = "accessor" in c
            ? (c as any).accessor(allNodeData, input)
            : (c as any).staticValue;
        }
        return result;
      },
    };
  }

  // number, boolean, null, undefined — static
  return { compiled: true, staticValue: value };
}

/**
 * Pre-compile all parameters for a single node.
 * Returns a CompiledNodeParams object that can resolve params without regex at runtime.
 */
export function compileNodeParams(
  node: WorkflowNode,
  nodes: WorkflowNode[],
): CompiledNodeParams {
  const nodeParams = (node as any).values || {};
  const entries = Object.entries(nodeParams).filter(([k]) => k !== "credential_id");

  if (entries.length === 0) {
    return { hasTemplates: false, staticParams: {} };
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // Check if any entry has templates at all
  const hasAnyTemplates = entries.some(([, v]) => containsTemplates(v));
  if (!hasAnyTemplates) {
    const staticParams: Record<string, any> = {};
    for (const [k, v] of entries) staticParams[k] = v;
    return { hasTemplates: false, staticParams };
  }

  // Try to compile all entries
  const compiledEntries: Array<{
    key: string;
    accessor?: AccessorFn;
    staticValue?: any;
    fallback?: boolean;
  }> = [];

  let hasFallback = false;

  for (const [key, value] of entries) {
    const result = compileValue(value, nodeIdSet, nodes);
    if (!result.compiled) {
      // This entry can't be compiled — mark for runtime fallback
      compiledEntries.push({ key, fallback: true, staticValue: value });
      hasFallback = true;
    } else if ("accessor" in result) {
      compiledEntries.push({ key, accessor: (result as any).accessor });
    } else {
      compiledEntries.push({ key, staticValue: (result as any).staticValue });
    }
  }

  // Collect fallback keys explicitly
  const fallbackKeys = hasFallback
    ? compiledEntries.filter((e) => e.fallback).map((e) => e.key)
    : undefined;

  return {
    hasTemplates: true,
    fallbackKeys,
    resolve: (allNodeData, input) => {
      const resolved: Record<string, any> = {};
      for (const entry of compiledEntries) {
        if (entry.fallback) {
          // Will be handled by the engine's resolveDeep fallback
          resolved[entry.key] = entry.staticValue;
        } else if (entry.accessor) {
          resolved[entry.key] = entry.accessor(allNodeData, input);
        } else {
          resolved[entry.key] = entry.staticValue;
        }
      }
      return resolved;
    },
  };
}

function containsTemplates(value: any): boolean {
  if (typeof value === "string") return value.includes("{{");
  if (Array.isArray(value)) return value.some((v) => containsTemplates(v));
  if (value && typeof value === "object") {
    return Object.values(value).some((v) => containsTemplates(v));
  }
  return false;
}

/**
 * Pre-compile all nodes in a workflow.
 * Returns a Map from nodeId to CompiledNodeParams.
 */
export function preCompileAllNodes(
  nodes: WorkflowNode[],
): Map<string, CompiledNodeParams> {
  const compiled = new Map<string, CompiledNodeParams>();
  for (const node of nodes) {
    try {
      compiled.set(node.id, compileNodeParams(node, nodes));
    } catch (e) {
      // If compilation fails for a node, skip it — runtime fallback will handle it
      console.warn(`Template compilation failed for node ${node.id}:`, e);
    }
  }
  return compiled;
}
