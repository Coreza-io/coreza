/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
import { BacktestExecutor } from "../backtest";
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
