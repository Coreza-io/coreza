import client from "prom-client";
import { LOG } from "./logging";

// Reuse the existing startup logging switch; no separate timing-enable setting.
export const LIVE_TIMING_ENABLED = LOG;
const clocksVerified = process.env.LIVE_TIMING_CLOCKS_VERIFIED === "true";
const buckets = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
export type LiveEventKind = "tick" | "bar" | "aggregated_bar" | "order" | "other";
// Wire contract mirrored in coreza-backend/src/utils/liveTiming.ts; no process-local clocks on the wire.
export interface LiveTimingEnvelope {
  gatewayReceivedAt: number;
  eventKind: LiveEventKind;
  gatewayGeneration: string;
  barEligibleAt?: number;
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
export const liveIngress = new client.Histogram({ name: "coreza_live_ingress_seconds", help: "Approximate Coreza receipt (bar eligibility for aggregated bars) to workflow stream append; requires verified clocks", buckets, labelNames: ["event_kind", "outcome"] });
export const liveStage = new client.Histogram({ name: "coreza_live_stage_seconds", help: "Local monotonic stage wall time; stages can be nested", buckets, labelNames: ["stage", "outcome"] });
export const liveEvents = new client.Counter({ name: "coreza_live_events_total", help: "Observed live event dispositions; not proof of lossless provider delivery", labelNames: ["stage", "outcome"] });
export const liveIngressQueueDepth = new client.Gauge({ name: "coreza_live_ingress_queue_events", help: "Waiting live delivery tasks, not the number of promise chains" });
export function changeIngressQueueDepth(delta: 1 | -1): void {
  if (!LIVE_TIMING_ENABLED) return;
  try { liveIngressQueueDepth.inc(delta); } catch { /* Observer isolation. */ }
}
const clockSamples = new client.Counter({ name: "coreza_live_clock_samples_total", help: "Cross-clock sample eligibility", labelNames: ["stage", "outcome"] });
export const timingNow = () => LIVE_TIMING_ENABLED ? performance.now() : 0;
export function observeStage(stage: string, startedAt: number, outcome = "success"): void {
  if (!LIVE_TIMING_ENABLED) return;
  try { liveStage.observe({ stage, outcome }, (performance.now() - startedAt) / 1000); } catch { /* Telemetry never changes delivery. */ }
}
export function countLive(stage: string, outcome: string): void {
  if (!LIVE_TIMING_ENABLED) return;
  try { liveEvents.inc({ stage, outcome }); } catch { /* Observer isolation. */ }
}
export function observeIngress(from: unknown, streamId: string, eventKind: LiveEventKind): void {
  if (!LIVE_TIMING_ENABLED) return;
  const appendedAt = Number(streamId.split("-", 1)[0]);
  const status = !clocksVerified ? "unverified" : typeof from !== "number" ? "missing" : !Number.isFinite(from) || !Number.isFinite(appendedAt) || appendedAt < from ? "invalid" : "approximate";
  try {
    clockSamples.inc({ stage: "ingress", outcome: status });
    if (status === "approximate") liveIngress.observe({ event_kind: eventKind, outcome: "success" }, (appendedAt - (from as number)) / 1000);
  } catch { /* Observer isolation. */ }
}
