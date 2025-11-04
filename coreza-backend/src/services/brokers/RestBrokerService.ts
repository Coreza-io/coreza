import axios, { AxiosRequestConfig } from "axios";
import { BaseBrokerService } from "./BaseBrokerService";
import { BrokerInput, BrokerResult, IBrokerService } from "./types";

export type HttpMethod = "get" | "post" | "put" | "delete";

export interface PaginationConfig {
  /** Query param name for the page token (e.g., 'page_token') */
  pageParam: string;
  
  /** JSON path to next token in response (e.g., 'next_page_token') */
  nextTokenPath: string;
  
  /** Function to merge accumulated data with new page */
  mergePages: (accumulated: any, newPage: any, input: BrokerInput) => any;
  
  /** Optional: Max pages to prevent infinite loops (default: 50) */
  maxPages?: number;
}

export interface RestOperation {
  path: string | ((input: BrokerInput) => string);
  method: HttpMethod;
  makeParams?: (input: BrokerInput) => Record<string, string>;
  makeBody?: (input: BrokerInput, creds?: any) => any;
  /** Optional per-op transform of raw response.data → final data */
  transformResult?: (data: any, input: BrokerInput) => any;
  /** Optional: Enable pagination for this operation */
  pagination?: PaginationConfig;
}

export interface RestConfig {
  baseUrl: string | ((creds: any, input: BrokerInput) => string);

  makeAuthHeaders: (creds: any) => Record<string, string>;
  ops: Record<string, RestOperation>;
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
    if (typeof input.symbol === "string") {
      try {
        const parsed = JSON.parse(input.symbol);
        if (Array.isArray(parsed)) {
          input.symbol = parsed.join(",");
        }
      } catch {
        // not a valid JSON array, leave as-is
      }
    }
    const op = this.config.ops[input.operation];
    if (!op) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for broker: ${this.brokerKey}`,
      };
    }

    try {
      // 1. fetch credentials
      const {
        credentials: { client_json, token_json },
      } = await this.getCredentials(input.user_id, input.credential_id);

      // 2. Check if pagination is enabled for this operation
      if (op.pagination) {
        return await this.executePaginated(op, input, client_json);
      } else {
        return await this.executeSingle(op, input, client_json);
      }
    } catch (err: any) {
      // --- Enhanced error handling ---
      // Axios error shape
      const status = err.response?.status;
      let message =
        err.response?.data?.errorMessage ||
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Unknown error";

      if (status === 503) {
        message =
          "API service is temporarily unavailable (HTTP 503). Please try again later.";
      } else if (status === 400) {
        // Dhan returns errorType, errorCode, errorMessage
        if (err.response?.data?.errorMessage || err.response?.data?.errorCode) {
          message = `API Error [${err.response.data.errorCode || "400"}]: ${
            err.response.data.errorMessage || message
          }`;
        }
      } else if (!message && err.response?.statusText) {
        message = err.response.statusText;
      }

      return { success: false, error: message };
    }
  }

  /**
   * Extract value from nested object using dot notation path
   * Example: getNestedValue({a: {b: {c: 'token'}}}, 'a.b.c') → 'token'
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Execute single request (non-paginated)
   */
  private async executeSingle(
    op: RestOperation,
    input: BrokerInput,
    creds: any
  ): Promise<BrokerResult> {
    const baseUrl =
      typeof this.config.baseUrl === "function"
        ? this.config.baseUrl(creds, input)
        : this.config.baseUrl;
    const path = typeof op.path === "function" ? op.path(input) : op.path;
    const url = `${baseUrl}${path}`;
    const headers = this.config.makeAuthHeaders(creds);
    const params = op.makeParams?.(input) ?? {};
    const body = op.makeBody ? await op.makeBody(input, creds) : undefined;

    const axiosConfig: AxiosRequestConfig = {
      method: op.method,
      url,
      headers,
      params,
      timeout: 30_000,
    };

    if (["post", "put", "patch", "delete"].includes(op.method.toLowerCase())) {
      axiosConfig.data = body;
    }

    const res = await axios.request(axiosConfig);
    const rawData = res.data;
    const data = op.transformResult
      ? op.transformResult(rawData, input)
      : rawData;

    return { success: true, data };
  }

  /**
   * Execute paginated request (fetch all pages automatically)
   */
  private async executePaginated(
    op: RestOperation,
    input: BrokerInput,
    creds: any
  ): Promise<BrokerResult> {
    const pagination = op.pagination!;
    const maxPages = pagination.maxPages || 50;
    
    const baseUrl =
      typeof this.config.baseUrl === "function"
        ? this.config.baseUrl(creds, input)
        : this.config.baseUrl;
    const path = typeof op.path === "function" ? op.path(input) : op.path;
    const url = `${baseUrl}${path}`;
    const headers = this.config.makeAuthHeaders(creds);
    const baseParams = op.makeParams?.(input) ?? {};
    const body = op.makeBody ? await op.makeBody(input, creds) : undefined;

    let accumulatedData: any = null;
    let nextPageToken: string | null = null;
    let pageCount = 0;

    console.log(`[RestBrokerService] Starting paginated request for ${this.brokerKey}.${input.operation}`);

    do {
      pageCount++;
      
      if (pageCount > maxPages) {
        console.warn(`[RestBrokerService] Max pages (${maxPages}) reached, stopping pagination`);
        break;
      }

      // Build params with page token if present
      const params = { ...baseParams };
      if (nextPageToken) {
        params[pagination.pageParam] = nextPageToken;
      }

      const axiosConfig: AxiosRequestConfig = {
        method: op.method,
        url,
        headers,
        params,
        timeout: 30_000,
      };

      if (["post", "put", "patch", "delete"].includes(op.method.toLowerCase())) {
        axiosConfig.data = body;
      }

      console.log(`[RestBrokerService] Fetching page ${pageCount}${nextPageToken ? ` with token: ${nextPageToken.substring(0, 20)}...` : ''}`);

      // Fetch page
      const res = await axios.request(axiosConfig);
      const pageData = res.data;

      // Extract next page token
      nextPageToken = this.getNestedValue(pageData, pagination.nextTokenPath);

      // Merge this page into accumulated data
      if (accumulatedData === null) {
        // First page - initialize
        accumulatedData = pageData;
      } else {
        // Subsequent pages - merge
        accumulatedData = pagination.mergePages(accumulatedData, pageData, input);
      }

      console.log(`[RestBrokerService] Page ${pageCount} fetched. Next token: ${nextPageToken ? 'exists' : 'none'}`);

    } while (nextPageToken);

    console.log(`[RestBrokerService] Pagination complete. Total pages: ${pageCount}`);

    // Apply transformResult to final accumulated data
    const data = op.transformResult
      ? op.transformResult(accumulatedData, input)
      : accumulatedData;

    return { success: true, data };
  }
}
