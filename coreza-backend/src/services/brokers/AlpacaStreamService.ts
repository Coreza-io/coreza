import { BaseBrokerService } from './BaseBrokerService';
import { BrokerInput } from './types';
import AlpacaWebSocketService from './AlpacaWebSocketService';
import { getBrokerService } from './registry';

/**
 * Broker service that manages Alpaca market data streaming over WebSocket.
 * Uses the existing Alpaca REST service to resolve user credentials and
 * delegates streaming functionality to AlpacaWebSocketService.
 */
export class AlpacaStreamService extends BaseBrokerService {
  readonly brokerKey = 'alpacastream';

  protected handlers: Record<string, (input: BrokerInput) => Promise<any>> = {
    start_stream: this.startStream.bind(this),
    stop_stream: this.stopStream.bind(this)
  };

  /** Retrieve Alpaca credentials using the existing Alpaca broker service */
  private async getAlpacaCredentials(userId: string, credentialId: string) {
    const alpacaService = getBrokerService('alpaca') as any;
    if (!alpacaService || typeof alpacaService.getCredentials !== 'function') {
      throw new Error('Alpaca broker service not available');
    }
    return alpacaService.getCredentials(userId, credentialId);
  }

  private async startStream(input: BrokerInput) {
    const { user_id, credential_id, symbols } = input;
    const { credentials } = await this.getAlpacaCredentials(user_id, credential_id);

    // Connect to Alpaca stream if not already connected
    if (!AlpacaWebSocketService.isConnected()) {
      await AlpacaWebSocketService.connect(credentials.client_json);
    }

    const symbolArray = Array.isArray(symbols)
      ? symbols
      : typeof symbols === 'string'
        ? symbols.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    if (symbolArray.length > 0) {
      AlpacaWebSocketService.subscribeToSymbols(user_id, symbolArray);
    }

    return {
      message: 'Alpaca stream started',
      symbols: symbolArray
    };
  }

  private async stopStream(input: BrokerInput) {
    const { user_id, symbols } = input;
    const symbolArray = Array.isArray(symbols)
      ? symbols
      : typeof symbols === 'string'
        ? symbols.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    if (symbolArray.length > 0) {
      AlpacaWebSocketService.unsubscribeFromSymbols(user_id, symbolArray);
    }

    return {
      message: 'Alpaca stream stopped',
      symbols: symbolArray
    };
  }
}

export default AlpacaStreamService;
