import axios, { AxiosStatic } from 'axios';
import { createLogger } from './logger';

const logger = createLogger('ToolExecution');
type Fields = Record<string, unknown>;
type Level = 'info' | 'debug';
export type ToolExecutionTrace = (phase: string, fields: Fields | (() => Fields), level?: Level) => void;

const secretKey = /authorization|apikey|secret|password|token|cookie|credential|signature|privatekey|clientjson|clientid|account|customer|email|phone|address|firstname|lastname|fullname|username|userid|orderid|clientorder|idempotency|prompt|messages|headers|notes|comment|payload/;
const keyName = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** No toJSON calls, getters, raw Error objects or unbounded payload traversal. */
export function redactToolFields(value: unknown): unknown {
  let remaining = 400;
  const seen = new WeakSet<object>();
  const visit = (item: any, depth: number, key = ''): any => {
    if (secretKey.test(keyName(key)) || /^(name|contact|person|owner|dob|birth|tax|ssn|iban|bank|routing)$/.test(keyName(key))) return '[REDACTED]';
    if (--remaining < 0 || depth > 5) return '[Truncated]';
    if (item == null || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : '[Non-finite]';
    if (typeof item === 'bigint') return String(item);
    if (typeof item === 'string') {
      if (/^(body|requestbody)$/.test(keyName(key))) return '[Body omitted]';
      if (/^\s*[\[{]/.test(item)) return `[Serialized data: ${item.length} characters]`;
      if (/^(candledata|bars|prices|resolveddata)$/.test(keyName(key)) && !item.startsWith('bars:')) return `[Data: ${item.length} characters]`;
      const technicalId = /^(runid|agentinvocationid|toolinvocationid|workflownodeid|dataref)$/.test(keyName(key));
      const dateOrNumericField = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+Z-]+)?$/.test(item) ||
        /^(start|end|fromdate|todate|startdate|enddate|timestamp|time|interval|limit|period|lookback|securityid)$/.test(keyName(key));
      if (/@|\bBearer\s|\b(?:api[_-]?key|secret|password|token|signature)\s*[:=]/i.test(item) ||
          (!technicalId && /[A-Za-z0-9+/_=-]{48,}/.test(item)) ||
          (!technicalId && !dateOrNumericField && /\b\+?\d[\d ()-]{8,}\d\b/.test(item))) return '[REDACTED]';
      return item.replace(/https?:\/\/[^\s]+/gi, '[URL omitted]').slice(0, 256);
    }
    if (typeof item !== 'object') return `[${typeof item}]`;
    if (/^(body|requestbody)$/.test(keyName(key))) {
      const allowed: Fields = {};
      for (const field of Object.keys(item).slice(0, 40)) {
        if (!bodyFields.has(keyName(field)) && !tradingFields.has(keyName(field)) && keyName(field) !== 'omittedfieldcount') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, field);
        if (keyName(field) === 'omittedfieldcount' && typeof descriptor?.value !== 'number') continue;
        if (descriptor && 'value' in descriptor) allowed[field] = descriptor.value && typeof descriptor.value === 'object' && !Array.isArray(descriptor.value)
          ? '[Object omitted]' : descriptor.value;
      }
      return visit(allowed, depth + 1, 'safeBody');
    }
    if (ArrayBuffer.isView(item)) return `[Binary: ${item.byteLength} bytes]`;
    if (/^(candledata|bars|prices|resolveddata)$/.test(keyName(key))) {
      return { type: Array.isArray(item) ? 'array' : 'object', rowCount: Array.isArray(item) ? item.length : null };
    }
    if (item instanceof Error) return safeToolError(item);
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 8) return `[Array: ${item.length} items]`;
      const entries: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (descriptor && !('value' in descriptor)) entries.push('[Accessor omitted]');
        else {
          const value = descriptor?.value;
          if (value !== null && typeof value === 'object') return `[Array: ${item.length} items]`;
          entries.push(visit(value, depth + 1, key));
        }
      }
      return entries;
    }
    const keys = Object.keys(item);
    const output: Fields = Object.create(null);
    for (const field of keys.slice(0, 40)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, field);
      const label = /@|https?:\/\/|[A-Za-z0-9+/_=-]{48,}/.test(field) ? '[REDACTED KEY]' : field.slice(0, 80);
      output[label] = descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1, field) : '[Accessor omitted]';
    }
    if (keys.length > 40) output.truncatedKeys = keys.length - 40;
    return output;
  };
  try { return visit(value, 0); } catch { return '[Log fields unavailable]'; }
}

