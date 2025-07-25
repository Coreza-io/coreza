import { supabase } from '../../config/supabase';
import { IBrokerService, BrokerInput, BrokerResult } from './types';

export abstract class BaseBrokerService implements IBrokerService {
  abstract readonly brokerKey: string;
  /** Map from operation → handler(input) */
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
    try {
      const { data, error } = await supabase
        .from('user_credentials')
        .select('client_json, token_json')
        .eq('user_id', userId)
        .eq('name', credentialId)
        .eq('service_type', this.brokerKey)
        .single();

      if (error) {
        // handle or throw error as needed
        return { credentials: null }; // or throw error
      }

      if (!data) {
        // Not found
        return { credentials: null };
      }

      return { credentials: { client_json: data.client_json, token_json: data.token_json } };
    } catch (error) {
      throw new Error(`Failed to get ${this.brokerKey} credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}