/**
 * Invoice File Manager
 * Zarządzanie plikami XML faktur na dysku
 * - Zapis XML as-is (bez modyfikacji)
 * - Atomowy zapis (temp file + rename)
 * - Automatyczne tworzenie folderów
 * - Śledzenie duplikatów
 */

import fs from 'fs/promises';
import path from 'path';
import { storageLogger } from '../logger.js';
import { KsefValidationError } from '../errors.js';
import { maskNip } from '../utils/sanitize.js';
import { IndexTracker } from './index-tracker.js';
import { generateFileName, generateFolderPath, isValidFileName } from './naming.js';
import type {
  FileManagerConfig,
  InvoiceHeader,
  SaveResult,
  BatchSaveResult,
  SavedInvoiceInfo,
  IndexEntry,
} from './types.js';

/**
 * Manages invoice XML file storage with duplicate prevention
 */
export class InvoiceFileManager {
  private config: FileManagerConfig;
  private indexTracker: IndexTracker;
  private indexLoaded = false;

  constructor(config: FileManagerConfig) {
    if (!config.outputDir) {
      throw new KsefValidationError('outputDir is required in FileManagerConfig');
    }

    this.config = {
      outputDir: config.outputDir,
    };

    // Initialize index tracker
    const indexPath = path.join(this.config.outputDir, '.index.json');
    this.indexTracker = new IndexTracker(indexPath);

    storageLogger.info('💾 FileManager initialized', { outputDir: this.config.outputDir });
  }

