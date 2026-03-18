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

// Export services
export { WorkflowEngine, executeWorkflow } from '../engine';
export { NodeStore } from './nodeStore';
export { NodeScheduler } from '../engine';
export { NodeQueueManager } from '../engine';
export { BullMQJobQueue } from './jobQueueManager';
export { bullMqJobQueue as jobQueue } from './jobQueueManager';
export { NodeRouter } from '../engine';

export { NodeStoreV2 } from '../engine';

// Export Market Data services (Redis Pub/Sub architecture)
export { MarketDataGateway } from './MarketDataGateway';
export { MarketDataSubscriber } from './MarketDataSubscriber';
export { MarketControlHandler } from './MarketControlHandler';
export { SubscriptionManager } from './SubscriptionManager';

// Note: WebSocketClient is DEPRECATED and no longer exported
// Use Redis Pub/Sub architecture via MarketControlHandler instead