/** Transport errors often embed headers, signed URLs, request bodies and responses. */
export function safeToolError(error: any): Fields {
  try {
    const own = (value: any, key: string) => value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    const name = own(error, 'name') ?? own(Object.getPrototypeOf(error), 'name');
    const code = own(error, 'code');
    const status = own(own(error, 'response'), 'status');
    return {
      type: typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'Error',
      code: typeof code === 'string' && /^[A-Z][A-Z_0-9]{0,63}$/.test(code) ? code : undefined,
      httpStatus: typeof status === 'number' ? status : undefined,
    };
  } catch { return { type: 'Error' }; }
}

export function createToolExecutionTrace(identity: Fields): ToolExecutionTrace {
  return (phase, fields, level = 'info') => {
    try {
      if (!logger.isLevelEnabled(level)) return;
      const details = typeof fields === 'function' ? fields() : fields;
      // Payload truncation must not consume the budget for correlation fields.
      const safeDetails = redactToolFields(details);
      const envelope = redactToolFields({ ...identity, event: phase, timestamp: new Date().toISOString() }) as Fields;
      logger[level]({ ...(safeDetails && typeof safeDetails === 'object' ? safeDetails : { fields: safeDetails }), ...envelope });
    } catch { /* Observability must never replace an execution result. */ }
  };
}

/** Only verified historical operations use these counts. A wrapper is never one row. */
export function historicalRowCount(data: any, symbol?: unknown, depth = 0): number | null {
  if (depth > 4 || !data || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    if (!data.length) return 0;
    const first = data[0];
    const scalar = (value: unknown) => typeof value === 'number' || typeof value === 'string';
    const candle = first && [first.open ?? first.o, first.high ?? first.h,
      first.low ?? first.l, first.close ?? first.c].every(scalar);
    const tuple = Array.isArray(first) && first.length >= 6 && first.slice(0, 6).every(scalar);
    if (!candle && !tuple) return null;
    if (first?.symbol) {
      if (!symbol) return null;
      return data.filter(row => String(row?.symbol).toUpperCase().replace(/\//g, '') === String(symbol).toUpperCase().replace(/\//g, '')).length;
    }
    return data.length;
  }
  if (Array.isArray(data.BarSeries)) {
    const candidates = data.BarSeries.filter((series: any) => !symbol || String(series?.symbol).toUpperCase().replace('/', '') === String(symbol).toUpperCase().replace('/', ''));
    return candidates.length === 1 ? historicalRowCount(candidates[0]?.bars, symbol, depth + 1) : data.BarSeries.length === 0 ? 0 : null;
  }
  if (['open', 'high', 'low', 'close', 'timestamp'].every(field => Array.isArray(data[field]))) {
    return ['high', 'low', 'close', 'timestamp'].every(field => data[field].length === data.open.length) ? data.open.length : null;
  }
  if (data.bars && !Array.isArray(data.bars)) {
    const keys = Object.keys(data.bars);
    const selected = symbol ? keys.filter(key => key.toUpperCase().replace('/', '') === String(symbol).toUpperCase().replace('/', '')) : keys;
    return selected.length === 1 ? historicalRowCount(data.bars[selected[0]], symbol, depth + 1) : keys.length === 0 ? 0 : null;
  }
  for (const key of ['bars', 'candles', 'ohlcv', 'data']) {
    if (data[key] != null) return historicalRowCount(data[key], symbol, depth + 1);
  }
  return null;
}

export function toolResultSummary(data: any, indicator = false): Fields {
  const result: Fields = { type: data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data };
  if (Array.isArray(data)) result.arrayLength = data.length;
  if (indicator && typeof data?.IsReady === 'boolean') {
    result.isReady = data.IsReady;
    result.observedBars = data.SampleCount;
    if (data.IsReady) result.value = data.Current;
  }
  return result;
}

const bodyFields = new Set(['operation', 'symbol', 'symbols', 'interval', 'timeframe', 'start', 'end', 'startdate', 'enddate', 'fromdate', 'todate', 'limit', 'exchange', 'exchangesegment', 'assettype', 'feed', 'adjustment', 'instrument', 'securityid', 'expirycode', 'oi']);
const tradingFields = new Set(['operation', 'symbol', 'symbols', 'side', 'type', 'ordertype', 'timeinforce', 'exchange', 'assettype']);
const historicalOperation = (operation: unknown) => ['get_candle', 'get_history', 'get_historical_data', 'get_price_history'].includes(String(operation));

/** Free-form bodies and trading/account inputs require an explicit safe allowlist. */
export function toolInputFields(input: any, operation?: unknown, body = false): unknown {
  if (!body && (operation === undefined || /^(get|fetch)_(candle|candles|bars|history|historical_data|price_history|quote|quotes|snapshot|snapshots|news|screener)$/.test(String(operation)))) return input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '[Body omitted]';
  const allowed = historicalOperation(operation) ? bodyFields : tradingFields;
  const output: Fields = {};
  let omittedFieldCount = 0;
  for (const key of Object.keys(input)) {
    if (allowed.has(keyName(key))) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor && 'value' in descriptor) output[key] = descriptor.value;
    } else omittedFieldCount++;
  }
  return { ...output, omittedFieldCount };
}

