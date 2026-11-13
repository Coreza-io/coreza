import type { ZodTypeAny } from 'zod';
import type { ProcessedToolOutput } from './toolOutputProcessor';

export interface ToolInputIssue {
  field: string;
  code: string;
  message: string;
  source: 'model' | 'configuration' | 'default';
  editable: boolean;
}

export class ToolInputError extends Error {
  constructor(readonly issues: ToolInputIssue[]) {
    const summary = issues.slice(0, 3).map(issue => issue.message.slice(0, 240)).join('; ');
    super(summary ? `Tool input validation failed: ${summary}` : 'Tool input validation failed');
  }
}

/** Provider rules live with their provider, never in the generic agent adapter. */
export interface ToolInputContract {
  id: string;
  risk: 'read-only' | 'state-mutation' | 'external-side-effect' | 'unsupported-synchronous';
  instructions?: string;
  supports(operation: unknown): boolean;
  schema(shape: Record<string, ZodTypeAny>, configured: Record<string, any>): Record<string, ZodTypeAny>;
  argumentIssues?(raw: any): ToolInputIssue[];
  validate(input: Record<string, any>, configured?: Record<string, any>, raw?: any): Record<string, any>;
  output(output: any, input: any): { input: any; summary: Record<string, any>; result?: ProcessedToolOutput };
}

export function inputFailure(error: ToolInputError) {
  const issues = error.issues.slice(0, 12).map(issue => ({ ...issue, field: /^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(issue.field) ? issue.field : 'parameter' }));
  return { success: false, type: 'tool_error',
    status: issues.some(issue => !issue.editable) ? 'configuration_error' : 'invalid_input',
    issues, retryable_by_agent: issues.length > 0 && issues.every(issue => issue.editable), provider_request_sent: false };
}
