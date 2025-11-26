import { IScreenerService, ScreenerInput, ScreenerResult } from './types';
import CredentialManager from '../../utils/credentialManager';

export abstract class BaseScreenerService implements IScreenerService {
  abstract readonly screenerKey: string;
  
  /** Map from operation -> handler(input) */
  protected abstract handlers: Record<
    string, 
    (input: ScreenerInput) => Promise<any>
  >;

  async execute(input: ScreenerInput): Promise<ScreenerResult> {
    const handler = this.handlers[input.operation];
    if (!handler) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for screener: ${this.screenerKey}`
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
    return CredentialManager.getCredentials(userId, this.screenerKey, credentialId);
  }
}
