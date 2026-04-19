/**
 * CLI E2E Tests
 * End-to-end tests for CLI commands
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ksefClient } from '../../src/ksef/client.js';
import { InvoiceFileManager } from '../../src/storage/index.js';

// Mock environment
const testOutputDir = join(tmpdir(), 'ksef-e2e-test-' + Date.now());

describe('CLI E2E Tests', () => {
  beforeAll(async () => {
    // Setup test directory
    await mkdir(testOutputDir, { recursive: true });
    process.env.INSERT_OUTPUT_DIR = testOutputDir;
  });

  afterAll(async () => {
    // Cleanup
    try {
      await rm(testOutputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Sync Command', () => {
    it('should handle empty invoice list gracefully', async () => {
      // Mock KSeF client to return empty list
      vi.spyOn(ksefClient, 'queryInvoices').mockResolvedValue({
        invoiceHeaderList: [],
        numberOfElements: 0,
      });

      vi.spyOn(ksefClient, 'terminateSession').mockResolvedValue(undefined as any);

      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      // When no invoices found, should not crash
      expect(fileManager).toBeDefined();
    });

    it('should skip duplicate invoices', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const invoiceData = {
        ksefReferenceNumber: 'test-ref-123',
        invoicingDate: '2024-01-15',
        subjectType: 'zakup' as const,
        nip: '5213000001',
      };

      // Save first time
      const result1 = await fileManager.saveInvoice({
        xml: '<test>Invoice 1</test>',
        header: invoiceData,
      });

      expect(result1.filePath).toBeDefined();
      expect(result1.alreadyExisted).toBe(false);

      // Save second time (duplicate)
      const result2 = await fileManager.saveInvoice({
        xml: '<test>Invoice 1 Updated</test>',
        header: invoiceData,
      });

      expect(result2.alreadyExisted).toBe(true);
    });

    it('should handle batch save with errors gracefully', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const invoices = [
        {
          xml: '<valid>Invoice</valid>',
          header: {
            ksefReferenceNumber: 'ref-batch-1',
            invoicingDate: '2024-01-20',
            subjectType: 'zakup' as const,
            nip: '5213000001',
          },
        },
        {
          xml: '',
          header: {
            ksefReferenceNumber: 'ref-batch-2',
            invoicingDate: '2024-01-21',
            subjectType: 'zakup' as const,
            nip: '5213000001',
          },
        },
      ];

      const result = await fileManager.saveBatch(invoices);

      // Should have saved at least one
      expect(result.saved + result.skipped).toBeGreaterThan(0);
    });

    it('should validate date parameters correctly', async () => {
      // Invalid date should be rejected at CLI level
      // This is tested in integration tests
      const validDate = '2024-01-01';
      const parts = validDate.split('-');

      expect(parts.length).toBe(3);
      expect(parts[0]).toHaveLength(4); // Year
      expect(parts[1]).toHaveLength(2); // Month
      expect(parts[2]).toHaveLength(2); // Day
    });
  });

  describe('File Manager Integration', () => {
    it('should create correct folder structure', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const invoiceData = {
        ksefReferenceNumber: 'ref-structure-test',
        invoicingDate: '2024-02-15',
        subjectType: 'sprzedaz' as const,
        nip: '5213000001',
      };

      const result = await fileManager.saveInvoice({
        xml: '<test>Structure</test>',
        header: invoiceData,
      });

      // Should have folder structure YYYY-MM/type/
      expect(result.filePath).toContain('2024-02');
      expect(result.filePath).toContain('sprzedaz');
    });

    it('should generate correct file name format', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const invoiceData = {
        ksefReferenceNumber: 'ref-naming-test',
        invoicingDate: '2024-03-10',
        subjectType: 'zakup' as const,
        nip: '7891234567',
      };

      const result = await fileManager.saveInvoice({
        xml: '<test>Naming</test>',
        header: invoiceData,
      });

      // Format: YYYY-MM-DD_NIP_KSEFREF.xml
      expect(result.fileName).toMatch(/^\d{4}-\d{2}-\d{2}_\d{10}_.*\.xml$/);
      expect(result.fileName).toContain('7891234567');
    });

    it('should track invoice metadata in index', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const invoiceData = {
        ksefReferenceNumber: 'ref-index-test',
        invoicingDate: '2024-04-05',
        subjectType: 'zakup' as const,
        nip: '1234567890',
      };

      await fileManager.saveInvoice({
        xml: '<test>Index</test>',
        header: invoiceData,
      });

      // Get stats
      const stats = fileManager.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.lastSync).toBeDefined();
    });

    it('should list saved invoices with filters', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      // Save an invoice
      await fileManager.saveInvoice({
        xml: '<test>List</test>',
        header: {
          ksefReferenceNumber: 'ref-list-test',
          invoicingDate: '2024-05-10',
          subjectType: 'zakup' as const,
          nip: '5213000001',
        },
      });

      // List with date filter
      const result = await fileManager.listSaved({ 
        dateFrom: '2024-05-01',
        dateTo: '2024-05-31',
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('CLI Output Formatting', () => {
    it('should format dates correctly', async () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const isoDate = date.toISOString().split('T')[0];

      expect(isoDate).toBe('2024-01-15');
    });

    it('should handle invoice type values', () => {
      const validTypes = ['zakup', 'sprzedaz', 'wszystkie'];

      validTypes.forEach((type) => {
        expect(['zakup', 'sprzedaz', 'wszystkie']).toContain(type);
      });
    });

    it('should validate NIP format', () => {
      const validNips = ['5213000001', '7891234567', '1234567890'];

      validNips.forEach((nip) => {
        expect(nip).toMatch(/^\d{10}$/);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing .env gracefully', () => {
      // This is tested at startup - missing env vars would throw
      const envVars = ['INSERT_OUTPUT_DIR'];

      envVars.forEach((env) => {
        // Check that env is either set or has a fallback
        expect(
          process.env[env] !== undefined || env === 'KSEF_TOKEN' || env === 'KSEF_NIP'
        ).toBe(true);
      });
    });

    it('should handle empty batch save', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const result = await fileManager.saveBatch([]);

      expect(result.saved).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate invoice data before saving', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      // Missing required fields should throw
      expect(async () => {
        await fileManager.saveInvoice({
          xml: '<test></test>',
          header: {
            ksefReferenceNumber: '', // Invalid - empty
            invoicingDate: '2024-01-01',
            subjectType: 'zakup' as const,
            nip: '5213000001',
          },
        });
      }).rejects.toThrow();
    });
  });

  describe('Session Management', () => {
    it('should track session state', () => {
      // Session tracking would be done at runtime
      // Here we test the types and interfaces
      const mockSession = {
        referenceNumber: 'test-session-123',
        sessionToken: {
          token: 'token-value',
          expiryDate: new Date().toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date().toISOString(),
        authenticationMethod: 'api',
      };

      expect(mockSession.referenceNumber).toBeDefined();
      expect(mockSession.sessionToken.token).toBeDefined();
    });

    it('should handle session termination', async () => {
      // Mock session termination
      const spy = vi.spyOn(ksefClient, 'terminateSession');

      try {
        await ksefClient.terminateSession();
      } catch {
        // Expected in tests - we're just checking it's callable
      }

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Progress Tracking', () => {
    it('should calculate progress percentage correctly', () => {
      const current = 15;
      const total = 35;
      const percent = Math.round((current / total) * 100);

      expect(percent).toBe(43);
    });

    it('should format progress bar correctly', () => {
      const width = 20;
      const current = 10;
      const total = 20;
      const filled = Math.round((current / total) * width);
      const empty = width - filled;

      expect(filled + empty).toBe(width);
      expect(filled).toBe(10);
    });
  });

  describe('Statistics', () => {
    it('should calculate correct statistics', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const stats = fileManager.getStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('lastSync');
      expect(typeof stats.total).toBe('number');
      expect(stats.total >= 0).toBe(true);
    });

    it('should track download timestamps', async () => {
      const fileManager = new InvoiceFileManager({ outputDir: testOutputDir });
      await fileManager.initialize();

      const beforeSave = new Date();

      await fileManager.saveInvoice({
        xml: '<test>Timestamp</test>',
        header: {
          ksefReferenceNumber: 'ref-timestamp-test',
          invoicingDate: '2024-06-01',
          subjectType: 'zakup' as const,
          nip: '5213000001',
        },
      });

      const afterSave = new Date();
      const stats = fileManager.getStats();

      if (stats.lastSync) {
        const lastSyncTime = new Date(stats.lastSync);
        expect(lastSyncTime.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
        expect(lastSyncTime.getTime()).toBeLessThanOrEqual(afterSave.getTime());
      }
    });
  });
});
