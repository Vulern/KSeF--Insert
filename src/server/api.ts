/**
 * API Routes for Web UI
 * Handles status, sync, invoices, validation, and config
 */

import { Hono } from 'hono';
import { Context } from 'hono';
import { KsefClient } from '../ksef/client.js';
import { InvoiceFileManager } from '../storage/file-manager.js';
import { InvoiceXMLValidator } from '../validator/xml-validator.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { createAuth } from '../ksef/auth.js';

/**
 * Setup all API routes
 */
export function setupApiRoutes(app: Hono): void {
  // GET /api/status - Current status
  app.get('/api/status', async (c: Context) => {
    try {
      let totalInvoices = 0;

      try {
        const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
        await fileManager.initialize();
        const savedInvoices = await fileManager.listSaved();
        totalInvoices = savedInvoices?.length || 0;
      } catch (err) {
        logger.warn('Could not get invoice count:', err);
        // Continue with totalInvoices = 0
      }

      const status = {
        connected: !!config.ksef.token,
        environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
        nip: config.ksef.nip || 'N/A',
        lastSync: new Date().toISOString(), // Would be from index in production
        totalInvoices,
        outputDir: config.insert.outputDir,
      };

      return c.json(status);
    } catch (error) {
      logger.error('Status endpoint error:', error);
      // Return minimal status
      return c.json(
        {
          connected: !!config.ksef.token,
          environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
          nip: config.ksef.nip || 'N/A',
          lastSync: null,
          totalInvoices: 0,
          outputDir: config.insert.outputDir,
        },
        200
      );
    }
  });

  // POST /api/sync - Start synchronization with SSE
  app.post('/api/sync', async (c: Context) => {
    try {
      const body = await c.req.json();
      const { dateFrom, dateTo, type } = body as {
        dateFrom?: string;
        dateTo?: string;
        type?: string;
      };

      // Validate input
      if (!dateFrom || !dateTo) {
        return c.json({ error: 'dateFrom and dateTo are required' }, 400);
      }

      // Create readable stream for SSE
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const client = new KsefClient();
            const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });

            // Helper to send SSE message
            const sendProgress = (data: Record<string, unknown>) => {
              const message = `data: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(message);
            };

            // Initialize file manager
            await fileManager.initialize();

            // Authenticate
            sendProgress({ status: 'Autentykacja...' });

            const auth = createAuth(client);
            await auth.authenticate(config.ksef.nip!, config.ksef.token!);

            // Query invoices
            sendProgress({ status: 'Wyszukiwanie faktur...' });

            const subjectType =
              type === 'wszystkie'
                ? undefined
                : type === 'sprzedaz'
                  ? 'subject_type.seller'
                  : 'subject_type.buyer';

            const queryParams = {
              pageSize: 100,
              queryCriteria: {
                subjectType,
                dateFrom,
                dateTo,
              } as Record<string, unknown>,
            };

            const result = await client.queryInvoices(queryParams);
            const invoices = result.invoiceHeaderList || [];

            // Download and save invoices
            let downloaded = 0;
            let skipped = 0;
            let errors = 0;

            for (let i = 0; i < invoices.length; i++) {
              const invoice = invoices[i] as Record<string, unknown>;

              try {
                // Get invoice content
                const ksefRef = invoice.ksefReferenceNumber as string;
                const invoiceData = await client.getInvoice(ksefRef);

                if (!invoiceData || !invoiceData.content) {
                  throw new Error('Empty invoice content');
                }

                // Create header object
                const header = {
                  ksefReferenceNumber: ksefRef,
                  invoicingDate: (invoice.invoicingDate as string) || '',
                  issueDate: (invoice.issueDate as string) || '',
                  subjectType: subjectType as string,
                  nip: (invoice.sellerNip || invoice.buyerNip) as string,
                };

                // Save invoice
                const saveResult = await fileManager.saveInvoice({
                  xml: invoiceData.content,
                  header,
                });

                if (saveResult.alreadyExisted) {
                  skipped++;
                } else {
                  downloaded++;
                }

                // Send progress
                const progress = i + 1;
                const percentage = Math.round((progress / invoices.length) * 100);
                sendProgress({
                  current: progress,
                  total: invoices.length,
                  status: `Pobieram fakturę ${progress}/${invoices.length}...`,
                  percentage,
                });
              } catch (err) {
                logger.error(`Error processing invoice:`, err);
                errors++;
              }
            }

            // Cleanup session
            try {
              await client.terminateSession();
            } catch {
              // Ignore cleanup errors
            }

            // Send completion
            sendProgress({ downloaded, skipped, errors, total: invoices.length });
            controller.close();
          } catch (error) {
            logger.error('Sync error:', error);
            const message = `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`;
            controller.enqueue(message);
            controller.close();
          }
        },
      });

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return new Response(stream);
    } catch (error) {
      logger.error('Sync endpoint error:', error);
      return c.json(
        { error: 'Sync failed', message: error instanceof Error ? error.message : 'Unknown error' },
        500
      );
    }
  });

  // GET /api/invoices - List downloaded invoices
  app.get('/api/invoices', async (c: Context) => {
    try {
      const month = c.req.query('month'); // "2024-01"
      const invoiceType = c.req.query('type') || 'zakup'; // "zakup" or "sprzedaz"

      const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
      await fileManager.initialize();

      // Parse month to date range
      let dateFrom: string | undefined;
      let dateTo: string | undefined;

      if (month) {
        const [year, monthNum] = month.split('-');
        dateFrom = `${year}-${monthNum}-01`;
        const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
        dateTo = `${year}-${monthNum}-${lastDay.toString().padStart(2, '0')}`;
      }

      const savedInvoices = await fileManager.listSaved({
        dateFrom,
        dateTo,
      });

      const filtered = (savedInvoices || []).filter((item) => {
        if (invoiceType === 'zakup') {
          return item.subjectType === 'subject_type.buyer';
        } else if (invoiceType === 'sprzedaz') {
          return item.subjectType === 'subject_type.seller';
        }
        return true; // wszystkie
      });

      const invoices = filtered.map((item) => ({
        ksefRef: item.ksefReferenceNumber,
        date: item.invoiceDate,
        nip: item.nip,
        fileName: item.fileName,
        filePath: item.filePath,
      }));

      return c.json({
        invoices,
        total: invoices.length,
      });
    } catch (error) {
      logger.error('Invoices endpoint error:', error);
      return c.json({ error: 'Failed to list invoices', invoices: [], total: 0 }, 200); // Return empty on error
    }
  });

  // GET /api/invoices/:ksefRef/download - Download invoice XML
  app.get('/api/invoices/:ksefRef/download', async (c: Context) => {
    try {
      const ksefRef = c.req.param('ksefRef');

      if (!ksefRef) {
        return c.json({ error: 'ksefRef parameter required' }, 400);
      }

      const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
      await fileManager.initialize();

      const savedInvoices = await fileManager.listSaved();

      const invoice = (savedInvoices || []).find((item) => item.ksefReferenceNumber === ksefRef);

      if (!invoice) {
        return c.json({ error: 'Invoice not found' }, 404);
      }

      // Read and return file
      const { readFile } = await import('fs/promises');
      const content = await readFile(invoice.filePath, 'utf-8');

      c.header('Content-Type', 'application/xml');
      c.header('Content-Disposition', `attachment; filename="${invoice.fileName}"`);

      return c.text(content);
    } catch (error) {
      logger.error('Download endpoint error:', error);
      return c.json({ error: 'Download failed' }, 500);
    }
  });

  // POST /api/validate - Validate invoices
  app.post('/api/validate', async (c: Context) => {
    try {
      const body = await c.req.json();
      const { month } = body as { month?: string };

      const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
      const validator = new InvoiceXMLValidator();

      await fileManager.initialize();

      // Parse month to date range
      let dateFrom: string | undefined;
      let dateTo: string | undefined;

      if (month) {
        const [year, monthNum] = month.split('-');
        dateFrom = `${year}-${monthNum}-01`;
        const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
        dateTo = `${year}-${monthNum}-${lastDay.toString().padStart(2, '0')}`;
      }

      // Get invoices for month
      const invoices = await fileManager.listSaved({
        dateFrom,
        dateTo,
      });

      if (!invoices || invoices.length === 0) {
        return c.json({
          total: 0,
          valid: 0,
          invalid: 0,
          errors: [],
        });
      }

      // Validate each invoice
      let valid = 0;
      let invalid = 0;
      const errors: Array<{ file: string; errors: string[] }> = [];

      for (const invoice of invoices) {
        try {
          const result = await validator.validate(invoice.filePath);

          if (result.valid) {
            valid++;
          } else {
            invalid++;
            const errorMessages = result.errors.map((err) => err.message).slice(0, 3);
            errors.push({
              file: invoice.fileName,
              errors: errorMessages,
            });
          }
        } catch (err) {
          invalid++;
          errors.push({
            file: invoice.fileName,
            errors: [err instanceof Error ? err.message : 'Unknown validation error'],
          });
        }
      }

      return c.json({
        total: invoices.length,
        valid,
        invalid,
        errors: errors.slice(0, 10), // First 10 files with errors
      });
    } catch (error) {
      logger.error('Validate endpoint error:', error);
      return c.json({ error: 'Validation failed', total: 0, valid: 0, invalid: 0, errors: [] }, 200);
    }
  });

  // GET /api/config - Get configuration (without secrets)
  app.get('/api/config', async (c: Context) => {
    try {
      const nipMasked = config.ksef.nip
        ? config.ksef.nip.substring(0, 4) + '****' + config.ksef.nip.substring(8)
        : 'N/A';

      return c.json({
        environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
        nip: nipMasked,
        outputDir: config.insert.outputDir,
        baseUrl: config.ksef.baseUrl,
      });
    } catch (error) {
      logger.error('Config endpoint error:', error);
      return c.json({ error: 'Failed to get config' }, 500);
    }
  });
}
