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
import { generateFileName, generateFolderPath, isValidFileName, parseKsefReferenceFromInvoiceFileName } from './naming.js';
import { buildJpkFaXml, ksefInvoiceXmlToJpkFaEntry, type JpkFolderType } from '../transformer/jpk-fa.js';
import {
  buildInsertJpkVat2017Xml,
  buildJpkV7m3WithKsefXml,
  ksefInvoiceXmlToJpkVat3Row,
  type JpkVatFolderType,
  type JpkVat3RowBase,
} from '../transformer/jpk-vat3.js';
import type {
  FileManagerConfig,
  InvoiceHeader,
  SaveResult,
  BatchSaveResult,
  SavedInvoiceInfo,
  IndexEntry,
} from './types.js';

function csvSemicolonField(field: string): string {
  if (/[;\r\n"]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/**
 * Manages invoice XML file storage with duplicate prevention
 */
export class InvoiceFileManager {
  private config: FileManagerConfig;
  private baseDir: string;
  private indexTracker: IndexTracker;
  private indexLoaded = false;

  constructor(config: FileManagerConfig) {
    if (!config.outputDir) {
      throw new KsefValidationError('outputDir is required in FileManagerConfig');
    }

    const companyNip = config.companyNip ? config.companyNip.replace(/\D/g, '') : '';

    this.config = {
      outputDir: config.outputDir,
      companyNip,
      taxOfficeCode: config.taxOfficeCode?.trim(),
    };

    // When a company NIP is provided, scope all files under outputDir/<NIP>/
    this.baseDir = companyNip
      ? path.join(config.outputDir, companyNip)
      : config.outputDir;

    // Initialize index tracker scoped to baseDir
    const indexPath = path.join(this.baseDir, '.index.json');
    this.indexTracker = new IndexTracker(indexPath);

    storageLogger.debug('💾 FileManager initialized', { baseDir: this.baseDir });
  }

  /**
   * Initialize file manager and load index
   */
  async initialize(): Promise<void> {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(this.baseDir, { recursive: true });
      storageLogger.debug('📁 Utworzono/zweryfikowano katalog output', { baseDir: this.baseDir });

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

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  private getInvoicesDir(): string {
    // Raw invoices (as downloaded from KSeF) remain under faktury/
    return path.join(this.baseDir, 'faktury');
  }

  private getJpkDir(): string {
    // Monthly JPK files are stored separately for easy import
    return path.join(this.baseDir, 'jpk');
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
      const filePath = path.join(this.baseDir, folderPath, fileName);

      return {
        filePath,
        fileName,
        alreadyExisted: true,
      };
    }

    // Generate raw invoice file path (KSeF XML kept for traceability + rebuilding monthly JPK)
    const folderPath = path.join('faktury', generateFolderPath(header));
    const fileName = generateFileName(header);
    const fullFolderPath = path.join(this.baseDir, folderPath);
    const filePath = path.join(fullFolderPath, fileName);

    try {
      // Create directories recursively
      await this.ensureDir(fullFolderPath);
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
        filePath: path.relative(this.baseDir, filePath),
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
   * Build or rebuild monthly JPK_FA file for a given month and folder type.
   * Reads raw KSeF invoices from `faktury/<YYYY-MM>/<zakup|sprzedaz>/` and outputs:
   * `jpk/<YYYY-MM>/<zakup|sprzedaz>/JPK_FA_<YYYY-MM>.xml`
   */
  async buildMonthlyJpkFa(params: { month: string; folderType: JpkFolderType }): Promise<{ filePath: string; invoices: number }> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    const { month, folderType } = params;
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new KsefValidationError(`Invalid month: ${month} (expected YYYY-MM)`);

    const rawDir = path.join(this.getInvoicesDir(), month, folderType);
    let rawFiles: string[] = [];
    try {
      rawFiles = (await fs.readdir(rawDir)).filter((f) => f.toLowerCase().endsWith('.xml'));
    } catch {
      // No raw invoices for that month/type
      rawFiles = [];
    }

    const entries = [];
    for (const f of rawFiles) {
      const full = path.join(rawDir, f);
      try {
        const xml = await fs.readFile(full, 'utf-8');
        const inv = ksefInvoiceXmlToJpkFaEntry({
          xml,
          folderType,
          companyNip: this.config.companyNip || '',
        });
        entries.push(inv);
      } catch (err) {
        storageLogger.warn('⚠️ Pomijam fakturę przy budowie JPK_FA', {
          file: full,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const podmiotNip = this.config.companyNip || '';
    if (!podmiotNip) {
      throw new KsefValidationError('companyNip is required to build monthly JPK_FA');
    }

    // Pick company name from invoices (seller for sprzedaz, buyer for zakup) if present.
    const podmiotName =
      folderType === 'sprzedaz'
        ? entries.find((e) => e.seller.pelnaNazwa && e.seller.nip === podmiotNip)?.seller.pelnaNazwa
        : entries.find((e) => e.buyer.pelnaNazwa && e.buyer.nip === podmiotNip)?.buyer.pelnaNazwa;

    const xmlOut = buildJpkFaXml({
      month,
      podmiot: { nip: podmiotNip, pelnaNazwa: podmiotName ?? undefined },
      invoices: entries,
    });

    const outDir = path.join(this.getJpkDir(), month, folderType);
    await this.ensureDir(outDir);

    const outPath = path.join(outDir, `JPK_FA_${month}.xml`);
    const tmp = `${outPath}.tmp`;
    await fs.writeFile(tmp, xmlOut, 'utf-8');
    await fs.rename(tmp, outPath);

    storageLogger.info('📦 Zbudowano JPK_FA', { month, folderType, outPath, invoices: entries.length });

    return { filePath: outPath, invoices: entries.length };
  }

  /**
   * Buduje miesięczne pliki JPK:
   * 1. **`JPK_VAT_<YYYY-MM>.xml`** — schemat **2017** (`JPK_VAT (3)`), **import do InsERT** (bez pola NrKSeF w XSD).
   * 2. Opcjonalnie **`JPK_V7M_KSEF_<YYYY-MM>.xml`** — **JPK_V7M(3)** z `NrKSeF` (wymaga `INSERT_KOD_URZEDU`; nowsza wersja InsERT może go jeszcze nie rozpoznawać).
   * Reads raw KSeF invoices from `faktury/<YYYY-MM>/<zakup|sprzedaz>/`.
   */
  async buildMonthlyJpkVat3(params: { month: string; folderType: JpkVatFolderType }): Promise<{ filePath: string; rows: number }> {
    if (!this.indexLoaded) {
      throw new KsefValidationError('File manager not initialized. Call initialize() first.');
    }

    const { month, folderType } = params;
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new KsefValidationError(`Invalid month: ${month} (expected YYYY-MM)`);

    const rawDir = path.join(this.getInvoicesDir(), month, folderType);
    let rawFiles: string[] = [];
    try {
      rawFiles = (await fs.readdir(rawDir)).filter((f) => f.toLowerCase().endsWith('.xml'));
    } catch {
      rawFiles = [];
    }

    const rows: Array<{ kind: 'zakup' | 'sprzedaz'; row: JpkVat3RowBase }> = [];
    for (const f of rawFiles) {
      const full = path.join(rawDir, f);
      try {
        const xml = await fs.readFile(full, 'utf-8');
        const ksefRef = parseKsefReferenceFromInvoiceFileName(f);
        rows.push(
          ksefInvoiceXmlToJpkVat3Row({
            xml,
            folderType,
            companyNip: this.config.companyNip || '',
            ksefReferenceNumber: ksefRef,
          })
        );
      } catch (err) {
        storageLogger.warn('⚠️ Pomijam fakturę przy budowie JPK_VAT(3)', {
          file: full,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const podmiotNip = this.config.companyNip || '';
    if (!podmiotNip) {
      throw new KsefValidationError('companyNip is required to build monthly JPK_VAT(3)');
    }

    const taxOfficeCode = (this.config.taxOfficeCode ?? '').trim();

    const podmiotName: string | undefined = undefined;

    const xmlInsert = buildInsertJpkVat2017Xml({
      month,
      podmiotNip,
      podmiotPelnaNazwa: podmiotName,
      rows,
      systemName: 'KSeF--Insert',
    });

    const outDir = path.join(this.getJpkDir(), month, folderType);
    await this.ensureDir(outDir);

    const outPath = path.join(outDir, `JPK_VAT_${month}.xml`);
    const tmp = `${outPath}.tmp`;
    await fs.writeFile(tmp, xmlInsert, 'utf-8');
    await fs.rename(tmp, outPath);

    if (/^\d{4}$/.test(taxOfficeCode)) {
      try {
        const xmlV7 = buildJpkV7m3WithKsefXml({
          month,
          podmiotNip,
          podmiotPelnaNazwa: podmiotName,
          rows,
          systemName: 'KSeF--Insert',
          taxOfficeCode,
        });
        const v7Path = path.join(outDir, `JPK_V7M_KSEF_${month}.xml`);
        const tmpV7 = `${v7Path}.tmp`;
        await fs.writeFile(tmpV7, xmlV7, 'utf-8');
        await fs.rename(tmpV7, v7Path);
        storageLogger.info('📦 Zapisano dodatkowo JPK_V7M(3) z NrKSeF', { v7Path });
      } catch (e) {
        storageLogger.warn('⚠️ Nie udało się zapisać JPK_V7M_KSEF', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      storageLogger.warn(
        'ℹ️ Pominięto JPK_V7M_KSEF (ustaw INSERT_KOD_URZEDU=4 cyfry, aby wygenerować plik z polem NrKSeF dla przyszłych wersji InsERT / MF).'
      );
    }

    const ksefLines = rows
      .map((r) => r.row)
      .filter((row) => row.ksefReferenceNumber)
      .map(
        (row) =>
          `${csvSemicolonField(row.documentNumber)};${csvSemicolonField(row.ksefReferenceNumber!)}`
      );
    if (ksefLines.length > 0) {
      const csvPath = path.join(outDir, `KSeF_numery_${month}_${folderType}.csv`);
      const csvBody = `\ufeffNumer dowodu;Numer KSeF\n${ksefLines.join('\n')}\n`;
      await fs.writeFile(csvPath, csvBody, 'utf-8');
      storageLogger.info('📎 Zapisano mapowanie numerów KSeF (CSV)', { csvPath, lines: ksefLines.length });
    }

    storageLogger.info('📦 Zbudowano JPK_VAT(2017) do importu InsERT', { month, folderType, outPath, rows: rows.length });

    return { filePath: outPath, rows: rows.length };
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
      const filePath = path.join(this.baseDir, entry.filePath);

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
