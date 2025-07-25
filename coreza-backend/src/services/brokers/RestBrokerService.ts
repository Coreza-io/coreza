import axios, { AxiosRequestConfig } from 'axios';
import { BaseBrokerService } from './BaseBrokerService';
import { BrokerInput, BrokerResult, IBrokerService } from './types';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface RestOperation {
  path: string;
  method: HttpMethod;
  makeParams?: (input: BrokerInput) => Record<string, string>;
  makeBody?: (input: BrokerInput) => any;
}

export interface RestConfig {
  baseUrl: string | ((creds: any) => string);
  makeAuthHeaders: (creds: any) => Record<string, string>;
  ops: Record<string, RestOperation>;
}

export class RestBrokerService extends BaseBrokerService implements IBrokerService {
  constructor(
    public readonly brokerKey: string,
    private readonly config: RestConfig
  ) {
    super();
  }

  async execute(input: BrokerInput): Promise<BrokerResult> {
    const op = this.config.ops[input.operation];
    if (!op) {
      return { 
        success: false, 
        error: `Unsupported operation: ${input.operation} for broker: ${this.brokerKey}` 
      };
    }

    try {
      // 1. fetch credentials
      const {
        credentials: {
          client_json,
          token_json
        }
      } = await this.getCredentials(input.user_id, input.credential_id);

      // 2. build request
      const baseUrl = typeof this.config.baseUrl === 'function' 
        ? this.config.baseUrl(client_json) 
        : this.config.baseUrl;
      const url = `${baseUrl}${op.path}`;
      const headers = this.config.makeAuthHeaders(client_json);
      const params = op.makeParams?.(input) ?? {};
      const data = op.makeBody?.(input);

      // 3. call
      const res = await axios.request({
        method: op.method,
        url,
        headers,
        params,
        data,
        timeout: 30_000,
      } as AxiosRequestConfig);

      return { success: true, data: res.data };
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || 'Unknown error';
      return { success: false, error: message };
    }
  }
}