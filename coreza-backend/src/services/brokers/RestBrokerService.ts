import axios, { AxiosRequestConfig } from 'axios';
import { BaseBrokerService } from './BaseBrokerService';
import { BrokerInput, BrokerResult, IBrokerService } from './types';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface RestOperation {
  path: string | ((input: BrokerInput) => string);
  method: HttpMethod;
  makeParams?:     (input: BrokerInput) => Record<string, string>;
  makeBody?:       (input: BrokerInput, creds?: any) => any;
  /** Optional per-op transform of raw response.data → final data */
  transformResult?: (data: any, input: BrokerInput) => any;
}

export interface RestConfig {
  baseUrl:
    | string
    | ((creds: any, input: BrokerInput) => string);

  makeAuthHeaders: (creds: any) => Record<string, string>;
  ops:             Record<string, RestOperation>;
}

export class RestBrokerService
  extends BaseBrokerService
  implements IBrokerService
{
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
        error:   `Unsupported operation: ${input.operation} for broker: ${this.brokerKey}`
      };
    }

    try {
      // 1. fetch credentials
      const { credentials } = await this.getCredentials(input.user_id, input.credential_id);
      
      // Credentials are returned as flat object with api keys
      const client_json = credentials;
      const token_json = {};

      // 2. build request
      const baseUrl = typeof this.config.baseUrl === 'function'
        ? this.config.baseUrl(client_json, input)
        : this.config.baseUrl;
      const path = typeof op.path === 'function' ? op.path(input) : op.path;
      const url     = `${baseUrl}${path}`;
      const headers = this.config.makeAuthHeaders(client_json);
      const params  = op.makeParams?.(input) ?? {};
      const body    = op.makeBody ? await op.makeBody(input, client_json) : undefined;

      // build the axios config:
      const axiosConfig: AxiosRequestConfig = {
        method:  op.method,
        url,
        headers,
        params,
        timeout: 30_000,
      };

      if (['post','put','patch','delete'].includes(op.method.toLowerCase())) {
        axiosConfig.data = body;
      }

      // fire:
      const res = await axios.request(axiosConfig);

      // 3. transform if needed
      const rawData = res.data;
      const data = op.transformResult
        ? op.transformResult(rawData, input)
        : rawData;

      return { success: true, data };
    } catch (err: any) {
      // --- Enhanced error handling ---
      // Axios error shape
      const status = err.response?.status;
      let message =
        err.response?.data?.errorMessage ||
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Unknown error';

      if (status === 503) {
        message = 'API service is temporarily unavailable (HTTP 503). Please try again later.';
      } else if (status === 400) {
        // Dhan returns errorType, errorCode, errorMessage
        if (err.response?.data?.errorMessage || err.response?.data?.errorCode) {
          message = `API Error [${err.response.data.errorCode || '400'}]: ${err.response.data.errorMessage || message}`;
        }
      } else if (!message && err.response?.statusText) {
        message = err.response.statusText;
      }

      return { success: false, error: message };
    }
  }
}
