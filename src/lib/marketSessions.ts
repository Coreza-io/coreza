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

export function marketSession(id: MarketId, now: Date = new Date()) {
  if (id === 'crypto') return {
    label: '24/7 schedule', description: 'Trading schedule only; not venue uptime or account connectivity.',
  };
  const market = MARKET_CATALOG.find(item => item.id === id);
  if (!market || !Number.isFinite(now.getTime())) return {
    label: 'Schedule unavailable', description: 'Market or current time is invalid.',
  };
  const calendar = id === 'nyse' || id === 'nasdaq' ? usCalendar : indiaCalendar;
  try {
    const { day, minute, weekday } = exchangeClock(now, market.timezone);
    if (day < calendar.from || day > calendar.through) return {
      label: 'Schedule unavailable',
      description: `Published calendar coverage: ${calendar.from} to ${calendar.through}. Update the calendar for this date.`,
    };
    // Special sessions override weekends (e.g. Sunday Muhurat trading).
    const special = calendar.overrides[day];
    const holiday = calendar.holidays.includes(day);
    const tradingDay = special != null || (!holiday && weekday !== 0 && weekday !== 6);
    const [open, close] = special ?? [calendar.open, calendar.close];
    const isOpen = tradingDay && minute >= open && minute < close;
    const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    const reason = holiday ? 'Exchange holiday.' : !tradingDay ? 'Weekend.'
      : `${special ? 'Special/shortened' : 'Regular'} equity session: ${time(open)}–${time(close)} ${market.timezone}.`;
    return {
      label: isOpen ? 'Scheduled open' : 'Scheduled closed',
      description: `${reason} Calendar through ${calendar.through}; scheduled hours only, not live exchange connectivity or unscheduled halts.`,
    };
  } catch {
    return { label: 'Schedule unavailable', description: 'Exchange timezone could not be evaluated.' };
  }
}
