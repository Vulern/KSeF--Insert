/**
 * Invoice File Naming
 * Generowanie nazw plików wg schematu: YYYY-MM-DD_NIP_KSEF_REF.xml
 */

import { logger } from '../logger.js';
import { KsefValidationError } from '../errors.js';
import type { InvoiceHeader } from './types.js';

/**
 * Extract NIP from invoice header
 * Priority: sellerNip > buyerNip > nip
 */
export const extractNip = (header: InvoiceHeader): string => {
  const nip = header.sellerNip || header.buyerNip || header.nip || '';

  if (!nip) {
    throw new KsefValidationError('No NIP found in invoice header', {
      sellerNip: !!header.sellerNip,
      buyerNip: !!header.buyerNip,
      nip: !!header.nip,
    });
  }

  // Remove non-digits for consistency
  return nip.replace(/\D/g, '');
};

/**
 * Extract invoice date in YYYY-MM-DD format
 */
export const extractInvoiceDate = (header: InvoiceHeader): string => {
  const date = header.invoicingDate || header.issueDate;

  if (!date) {
    throw new KsefValidationError('No invoice date found in header', {
      invoicingDate: !!header.invoicingDate,
      issueDate: !!header.issueDate,
    });
  }

  // Parse ISO date and return YYYY-MM-DD format
  const dateObj = new Date(date);

  if (isNaN(dateObj.getTime())) {
    throw new KsefValidationError(`Invalid date format: ${date}`);
  }

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

/**
 * Generate file name from invoice header
 * Format: YYYY-MM-DD_NIP_KSEF_REF.xml
 * Example: 2024-01-15_5213000001_1234567890-20240115-ABC123.xml
 */
export const generateFileName = (header: InvoiceHeader): string => {
  logger.debug('Generating file name for invoice', {
    ksefRef: header.ksefReferenceNumber,
  });

  if (!header.ksefReferenceNumber) {
    throw new KsefValidationError('ksefReferenceNumber is required');
  }

  const invoiceDate = extractInvoiceDate(header);
  const nip = extractNip(header);
  const ksefRef = header.ksefReferenceNumber.replace(/\s+/g, '_');

  const fileName = `${invoiceDate}_${nip}_${ksefRef}.xml`;

  logger.debug(`Generated file name: ${fileName}`);
  return fileName;
};

/**
 * Generate folder path from invoice date and type
 * Format: YYYY-MM/zakup|sprzedaz
 */
export const generateFolderPath = (header: InvoiceHeader): string => {
  const invoiceDate = extractInvoiceDate(header);
  const [year, month] = invoiceDate.split('-');
  const yearMonth = `${year}-${month}`;

  // Determine subject type (zakup = purchase, sprzedaz = sales)
  const subjectType = header.subjectType || 'zakup';
  const folderType = subjectType.toLowerCase().includes('sprzedaz') ? 'sprzedaz' : 'zakup';

  return `${yearMonth}/${folderType}`;
};

/**
 * Validate file name format
 */
export const isValidFileName = (fileName: string): boolean => {
  // Pattern: YYYY-MM-DD_NIP_KSEF_REF.xml
  const pattern = /^\d{4}-\d{2}-\d{2}_\d+_[^/\\]+\.xml$/;
  return pattern.test(fileName);
};
