import logger from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableErrors: [
    'PGRST', // PostgREST errors
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNRESET',
    '503', // Service unavailable
    '502', // Bad gateway
    '429', // Rate limit
  ],
};

/**
 * Check if an error is retryable based on error message/code
 */
function isRetryableError(error: any, retryableErrors: string[]): boolean {
  if (!error) return false;
  
  const errorString = error.toString().toLowerCase();
  const errorMessage = error.message?.toLowerCase() || '';
  const errorCode = error.code?.toLowerCase() || '';
  
  return retryableErrors.some(pattern => 
    errorString.includes(pattern.toLowerCase()) ||
    errorMessage.includes(pattern.toLowerCase()) ||
    errorCode.includes(pattern.toLowerCase())
  );
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateDelay(
  attemptNumber: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attemptNumber - 1);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Add jitter (randomize ±25% to prevent thundering herd)
  const jitter = cappedDelay * 0.25 * (Math.random() - 0.5);
  
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * 
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @param context - Context for logging (e.g., "Supabase insert", "Redis publish")
 * @returns Result of successful function execution
 * @throws Error if all retry attempts fail
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  context: string = 'Operation'
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  
  let lastError: any;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await fn();
      
      if (attempt > 1) {
        logger.info(
          { attempt, context },
          `${context} succeeded after ${attempt} attempts`
        );
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error, config.retryableErrors)) {
        logger.warn(
          { err: error, attempt, context },
          `${context} failed with non-retryable error`
        );
        throw error;
      }
      
      // If this was the last attempt, throw
      if (attempt === config.maxAttempts) {
        logger.error(
          { err: error, attempts: attempt, context },
          `${context} failed after ${config.maxAttempts} attempts`
        );
        throw error;
      }
      
      // Calculate delay and wait before next retry
      const delayMs = calculateDelay(
        attempt,
        config.initialDelayMs,
        config.maxDelayMs,
        config.backoffMultiplier
      );
      
      logger.warn(
        { 
          err: error,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          context
        },
        `${context} failed, retrying in ${delayMs}ms`
      );
      
      await sleep(delayMs);
    }
  }
  
  // This should never be reached due to throw in loop, but TypeScript doesn't know that
  throw lastError;
}

/**
 * Retry a Supabase operation with sensible defaults
 */
export async function retrySupabaseOperation<T>(
  fn: () => Promise<T>,
  operationName: string = 'Supabase operation'
): Promise<T> {
  return retryWithBackoff(
    fn,
    {
      maxAttempts: 3,
      initialDelayMs: 200,
      maxDelayMs: 2000,
      backoffMultiplier: 2,
      retryableErrors: ['PGRST', '503', '502', '429', 'ECONNREFUSED', 'ETIMEDOUT'],
    },
    operationName
  );
}
