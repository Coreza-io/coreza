import axios, { AxiosRequestConfig } from 'axios';
import { BaseScreenerService } from './BaseScreenerService';
import { ScreenerInput, ScreenerResult, IScreenerService } from './types';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface RestScreenerOperation {
  path: string | ((input: ScreenerInput) => string);
  method: HttpMethod;
  makeParams?: (input: ScreenerInput) => Record<string, any>;
  makeBody?: (input: ScreenerInput, creds?: any) => any;
  transformResult?: (data: any, input: ScreenerInput) => any;
}

export interface RestScreenerConfig {
  baseUrl: string | ((creds: any, input?: ScreenerInput) => string);
  makeAuthHeaders: (creds: any) => Record<string, string>;
  ops: Record<string, RestScreenerOperation>;
}

export class RestScreenerService
  extends BaseScreenerService
  implements IScreenerService
{
  constructor(
    public readonly screenerKey: string,
    private readonly config: RestScreenerConfig
  ) {
    super();
  }

  protected handlers: Record<string, (input: ScreenerInput) => Promise<any>> = 
    new Proxy({}, {
      get: (target, prop: string) => {
        return async (input: ScreenerInput) => {
          const op = this.config.ops[prop];
          if (!op) {
            throw new Error(`Operation ${prop} not configured`);
          }

          // Get credentials if credential_id provided
          let creds = null;
          if (input.credential_id) {
            const { credentials: { client_json } } = 
              await this.getCredentials(input.user_id, input.credential_id);
            creds = client_json;
          }

          // Build request
          const baseUrl = typeof this.config.baseUrl === 'function'
            ? this.config.baseUrl(creds, input)
            : this.config.baseUrl;
          const path = typeof op.path === 'function' ? op.path(input) : op.path;
          const url = `${baseUrl}${path}`;
          const headers = creds ? this.config.makeAuthHeaders(creds) : {};
          const params = op.makeParams?.(input) ?? {};
          const body = op.makeBody ? await op.makeBody(input, creds) : undefined;

          const axiosConfig: AxiosRequestConfig = {
            method: op.method,
            url,
            headers,
            params,
            timeout: 30_000,
          };

          if (['post', 'put', 'patch', 'delete'].includes(op.method)) {
            axiosConfig.data = body;
          }

          console.log(`📊 [RestScreenerService] Executing ${this.screenerKey}.${prop}:`, {
            url,
            method: op.method,
            params
          });

          const res = await axios.request(axiosConfig);
          const rawData = res.data;
          return op.transformResult 
            ? op.transformResult(rawData, input) 
            : rawData;
        };
      }
    });
}
