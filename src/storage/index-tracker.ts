/**
 * Invoice Index Tracker
 * Śledzi które faktury zostały już pobrane (duplikat detection)
 * Przechowuje .index.json w katalogu output
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger.js';
import { KsefValidationError } from '../errors.js';
import type { InvoiceIndex, IndexEntry } from './types.js';

/**
 * Tracks downloaded invoices to prevent duplicates
 */
export class IndexTracker {
  private indexPath: string;
  private index: InvoiceIndex;
  private loaded = false;

  constructor(indexPath: string) {
    this.indexPath = indexPath;
    this.index = {
      lastSync: new Date().toISOString(),
      invoices: {},
    };
  }

  /**
   * Load index from disk
   */
  async load(): Promise<InvoiceIndex> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(content);
      this.loaded = true;
      logger.info(`Loaded invoice index: ${Object.keys(this.index.invoices).length} entries`);
      return this.index;
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        // Index doesn't exist yet - create empty one
        logger.info('Index file does not exist, creating new index');
        this.loaded = true;
        return this.index;
      }

      logger.error('Failed to load index', error);
      throw new KsefValidationError(
        `Failed to load invoice index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Save index to disk with pretty print
   */
  async save(): Promise<void> {
    if (!this.loaded) {
      throw new KsefValidationError('Index not loaded. Call load() first.');
    }

    try {
      const dir = path.dirname(this.indexPath);

      // Create directory if it doesn't exist
      await fs.mkdir(dir, { recursive: true });

      // Write to temp file first for atomic operation
      const tempPath = `${this.indexPath}.tmp`;
      const content = JSON.stringify(this.index, null, 2);

      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, this.indexPath);

      logger.info(`Saved invoice index: ${Object.keys(this.index.invoices).length} entries`);
    } catch (error) {
      logger.error('Failed to save index', error);
      throw new KsefValidationError(
        `Failed to save invoice index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if invoice already downloaded
   */
  isAlreadyDownloaded(ksefReferenceNumber: string): boolean {
    return ksefReferenceNumber in this.index.invoices;
  }

  /**
   * Add entry to index
   */
  addEntry(ksefReferenceNumber: string, entry: IndexEntry): void {
    if (!this.loaded) {
      throw new KsefValidationError('Index not loaded. Call load() first.');
    }

    if (this.isAlreadyDownloaded(ksefReferenceNumber)) {
      logger.warn(`Invoice ${ksefReferenceNumber} already in index`);
      return;
    }

    this.index.invoices[ksefReferenceNumber] = entry;
    this.index.lastSync = new Date().toISOString();

    logger.debug(`Added entry to index: ${ksefReferenceNumber}`);
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; lastSync: string } {
    return {
      total: Object.keys(this.index.invoices).length,
      lastSync: this.index.lastSync,
    };
  }

  /**
   * Get all entries
   */
  getAllEntries(): Record<string, IndexEntry> {
    return { ...this.index.invoices };
  }

  /**
   * Filter entries by date range
   */
  getEntriesByDateRange(dateFrom?: string, dateTo?: string): IndexEntry[] {
    const entries = Object.values(this.index.invoices);

    if (!dateFrom && !dateTo) {
      return entries;
    }

    return entries.filter((entry) => {
      const invoiceDate = entry.invoiceDate;

      if (dateFrom && invoiceDate < dateFrom) {
        return false;
      }

      if (dateTo && invoiceDate > dateTo) {
        return false;
      }

      return true;
    });
  }

  /**
   * Remove entry from index
   */
  removeEntry(ksefReferenceNumber: string): boolean {
    if (!this.loaded) {
      throw new KsefValidationError('Index not loaded. Call load() first.');
    }

    if (ksefReferenceNumber in this.index.invoices) {
      delete this.index.invoices[ksefReferenceNumber];
      this.index.lastSync = new Date().toISOString();
      logger.debug(`Removed entry from index: ${ksefReferenceNumber}`);
      return true;
    }

    return false;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    if (!this.loaded) {
      throw new KsefValidationError('Index not loaded. Call load() first.');
    }

    this.index.invoices = {};
    this.index.lastSync = new Date().toISOString();
    logger.info('Cleared invoice index');
  }

  /**
   * Get raw index object
   */
  getIndex(): InvoiceIndex {
    return { ...this.index };
  }
}
