import axios, { AxiosRequestConfig } from "axios";
import { BaseBrokerService } from "./BaseBrokerService";
import { BrokerInput, BrokerResult, IBrokerService } from "./types";

export type HttpMethod = "get" | "post" | "put" | "delete";

export interface PaginationConfig {
  /** Query param name for the page token (default: 'page_token') */
  pageParam?: string;
  
  /** JSON path to next token in response (default: 'next_page_token') */
  nextTokenPath?: string;
  
  /** Function to merge accumulated data with new page (default: replace) */
  mergePages?: (accumulated: any, newPage: any, input: BrokerInput) => any;
  
  /** Max pages to prevent infinite loops (default: 50) */
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
      // Fetch credentials
      const {
        credentials: { client_json, token_json },
      } = await this.getCredentials(input.user_id, input.credential_id);

      // Execute request (always uses pagination-aware logic)
      return await this.executeRequest(op, input, client_json);
    } catch (err: any) {
      // Enhanced error handling
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
   * Get default pagination config for operations without explicit config
   */
  private getDefaultPaginationConfig(): PaginationConfig {
    return {
      pageParam: "page_token",
      nextTokenPath: "next_page_token",
      maxPages: 50,
      mergePages: (accumulated: any, newPage: any) => newPage // Simple: last page wins
    };
  }

  /**
   * Construct full request URL from operation config
   */
  private buildRequestUrl(
    op: RestOperation,
    input: BrokerInput,
    creds: any
  ): string {
    const baseUrl =
      typeof this.config.baseUrl === "function"
        ? this.config.baseUrl(creds, input)
        : this.config.baseUrl;
    const path = typeof op.path === "function" ? op.path(input) : op.path;
    return `${baseUrl}${path}`;
  }

  /**
   * Build axios request configuration
   */
  private buildAxiosConfig(
    op: RestOperation,
    input: BrokerInput,
    creds: any,
    url: string,
    params: Record<string, string>,
    body?: any
  ): AxiosRequestConfig {
    const headers = this.config.makeAuthHeaders(creds);
    
    const config: AxiosRequestConfig = {
      method: op.method,
      url,
      headers,
      params,
      timeout: 30_000,
    };

    if (["post", "put", "patch", "delete"].includes(op.method.toLowerCase())) {
      config.data = body;
    }

    return config;
  }

  /**
   * Fetch a single page of data
   */
  private async fetchPage(config: AxiosRequestConfig): Promise<any> {
    const res = await axios.request(config);
    return res.data;
  }

  /**
   * Determine if pagination should continue
   */
  private shouldContinuePagination(
    nextToken: string | null,
    pageCount: number,
    maxPages: number
  ): boolean {
    if (!nextToken) {
      return false;
    }
    
    if (pageCount >= maxPages) {
      console.warn(
        `[RestBrokerService] Max pages (${maxPages}) reached, stopping pagination`
      );
      return false;
    }
    
    return true;
  }

  /**
   * Execute request with automatic pagination support
   */
  private async executeRequest(
    op: RestOperation,
    input: BrokerInput,
    creds: any
  ): Promise<BrokerResult> {
    // Get pagination config (use defaults if not provided)
    const paginationConfig = op.pagination || this.getDefaultPaginationConfig();
    const pagination = {
      pageParam: paginationConfig.pageParam || "page_token",
      nextTokenPath: paginationConfig.nextTokenPath || "next_page_token",
      maxPages: paginationConfig.maxPages || 50,
      mergePages: paginationConfig.mergePages || ((acc: any, page: any) => page)
    };
    
    // Build request components
    const url = this.buildRequestUrl(op, input, creds);
    const baseParams = op.makeParams?.(input) ?? {};
    const body = op.makeBody ? await op.makeBody(input, creds) : undefined;

    let accumulatedData: any = null;
    let nextPageToken: string | null = null;
    let pageCount = 0;

    console.log(
      `[RestBrokerService] Starting request for ${this.brokerKey}.${input.operation}`
    );

    // Pagination loop
    do {
      pageCount++;

      // Build params with page token
      const params = { ...baseParams };
      if (nextPageToken) {
        params[pagination.pageParam] = nextPageToken;
      }

      // Build axios config
      const axiosConfig = this.buildAxiosConfig(op, input, creds, url, params, body);

      console.log(
        `[RestBrokerService] Fetching page ${pageCount}${
          nextPageToken ? ` with token: ${nextPageToken.substring(0, 20)}...` : ""
        }`
      );

      // Fetch page
      const pageData = await this.fetchPage(axiosConfig);

      // Extract next page token
      nextPageToken = this.getNestedValue(pageData, pagination.nextTokenPath);

      // Merge data
      if (accumulatedData === null) {
        accumulatedData = pageData;
      } else {
        accumulatedData = pagination.mergePages(accumulatedData, pageData, input);
      }

      console.log(
        `[RestBrokerService] Page ${pageCount} fetched. Next token: ${
          nextPageToken ? "exists" : "none"
        }`
      );
    } while (this.shouldContinuePagination(nextPageToken, pageCount, pagination.maxPages));

    console.log(`[RestBrokerService] Request complete. Total pages: ${pageCount}`);

    // Apply final transformation
    const data = op.transformResult
      ? op.transformResult(accumulatedData, input)
      : accumulatedData;

    return { success: true, data };
  }
}
