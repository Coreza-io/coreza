import { BROKER_CAPABILITIES } from "./capabilities";
import { buildCryptoSymbols, normalizeSymbolList } from "../utils/symbolHelpers";

export interface ResolveSymbolsOptions {
  assetType?: unknown;
  symbols?: unknown;
  cryptoBase?: unknown;
  cryptoQuote?: unknown;
  /** Live workflows prefer explicit symbols before the generic crypto fallback. */
  preferSymbols?: boolean;
}

/** Resolve a broker or source alias to a validated, normalized symbol list. */
export function resolveSymbols(brokerOrSource: string, options: ResolveSymbolsOptions): string[] {
  // Longest registered alias wins, including broker IDs containing underscores.
  const aliases = Object.values(BROKER_CAPABILITIES).flatMap(capability =>
    [capability.id, capability.streaming.sourceId, capability.streaming.tradingSourceId, capability.streaming.newsSourceId]
      .filter((id): id is string => !!id)
      .map(id => ({ id, capability })),
  );
  const capability = aliases.sort((a, b) => b.id.length - a.id.length)
    .find(({ id }) => brokerOrSource === id || brokerOrSource.startsWith(`${id}_`))?.capability;
  const brokerSymbols = capability?.resolveSymbols?.(options.assetType, options.cryptoBase ?? options.symbols);
  // An empty broker result is authoritative; only undefined selects the default.
  if (brokerSymbols !== undefined) return brokerSymbols;

  const symbols = normalizeSymbolList(options.symbols);
  if (options.preferSymbols && symbols.length > 0) return symbols;
  const cryptoSymbols = buildCryptoSymbols(options.assetType, options.cryptoBase, options.cryptoQuote);
  return cryptoSymbols.length > 0 ? cryptoSymbols : symbols;
}
