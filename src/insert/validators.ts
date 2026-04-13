/**
 * Insert CSV Validators
 * Walidacja danych przed eksportem do Insert
 */

import { z } from 'zod';
import { logger } from '../logger.js';

export const insertRowSchema = z.object({
  // TODO: Define Insert row validation schema
});

export const validateInsertData = (data: unknown): boolean => {
  logger.debug('Validating Insert data');
  try {
    insertRowSchema.parse(data);
    return true;
  } catch (error) {
    logger.error('Insert data validation failed', error);
    return false;
  }
};
