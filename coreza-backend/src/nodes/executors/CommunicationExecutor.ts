import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { CommunicationService } from '../../services/communications';
import axios from 'axios';
import { resolveReferences } from '../../utils/resolveReferences';

export class CommunicationExecutor implements INodeExecutor {
  readonly category = 'Communication';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      const operation = node.values?.operation || 'send';

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };

      const combinedInput = {
        ...input,
        ...resolvedParams
      };

      let result;
      switch (nodeType) {
        case 'Gmail':
          result = await CommunicationService.execute('gmail', operation, combinedInput);
          break;
        case 'WhatsApp':
          result = await CommunicationService.execute('whatsapp', operation, combinedInput);
          break;
        case 'OpenAI':
          return this.executeOpenAI(node, combinedInput, context);
        default:
          return {
            success: false,
            error: `Unsupported communication node type: ${nodeType}`
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${nodeType} ${operation} operation failed`
        };
      }

      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Communication execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async executeOpenAI(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const values = node.data?.values || node.values || {};
      const resolvedValues = resolveReferences(values, input);

      const payload = {
        model: resolvedValues.model || 'gpt-4o-mini',
        prompt: resolvedValues.prompt || 'You are a helpful assistant.',
        userMessage: resolvedValues.userMessage,
        temperature: resolvedValues.temperature || 0.7,
        maxTokens: resolvedValues.maxTokens || 1000,
        apiKey: resolvedValues.apiKey
      };

      const response = await axios.post(`${process.env.API_URL || 'http://localhost:8000'}/openai/chat`, payload);

      if (response.data.success) {
        return {
          success: true,
          data: response.data.data
        };
      } else {
        return {
          success: false,
          error: response.data.error || 'OpenAI execution failed'
        };
      }
    } catch (error: any) {
      console.error('OpenAI execution error:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'OpenAI execution failed'
      };
    }
  }
}