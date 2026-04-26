import { logger } from '../logger.js';
import { KSeFSyncError } from '../errors.js';

export function handleError(error: unknown): { code: string; message: string } {
  if (error instanceof KSeFSyncError) {
    logger.error(error.message, {
      code: error.code,
      context: error.context,
      suggestion: error.suggestion,
      stack: error.stack,
    });
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    logger.error(error.message, { code: 'UNKNOWN_001', stack: error.stack });
    return { code: 'UNKNOWN_001', message: error.message };
  }

  logger.error('Unknown thrown value', { code: 'UNKNOWN_002', thrown: String(error) });
  return { code: 'UNKNOWN_002', message: 'Unknown error' };
}

