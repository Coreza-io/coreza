/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Position } from "../simulation/simBroker";
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
  const costBasis = Math.abs(position.avgEntryPrice * position.quantity);
  return {
    ...position,
    unrealizedPnlPct: toPercent(position.unrealizedPnl, costBasis),
    realizedPnlPct: toPercent(position.realizedPnl, costBasis),
  };
}
