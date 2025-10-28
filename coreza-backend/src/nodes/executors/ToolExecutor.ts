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

      console.log(`🔧 [Tool] Executing ${nodename} with input:`, input);

      let result;
      switch (nodename) {
        case "GoogleWebSearch":
          result = await this.executeGoogleWebSearch(node, input, context);
          break;
        default:
          return {
            success: false,
            error: `Unsupported tool node type: ${nodename}`,
          };
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
      
      console.log(
        "🔍 [GoogleWebSearch] Debug - Raw inputs:",
        {
          node_values: node.values,
          input_keys: Object.keys(input || {}),
          input_data: input,
          context_keys: Object.keys(context || {}),
          merged_params: params
        }
      );

      const { user_id, credential_id, query, numResults = 10 } = params;

      if (!user_id) {
        return { success: false, error: "user_id is required" };
      }

      if (!credential_id) {
        return { success: false, error: "credential_id is required" };
      }

      if (!query) {
        console.error("❌ [GoogleWebSearch] Missing query parameter. Params:", params);
        return { success: false, error: "query is required" };
      }

      console.log(
        `🔍 [GoogleWebSearch] Searching for: "${query}" with ${numResults} results`
      );

      // Get credentials
      const { credentials } = await CredentialManager.getCredentials(
        user_id,
        "googlesearch",
        credential_id
      );

      const { api_key, search_engine_id } = credentials.client_json;

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
}
