import logger from './logger';

type BinanceEnvironment = 'live' | 'testnet';
type BinanceAssetType = 'spot' | 'futures';

type TimeSyncKey = `${BinanceAssetType}_${BinanceEnvironment}`;

const SYNC_TIMEOUT_MS = 5_000;
const RESYNC_INTERVAL_MS = 30 * 60 * 1000;

const timeOffsets: Record<TimeSyncKey, number> = {
  spot_live: 0,
  spot_testnet: 0,
  futures_live: 0,
  futures_testnet: 0,
};

const TIME_ENDPOINTS: Record<TimeSyncKey, string> = {
  spot_live: 'https://api.binance.com/api/v3/time',
  spot_testnet: 'https://testnet.binance.vision/api/v3/time',
  futures_live: 'https://fapi.binance.com/fapi/v1/time',
  futures_testnet: 'https://testnet.binancefuture.com/fapi/v1/time',
};

async function syncTime(key: TimeSyncKey, url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  try {
    const localBefore = Date.now();
    const response = await fetch(url, { signal: controller.signal });
    const localAfter = Date.now();

    if (!response.ok) {
      logger.warn(
        { key, status: response.status },
        'Failed to sync Binance time due to non-OK response; using local clock offset',
      );
      return;
    }

    const payload = (await response.json()) as { serverTime?: number };
    if (typeof payload.serverTime !== 'number') {
      logger.warn(
        { key, payload },
        'Failed to sync Binance time due to invalid payload; using local clock offset',
      );
      return;
    }

    const localMidpoint = Math.floor((localBefore + localAfter) / 2);
    timeOffsets[key] = payload.serverTime - localMidpoint;

    logger.info({ key, offset: timeOffsets[key] }, 'Binance time offset synced');
  } catch (error) {
    logger.warn({ key, err: error }, 'Failed to sync Binance time; using local clock offset');
  } finally {
    clearTimeout(timeout);
  }
}

export async function initBinanceTimeSync(): Promise<void> {
  await Promise.all(
    (Object.entries(TIME_ENDPOINTS) as Array<[TimeSyncKey, string]>).map(([key, url]) =>
      syncTime(key, url),
    ),
  );

  const syncTimer = setInterval(() => {
    (Object.entries(TIME_ENDPOINTS) as Array<[TimeSyncKey, string]>).forEach(([key, url]) => {
      void syncTime(key, url);
    });
  }, RESYNC_INTERVAL_MS);

  syncTimer.unref?.();
}

export function getBinanceTimestamp(
  environment: BinanceEnvironment,
  assetType: BinanceAssetType,
): number {
  const key: TimeSyncKey = `${assetType}_${environment}`;
  return Date.now() + timeOffsets[key];
}
