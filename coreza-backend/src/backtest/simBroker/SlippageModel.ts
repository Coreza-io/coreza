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

import { ISlippageModel, Order, Bar } from './interfaces';

/**
 * No Slippage Model
 * Executes at exact price (unrealistic but useful for testing)
 */
export class NoSlippageModel implements ISlippageModel {
  getSlippage(): number {
    return 0;
  }
}

/**
 * Fixed Slippage Model
 * Applies a fixed dollar amount of slippage per share
 * E.g., $0.01 slippage means buy fills $0.01 higher, sell fills $0.01 lower
 */
export class FixedSlippageModel implements ISlippageModel {
  constructor(private readonly amount: number) {}

  getSlippage(order: Order): number {
    // Positive slippage for buys (pay more), negative for sells (receive less)
    return order.side === 'buy' ? this.amount : -this.amount;
  }
}

/**
 * Percentage Slippage Model
 * Applies slippage as a percentage of the fill price
 * E.g., 0.1% slippage means buy fills 0.1% higher, sell fills 0.1% lower
 */
export class PercentageSlippageModel implements ISlippageModel {
  constructor(private readonly percentage: number) {}

  getSlippage(order: Order, fillPrice: number): number {
    const slippageAmount = fillPrice * this.percentage;
    // Positive slippage for buys (pay more), negative for sells (receive less)
    return order.side === 'buy' ? slippageAmount : -slippageAmount;
  }
}

/**
 * Volume-Based Slippage Model
 * Higher volume = lower slippage (more liquidity)
 * Uses bar volume to estimate market impact
 */
export class VolumeBasedSlippageModel implements ISlippageModel {
  constructor(
    private readonly basePercentage: number = 0.001, // 0.1% base
    private readonly volumeThreshold: number = 100000 // shares
  ) {}

  getSlippage(order: Order, fillPrice: number, bar: Bar): number {
    // Calculate volume-adjusted slippage
    const volumeFactor = bar.volume < this.volumeThreshold
      ? this.volumeThreshold / Math.max(bar.volume, 1000) // Low volume = more slippage
      : 1;
    
    // Order size impact (larger orders = more slippage)
    const sizeFactor = 1 + (order.quantity / this.volumeThreshold) * 0.1;
    
    const slippageAmount = fillPrice * this.basePercentage * volumeFactor * sizeFactor;
    
    // Positive slippage for buys (pay more), negative for sells (receive less)
    return order.side === 'buy' ? slippageAmount : -slippageAmount;
  }
}

/**
 * Slippage Model Factory
 */
export function createSlippageModel(
  type: 'none' | 'fixed' | 'percentage',
  value: number = 0
): ISlippageModel {
  switch (type) {
    case 'none':
      return new NoSlippageModel();
    case 'fixed':
      return new FixedSlippageModel(value);
    case 'percentage':
      return new PercentageSlippageModel(value);
    default:
      return new NoSlippageModel();
  }
}
