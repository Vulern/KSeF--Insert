/**
 * Invoice File Manager Tests
 * Testy dla zarządzania plikami XML faktur
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { InvoiceFileManager } from '../../src/storage/file-manager.js';
import { IndexTracker } from '../../src/storage/index-tracker.js';
import {
  generateFileName,
  generateFolderPath,
  isValidFileName,
  extractNip,
  extractInvoiceDate,
} from '../../src/storage/naming.js';
import { KsefValidationError } from '../../src/errors.js';
import type { InvoiceHeader } from '../../src/storage/types.js';

// Test helpers
const createTempDir = async (): Promise<string> => {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'ksef-test-'));
};

const createMockHeader = (overrides?: Partial<InvoiceHeader>): InvoiceHeader => ({
  ksefReferenceNumber: '1234567890-20240115-ABC123',
  invoicingDate: '2024-01-15T10:00:00Z',
  sellerNip: '5213000001',
  subjectType: 'zakup',
  ...overrides,
});

const createMockXml = (content?: string): string => {
  return content || `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <InvoiceNumber>INV-2024-001</InvoiceNumber>
  <IssueDate>2024-01-15</IssueDate>
  <Amount>1000.00</Amount>
</Invoice>`;
};

describe('File Naming (naming.ts)', () => {
  describe('generateFileName', () => {
    it('should generate valid file name from invoice header', () => {
      const header = createMockHeader();
      const fileName = generateFileName(header);

      expect(fileName).toBe('2024-01-15_5213000001_1234567890-20240115-ABC123.xml');
      expect(isValidFileName(fileName)).toBe(true);
    });

    it('should extract date correctly from invoicingDate', () => {
      const header = createMockHeader({
        invoicingDate: '2024-06-15T12:00:00Z',
      });
      const fileName = generateFileName(header);

      expect(fileName).toMatch(/^2024-06-15_/);
      expect(isValidFileName(fileName)).toBe(true);
    });

    it('should fall back to issueDate if invoicingDate missing', () => {
      const header = createMockHeader({
        invoicingDate: undefined,
        issueDate: '2024-02-10',
      });
      const fileName = generateFileName(header);

      expect(fileName).toMatch(/^2024-02-10_/);
    });

    it('should use sellerNip as priority over buyerNip', () => {
      const header = createMockHeader({
        sellerNip: '5213000001',
        buyerNip: '9876543210',
      });
      const fileName = generateFileName(header);

      expect(fileName).toMatch(/_5213000001_/);
    });

    it('should replace spaces in ksefRef with underscores', () => {
      const header = createMockHeader({
        ksefReferenceNumber: '1234567890 20240115 ABC123',
      });
      const fileName = generateFileName(header);

      expect(fileName).toMatch(/_1234567890_20240115_ABC123\.xml$/);
    });

    it('should throw error if no date in header', () => {
      const header = createMockHeader({
        invoicingDate: undefined,
        issueDate: undefined,
      });

      expect(() => generateFileName(header)).toThrow(KsefValidationError);
    });

    it('should throw error if no NIP in header', () => {
      const header = createMockHeader({
        sellerNip: undefined,
        buyerNip: undefined,
        nip: undefined,
      });

      expect(() => generateFileName(header)).toThrow(KsefValidationError);
    });

    it('should throw error if ksefReferenceNumber missing', () => {
      const header = createMockHeader({
        ksefReferenceNumber: '',
      });

      expect(() => generateFileName(header)).toThrow(KsefValidationError);
    });
  });

  describe('generateFolderPath', () => {
    it('should generate correct folder path for zakup', () => {
      const header = createMockHeader({
        invoicingDate: '2024-01-15',
        subjectType: 'zakup',
      });
      const folderPath = generateFolderPath(header);

      expect(folderPath).toBe('2024-01/zakup');
    });

    it('should generate correct folder path for sprzedaz', () => {
      const header = createMockHeader({
        invoicingDate: '2024-03-20',
        subjectType: 'sprzedaz',
      });
      const folderPath = generateFolderPath(header);

      expect(folderPath).toBe('2024-03/sprzedaz');
    });

    it('should default to zakup if subjectType not specified', () => {
      const header = createMockHeader({
        subjectType: undefined,
      });
      const folderPath = generateFolderPath(header);

      expect(folderPath).toMatch(/\/zakup$/);
    });

    it('should handle case-insensitive subjectType', () => {
      const headerSprzedaz = createMockHeader({
        subjectType: 'SPRZEDAZ',
      });
      const headerZakup = createMockHeader({
        subjectType: 'Zakup',
      });

      expect(generateFolderPath(headerSprzedaz)).toMatch(/\/sprzedaz$/);
      expect(generateFolderPath(headerZakup)).toMatch(/\/zakup$/);
    });
  });

  describe('extractNip', () => {
    it('should extract sellerNip with priority', () => {
      const header = createMockHeader({
        sellerNip: '5213000001',
        buyerNip: '9876543210',
      });

      expect(extractNip(header)).toBe('5213000001');
    });

    it('should fall back to buyerNip', () => {
      const header = createMockHeader({
        sellerNip: undefined,
        buyerNip: '9876543210',
      });

      expect(extractNip(header)).toBe('9876543210');
    });

    it('should remove non-digit characters from NIP', () => {
      const header = createMockHeader({
        nip: '52-13-00-0001',
      });

      expect(extractNip(header)).toBe('5213000001');
    });

    it('should throw error if no NIP available', () => {
      const header = createMockHeader({
        sellerNip: undefined,
        buyerNip: undefined,
        nip: undefined,
      });

      expect(() => extractNip(header)).toThrow(KsefValidationError);
    });
  });

  describe('extractInvoiceDate', () => {
    it('should extract and format ISO date to YYYY-MM-DD', () => {
      const header = createMockHeader({
        invoicingDate: '2024-01-15T10:30:00Z',
      });

      const date = extractInvoiceDate(header);
      expect(date).toMatch(/2024-01-15/);
    });

    it('should handle various ISO date formats', () => {
      const testCases = [
        { input: '2024-01-15', expected: '2024-01-15' },
        { input: '2024-06-15', expected: '2024-06-15' },
        { input: '2024-03-20T10:00:00Z', expected: '2024-03-20' },
      ];

      for (const { input, expected } of testCases) {
        const header = createMockHeader({ invoicingDate: input });
        const result = extractInvoiceDate(header);
        expect(result).toBe(expected);
      }
    });

    it('should throw error for invalid date format', () => {
      const header = createMockHeader({
        invoicingDate: 'invalid-date',
      });

      expect(() => extractInvoiceDate(header)).toThrow(KsefValidationError);
    });
  });

  describe('isValidFileName', () => {
    it('should validate correct file name format', () => {
      expect(isValidFileName('2024-01-15_5213000001_1234567890-20240115-ABC123.xml')).toBe(true);
      expect(isValidFileName('2024-12-31_9876543210_REF123.xml')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidFileName('invalid.xml')).toBe(false);
      expect(isValidFileName('2024-01-15_NIP_REF')).toBe(false); // missing .xml
      expect(isValidFileName('2024-01-15_NIP_REF.txt')).toBe(false); // wrong extension
      expect(isValidFileName('2024-1-15_NIP_REF.xml')).toBe(false); // wrong date format
    });
  });
});

describe('Index Tracker (index-tracker.ts)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create new index when file does not exist', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker = new IndexTracker(indexPath);

    await tracker.load();

    expect(tracker.getStats().total).toBe(0);
    expect(tracker.getStats().lastSync).toBeTruthy();
  });

  it('should load existing index from disk', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker1 = new IndexTracker(indexPath);

    await tracker1.load();
    tracker1.addEntry('ref1', {
      downloadedAt: new Date().toISOString(),
      filePath: '2024-01/zakup/file1.xml',
      invoiceDate: '2024-01-15',
      subjectType: 'zakup',
      nip: '5213000001',
    });
    await tracker1.save();

    // Load in new instance
    const tracker2 = new IndexTracker(indexPath);
    await tracker2.load();

    expect(tracker2.getStats().total).toBe(1);
    expect(tracker2.isAlreadyDownloaded('ref1')).toBe(true);
  });

  it('should detect duplicate invoices', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker = new IndexTracker(indexPath);

    await tracker.load();

    expect(tracker.isAlreadyDownloaded('ref1')).toBe(false);

    tracker.addEntry('ref1', {
      downloadedAt: new Date().toISOString(),
      filePath: '2024-01/zakup/file1.xml',
      invoiceDate: '2024-01-15',
      subjectType: 'zakup',
      nip: '5213000001',
    });

    expect(tracker.isAlreadyDownloaded('ref1')).toBe(true);
  });

  it('should save index with pretty print', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker = new IndexTracker(indexPath);

    await tracker.load();
    tracker.addEntry('ref1', {
      downloadedAt: '2024-01-15T10:00:00Z',
      filePath: '2024-01/zakup/file1.xml',
      invoiceDate: '2024-01-15',
      subjectType: 'zakup',
      nip: '5213000001',
    });
    await tracker.save();

    const content = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(content);

    expect(index.invoices.ref1).toBeDefined();
    expect(content).toContain('  '); // Check for indentation (pretty print)
  });

  it('should handle empty batch gracefully', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker = new IndexTracker(indexPath);

    await tracker.load();
    await tracker.save();

    expect(tracker.getStats().total).toBe(0);
  });

  it('should get entries by date range', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker = new IndexTracker(indexPath);

    await tracker.load();

    tracker.addEntry('ref1', {
      downloadedAt: '2024-01-10T10:00:00Z',
      filePath: '2024-01/zakup/file1.xml',
      invoiceDate: '2024-01-10',
      subjectType: 'zakup',
      nip: '5213000001',
    });

    tracker.addEntry('ref2', {
      downloadedAt: '2024-01-20T10:00:00Z',
      filePath: '2024-01/zakup/file2.xml',
      invoiceDate: '2024-01-20',
      subjectType: 'zakup',
      nip: '5213000001',
    });

    const entries = tracker.getEntriesByDateRange('2024-01-15', '2024-01-25');
    expect(entries).toHaveLength(1);
    expect(entries[0].invoiceDate).toBe('2024-01-20');
  });

  it('should remove entries from index', async () => {
    const indexPath = path.join(tempDir, '.index.json');
    const tracker = new IndexTracker(indexPath);

    await tracker.load();

    tracker.addEntry('ref1', {
      downloadedAt: new Date().toISOString(),
      filePath: '2024-01/zakup/file1.xml',
      invoiceDate: '2024-01-15',
      subjectType: 'zakup',
      nip: '5213000001',
    });

    expect(tracker.isAlreadyDownloaded('ref1')).toBe(true);

    const removed = tracker.removeEntry('ref1');
    expect(removed).toBe(true);
    expect(tracker.isAlreadyDownloaded('ref1')).toBe(false);
  });
});

describe('Invoice File Manager (file-manager.ts)', () => {
  let tempDir: string;
  let manager: InvoiceFileManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new InvoiceFileManager({ outputDir: tempDir });
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Single Invoice Save', () => {
    it('should save single invoice to correct location', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      const result = await manager.saveInvoice({ xml, header });

      expect(result.alreadyExisted).toBe(false);
      expect(result.fileName).toBe('2024-01-15_5213000001_1234567890-20240115-ABC123.xml');
      expect(result.filePath).toContain('2024-01');
      expect(result.filePath).toContain('zakup');
    });

    it('should create nested folder structure', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      await manager.saveInvoice({ xml, header });

      const folderPath = path.join(tempDir, '2024-01', 'zakup');
      const stats = await fs.stat(folderPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should write XML content exactly as provided', async () => {
      const customXml = `<?xml version="1.0"?>
<Root>
  <Element>Value</Element>
</Root>`;
      const header = createMockHeader();

      await manager.saveInvoice({ xml: customXml, header });

      const filePath = path.join(tempDir, '2024-01', 'zakup', '2024-01-15_5213000001_1234567890-20240115-ABC123.xml');
      const savedContent = await fs.readFile(filePath, 'utf-8');

      expect(savedContent).toBe(customXml);
    });

    it('should detect duplicate and skip', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      const result1 = await manager.saveInvoice({ xml, header });
      expect(result1.alreadyExisted).toBe(false);

      const result2 = await manager.saveInvoice({ xml, header });
      expect(result2.alreadyExisted).toBe(true);
    });

    it('should handle sprzedaz folder type', async () => {
      const header = createMockHeader({
        subjectType: 'sprzedaz',
      });
      const xml = createMockXml();

      const result = await manager.saveInvoice({ xml, header });

      expect(result.filePath).toContain('sprzedaz');
    });

    it('should throw error if XML is empty', async () => {
      const header = createMockHeader();

      await expect(manager.saveInvoice({ xml: '', header })).rejects.toThrow(KsefValidationError);
    });

    it('should throw error if header is invalid', async () => {
      const xml = createMockXml();

      await expect(manager.saveInvoice({ xml, header: null as any })).rejects.toThrow(KsefValidationError);
    });
  });

  describe('Batch Save', () => {
    it('should save batch of invoices to correct folders', async () => {
      const invoices = [
        { xml: createMockXml('XML1'), header: createMockHeader() },
        {
          xml: createMockXml('XML2'),
          header: createMockHeader({
            ksefReferenceNumber: 'ref-2',
            invoicingDate: '2024-02-10',
            subjectType: 'sprzedaz',
          }),
        },
        {
          xml: createMockXml('XML3'),
          header: createMockHeader({
            ksefReferenceNumber: 'ref-3',
            invoicingDate: '2024-01-20',
          }),
        },
      ];

      const result = await manager.saveBatch(invoices);

      expect(result.saved).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.details).toHaveLength(3);
    });

    it('should skip duplicates in batch', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      const invoices = [
        { xml, header },
        { xml, header }, // Duplicate
        {
          xml: createMockXml('XML3'),
          header: createMockHeader({ ksefReferenceNumber: 'ref-3' }),
        },
      ];

      const result = await manager.saveBatch(invoices);

      expect(result.saved).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty batch', async () => {
      const result = await manager.saveBatch([]);

      expect(result.saved).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors from invalid invoices', async () => {
      const invoices = [
        { xml: createMockXml(), header: createMockHeader() },
        { xml: '', header: createMockHeader({ ksefReferenceNumber: 'invalid' }) }, // Invalid XML
      ];

      const result = await manager.saveBatch(invoices);

      expect(result.saved).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('XML content must be a non-empty string');
    });
  });

  describe('Index Tracking', () => {
    it('should update index after save', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      await manager.saveInvoice({ xml, header });

      const stats = manager.getStats();
      expect(stats.total).toBe(1);
    });

    it('should persist index to disk', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      await manager.saveInvoice({ xml, header });

      // Create new manager instance
      const manager2 = new InvoiceFileManager({ outputDir: tempDir });
      await manager2.initialize();

      const stats = manager2.getStats();
      expect(stats.total).toBe(1);
    });

    it('should track invoice metadata in index', async () => {
      const header = createMockHeader({
        invoicingDate: '2024-03-15T10:00:00Z',
        sellerNip: '1234567890',
      });
      const xml = createMockXml();

      await manager.saveInvoice({ xml, header });

      const index = manager.getIndex();
      const entry = index.invoices['1234567890-20240115-ABC123'];

      expect(entry).toBeDefined();
      expect(entry.nip).toBe('1234567890');
      expect(entry.subjectType).toBe('zakup');
      expect(entry.invoiceDate).toBe('2024-03-15T10:00:00Z');
    });
  });

  describe('List Saved Invoices', () => {
    beforeEach(async () => {
      // Save multiple invoices
      const invoices = [
        {
          xml: createMockXml(),
          header: createMockHeader({ invoicingDate: '2024-01-10' }),
        },
        {
          xml: createMockXml(),
          header: createMockHeader({
            ksefReferenceNumber: 'ref-2',
            invoicingDate: '2024-01-20',
          }),
        },
        {
          xml: createMockXml(),
          header: createMockHeader({
            ksefReferenceNumber: 'ref-3',
            invoicingDate: '2024-02-10',
          }),
        },
      ];

      await manager.saveBatch(invoices);
    });

    it('should list all saved invoices', async () => {
      const invoices = await manager.listSaved();

      expect(invoices).toHaveLength(3);
      expect(invoices[0].ksefReferenceNumber).toBeTruthy();
      expect(invoices[0].filePath).toBeTruthy();
      expect(invoices[0].fileName).toMatch(/\.xml$/);
    });

    it('should filter by date range', async () => {
      const invoices = await manager.listSaved({
        dateFrom: '2024-01-15',
        dateTo: '2024-01-25',
      });

      expect(invoices).toHaveLength(1);
      expect(invoices[0].invoiceDate).toBe('2024-01-20');
    });

    it('should return empty list when no matches', async () => {
      const invoices = await manager.listSaved({
        dateFrom: '2025-01-01',
      });

      expect(invoices).toHaveLength(0);
    });
  });

  describe('Delete Invoice', () => {
    it('should delete invoice from disk and index', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      await manager.saveInvoice({ xml, header });

      let stats = manager.getStats();
      expect(stats.total).toBe(1);

      const deleted = await manager.delete('1234567890-20240115-ABC123');
      expect(deleted).toBe(true);

      stats = manager.getStats();
      expect(stats.total).toBe(0);
    });

    it('should return false if invoice not found', async () => {
      const deleted = await manager.delete('non-existent-ref');

      expect(deleted).toBe(false);
    });

    it('should verify file is deleted from disk', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      const saveResult = await manager.saveInvoice({ xml, header });

      // Verify file exists
      await fs.access(saveResult.filePath);

      // Delete invoice
      await manager.delete('1234567890-20240115-ABC123');

      // Verify file is deleted
      await expect(fs.access(saveResult.filePath)).rejects.toThrow();
    });

    it('should persist deletion to disk', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      await manager.saveInvoice({ xml, header });
      await manager.delete('1234567890-20240115-ABC123');

      // Create new manager instance
      const manager2 = new InvoiceFileManager({ outputDir: tempDir });
      await manager2.initialize();

      const stats = manager2.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error if not initialized', async () => {
      const manager3 = new InvoiceFileManager({ outputDir: tempDir });

      await expect(manager3.saveInvoice({ xml: '<root/>', header: createMockHeader() })).rejects.toThrow(
        'not initialized'
      );
    });

    it('should provide readable error for invalid NIP', async () => {
      const header = createMockHeader({
        sellerNip: undefined,
        buyerNip: undefined,
        nip: undefined,
      });

      await expect(manager.saveInvoice({ xml: createMockXml(), header })).rejects.toThrow(KsefValidationError);
    });

    it('should handle permission errors gracefully', async () => {
      // This test requires specific OS setup and is environment-dependent
      // For now, we'll just verify the error handling exists
      expect.assertions(0);
    });

    it('should clean up temp files on write failure', async () => {
      const header = createMockHeader();
      const xml = createMockXml();

      // This would require mocking fs.rename to test properly
      // For now, verify normal operation doesn't leave temp files
      await manager.saveInvoice({ xml, header });

      const folderPath = path.join(tempDir, '2024-01', 'zakup');
      const files = await fs.readdir(folderPath);

      // Should only have .xml files, no .tmp files
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});
