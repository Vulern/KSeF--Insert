/**
 * Transformer mapper
 * Mapowanie danych z KSeF do formatu Insert
 */

import { logger } from '../logger.js';
import type { KsefInvoice } from '../ksef/types.js';
import type { InsertRow } from '../insert/types.js';

export const mapKsefToInsert = (_invoice: KsefInvoice): InsertRow => {
  logger.debug('Mapping KSeF invoice to Insert format');
  
  // TODO: Implement mapping from KSeF to Insert format
  return {};
};

export const transformBatch = (invoices: KsefInvoice[]): InsertRow[] => {
  logger.info(`Transforming batch of ${invoices.length} invoices`);
  return invoices.map(mapKsefToInsert);
};
