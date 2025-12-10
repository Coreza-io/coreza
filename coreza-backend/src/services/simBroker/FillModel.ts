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

import { IFillModel, FillResult, Order, Bar } from './interfaces';

/**
 * Immediate Fill Model
 * Fills market orders at current bar close, limit orders if price touched during bar
 * Best for: Quick backtesting, end-of-day strategies
 */
export class ImmediateFillModel implements IFillModel {
  fill(order: Order, bar: Bar): FillResult {
    switch (order.type) {
      case 'market':
        return {
          filled: true,
          price: bar.close,
          quantity: order.quantity,
        };

      case 'limit':
        // Buy limit: fill if bar low <= limit price
        if (order.side === 'buy' && bar.low <= (order.limitPrice ?? 0)) {
          return {
            filled: true,
            price: Math.min(order.limitPrice ?? bar.close, bar.close),
            quantity: order.quantity,
          };
        }
        // Sell limit: fill if bar high >= limit price
        if (order.side === 'sell' && bar.high >= (order.limitPrice ?? Infinity)) {
          return {
            filled: true,
            price: Math.max(order.limitPrice ?? bar.close, bar.close),
            quantity: order.quantity,
          };
        }
        return { filled: false, reason: 'Limit price not reached' };

      case 'stop':
        // Buy stop: fill if bar high >= stop price
        if (order.side === 'buy' && bar.high >= (order.stopPrice ?? Infinity)) {
          return {
            filled: true,
            price: Math.max(order.stopPrice ?? bar.close, bar.open),
            quantity: order.quantity,
          };
        }
        // Sell stop: fill if bar low <= stop price
        if (order.side === 'sell' && bar.low <= (order.stopPrice ?? 0)) {
          return {
            filled: true,
            price: Math.min(order.stopPrice ?? bar.close, bar.open),
            quantity: order.quantity,
          };
        }
        return { filled: false, reason: 'Stop price not reached' };

      case 'stop_limit':
        // Buy stop-limit: stop triggers at high >= stop, then limit at limitPrice
        if (order.side === 'buy' && bar.high >= (order.stopPrice ?? Infinity)) {
          if (bar.low <= (order.limitPrice ?? 0)) {
            return {
              filled: true,
              price: order.limitPrice ?? bar.close,
              quantity: order.quantity,
            };
          }
          return { filled: false, reason: 'Stop triggered but limit not reached' };
        }
        // Sell stop-limit: stop triggers at low <= stop, then limit at limitPrice
        if (order.side === 'sell' && bar.low <= (order.stopPrice ?? 0)) {
          if (bar.high >= (order.limitPrice ?? Infinity)) {
            return {
              filled: true,
              price: order.limitPrice ?? bar.close,
              quantity: order.quantity,
            };
          }
          return { filled: false, reason: 'Stop triggered but limit not reached' };
        }
        return { filled: false, reason: 'Stop price not reached' };

      default:
        return { filled: false, reason: `Unknown order type: ${order.type}` };
    }
  }
}

/**
 * Next Bar Open Fill Model
 * Fills market orders at the NEXT bar's open price (more realistic)
 * Orders placed during bar N are filled at bar N+1 open
 * Best for: Realistic intraday simulation
 */
export class NextBarOpenFillModel implements IFillModel {
  fill(order: Order, bar: Bar, previousBar?: Bar): FillResult {
    // If no previous bar, this is the first bar - can't fill yet
    if (!previousBar) {
      return { filled: false, reason: 'Waiting for next bar' };
    }

    switch (order.type) {
      case 'market':
        // Fill at current bar open (order was placed at previous bar)
        return {
          filled: true,
          price: bar.open,
          quantity: order.quantity,
        };

      case 'limit':
        // Buy limit: fill at bar open if open <= limit, otherwise check if low reaches limit
        if (order.side === 'buy') {
          if (bar.open <= (order.limitPrice ?? 0)) {
            return { filled: true, price: bar.open, quantity: order.quantity };
          }
          if (bar.low <= (order.limitPrice ?? 0)) {
            return { filled: true, price: order.limitPrice ?? bar.close, quantity: order.quantity };
          }
        }
        // Sell limit: fill at bar open if open >= limit, otherwise check if high reaches limit
        if (order.side === 'sell') {
          if (bar.open >= (order.limitPrice ?? Infinity)) {
            return { filled: true, price: bar.open, quantity: order.quantity };
          }
          if (bar.high >= (order.limitPrice ?? Infinity)) {
            return { filled: true, price: order.limitPrice ?? bar.close, quantity: order.quantity };
          }
        }
        return { filled: false, reason: 'Limit price not reached' };

      case 'stop':
        // Buy stop: fill at bar open if open >= stop, otherwise check if high reaches stop
        if (order.side === 'buy') {
          if (bar.open >= (order.stopPrice ?? Infinity)) {
            return { filled: true, price: bar.open, quantity: order.quantity };
          }
          if (bar.high >= (order.stopPrice ?? Infinity)) {
            return { filled: true, price: order.stopPrice ?? bar.high, quantity: order.quantity };
          }
        }
        // Sell stop: fill at bar open if open <= stop, otherwise check if low reaches stop
        if (order.side === 'sell') {
          if (bar.open <= (order.stopPrice ?? 0)) {
            return { filled: true, price: bar.open, quantity: order.quantity };
          }
          if (bar.low <= (order.stopPrice ?? 0)) {
            return { filled: true, price: order.stopPrice ?? bar.low, quantity: order.quantity };
          }
        }
        return { filled: false, reason: 'Stop price not reached' };

      case 'stop_limit':
        // Complex stop-limit logic for next bar
        if (order.side === 'buy') {
          const stopTriggered = bar.open >= (order.stopPrice ?? Infinity) || bar.high >= (order.stopPrice ?? Infinity);
          if (stopTriggered) {
            const limitReached = bar.open <= (order.limitPrice ?? 0) || bar.low <= (order.limitPrice ?? 0);
            if (limitReached) {
              const fillPrice = bar.open <= (order.limitPrice ?? 0) ? bar.open : (order.limitPrice ?? bar.close);
              return { filled: true, price: fillPrice, quantity: order.quantity };
            }
            return { filled: false, reason: 'Stop triggered but limit not reached' };
          }
        }
        if (order.side === 'sell') {
          const stopTriggered = bar.open <= (order.stopPrice ?? 0) || bar.low <= (order.stopPrice ?? 0);
          if (stopTriggered) {
            const limitReached = bar.open >= (order.limitPrice ?? Infinity) || bar.high >= (order.limitPrice ?? Infinity);
            if (limitReached) {
              const fillPrice = bar.open >= (order.limitPrice ?? Infinity) ? bar.open : (order.limitPrice ?? bar.close);
              return { filled: true, price: fillPrice, quantity: order.quantity };
            }
            return { filled: false, reason: 'Stop triggered but limit not reached' };
          }
        }
        return { filled: false, reason: 'Stop price not reached' };

      default:
        return { filled: false, reason: `Unknown order type: ${order.type}` };
    }
  }
}

/**
 * Fill Model Factory
 */
export function createFillModel(type: 'immediate' | 'next_bar_open'): IFillModel {
  switch (type) {
    case 'immediate':
      return new ImmediateFillModel();
    case 'next_bar_open':
      return new NextBarOpenFillModel();
    default:
      return new NextBarOpenFillModel();
  }
}
