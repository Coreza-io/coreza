import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';

let scripMasterCache: Map<string, string> | null = null;
let loadingPromise: Promise<Map<string, string>> | null = null;

async function loadScripMaster(): Promise<Map<string, string>> {
  if (scripMasterCache) return scripMasterCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<Map<string, string>>((resolve, reject) => {
    const map = new Map<string, string>();
    const csvFilePath = path.resolve(__dirname, '../../data/api-scrip-master-detailed.csv');

    if (!fs.existsSync(csvFilePath)) {
      console.warn('Dhan scrip master CSV file not found. Skipping load.');
      scripMasterCache = map;
      return resolve(map);
    }

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row: Record<string, string>) => {
        const symbol = row['UNDERLYING_SYMBOL']?.trim();
        const securityId = row['SECURITY_ID']?.trim();
        const exchangeSegment = row['EXCH_ID']?.trim();

        if (symbol && securityId && exchangeSegment) {
          const baseSegment = exchangeSegment.split('_')[0];
          const key = `${symbol}_${baseSegment}`;
          map.set(key, securityId);
        }
      })
      .on('end', () => {
        scripMasterCache = map;
        console.log(`✅ Loaded ${map.size} Dhan scrip mappings`);
        resolve(map);
      })
      .on('error', (err) => {
        console.error('Error loading Dhan scrip master CSV:', err);
        reject(err);
      });
  });

  return loadingPromise;
}

export async function lookupSecurityId(symbol: string, exchangeSegment: string): Promise<string> {
  const map = await loadScripMaster();
  const baseSegment = exchangeSegment.split('_')[0];
  const key = `${symbol}_${baseSegment}`;
  return map.get(key) || '';
}

// Preload on startup
loadScripMaster().catch(() => {});
