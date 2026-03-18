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

import { IFeeModel, Order } from './interfaces';

/**
 * No Fee Model
 * Zero commission (like Robinhood, Alpaca)
 */
export class NoFeeModel implements IFeeModel {
  getCommission(): number {
    return 0;
  }
}

/**
 * Per Share Fee Model
 * Charges a fixed amount per share traded
 * E.g., $0.01 per share
 */
export class PerShareFeeModel implements IFeeModel {
  constructor(
    private readonly perShareFee: number,
    private readonly minimumFee: number = 0
  ) {}

  getCommission(_order: Order, _fillPrice: number, fillQty: number): number {
    const rawFee = fillQty * this.perShareFee;
    return Math.max(rawFee, this.minimumFee);
  }
}

/**
 * Percentage Fee Model
 * Charges a percentage of the total trade value
 * E.g., 0.1% of trade value
 */
export class PercentageFeeModel implements IFeeModel {
  constructor(
    private readonly percentage: number,
    private readonly minimumFee: number = 0
  ) {}

  getCommission(_order: Order, fillPrice: number, fillQty: number): number {
    const tradeValue = fillPrice * fillQty;
    const rawFee = tradeValue * this.percentage;
    return Math.max(rawFee, this.minimumFee);
  }
}

/**
 * Fixed Fee Model
 * Charges a flat fee per order
 * E.g., $4.95 per trade
 */
export class FixedFeeModel implements IFeeModel {
  constructor(private readonly fixedFee: number) {}

  getCommission(): number {
    return this.fixedFee;
  }
}

/**
 * Tiered Fee Model
 * Different fees based on trade value or volume
 * Common for professional trading platforms
 */
export class TieredFeeModel implements IFeeModel {
  constructor(
    private readonly tiers: Array<{
      maxValue: number;
      percentage: number;
      minimumFee?: number;
    }>
  ) {
    // Sort tiers by maxValue ascending
    this.tiers.sort((a, b) => a.maxValue - b.maxValue);
  }

  getCommission(_order: Order, fillPrice: number, fillQty: number): number {
    const tradeValue = fillPrice * fillQty;
    
    // Find applicable tier
    const tier = this.tiers.find(t => tradeValue <= t.maxValue) ?? this.tiers[this.tiers.length - 1];
    
    const rawFee = tradeValue * tier.percentage;
    return Math.max(rawFee, tier.minimumFee ?? 0);
  }
}

/**
 * Fee Model Factory
 */
export function createFeeModel(
  type: 'none' | 'per_share' | 'percentage' | 'fixed',
  value: number = 0,
  minimumFee: number = 0
): IFeeModel {
  switch (type) {
    case 'none':
      return new NoFeeModel();
    case 'per_share':
      return new PerShareFeeModel(value, minimumFee);
    case 'percentage':
      return new PercentageFeeModel(value, minimumFee);
    case 'fixed':
      return new FixedFeeModel(value);
    default:
      return new NoFeeModel();
  }
}
