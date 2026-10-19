import type { HistoricalToolCapability } from '../brokers/capabilities';
import type { ProcessedToolOutput } from '../nodes/logic/toolOutputProcessor';
import type { ToolExecutionTrace } from '../utils/toolExecutionLog';
import { sameMarketSymbol, sameMarketTimeframe } from '../marketData/normalizeCandles';
import { parseTimeframe } from '../utils/timeframe';

type Input = Record<string, any>;
export interface HistoricalAgentTool {
  nodeId: string;
  toolName: string;
  capability: HistoricalToolCapability;
  exposed: Set<string>;
}
interface Coverage {
  symbol: string;
  timeframe: string;
  assetType?: string;
  attempts: number;
  requiredBars: number;
  pending: boolean;
  stopped?: string;
  latestRef?: string;
}
interface Snapshot {
  tool: HistoricalAgentTool;
  input: Input;
  invocationId: string;
  coverage: Coverage;
}
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
const DAY = 86_400_000;
const bounds = (input: Input, cap: HistoricalToolCapability) => ({
  start: [cap.startField, ...(cap.startAliases || [])].map(key => input[key]).find(present),
  end: [cap.endField, ...(cap.endAliases || [])].map(key => input[key]).find(present),
});

/** Parse for validation/diagnostics only: never replace the adapter's request values. */
function dateValue(value: unknown, format: HistoricalToolCapability['dateFormat']): number {
  if (format === 'epoch-or-date' && /^-?\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const epoch = Number(value);
    return Math.abs(epoch) < 1e12 ? epoch * 1000 : epoch;
  }
  if (format === 'js-date' && typeof value === 'number') return new Date(value).getTime();
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  const pattern = format === 'local-datetime'
    ? /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/
    : /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!pattern.test(text)) return NaN;
  const day = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== text.slice(0, 10)) return NaN;
  return Date.parse(text.replace(' ', 'T'));
}

function validate(input: Input, cap: HistoricalToolCapability): void {
  const { start, end } = bounds(input, cap);
  for (const [key, value] of [[cap.startField, start], [cap.endField, end]] as const) {
    if (present(value) && !Number.isFinite(dateValue(value, cap.dateFormat))) {
      throw new Error(`Historical ${key} must be a valid ${cap.dateFormat} date; use the tool's supported range fields`);
    }
  }
  if (present(start) && present(end) && dateValue(start, cap.dateFormat) > dateValue(end, cap.dateFormat)) {
    throw new Error(`Historical ${cap.startField} must not be after ${cap.endField}`);
  }
  const maxDays = cap.maxRangeDays?.(input);
  if (maxDays && present(start) && present(end) && dateValue(end, cap.dateFormat) - dateValue(start, cap.dateFormat) > maxDays * DAY) {
    throw new Error(`Historical range exceeds this adapter's ${maxDays}-day request window`);
  }
  if (cap.validateInterval && !cap.validateInterval(input)) throw new Error('Unsupported historical interval; use a value supported by this tool');
  if (cap.count && present(input[cap.count.field]) &&
      (!Number.isSafeInteger(Number(input[cap.count.field])) || Number(input[cap.count.field]) <= 0)) {
    throw new Error(`Historical ${cap.count.field} must be a positive integer`);
  }
  if (cap.requiresRange && !(present(start) && present(end)) && !(cap.count && Number(input[cap.count.field]) > 0)) {
    throw new Error(`Historical data requires both ${cap.startField}/${cap.endField}, or a positive ${cap.count?.field}`);
  }
}

function intervalMilliseconds(value: string): number | undefined {
  const month = /^(\d+)(?:M|month|Month)$/.exec(value);
  if (month) return Number(month[1]) * 31 * DAY;
  try { return parseTimeframe(value.replace(/Hours?$/i, 'h').replace(/Minutes?$/i, 'm')).milliseconds; }
  catch { return undefined; }
}

