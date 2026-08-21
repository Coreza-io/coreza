import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Bar } from "../../backtest/simBroker/interfaces";
import { validateTimeframeRatio } from "../../utils/timeframe";

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);

export interface ConsolidatedBar extends Bar {
  endTimestamp: string;
}

export interface ConsolidatorState {
  workingBar: ConsolidatedBar;
  lastInput: Bar;
}

export interface ConsolidationResult {
  emitted?: ConsolidatedBar;
  state: ConsolidatorState;
  duplicate: boolean;
}

export interface TimeBarConsolidatorOptions {
  sourceTimeframe: string;
  targetTimeframe: string;
  timezone?: string;
  anchorTime?: string;
}

function parseAnchor(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`Invalid anchor_time "${value}". Expected HH:mm.`);
  }
  return (Number(match[1]) * 60 + Number(match[2])) * 60_000;
}

function barsEqual(left: Bar, right: Bar): boolean {
  return left.timestamp === right.timestamp && left.open === right.open && left.high === right.high &&
    left.low === right.low && left.close === right.close && left.volume === right.volume;
}

export class ConsolidationError extends Error {
  constructor(readonly code: "DUPLICATE_BAR_CONFLICT" | "OUT_OF_ORDER_BAR", message: string) {
    super(message);
    this.name = "ConsolidationError";
  }
}

export class TimeBarConsolidator {
  readonly ratio: number;
  private readonly targetMs: number;
  private readonly timezone: string;
  private readonly anchorMs: number;

  constructor(options: TimeBarConsolidatorOptions) {
    const timeframes = validateTimeframeRatio(options.sourceTimeframe, options.targetTimeframe);
    this.ratio = timeframes.ratio;
    this.targetMs = timeframes.target.milliseconds;
    this.timezone = options.timezone?.trim() || "UTC";
    this.anchorMs = parseAnchor(options.anchorTime);
    // date-fns-tz validates the IANA zone while constructing a zoned date.
    if (Number.isNaN(toZonedTime(0, this.timezone).getTime())) throw new Error(`Invalid timezone: ${this.timezone}`);
  }

  update(input: Bar, previous?: ConsolidatorState): ConsolidationResult {
    const inputVolume = input._isFillForward ? 0 : input.volume;
    const normalizedInput = inputVolume === input.volume
      ? input
      : { ...input, volume: inputVolume };
    input = normalizedInput;
    if (previous) {
      const currentTime = new Date(input.timestamp).getTime();
      const lastTime = new Date(previous.lastInput.timestamp).getTime();
      if (currentTime < lastTime) throw new ConsolidationError("OUT_OF_ORDER_BAR", `Bar ${input.timestamp} is older than ${previous.lastInput.timestamp}`);
      if (currentTime === lastTime) {
        if (!barsEqual(input, previous.lastInput)) throw new ConsolidationError("DUPLICATE_BAR_CONFLICT", `Bar ${input.timestamp} conflicts with an existing bar`);
        return { state: previous, duplicate: true };
      }
    }

    const [bucketStart, bucketEnd] = this.bucket(input.timestamp);
    if (!previous || previous.workingBar.timestamp !== bucketStart) {
      const workingBar: ConsolidatedBar = { ...input, timestamp: bucketStart, endTimestamp: bucketEnd };
      return {
        emitted: previous?.workingBar,
        state: { workingBar, lastInput: input },
        duplicate: false,
      };
    }

    const workingBar: ConsolidatedBar = {
      ...previous.workingBar,
      high: Math.max(previous.workingBar.high, input.high),
      low: Math.min(previous.workingBar.low, input.low),
      close: input.close,
      volume: previous.workingBar.volume + input.volume,
    };
    return { state: { workingBar, lastInput: input }, duplicate: false };
  }

  private bucket(timestamp: string | number): [string, string] {
    const instant = new Date(timestamp);
    if (Number.isNaN(instant.getTime())) throw new Error(`Invalid bar timestamp: ${timestamp}`);
    const local = toZonedTime(instant, this.timezone);
    const wallTime = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds());
    const alignmentEpoch = this.targetMs % WEEK_MS === 0
      ? MONDAY_EPOCH_MS
      : 0;
    const startWallTime = Math.floor(
      (wallTime - alignmentEpoch - this.anchorMs) / this.targetMs,
    ) * this.targetMs + alignmentEpoch + this.anchorMs;
    const toInstant = (value: number) => fromZonedTime(new Date(value), this.timezone).toISOString();
    return [toInstant(startWallTime), toInstant(startWallTime + this.targetMs)];
  }
}
