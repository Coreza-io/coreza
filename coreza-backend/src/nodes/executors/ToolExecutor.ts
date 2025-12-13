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

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";

export class ToolExecutor implements INodeExecutor {
  readonly category = "Tool";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      // Check both node.type and node.name since JSON definitions use 'name'
      const nodename = node.name;
      const normalizedName =
        nodename && nodename.endsWith("Tool")
          ? nodename.replace(/Tool$/, "")
          : nodename;

      console.log(`🔧 [Tool] Executing ${nodename} with input:`, input);

      let result;
      switch (nodename) {
        case "GoogleWebSearch":
          result = await this.executeGoogleWebSearch(node, input, context);
          break;
        default:
          result = await this.delegateToolExecution(
            node,
            normalizedName,
            input,
            context
          );
          break;
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${nodename} tool execution failed`,
        };
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Tool execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async executeGoogleWebSearch(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const CredentialManager = (await import("../../utils/credentialManager"))
        .default;
      const axios = (await import("axios")).default;

      // Merge node values with input (input from AI Agent has priority)
      const params = { ...node.values, ...input, ...context };
      const { user_id, credential_id, query, numResults = 10 } = params;

      if (!user_id) {
        return { success: false, error: "user_id is required" };
      }

      if (!credential_id) {
        return { success: false, error: "credential_id is required" };
      }

      if (!query) {
        return { success: false, error: "query is required" };
      }

      console.log(
        `🔍 [GoogleWebSearch] Searching for: "${query}" with ${numResults} results`
      );

      // Get credentials
      const { credentials } = await CredentialManager.getCredentials(
        user_id,
        "googlewebsearch",
        credential_id
      );

      if (!credentials) {
        return {
          success: false,
          error: "Google Web Search credentials not found",
        };
      }

      const { api_key, search_engine_id } = credentials.client_json || {};
      if (!api_key || !search_engine_id) {
        return {
          success: false,
          error: "Google Web Search credential is missing api_key or search_engine_id",
        };
      }

      // Execute search
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
        api_key
      )}&cx=${encodeURIComponent(search_engine_id)}&q=${encodeURIComponent(
        query
      )}&num=${numResults}`;

      const response = await axios.get(searchUrl);

      if (!response.data || !response.data.items) {
        return {
          success: true,
          data: {
            query,
            results: [],
            searchInformation: response.data.searchInformation || {},
          },
        };
      }

      // Format results
      const results = response.data.items.map((item: any) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink,
      }));

      console.log(`✅ [GoogleWebSearch] Found ${results.length} results`);

      return {
        success: true,
        data: {
          query,
          results,
          searchInformation: response.data.searchInformation,
        },
      };
    } catch (error: any) {
      console.error(
        "❌ [GoogleWebSearch] Error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error:
          error.response?.data?.error?.message ||
          error.message ||
          "Google Search execution failed",
      };
    }
  }

  private async delegateToolExecution(
    node: WorkflowNode,
    normalizedName: string | undefined,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const executorCategoryMap: Record<string, string> = {
      YahooFinance: "DataSource",
      FinnHub: "DataSource",
      Polygon: "DataSource",
      Market: "Market",
      Alpaca: "Market",
      Binance: "Market",
      Schwab: "Market",
      Dhan: "Market",

      RSI: "Indicators",
      EMA: "Indicators",
      SMA: "Indicators",
      MACD: "Indicators",
      BB: "Indicators",
      ADX: "Indicators",
      Stoch: "Indicators",
      Ichimoku: "Indicators",
      OBV: "Indicators",
      VWAP: "Indicators",
      VolumeOscillator: "Indicators",
      SupportResistance: "Indicators",

      AlpacaTrade: "Broker",
      BinanceTrade: "Broker",
      DhanTrade: "Broker",
      SchwabTrade: "Broker",

      AlpacaScreener: "Screener",
      BinanceScreener: "Screener",
      YahooFinanceScreener: "Screener",
      SchwabScreener: "Screener",

      HttpRequest: "Utility",
      Math: "ControlFlow",
      Transform: "ControlFlow",
      Date: "ControlFlow",
      Field: "ControlFlow",
    };

    const category = executorCategoryMap[normalizedName || ""] || node.category;
    const { getNodeExecutor } = await import("../registry");
    const executor = category ? getNodeExecutor(category) : undefined;

    if (!executor) {
      return {
        success: false,
        error: `Unsupported tool node type: ${node.name}`,
      };
    }

    const delegatedNode: WorkflowNode = {
      ...node,
      name: normalizedName || node.name,
      category,
    };

    return executor.execute(delegatedNode, input, context);
  }
}