function formatDate(epoch: number, cap: HistoricalToolCapability): string {
  const date = new Date(epoch);
  return cap.dateFormat === 'local-datetime'
    ? new Date(epoch - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace('T', ' ')
    : date.toISOString();
}

/** One instance per agent invocation. It proposes tool calls; it never calls a broker. */
export class AgentHistoryRecovery {
  private readonly coverages: Coverage[] = [];
  private readonly snapshots = new Map<string, Snapshot>();
  private configuredRequirement = 1;

  observeRequirement(requiredBars: number): void {
    if (Number.isFinite(requiredBars)) this.configuredRequirement = Math.max(this.configuredRequirement, requiredBars);
  }

  beforeFetch(tool: HistoricalAgentTool, input: Input, trace: ToolExecutionTrace): Coverage {
    validate(input, tool.capability);
    const symbol = String(input.symbol || input.ticker || '').trim();
    const timeframe = tool.capability.timeframe(input);
    const assetType = input.assetType || input.asset_type;
    let coverage = this.coverages.find(item => sameMarketSymbol(item.symbol, symbol, assetType) && sameMarketTimeframe(item.timeframe, timeframe));
    if (!coverage) {
      coverage = { symbol, timeframe, assetType, attempts: 0, requiredBars: this.configuredRequirement, pending: false };
      this.coverages.push(coverage);
    }
    if (coverage.pending || coverage.stopped || coverage.attempts >= 1) {
      if (coverage.stopped || coverage.attempts >= 1) {
        trace('history_recovery_stopped', { symbol, timeframe, reason: coverage.stopped || 'budget_exhausted', attempt: coverage.attempts });
        throw new Error('Historical recovery stopped: one additional fetch per symbol/timeframe is allowed. Report unavailable indicators honestly.');
      }
      const previous = coverage.latestRef ? this.snapshots.get(coverage.latestRef) : undefined;
      if (previous) {
        const currentRange = bounds(input, tool.capability), previousRange = bounds(previous.input, previous.tool.capability);
        const widerRange = present(currentRange.start) && (!present(previousRange.start) ||
          dateValue(currentRange.start, tool.capability.dateFormat) < dateValue(previousRange.start, previous.tool.capability.dateFormat));
        const count = tool.capability.count;
        const largerCount = count && !present(currentRange.start) && !present(currentRange.end) &&
          Number(input[count.field]) > Number(previous.input[previous.tool.capability.count?.field || count.field] || 0);
        const largerPeriod = tool.capability.broadenPeriod && !present(currentRange.start) && !present(currentRange.end) &&
          input.periodType === previous.input.periodType && Number(input.period) > Number(previous.input.period || 10);
        if (!widerRange && !largerCount && !largerPeriod) throw new Error('Historical recovery must broaden the supported range/count. Use the not_ready recovery suggestion and honor fixed fields.');
      }
      // Reserve synchronously, so parallel model tool calls cannot spend this budget twice.
      coverage.attempts++;
      coverage.pending = false;
      coverage.stopped = 'recovery_in_progress';
      trace('history_recovery_decision', { symbol, timeframe, allowed: true, attempt: coverage.attempts, reason: 'agent_requested_recovery' });
    }
    const cap = tool.capability;
    if (!present(bounds(input, cap).start) && !(cap.count?.mode === 'latest') && !cap.broadenPeriod && coverage.requiredBars > 1) {
      trace('history_coverage_uncertain', { symbol, timeframe, reason: 'omitted_start_does_not_guarantee_warmup', requiredBars: coverage.requiredBars });
    }
    return coverage;
  }

  fetched(tool: HistoricalAgentTool, input: Input, output: ProcessedToolOutput, invocationId: string, coverage: Coverage, trace: ToolExecutionTrace): void {
    const cap = tool.capability;
    const { start, end } = bounds(input, cap);
    trace('history_coverage', { sourceToolInvocationId: invocationId, symbol: coverage.symbol, timeframe: coverage.timeframe,
      rawRowCount: null, normalizedRowCount: output.rowCount ?? null, observedMaxRequirement: coverage.requiredBars });
    trace('history_coverage_request', () => ({ interval: cap.timeframe(input), start, end,
      limit: input.limit, lookback: input.lookback, period: input.period }), 'debug');
    if (!output.dataRef || !output.rowCount || output.success === false) {
      this.failed(coverage, trace, 'no_data');
      return;
    }
    coverage.latestRef = output.dataRef;
    coverage.stopped = undefined;
    this.snapshots.set(output.dataRef, { tool, input: { ...input }, invocationId, coverage });
    if (coverage.attempts) trace('history_recovery_result', { sourceToolInvocationId: invocationId, dataRef: output.dataRef,
      receivedBars: output.rowCount, requiredBars: coverage.requiredBars, coverageSufficient: output.rowCount >= coverage.requiredBars,
      attempt: coverage.attempts });
  }

  failed(coverage: Coverage, trace: ToolExecutionTrace, reason = 'source_error_or_unavailable'): void {
    coverage.stopped = reason;
    coverage.pending = false;
    trace('history_recovery_stopped', { symbol: coverage.symbol, timeframe: coverage.timeframe, reason, attempt: coverage.attempts });
  }

  insufficient(dataRef: string | undefined, observedBars: number, requiredBars: number, trace: ToolExecutionTrace): Input {
    const snapshot = dataRef ? this.snapshots.get(dataRef) : undefined;
    const base = { dataRef, receivedBars: observedBars, requiredBars };
    const deny = (reason: string, extra: Input = {}) => {
      if (snapshot) { snapshot.coverage.stopped = reason; snapshot.coverage.pending = false; }
      trace('history_recovery_stopped', { ...base, reason, ...extra });
      return { ...base, allowed: false, reason, ...extra, instruction: 'Stop fetching history and report not_ready; never interpret unavailable values as signals.' };
    };
    if (!Number.isFinite(requiredBars) || !Number.isFinite(observedBars) || observedBars >= requiredBars) return deny('not_a_short_history_failure');
    if (!snapshot) return deny('no_connected_history_source');
    const { tool, input, coverage } = snapshot;
    const identity = { symbol: coverage.symbol, timeframe: coverage.timeframe,
      sourceTool: tool.toolName, sourceNodeId: tool.nodeId, sourceToolInvocationId: snapshot.invocationId };
    if (coverage.latestRef !== dataRef) return { ...base, ...identity, allowed: false, reason: 'superseded_history',
      replacementDataRef: coverage.latestRef, instruction: 'Recompute only the dependent indicators using replacementDataRef; do not fetch again.' };
    coverage.requiredBars = Math.max(coverage.requiredBars, requiredBars, this.configuredRequirement);
    if (coverage.stopped || coverage.attempts >= 1) return deny(coverage.stopped || 'budget_exhausted', identity);
    if (!coverage.symbol || coverage.symbol.includes(',') || (Array.isArray(input.symbol) && input.symbol.length !== 1)) return deny('ambiguous_symbol', identity);
    const suggestedInput = this.suggest(snapshot);
    if (!suggestedInput) return deny('fixed_settings_or_provider_constraints', identity);
    coverage.pending = true;
    trace('history_recovery_decision', { ...base, ...identity, allowed: true, attempt: 1, reason: 'insufficient_history', mode: suggestedInput.mode });
    return { ...base, ...identity, allowed: true, attempt: 1, mode: suggestedInput.mode, suggestedInput: suggestedInput.input,
      instruction: 'If the task needs these indicators, call sourceTool once with suggestedInput. Respect user-requested latest-only tasks, availability and provider limits. Use its exact NEW dataRef to recompute dependent indicators. If it fails or stays short, stop and report not_ready.' };
  }

  private suggest(snapshot: Snapshot): { mode: string; input: Input } | undefined {
    const { tool, input, coverage } = snapshot;
    const cap = tool.capability;
    const target = Math.ceil(coverage.requiredBars * 1.5) + 2;
    const previous = bounds(input, cap);
    const generated = Object.fromEntries(Object.entries(input).filter(([key]) => tool.exposed.has(key)));
    const count = cap.count;
    if (count?.mode === 'latest' && !present(previous.start) && !present(previous.end) && tool.exposed.has(count.field)) {
      const limit = Math.min(count.max ?? Infinity, Math.max(target, Number(input[count.field] || 0) * 2));
      if (limit < coverage.requiredBars || limit <= Number(input[count.field] || 0)) return undefined;
      return { mode: 'latest_count', input: { ...generated, [count.field]: String(limit) } };
    }
    const milliseconds = intervalMilliseconds(coverage.timeframe);
    if (tool.exposed.has(cap.startField) && milliseconds) {
      // Calendar buffer only, not a trading-calendar promise. Keep the original end anchor.
      const end = present(previous.end) ? dateValue(previous.end, cap.dateFormat) : Date.now();
      if (!present(previous.end) && !tool.exposed.has(cap.endField)) return undefined;
      const window = Math.max(7 * DAY, target * milliseconds * 3);
      const oldStart = present(previous.start) ? dateValue(previous.start, cap.dateFormat) : end;
      const maxDays = cap.maxRangeDays?.(input);
      const start = Math.max(maxDays ? end - maxDays * DAY : 0, Math.min(end - window, oldStart - window));
      if (present(previous.start) && start >= oldStart) return undefined;
      if (!Number.isFinite(start) || start < 0) return undefined;
      const next = { ...generated, [cap.startField]: formatDate(start, cap) };
      if (tool.exposed.has(cap.endField)) next[cap.endField] = previous.end || formatDate(end, cap);
      if (cap.rangeMode && tool.exposed.has(cap.rangeMode.field)) next[cap.rangeMode.field] = cap.rangeMode.value;
      const limit = cap.pageLimit ?? (count?.mode === 'latest' && count.max ? { field: count.field, max: count.max } : undefined);
      if (limit && tool.exposed.has(limit.field)) next[limit.field] = String(Math.min(limit.max, Math.max(Number(input[limit.field]) || 0, target * 3)));
      const paginated = limit && 'paginated' in limit && limit.paginated && ![false, 'false'].includes(input.auto_paginate);
      if (limit && limit.max < coverage.requiredBars && !paginated) return undefined;
      if (limit && !tool.exposed.has(limit.field) && Number(input[limit.field]) < coverage.requiredBars && !paginated) return undefined;
      return { mode: 'explicit_range', input: next };
    }
    if (count?.mode === 'lookback' && tool.exposed.has(count.field) && !present(previous.start) && !present(previous.end)) {
      return { mode: 'calendar_lookback', input: { ...generated, [count.field]: String(Math.max(target * 3, Number(input[count.field] || 0) * 2)) } };
    }
    const period = cap.broadenPeriod?.(input);
    if (period && !present(previous.start) && !present(previous.end) && Object.keys(period).every(key => tool.exposed.has(key))) {
      return { mode: 'rolling_period', input: { ...generated, ...period } };
    }
    return undefined;
  }
}