  /**
   * Initialize file manager and load index
   */
  async initialize(): Promise<void> {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(this.config.outputDir, { recursive: true });
      storageLogger.info('📁 Utworzono/zweryfikowano katalog output', { outputDir: this.config.outputDir });

      // Load existing index
      await this.indexTracker.load();
      this.indexLoaded = true;

      const stats = this.indexTracker.getStats();
      storageLogger.debug('Index loaded', { total: stats.total, lastSync: stats.lastSync });
    } catch (error) {
      storageLogger.error('Failed to initialize file manager', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Save single invoice to disk
   * Returns file path, file name, and whether it already existed
   */
  async saveInvoice(params: { xml: string; header: InvoiceHeader }): Promise<SaveResult> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    const { xml, header } = params;

    // Validate input
    if (!xml || typeof xml !== 'string') {
      throw new KsefValidationError('XML content must be a non-empty string');
    }

    if (!header || typeof header !== 'object') {
      throw new KsefValidationError('Header must be a valid object');
    }

    storageLogger.info('💾 Zapis faktury', {
      ksefReferenceNumber: header.ksefReferenceNumber,
      nip: header.nip ? maskNip(String(header.nip)) : undefined,
    });

    // Check if already downloaded
    if (this.indexTracker.isAlreadyDownloaded(header.ksefReferenceNumber)) {
      storageLogger.info('⏭️ Pominięto duplikat', { ksefReferenceNumber: header.ksefReferenceNumber });

      const folderPath = generateFolderPath(header);
      const fileName = generateFileName(header);
      const filePath = path.join(this.config.outputDir, folderPath, fileName);

      return {
        filePath,
        fileName,
        alreadyExisted: true,
      };
    }

    // Generate file path
    const folderPath = generateFolderPath(header);
    const fileName = generateFileName(header);
    const fullFolderPath = path.join(this.config.outputDir, folderPath);
    const filePath = path.join(fullFolderPath, fileName);

    try {
      // Create directories recursively
      await fs.mkdir(fullFolderPath, { recursive: true });
      storageLogger.info('📁 Utworzono katalog', { path: fullFolderPath });

      // Check if file exists (double-check in case of concurrent writes)
      try {
        await fs.access(filePath);
        storageLogger.info('⏭️ Plik już istnieje, pomijam', { filePath });

        return {
          filePath,
          fileName,
          alreadyExisted: true,
        };
      } catch {
        // File doesn't exist, proceed with write
      }

      // Write to temp file first (atomic operation)
      const tempPath = `${filePath}.tmp`;

      await fs.writeFile(tempPath, xml, 'utf-8');
      storageLogger.debug('Wrote temp file', { tempPath });

      // Atomic rename
      await fs.rename(tempPath, filePath);
      storageLogger.info('💾 Zapisano fakturę', { filePath });

      // Update index
      const invoiceDate = header.invoicingDate || header.issueDate || new Date().toISOString();
      const subjectType = header.subjectType || 'zakup';
      const nip = header.sellerNip || header.buyerNip || header.nip || '';

      const indexEntry: IndexEntry = {
        downloadedAt: new Date().toISOString(),
        filePath: path.relative(this.config.outputDir, filePath),
        invoiceDate,
        subjectType,
        nip,
      };

      this.indexTracker.addEntry(header.ksefReferenceNumber, indexEntry);
      await this.indexTracker.save();

      return {
        filePath,
        fileName,
        alreadyExisted: false,
      };
    } catch (error) {
      storageLogger.error('Błąd zapisu faktury', {
        ksefReferenceNumber: header.ksefReferenceNumber,
        error: error instanceof Error ? error.message : String(error),
      });

      // Clean up temp file if it exists
      try {
        await fs.rm(`${filePath}.tmp`, { force: true });
      } catch {
        // Ignore cleanup errors
      }

      throw new KsefValidationError(
        `Failed to save invoice: ${error instanceof Error ? error.message : String(error)}`,
        {
          filePath,
          ksefRef: header.ksefReferenceNumber,
        }
      );
    }
  }

  /**
   * Save batch of invoices
   */
  async saveBatch(invoices: Array<{ xml: string; header: InvoiceHeader }>): Promise<BatchSaveResult> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    storageLogger.info('💾 Batch start', { total: invoices.length });

    const result: BatchSaveResult = {
      saved: 0,
      skipped: 0,
      errors: [],
      details: [],
    };

    for (const invoice of invoices) {
      try {
        const saveResult = await this.saveInvoice(invoice);
        result.details.push(saveResult);

        if (saveResult.alreadyExisted) {
          result.skipped++;
        } else {
          result.saved++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(errorMsg);
        storageLogger.warn('⚠️ Error saving invoice in batch', { error: errorMsg });
      }
    }

    storageLogger.info('💾 Batch complete', {
      saved: result.saved,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * List saved invoices with optional filtering
   */
  async listSaved(filter?: { dateFrom?: string; dateTo?: string }): Promise<SavedInvoiceInfo[]> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    const entries = this.indexTracker.getEntriesByDateRange(filter?.dateFrom, filter?.dateTo);

    const result: SavedInvoiceInfo[] = [];

    for (const [ksefRef, entry] of Object.entries(this.indexTracker.getAllEntries())) {
      // Apply date filter if provided
      if (filter?.dateFrom && entry.invoiceDate < filter.dateFrom) {
        continue;
      }
      if (filter?.dateTo && entry.invoiceDate > filter.dateTo) {
        continue;
      }

      result.push({
        ksefReferenceNumber: ksefRef,
        filePath: entry.filePath,
        fileName: path.basename(entry.filePath),
        invoiceDate: entry.invoiceDate,
        downloadedAt: entry.downloadedAt,
        subjectType: entry.subjectType,
        nip: entry.nip,
      });
    }

    storageLogger.debug('Listed saved invoices', { total: result.length });
    return result;
  }

  /**
   * Delete invoice from disk and index
   */
  async delete(ksefReferenceNumber: string): Promise<boolean> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    storageLogger.info('🗑️ Delete invoice', { ksefReferenceNumber });

    const entries = this.indexTracker.getAllEntries();
    const entry = entries[ksefReferenceNumber];

    if (!entry) {
      storageLogger.warn('Invoice not found in index', { ksefReferenceNumber });
      return false;
    }

    try {
      const filePath = path.join(this.config.outputDir, entry.filePath);

      // Delete file
      try {
        await fs.rm(filePath);
        storageLogger.info('Deleted file', { filePath });
      } catch (error) {
        if ((error as any)?.code !== 'ENOENT') {
          throw error;
        }
        storageLogger.warn('File not found on disk', { filePath });
      }

      // Remove from index
      this.indexTracker.removeEntry(ksefReferenceNumber);
      await this.indexTracker.save();

      storageLogger.info('Deleted invoice from index', { ksefReferenceNumber });
      return true;
    } catch (error) {
      storageLogger.error('Failed to delete invoice', {
        ksefReferenceNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new KsefValidationError(
        `Failed to delete invoice: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get index statistics
   */
  getStats(): { total: number; lastSync: string } {
    return this.indexTracker.getStats();
  }

  /**
   * Get index object (for testing)
   */
  getIndex() {
    return this.indexTracker.getIndex();
  }
}
