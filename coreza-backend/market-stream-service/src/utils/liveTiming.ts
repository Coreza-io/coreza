import client from "prom-client";

export const LIVE_TIMING_ENABLED = process.env.LIVE_TIMING_ENABLED === "true";
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
export function liveEventKind(type: unknown): LiveEventKind {
  if (["tick", "bar", "aggregated_bar", "order", "other"].includes(String(type))) return type as LiveEventKind;
  if (["kline", "daily_bar", "continuousKline"].includes(String(type))) return "bar";
  if (["order_update", "algo_update", "account_update", "account_config_update", "margin_call", "listen_key_expired"].includes(String(type))) return "order";
  return ["trade", "aggTrade", "quote", "ticker", "full", "index", "miniTicker", "bookTicker", "depth", "depthUpdate", "24hrTicker", "markPriceUpdate"].includes(String(type)) ? "tick" : "other";
}
export const liveIngress = new client.Histogram({ name: "coreza_live_ingress_seconds", help: "Approximate Coreza receipt (bar eligibility for aggregated bars) to workflow stream append; requires verified clocks", buckets, labelNames: ["event_kind", "outcome"] });
export const liveStage = new client.Histogram({ name: "coreza_live_stage_seconds", help: "Local monotonic stage wall time; stages can be nested", buckets, labelNames: ["stage", "outcome"] });
export const liveEvents = new client.Counter({ name: "coreza_live_events_total", help: "Observed live event dispositions; not proof of lossless provider delivery", labelNames: ["stage", "outcome"] });
export const liveIngressQueueDepth = new client.Gauge({ name: "coreza_live_ingress_queue_events", help: "Waiting live delivery tasks, not the number of promise chains" });
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
