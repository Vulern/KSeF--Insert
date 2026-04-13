/**
 * CSV Writer for Insert
 * Generowanie plików CSV dla Insert
 */

import { stringify } from 'csv-stringify/sync';
import iconv from 'iconv-lite';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { InsertRow } from './types.js';

export const generateCsv = (rows: InsertRow[]): string => {
  logger.debug(`Generating CSV for ${rows.length} rows`);
  
  // TODO: Implement CSV generation
  const csv = stringify(rows, {
    delimiter: config.insert.csvDelimiter,
    header: true,
  });

  return csv;
};

export const encodeCsvForInsert = (csv: string): Buffer => {
  logger.debug(`Encoding CSV to ${config.insert.csvEncoding}`);
  
  if (config.insert.csvEncoding === 'win1250') {
    return iconv.encode(csv, 'win1250');
  }
  
  return Buffer.from(csv, 'utf8');
};

export const writeCsvFile = async (_rows: InsertRow[], _filePath: string): Promise<void> => {
  logger.info(`Writing CSV file: ${_filePath}`);
  // TODO: Implement file writing
};
