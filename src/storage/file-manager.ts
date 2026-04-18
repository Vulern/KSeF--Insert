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
import { logger } from '../logger.js';
import { KsefValidationError } from '../errors.js';
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

    logger.info(`InvoiceFileManager initialized with output dir: ${this.config.outputDir}`);
  }

  /**
   * Initialize file manager and load index
   */
  async initialize(): Promise<void> {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(this.config.outputDir, { recursive: true });

      // Load existing index
      await this.indexTracker.load();
      this.indexLoaded = true;

      const stats = this.indexTracker.getStats();
      logger.info(`Loaded ${stats.total} invoices from index, last sync: ${stats.lastSync}`);
    } catch (error) {
      logger.error('Failed to initialize file manager', error);
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

    logger.info(`Saving invoice: ${header.ksefReferenceNumber}`);

    // Check if already downloaded
    if (this.indexTracker.isAlreadyDownloaded(header.ksefReferenceNumber)) {
      logger.warn(`Invoice ${header.ksefReferenceNumber} already exists, skipping`);

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
      logger.debug(`Created directory: ${fullFolderPath}`);

      // Check if file exists (double-check in case of concurrent writes)
      try {
        await fs.access(filePath);
        logger.warn(`File ${filePath} already exists, skipping`);

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
      logger.debug(`Wrote temp file: ${tempPath}`);

      // Atomic rename
      await fs.rename(tempPath, filePath);
      logger.info(`Saved invoice to: ${filePath}`);

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
      logger.error(`Failed to save invoice ${header.ksefReferenceNumber}`, error);

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

    logger.info(`Processing batch of ${invoices.length} invoices`);

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
        logger.warn(`Error saving invoice in batch: ${errorMsg}`);
      }
    }

    logger.info(`Batch processing complete: ${result.saved} saved, ${result.skipped} skipped, ${result.errors.length} errors`);

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

    logger.info(`Listed ${result.length} saved invoices`);
    return result;
  }

  /**
   * Delete invoice from disk and index
   */
  async delete(ksefReferenceNumber: string): Promise<boolean> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    logger.info(`Deleting invoice: ${ksefReferenceNumber}`);

    const entries = this.indexTracker.getAllEntries();
    const entry = entries[ksefReferenceNumber];

    if (!entry) {
      logger.warn(`Invoice ${ksefReferenceNumber} not found in index`);
      return false;
    }

    try {
      const filePath = path.join(this.config.outputDir, entry.filePath);

      // Delete file
      try {
        await fs.rm(filePath);
        logger.info(`Deleted file: ${filePath}`);
      } catch (error) {
        if ((error as any)?.code !== 'ENOENT') {
          throw error;
        }
        logger.warn(`File not found on disk: ${filePath}`);
      }

      // Remove from index
      this.indexTracker.removeEntry(ksefReferenceNumber);
      await this.indexTracker.save();

      logger.info(`Deleted invoice from index: ${ksefReferenceNumber}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete invoice ${ksefReferenceNumber}`, error);
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
