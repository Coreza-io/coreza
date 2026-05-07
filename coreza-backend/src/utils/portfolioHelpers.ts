/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Position } from "../backtest/simBroker";
import { toPercent } from "./barParser";

export interface FormattedPosition extends Position {
  unrealizedPnlPct: number;
  realizedPnlPct: number;
}

/**
 * Format a position with PnL percentages as separate fields.
 * Does NOT overwrite the original unrealizedPnl / realizedPnl (keeps them as currency values).
 */
export function formatPositionWithPnlPercent(position: Position): FormattedPosition {
  const costBasis = Math.abs(position.avgFillPrice * position.quantity);
  return {
    ...position,
    unrealizedPnlPct: toPercent(position.unrealizedPnl, costBasis),
    realizedPnlPct: toPercent(position.realizedPnl, costBasis),
  };
}
