/**
 * Storage Types
 * Interfejsy dla zarządzania plikami XML
 */

export interface InvoiceHeader {
  ksefReferenceNumber: string;
  invoicingDate?: string;
  issueDate?: string;
  subjectType?: 'zakup' | 'sprzedaz' | string;
  nip?: string;
  sellerNip?: string;
  buyerNip?: string;
}

export interface SaveResult {
  filePath: string;
  fileName: string;
  alreadyExisted: boolean;
}

export interface BatchSaveResult {
  saved: number;
  skipped: number;
  errors: string[];
  details: SaveResult[];
}

export interface SavedInvoiceInfo {
  ksefReferenceNumber: string;
  filePath: string;
  fileName: string;
  invoiceDate: string;
  downloadedAt: string;
  subjectType: string;
  nip: string;
}

export interface IndexEntry {
  downloadedAt: string;
  filePath: string;
  invoiceDate: string;
  subjectType: string;
  nip: string;
}

export interface InvoiceIndex {
  lastSync: string;
  invoices: Record<string, IndexEntry>;
}

export interface FileManagerConfig {
  outputDir: string;
}
