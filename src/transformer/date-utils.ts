/**
 * Date utilities
 * Konwersja dat z ISO do formatu DD.MM.YYYY dla Insert
 */

import { TransformError } from '../errors.js';
import { logger } from '../logger.js';

export const isoToPlDate = (isoDate: string): string => {
  logger.debug(`Converting ISO date: ${isoDate}`);
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      throw new TransformError(`Invalid ISO date: ${isoDate}`);
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
  } catch (error) {
    logger.error('Date conversion failed', error);
    throw error;
  }
};

export const plDateToIso = (plDate: string): string => {
  logger.debug(`Converting PL date: ${plDate}`);
  try {
    const [day, month, year] = plDate.split('.');
    const date = new Date(`${year}-${month}-${day}`);
    
    if (isNaN(date.getTime())) {
      throw new TransformError(`Invalid PL date: ${plDate}`);
    }

    return date.toISOString().split('T')[0];
  } catch (error) {
    logger.error('Date conversion failed', error);
    throw error;
  }
};
