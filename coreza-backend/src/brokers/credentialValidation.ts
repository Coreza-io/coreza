export class CredentialValidationError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string,
    readonly fieldErrors: Record<string, string> = {}) { super(message); }
}
