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

import axios from "axios";
import { createLogger } from "./logger";

const logger = createLogger("BinanceTimeSync");

// Store offset per environment (testnet vs production have different server times)
const timeOffsets: Record<string, number> = {
  spot_live: 0,
  spot_testnet: 0,
  futures_live: 0,
  futures_testnet: 0,
};

const TIME_ENDPOINTS = {
  spot_live: "https://api.binance.com/api/v3/time",
  spot_testnet: "https://testnet.binance.vision/api/v3/time",
  futures_live: "https://fapi.binance.com/fapi/v1/time",
  futures_testnet: "https://demo-fapi.binance.com/fapi/v1/time",
};

async function syncTime(key: string, url: string): Promise<void> {
  try {
    const localBefore = Date.now();
    const res = await axios.get(url, { timeout: 5000 });
    const localAfter = Date.now();

    // Account for network latency (use midpoint between request start/end)
    const localTime = Math.floor((localBefore + localAfter) / 2);
    const serverTime = res.data.serverTime;

    timeOffsets[key] = serverTime - localTime;
    logger.info(
      { key, offset: timeOffsets[key] },
      "Binance time offset synced",
    );
  } catch (error) {
    logger.warn(
      { key, error },
      "Failed to sync Binance time, using local time",
    );
  }
}

export async function initBinanceTimeSync(): Promise<void> {
  // Sync all environments on boot
  await Promise.all(
    Object.entries(TIME_ENDPOINTS).map(([key, url]) => syncTime(key, url)),
  );

  // Re-sync every 30 minutes
  setInterval(
    () => {
      Object.entries(TIME_ENDPOINTS).forEach(([key, url]) =>
        syncTime(key, url),
      );
    },
    30 * 60 * 1000,
  );
}

export function getBinanceTimestamp(
  environment: "live" | "testnet",
  marketType: "spot" | "futures",
): number {
  const key = `${marketType}_${environment}`;
  return Date.now() + (timeOffsets[key] || 0);
}
