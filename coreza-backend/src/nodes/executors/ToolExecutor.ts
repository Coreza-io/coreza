/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { createSuccessOutput, createErrorOutput, toNodeResult, NormalizeContext } from "../../utils/normalizeOutput";

export class ToolExecutor implements INodeExecutor {
  readonly category = "Tool";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const normalizeCtx: NormalizeContext = {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    };

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
          result = await this.executeGoogleWebSearch(node, input, context, normalizeCtx);
          break;
        default:
          result = await this.delegateToolExecution(
            node,
            normalizedName,
            input,
            context,
            normalizeCtx
          );
          break;
      }

      // Result is already in NodeResult format from internal methods
      return result;
    } catch (error) {
      return toNodeResult(createErrorOutput(error, normalizeCtx));
    }
  }

  private async executeGoogleWebSearch(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
    normalizeCtx: NormalizeContext
  ): Promise<NodeResult> {
    try {
      const CredentialManager = (await import("../../utils/credentialManager"))
        .default;
      const axios = (await import("axios")).default;

      // Merge node values with input (input from AI Agent has priority)
      const params = { ...node.values, ...input, ...context };
      const { user_id, credential_id, query, numResults = 10 } = params;

      if (!user_id) {
        return toNodeResult(createErrorOutput("user_id is required", normalizeCtx));
      }

      if (!credential_id) {
        return toNodeResult(createErrorOutput("credential_id is required", normalizeCtx));
      }

      if (!query) {
        return toNodeResult(createErrorOutput("query is required", normalizeCtx));
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
        return toNodeResult(createErrorOutput(
          "Google Web Search credentials not found",
          normalizeCtx
        ));
      }

      const { api_key, search_engine_id } = credentials.client_json || {};
      if (!api_key || !search_engine_id) {
        return toNodeResult(createErrorOutput(
          "Google Web Search credential is missing api_key or search_engine_id",
          normalizeCtx
        ));
      }

      // Execute search
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
        api_key
      )}&cx=${encodeURIComponent(search_engine_id)}&q=${encodeURIComponent(
        query
      )}&num=${numResults}`;

      const response = await axios.get(searchUrl);

      if (!response.data || !response.data.items) {
        return toNodeResult(createSuccessOutput({
          query,
          results: [],
          searchInformation: response.data.searchInformation || {},
        }, normalizeCtx));
      }

      // Format results
      const results = response.data.items.map((item: any) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink,
      }));

      console.log(`✅ [GoogleWebSearch] Found ${results.length} results`);

      return toNodeResult(createSuccessOutput({
        query,
        results,
        searchInformation: response.data.searchInformation,
      }, normalizeCtx));
    } catch (error: any) {
      console.error(
        "❌ [GoogleWebSearch] Error:",
        error.response?.data || error.message
      );
      return toNodeResult(createErrorOutput(
        error.response?.data?.error?.message ||
        error.message ||
        "Google Search execution failed",
        normalizeCtx
      ));
    }
  }

  private async delegateToolExecution(
    node: WorkflowNode,
    normalizedName: string | undefined,
    input: NodeInput,
    context: any,
    normalizeCtx: NormalizeContext
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
      return toNodeResult(createErrorOutput(
        `Unsupported tool node type: ${node.name}`,
        normalizeCtx
      ));
    }

    const delegatedNode: WorkflowNode = {
      ...node,
      name: normalizedName || node.name,
      category,
    };

    return executor.execute(delegatedNode, input, context);
  }
}
