import client from "prom-client";
import { LOG } from "./logging";

// Reuse the existing startup logging switch; no separate timing-enable setting.
export const LIVE_TIMING_ENABLED = LOG;
const clocksVerified = process.env.LIVE_TIMING_CLOCKS_VERIFIED === "true";
const buckets = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
export type LiveEventKind = "tick" | "bar" | "aggregated_bar" | "order" | "other";
// Wire contract mirrored in market-stream-service/src/utils/liveTiming.ts.
export interface LiveTimingEnvelope {
  gatewayReceivedAt: number;
  eventKind: LiveEventKind;
  gatewayGeneration: string;
  barEligibleAt?: number;
}
export interface LiveExecutionTiming {
  eventKind: LiveEventKind;
  startedAt: number;
  executionStartedAt: number;
  executionStartedEpoch: number;
  ingress?: LiveTimingEnvelope;
  submitted: boolean;
  outcome: string;
}

const barTypes = new Set(["bar", "kline", "daily_bar", "continuousKline"]);
const orderTypes = new Set(["order", "order_update", "algo_update", "account_update", "account_config_update", "margin_call", "listen_key_expired"]);
const tickTypes = new Set(["tick", "trade", "aggTrade", "quote", "ticker", "full", "index", "miniTicker", "bookTicker", "depth", "depthUpdate", "24hrTicker", "markPriceUpdate"]);
export function liveEventKind(type: unknown): LiveEventKind {
  // Metadata is optional/untrusted; never coerce objects or return them as labels.
  if (typeof type !== "string") return "other";
  if (type === "aggregated_bar") return type;
  if (barTypes.has(type)) return "bar";
  if (orderTypes.has(type)) return "order";
  return tickTypes.has(type) ? "tick" : "other";
}

function histogram(name: string, help: string) {
  return new client.Histogram({ name, help, buckets, labelNames: ["event_kind", "outcome"] });
}
export const liveQueueDelay = histogram("coreza_live_queue_delay_seconds", "Approximate Redis stream append to execution start; requires verified clocks");
export const liveExecution = histogram("coreza_live_execution_seconds", "Per-event reset/preload through engine completion including required indicator flush");
export const liveRunnerCycle = histogram("coreza_live_runner_cycle_seconds", "Per-event admission through finalization/ACK; excludes stream reads and batch parsing");
export const liveReceiptToDecision = histogram("coreza_live_receipt_to_decision_seconds", "Approximate Coreza receipt (bar eligibility for aggregated bars) to engine completion");
export const liveReceiptToSubmit = histogram("coreza_live_receipt_to_submit_seconds", "Approximate Coreza receipt (bar eligibility for aggregated bars) to first submission request");
export const liveSignalToSubmit = histogram("coreza_live_signal_to_submit_seconds", "Execution start to first submission request; nested within execution");
export const liveStage = new client.Histogram({ name: "coreza_live_stage_seconds", help: "Local monotonic stage wall time; stages can be nested", buckets, labelNames: ["stage", "outcome"] });
export const liveEvents = new client.Counter({ name: "coreza_live_events_total", help: "Observed live event dispositions; not proof of lossless provider delivery", labelNames: ["stage", "outcome"] });
const clockSamples = new client.Counter({ name: "coreza_live_clock_samples_total", help: "Cross-clock sample eligibility", labelNames: ["stage", "outcome"] });
export const orderSubmitHttp = new client.Histogram({ name: "coreza_order_submit_http_seconds", help: "Each classified order submission HTTP attempt through response/error; excludes enrichment", buckets, labelNames: ["broker", "operation", "outcome"] });
export const orderStage = new client.Histogram({ name: "coreza_order_stage_seconds", help: "Exclusive broker preparation/post-response phases; HTTP samples are nested", buckets, labelNames: ["stage", "outcome"] });

export const timingNow = () => LIVE_TIMING_ENABLED ? performance.now() : 0;
export function observeLive(metric: client.Histogram<string>, labels: Record<string, string>, seconds: number): void {
  if (!LIVE_TIMING_ENABLED) return;
  try { if (Number.isFinite(seconds) && seconds >= 0) metric.observe(labels, seconds); } catch { /* Telemetry never changes execution. */ }
}
export function countLive(stage: string, outcome: string): void {
  if (!LIVE_TIMING_ENABLED) return;
  try { liveEvents.inc({ stage, outcome }); } catch { /* Observer isolation. */ }
}
export function observeStage(stage: string, startedAt: number, outcome = "success"): void {
  if (!LIVE_TIMING_ENABLED) return;
  observeLive(liveStage, { stage, outcome }, (timingNow() - startedAt) / 1000);
}
export function observeEpoch(metric: client.Histogram<string>, stage: string, from: unknown, to: number, eventKind: LiveEventKind, outcome = "success"): void {
  if (!LIVE_TIMING_ENABLED) return;
  const status = !clocksVerified ? "unverified" : typeof from !== "number" ? "missing" : !Number.isFinite(from) || !Number.isFinite(to) || to < from ? "invalid" : "approximate";
  try { clockSamples.inc({ stage, outcome: status }); } catch { /* Observer isolation. */ }
  if (status === "approximate") observeLive(metric, { event_kind: eventKind, outcome }, (to - (from as number)) / 1000);
}
