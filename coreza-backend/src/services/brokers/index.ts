import { registerBroker } from "./registry";
import { RestBrokerService } from "./RestBrokerService";
import { alpacaConfig } from "./configs/alpaca";
import { dhanConfig } from "./configs/dhan";
import { schwabConfig } from "./configs/schwab";

export function initializeBrokerServices() {
  console.log("🚀 Initializing broker services...");

  // Register REST-based broker services with their configurations
  registerBroker(new RestBrokerService("alpaca", alpacaConfig));
  registerBroker(new RestBrokerService("dhan", dhanConfig));
  registerBroker(new RestBrokerService("schwab", schwabConfig));

  console.log("✅ All broker services initialized");
}

// Re-export for convenience
export { getBrokerService, getAllRegisteredBrokers } from "./registry";
export { BrokerInput, BrokerResult, IBrokerService } from "./types";
