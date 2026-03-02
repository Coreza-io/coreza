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

import { registerNodeExecutor } from "./registry";
import { IOExecutor } from "./executors/IOExecutor";
import { IndicatorsExecutor } from "./executors/IndicatorsExecutor";
import { BrokerExecutor } from "./executors/BrokerExecutor";
import { MarketExecutor } from "./executors/MarketExecutor";
import { ControlFlowExecutor } from "./executors/ControlFlowExecutor";
import { UtilityExecutor } from "./executors/UtilityExecutor";
import { CommunicationExecutor } from "./executors/CommunicationExecutor";
import { DataSourceExecutor } from "./executors/DataSourceExecutor";
import { RiskExecutor } from "./executors/RiskExecutor";
import { AIAgentExecutor } from "./executors/AIAgentExecutor";
import { ToolExecutor } from "./executors/ToolExecutor";
import { ScreenerExecutor } from "./executors/ScreenerExecutor";
import { TriggerExecutor } from "./executors/TriggerExecutor";
import { BacktestExecutor } from "./executors/BacktestExecutor";
import { PortfolioExecutor } from "./executors/PortfolioExecutor";

// Register all node executors
export function initializeNodeExecutors() {
  const executors = [
    new IOExecutor(),
    new IndicatorsExecutor(),
    new BrokerExecutor(),
    new MarketExecutor(),
    new ControlFlowExecutor(),
    new UtilityExecutor(),
    new CommunicationExecutor(),
    new DataSourceExecutor(),
    new RiskExecutor(),
    new AIAgentExecutor(),
    new ToolExecutor(),
    new ScreenerExecutor(),
    new TriggerExecutor(),
    new BacktestExecutor(),
    new PortfolioExecutor(),
  ];

  executors.forEach((executor) => {
    try {
      registerNodeExecutor(executor);
    } catch (error) {
      console.error(`Failed to register executor ${executor.category}:`, error);
    }
  });

  // Wire PortfolioExecutor to BacktestExecutor's SimBroker cache
  PortfolioExecutor.setSimBrokerCache(BacktestExecutor.getSimBrokerCache());

  console.log("🚀 Node executors initialized successfully");
}

// Export types and registry functions for external use
export * from "./types";
export * from "./registry";
