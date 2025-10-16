import { IBrokerService, BrokerInput, BrokerResult } from './types';
import CredentialManager from '../../utils/credentialManager';

export abstract class BaseBrokerService implements IBrokerService {
  abstract readonly brokerKey: string;
  /** Map from operation -> handler(input) */
  protected abstract handlers: Record<string, (input: BrokerInput) => Promise<any>>;

  async execute(input: BrokerInput): Promise<BrokerResult> {
    const handler = this.handlers[input.operation];
    if (!handler) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for broker: ${this.brokerKey}`
      };
    }

    try {
      const data = await handler.call(this, input);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  protected async getCredentials(userId: string, credentialId: string): Promise<any> {
    return CredentialManager.getCredentials(userId, this.brokerKey, credentialId);
  }
}
