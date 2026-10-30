import { fromZonedTime } from 'date-fns-tz';

/** Display markets only: choosing one never creates a market-data subscription. */
export const MARKET_CATALOG = [
  { id: 'nyse', name: 'NYSE', timezone: 'America/New_York' },
  { id: 'nasdaq', name: 'NASDAQ', timezone: 'America/New_York' },
  { id: 'nse', name: 'NSE', timezone: 'Asia/Kolkata' },
  { id: 'bse', name: 'BSE', timezone: 'Asia/Kolkata' },
  { id: 'crypto', name: 'Crypto', timezone: 'UTC' },
] as const;
export type MarketId = typeof MARKET_CATALOG[number]['id'];
export const DEFAULT_MARKETS: MarketId[] = ['nyse', 'nasdaq'];
export function normalizeMarkets(value: unknown): MarketId[] {
  if (value == null) return [...DEFAULT_MARKETS];
  if (!Array.isArray(value)) return [];
  return MARKET_CATALOG.filter(market => value.includes(market.id)).map(market => market.id);
}

type Calendar = {
  from: string;
  through: string;
  open: number;
  close: number;
  holidays: readonly string[];
  overrides: Record<string, readonly [number, number]>;
  sources: readonly string[];
};

// Cash-equity core sessions, not premarket/after-hours, derivatives or venue uptime.
// Calendar coverage is explicit: extend it from published exchange notices before expiry.
// Verified 2026-10-30. US calendars cover 2026; Indian coverage starts on this date
// to avoid asserting coverage of earlier ad-hoc sessions not bundled here.
const usCalendar: Calendar = {
  from: '2026-01-01', through: '2026-12-31', open: 570, close: 960,
  holidays: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
    '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'],
  overrides: { '2026-11-27': [570, 780], '2026-12-24': [570, 780] },
  sources: ['https://www.nasdaqtrader.com/trader.aspx?id=calendar',
    'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule',
    'https://www.nyse.com/trade/hours-calendars'],
};
// BSE issuer holiday notice 20251212-8 and Muhurat notice 20261019-9;
// NSE official equities calendar and cash-market circular CMTR76941.
const indiaCalendar: Calendar = {
  from: '2026-10-30', through: '2026-12-31', open: 555, close: 930,
  holidays: ['2026-11-10', '2026-11-24', '2026-12-25'],
  overrides: { '2026-11-08': [860, 930] },
  sources: ['https://www.nseindia.com/resources/exchange-communication-holidays',
    'https://nsearchives.nseindia.com/content/circulars/CMTR76941.pdf',
    'https://www.bseindia.com/downloads/UploadDocs/Notices/20251212-8/20251212-8.pdf',
    'https://www.bseindia.com/downloads/UploadDocs/Notices/20261019-9/20261019-9.pdf'],
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function exchangeClock(date: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: new Date(`${day}T12:00:00Z`).getUTCDay() };
}

