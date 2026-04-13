/**
 * Number utilities
 * Konwersja liczb z kropki do przecinka dla Insert
 */

import { TransformError } from '../errors.js';
import { logger } from '../logger.js';

export const dotToCommaNumber = (value: string | number): string => {
  logger.debug(`Converting number to comma format: ${value}`);
  try {
    const str = String(value);
    return str.replace('.', ',');
  } catch (error) {
    logger.error('Number conversion failed', error);
    throw new TransformError(`Failed to convert number: ${value}`);
  }
};

export const commaToDotNumber = (value: string): number => {
  logger.debug(`Converting comma number to dot format: ${value}`);
  try {
    const num = parseFloat(value.replace(',', '.'));
    if (isNaN(num)) {
      throw new TransformError(`Invalid number format: ${value}`);
    }
    return num;
  } catch (error) {
    logger.error('Number conversion failed', error);
    throw error;
  }
};
