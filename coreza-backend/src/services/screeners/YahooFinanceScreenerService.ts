import { BaseScreenerService } from './BaseScreenerService';
import { ScreenerInput, IScreenerService } from './types';
import yahooFinance from 'yahoo-finance2';

export class YahooFinanceScreenerService 
  extends BaseScreenerService 
  implements IScreenerService 
{
  readonly screenerKey = 'yahoofinance';

  protected handlers: Record<string, (input: ScreenerInput) => Promise<any>> = {
    day_gainers: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      const minGap = Number(input.min_gap_percent || 0);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'day_gainers',
          count
        });

        const filtered = result.quotes.filter((q: any) => 
          (q.regularMarketChangePercent || 0) >= minGap
        );

        return {
          gainers: filtered.map(this.transformQuote),
          count: filtered.length,
          source: 'yahoo_finance_day_gainers'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          const filtered = error.result.quotes.filter((q: any) => 
            (q.regularMarketChangePercent || 0) >= minGap
          );
          return {
            gainers: filtered.map(this.transformQuote),
            count: filtered.length,
            source: 'yahoo_finance_day_gainers'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] day_gainers error:', error);
        throw error;
      }
    },

    small_cap_gainers: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'small_cap_gainers',
          count
        });

        return {
          gainers: result.quotes.map(this.transformQuote),
          count: result.quotes.length,
          source: 'yahoo_finance_small_cap_gainers'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          return {
            gainers: error.result.quotes.map(this.transformQuote),
            count: error.result.quotes.length,
            source: 'yahoo_finance_small_cap_gainers'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] small_cap_gainers error:', error);
        throw error;
      }
    },

    most_actives: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      const minChange = Number(input.min_change_percent || 1.0);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'most_actives',
          count
        });

        const filtered = result.quotes.filter((q: any) => 
          Math.abs(q.regularMarketChangePercent || 0) >= minChange
        );

        return {
          actives: filtered.map(this.transformQuote),
          count: filtered.length,
          source: 'yahoo_finance_most_actives'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          const filtered = error.result.quotes.filter((q: any) => 
            Math.abs(q.regularMarketChangePercent || 0) >= minChange
          );
          return {
            actives: filtered.map(this.transformQuote),
            count: filtered.length,
            source: 'yahoo_finance_most_actives'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] most_actives error:', error);
        throw error;
      }
    },

    day_losers: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      const minLoss = Number(input.min_loss_percent || 0);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'day_losers',
          count
        });

        const filtered = result.quotes.filter((q: any) => 
          (q.regularMarketChangePercent || 0) <= -minLoss
        );

        return {
          losers: filtered.map(this.transformQuote),
          count: filtered.length,
          source: 'yahoo_finance_day_losers'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          const filtered = error.result.quotes.filter((q: any) => 
            (q.regularMarketChangePercent || 0) <= -minLoss
          );
          return {
            losers: filtered.map(this.transformQuote),
            count: filtered.length,
            source: 'yahoo_finance_day_losers'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] day_losers error:', error);
        throw error;
      }
    },

    undervalued_large_caps: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'undervalued_large_caps',
          count
        });

        return {
          stocks: result.quotes.map(this.transformQuote),
          count: result.quotes.length,
          source: 'yahoo_finance_undervalued_large_caps'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          return {
            stocks: error.result.quotes.map(this.transformQuote),
            count: error.result.quotes.length,
            source: 'yahoo_finance_undervalued_large_caps'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] undervalued_large_caps error:', error);
        throw error;
      }
    },

    growth_technology_stocks: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'growth_technology_stocks',
          count
        });

        return {
          stocks: result.quotes.map(this.transformQuote),
          count: result.quotes.length,
          source: 'yahoo_finance_growth_technology_stocks'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          return {
            stocks: error.result.quotes.map(this.transformQuote),
            count: error.result.quotes.length,
            source: 'yahoo_finance_growth_technology_stocks'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] growth_technology_stocks error:', error);
        throw error;
      }
    },

    aggressive_small_caps: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'aggressive_small_caps',
          count
        });

        return {
          stocks: result.quotes.map(this.transformQuote),
          count: result.quotes.length,
          source: 'yahoo_finance_aggressive_small_caps'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          return {
            stocks: error.result.quotes.map(this.transformQuote),
            count: error.result.quotes.length,
            source: 'yahoo_finance_aggressive_small_caps'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] aggressive_small_caps error:', error);
        throw error;
      }
    },

    undervalued_growth_stocks: async (input: ScreenerInput) => {
      const count = Number(input.count || 100);
      
      try {
        const result = await yahooFinance.screener({
          scrIds: 'undervalued_growth_stocks',
          count
        });

        return {
          stocks: result.quotes.map(this.transformQuote),
          count: result.quotes.length,
          source: 'yahoo_finance_undervalued_growth_stocks'
        };
      } catch (error: any) {
        // Handle Yahoo Finance validation errors - data is still usable
        if (error.name === 'FailedYahooValidationError' && error.result?.quotes) {
          console.log('[YAHOOFINANCE-SCREENER] Validation error caught, using raw data');
          return {
            stocks: error.result.quotes.map(this.transformQuote),
            count: error.result.quotes.length,
            source: 'yahoo_finance_undervalued_growth_stocks'
          };
        }
        console.error('[YAHOOFINANCE-SCREENER] undervalued_growth_stocks error:', error);
        throw error;
      }
    }
  };

  private transformQuote(quote: any) {
    return {
      symbol: quote.symbol,
      current_price: quote.regularMarketPrice,
      previous_close: quote.regularMarketPreviousClose,
      gap_percent: quote.regularMarketChangePercent,
      change_dollar: quote.regularMarketChange,
      current_volume: quote.regularMarketVolume,
      avg_volume: quote.averageDailyVolume3Month,
      volume_ratio: quote.averageDailyVolume3Month
        ? quote.regularMarketVolume / quote.averageDailyVolume3Month
        : 0,
      market_cap: quote.marketCap,
      market_cap_billions: quote.marketCap ? quote.marketCap / 1e9 : 0,
      pe_ratio: quote.trailingPE,
      short_name: quote.shortName,
      long_name: quote.longName,
      fifty_two_week_high: quote.fiftyTwoWeekHigh,
      fifty_two_week_low: quote.fiftyTwoWeekLow
    };
  }
}
