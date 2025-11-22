import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";

export class BrokerExecutor implements INodeExecutor {
  readonly category = "Broker";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const operation = node.values?.operation;
      const brokerNode = node as WorkflowNode & { subCategory?: string };
      const broker = brokerNode.subCategory ?? node.name ?? node.node_type;
      const credential_id = node.values?.credential_id;

      if (!credential_id) {
        return {
          success: false,
          error: `${broker || "Broker"} credential_id is required`,
        };
      }

      // Resolve and merge node parameters with input data
      console.log(
        `🔧 [BROKER] Starting parameter resolution for node ${node.id}`
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      console.log(
        `🔧 [BROKER] Parameter resolution completed for node ${node.id}`
      );

      // Make internal HTTP call to broker route
      const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
      const url = `${backendUrl}/broker/${broker}/${operation}`;

      const response = await axios.post(url, {
        user_id: context?.userId,
        credential_id,
        operation,
        ...resolvedParams,
      });

      if (!response.data.success) {
        return {
          success: false,
          error: response.data.error || `${broker} ${operation} operation failed`,
        };
      }

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Broker execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}