function requestFields(config: any, operation: unknown): Fields {
  let host: string | undefined, path: string | undefined;
  const embeddedQuery: Fields = Object.create(null);
  const queryFields = (params: URLSearchParams): Fields => {
    const fields: Fields = Object.create(null);
    params.forEach((value, key) => {
      const previous = fields[key];
      fields[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
    });
    return fields;
  };
  try {
    const url = new URL(String(config.url), config.baseURL);
    host = url.hostname;
    path = url.pathname.replace(/\/(accounts?|orders?|users?|customers?)\/[^/]+/gi, '/$1/[REDACTED]')
      .split('/').map(part => /\d/.test(part) && !/^v\d+$/.test(part) ? '[identifier]' : part).join('/');
    url.searchParams.forEach((value, key) => {
      const previous = embeddedQuery[key];
      embeddedQuery[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
    });
  } catch { /* Malformed or opaque URLs are omitted, never printed raw. */ }
  const query = config.params instanceof URLSearchParams ? queryFields(config.params)
    : typeof config.params === 'string' ? queryFields(new URLSearchParams(config.params))
    : config.params && typeof config.params === 'object' ? config.params : undefined;
  return { host, path, method: String(config.method || 'get').toUpperCase(), timeoutMs: config.timeout,
    customParamsSerializer: !!config.paramsSerializer,
    urlQuery: toolInputFields(embeddedQuery, operation), query: toolInputFields(query, operation),
    body: config.data == null ? undefined : toolInputFields(config.data, operation, true) };
}

/** Wrap only the client passed to this invocation; never mutate Axios or its interceptors. */
export function traceToolHttp(client: AxiosStatic, trace: ToolExecutionTrace, input: any): { client: AxiosStatic; requestCount: () => number } {
  let requestCount = 0;
  const emit: ToolExecutionTrace = (...args) => {
    try { trace(...args); } catch { /* A tracing consumer cannot affect the HTTP call. */ }
  };
  const observe = (target: any, method: string, args: any[], invoke: () => any) => {
    const index = ++requestCount;
    const started = performance.now();
    emit('http_request', () => ({ requestIndex: index, operation: input.operation, observationStage: 'client_input',
      request: requestFields(axios.mergeConfig(target.defaults, method === 'request'
        ? typeof args[0] === 'string' ? { ...args[1], url: args[0] } : args[0] ?? {}
        : ['post', 'put', 'patch', 'postForm', 'putForm', 'patchForm'].includes(method)
          ? { ...args[2], url: args[0], data: args[1], method: method.replace('Form', '') }
          : { ...args[1], url: args[0], method }), input.operation) }), 'debug');
    const response = (result: any, error?: any) => {
      emit('http_effective_request', () => ({ requestIndex: index, operation: input.operation,
        observationStage: 'response_config',
        request: (result?.config ?? error?.config) ? requestFields(result?.config ?? error.config, input.operation) : undefined,
        // Adapter serialization, redirects and custom transports may not expose wire details.
        wireRequestObserved: false }), 'debug');
      emit('http_response', () => ({ requestIndex: index,
        durationMs: performance.now() - started, success: !error, httpStatus: result?.status ?? safeToolError(error).httpStatus,
        rawRowCount: historicalOperation(input.operation) && !error ? historicalRowCount(result?.data, input.symbol) : null,
        hasNextPage: result?.data && Object.prototype.hasOwnProperty.call(result.data, 'next_page_token') ? !!result.data.next_page_token : undefined,
        failure: error ? safeToolError(error) : undefined }));
    };
    let pending: any;
    try {
      pending = invoke();
    } catch (error) { response(undefined, error); throw error; }
    try {
      if (pending && typeof pending.then === 'function') {
        // Observe separately and return the original promise, including its cancellation behavior.
        void Promise.resolve(pending).then((value: any) => response(value), (error: any) => response(undefined, error)).catch(() => {});
      }
    } catch { /* Inspecting an unusual thenable must not replace the execution result. */ }
    return pending;
  };
  const methods = new Set(['request', 'get', 'delete', 'head', 'options', 'post', 'put', 'patch', 'postForm', 'putForm', 'patchForm']);
  const wrap = (client: any): any => new Proxy(client, {
    apply(target, receiver, args) { return observe(target, 'request', args, () => Reflect.apply(target, receiver, args)); },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'create' && typeof value === 'function') return (...args: any[]) => wrap(Reflect.apply(value, target, args));
      return typeof property === 'string' && methods.has(property) && typeof value === 'function'
        ? (...args: any[]) => observe(target, property, args, () => Reflect.apply(value, target, args)) : value;
    },
  });
  return { client: wrap(client), requestCount: () => requestCount };
}