export type SessionPhase = 'preopen' | 'premarket' | 'regular' | 'afterhours' | 'overnight' | 'closed' | 'unknown' | 'always';
export interface MarketSession {
  phase: SessionPhase;
  label: string;
  description: string;
  basis: 'calendar';
  venue: MarketId | 'blue_ocean_ats';
  regularSessionOpen: boolean | null;
  tradeDate: string | null;
  timezone: string;
  coverage: { from: string; through: string; version: string } | null;
  sources: readonly string[];
  extendedCoverage: 'covered' | 'unavailable' | 'not-applicable';
}
const labels: Record<SessionPhase, string> = {
  preopen: 'Pre-open', premarket: 'Pre-market', regular: 'Open', afterhours: 'After-hours',
  overnight: 'Overnight (ATS)', closed: 'Closed', unknown: 'Schedule unavailable', always: '24/7 schedule',
};
const OVERNIGHT_SOURCE = 'https://docs.alpaca.markets/us/v1.1/docs/245-trading';
const shiftDay = (day: string, delta: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const covered = (calendar: Calendar, day: string) => day >= calendar.from && day <= calendar.through;
const tradingDay = (calendar: Calendar, day: string) => {
  if (calendar.overrides[day]) return true;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.includes(day);
};

/** Calendar information only. No result here authorizes orders or proves venue uptime. */
export function marketSession(id: MarketId, now: Date = new Date()): MarketSession {
  const market = MARKET_CATALOG.find(item => item.id === id);
  const calendar = id === 'nyse' || id === 'nasdaq' ? usCalendar : indiaCalendar;
  // Each profile names its own authority; matching regular holidays do not imply
  // matching extended sessions (NYSE Tape A is not NASDAQ or NYSE Arca).
  const sources = id === 'nasdaq' ? usCalendar.sources.filter(url => !url.includes('nyse.com'))
    : id === 'nyse' ? usCalendar.sources.filter(url => url.includes('nyse.com'))
    : id === 'bse' ? indiaCalendar.sources.filter(url => url.includes('bseindia.com'))
    : id === 'nse' ? indiaCalendar.sources.filter(url => !url.includes('bseindia.com')) : [];
  const base = {
    basis: 'calendar' as const, venue: id, timezone: market?.timezone ?? 'UTC',
    tradeDate: null, regularSessionOpen: null,
    coverage: id === 'crypto' ? null : { from: calendar.from, through: calendar.through, version: '2026-10-30' },
    sources, extendedCoverage: 'not-applicable' as const,
  };
  const result = (phase: SessionPhase, description: string, patch: Partial<MarketSession> = {}): MarketSession => ({
    ...base, phase, label: labels[phase], description, ...patch,
  });
  if (!market || !Number.isFinite(now.getTime())) return result('unknown', 'Market or current time is invalid.');
  if (id === 'crypto') return result('always', '24/7 trading schedule only; not venue uptime or account connectivity.');
  try {
    const { day, minute } = exchangeClock(now, market.timezone);
    if (!covered(calendar, day)) return result('unknown', `Calendar coverage is ${calendar.from} through ${calendar.through}.`);
    const special = calendar.overrides[day];
    const [open, close] = special ?? [calendar.open, calendar.close];
    const isTradingDay = tradingDay(calendar, day);
    const regularSessionOpen = isTradingDay && minute >= open && minute < close;
    const reason = `${special ? 'Special/shortened' : 'Regular'} cash-equity session: ${time(open)}–${time(close)} ${market.timezone}.`;
    const core = { tradeDate: day, regularSessionOpen };
    if (regularSessionOpen) return result('regular', `${reason} Scheduled hours only; unscheduled halts and connectivity are not monitored.`, core);
    if (id !== 'nasdaq') {
      return result('closed', `${!isTradingDay ? 'Weekend or exchange holiday. ' : ''}${reason} Only the named exchange cash-equity session is covered; no pre-open auction or other venue hours are inferred.`, core);
    }
    // A core early-close notice does not establish the extended/ATS hours for
    // that date. Do not accidentally keep a normal 16:00/20:00 boundary active.
    if (special) return result('closed', `${reason} Extended and ATS hours for this special date are not verified.`, {
      ...core, label: 'Closed (regular)', extendedCoverage: 'unavailable',
    });
    const extended = { ...core, extendedCoverage: 'covered' as const, sources };
    if (isTradingDay && minute >= 240 && minute < open) return result('premarket', 'NASDAQ scheduled pre-market: 04:00–09:30 America/New_York. Broker access and security eligibility may differ.', extended);
    if (isTradingDay && minute >= close && minute < 1200) return result('afterhours', 'NASDAQ scheduled after-hours: 16:00–20:00 America/New_York. Broker access and security eligibility may differ.', extended);
    if (minute >= 1200 || minute < 240) {
      const tradeDate = minute >= 1200 ? shiftDay(day, 1) : day;
      const overnight = { ...core, sources: [...sources, OVERNIGHT_SOURCE] };
      if (!covered(calendar, tradeDate) || calendar.overrides[tradeDate]) return result('closed', 'NASDAQ regular exchange session is closed. Adjacent trade-date coverage or special-date ATS hours are unavailable.', {
        ...overnight, label: 'Closed (regular)', extendedCoverage: 'unavailable',
      });
      if (tradingDay(calendar, tradeDate)) {
        // Resolve both endpoints as zoned instants; never use a fixed IST/UTC offset.
        const start = fromZonedTime(`${shiftDay(tradeDate, -1)}T20:00:00`, market.timezone).getTime();
        const end = fromZonedTime(`${tradeDate}T04:00:00`, market.timezone).getTime();
        if (now.getTime() >= start && now.getTime() < end) return result('overnight',
          'NASDAQ exchange closed. Blue Ocean ATS reference schedule for eligible US equities: 20:00–04:00 America/New_York, Sunday evening through Friday morning, subject to the upcoming trade-date holiday calendar. This does not confirm broker access, live quotes, or Coreza order/stream support.', {
            ...overnight, venue: 'blue_ocean_ats', tradeDate, extendedCoverage: 'covered',
          });
      }
    }
    return result('closed', 'No covered NASDAQ exchange or referenced Blue Ocean ATS session is scheduled now. Weekend/holiday rules use the assigned trade date; no future NASDAQ exchange overnight launch is assumed.', extended);
  } catch {
    return result('unknown', 'Exchange timezone or session interval could not be evaluated.');
  }
}
