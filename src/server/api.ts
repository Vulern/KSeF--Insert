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
import { serverLogger } from '../logger.js';
import { createAuth } from '../ksef/auth.js';
import { maskNip } from '../utils/sanitize.js';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

function getTodayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLogDir(): string {
  return process.env.LOG_DIR || './logs';
}

async function getLatestTodayLogPath(): Promise<string> {
  const logDir = getLogDir();
  const prefix = `ksef-sync-${getTodayIsoDate()}`;
  const fallback = path.join(logDir, `${prefix}.log`);
  try {
    const files = await fs.readdir(logDir);
    const candidates = files.filter(f => f.startsWith(prefix) && f.endsWith('.log'));
    if (candidates.length === 0) return fallback;
    const withStats = await Promise.all(
      candidates.map(async f => {
        const full = path.join(logDir, f);
        const stat = await fs.stat(full).catch(() => null);
        return { full, mtime: stat?.mtimeMs ?? 0 };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    return withStats[0].full;
  } catch {
    return fallback;
  }
}

async function readLastLogLines(params: {
  lines: number;
  level?: string;
  module?: string;
}): Promise<any[]> {
  const logPath = await getLatestTodayLogPath();
  const raw = await fs.readFile(logPath, 'utf-8').catch(() => '');
  if (!raw) return [];

  const all = raw.split('\n').filter(Boolean);
  const slice = all.slice(Math.max(0, all.length - params.lines));
  const out: any[] = [];

  for (const line of slice) {
    try {
      const obj = JSON.parse(line);
      if (params.level && String(obj.level).toLowerCase() !== params.level.toLowerCase()) continue;
      if (params.module && String(obj.module).toLowerCase() !== params.module.toLowerCase()) continue;
      out.push(obj);
    } catch {
      // ignore non-json lines
    }
  }

  return out;
}

// Shared FileManager instance — initialised once, reused across all status/health polls
let sharedFileManager: InvoiceFileManager | null = null;

async function getSharedFileManager(): Promise<InvoiceFileManager> {
  if (!sharedFileManager) {
    sharedFileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
    await sharedFileManager.initialize();
  }
  return sharedFileManager;
}

/**
 * Setup all API routes
 */
export function setupApiRoutes(app: Hono): void {
  // GET /api/health - health check
  app.get('/api/health', async (c: Context) => {
    const started = Date.now();
    const envFilePath = path.join(process.cwd(), '.env');
    const envFile = await fs
      .access(envFilePath)
      .then(() => true)
      .catch(() => false);

    const tokenSet = !!config.ksef.token;
    const nipSet = !!config.ksef.nip;

    let totalInvoices = 0;
    let writable = false;
    try {
      await fs.mkdir(config.insert.outputDir, { recursive: true });
      await fs.access(config.insert.outputDir, fs.constants.W_OK as any);
      writable = true;
      const fm = await getSharedFileManager();
      totalInvoices = (await fm.listSaved())?.length || 0;
    } catch {
      writable = false;
    }

    let ksefLatency: number | null = null;
    let ksefOk = false;
    try {
      const t0 = Date.now();
      await axios.get(config.ksef.baseUrl, { timeout: 5000, validateStatus: () => true });
      ksefLatency = Date.now() - t0;
      ksefOk = true;
    } catch {
      ksefOk = false;
    }

    // version from package.json (best-effort)
    let version = '0.0.0';
    try {
      const pkgRaw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
      version = JSON.parse(pkgRaw)?.version || version;
    } catch {
      // ignore
    }

    return c.json({
      status: 'healthy',
      uptime: Math.floor(process.uptime()),
      version,
      checks: {
        ksef: {
          status: ksefOk ? 'ok' : 'fail',
          environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
          latency: ksefLatency,
        },
        storage: {
          status: writable ? 'ok' : 'fail',
          writable,
          totalInvoices,
          diskSpace: 'unknown',
        },
        config: {
          status: envFile && tokenSet && nipSet ? 'ok' : 'fail',
          envFile,
          tokenSet,
          nipSet,
        },
      },
      responseTime: Date.now() - started,
    });
  });

  // GET /api/logs?lines=100&level=error&module=ksef-client
  app.get('/api/logs', async (c: Context) => {
    const lines = Math.min(Number(c.req.query('lines') || '100'), 1000);
    const level = c.req.query('level') || undefined;
    const module = c.req.query('module') || undefined;

    const entries = await readLastLogLines({ lines, level, module }).catch(() => []);
    const logPath = await getLatestTodayLogPath();
    return c.json({ logPath, entries });
  });

  // GET /api/logs/download - download today's logs
  app.get('/api/logs/download', async (c: Context) => {
    const logPath = await getLatestTodayLogPath();
    const content = await fs.readFile(logPath).catch(() => null);
    if (!content) return c.json({ error: 'Log file not found' }, 404);

    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${path.basename(logPath)}"`);
    return c.body(content);
  });

  // GET /api/logs/stream - SSE stream of logs
  app.get('/api/logs/stream', async (c: Context) => {
    const level = (c.req.query('level') || '').toLowerCase() || undefined;
    const module = (c.req.query('module') || '').toLowerCase() || undefined;
    const logPath = await getLatestTodayLogPath();

    // Use closures for interval IDs so cancel() can clear them reliably
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        let pos = 0;
        const encoder = new TextEncoder();

        const enqueue = (payload: string) => {
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            // stream was closed/cancelled
          }
        };

        const tick = async () => {
          try {
            const fh = await fs.open(logPath, 'r').catch(() => null);
            if (!fh) return;
            const stat = await fh.stat();
            if (stat.size > pos) {
              const sizeToRead = stat.size - pos;
              const buf = Buffer.alloc(Math.min(sizeToRead, 1024 * 256));
              const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
              pos += bytesRead;
              const chunk = buf.subarray(0, bytesRead).toString('utf-8');
              const lines = chunk.split('\n').filter(Boolean);
              for (const line of lines) {
                try {
                  const obj = JSON.parse(line);
                  if (level && String(obj.level).toLowerCase() !== level) continue;
                  if (module && String(obj.module).toLowerCase() !== module) continue;
                  enqueue(`data: ${JSON.stringify(obj)}\n\n`);
                } catch {
                  // ignore non-JSON lines
                }
              }
            }
            await fh.close();
          } catch {
            // ignore streaming errors
          }
        };

        // Bootstrap: send last 100 lines so the feed isn't empty on connect
        try {
          const historical = await readLastLogLines({ lines: 100, level, module });
          for (const obj of historical) {
            enqueue(`data: ${JSON.stringify(obj)}\n\n`);
          }
        } catch {
          // ignore — if log file missing, just start tailing
        }

        // Set pos to current end so the interval only picks up NEW entries
        try {
          const stat = await fs.stat(logPath);
          pos = stat.size;
        } catch {
          pos = 0;
        }

        tickInterval = setInterval(tick, 1000);

        // Keepalive: send SSE comment every 25s to prevent browser/proxy timeouts
        heartbeatInterval = setInterval(() => {
          enqueue(': keepalive\n\n');
        }, 25000);
      },
      cancel() {
        if (tickInterval !== null) clearInterval(tickInterval);
        if (heartbeatInterval !== null) clearInterval(heartbeatInterval);
      },
    });

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    return new Response(stream);
  });

  // GET /api/diagnose - diagnostic report
  app.get('/api/diagnose', async (c: Context) => {
    const envFilePath = path.join(process.cwd(), '.env');
    const envFile = await fs
      .access(envFilePath)
      .then(() => true)
      .catch(() => false);

    const tokenSet = !!config.ksef.token;
    const nipSet = !!config.ksef.nip;

    const checks: Record<
      string,
      { status: 'pass' | 'fail'; detail: string; suggestion?: string }
    > = {};

    checks.env = envFile
      ? { status: 'pass', detail: 'Found .env file' }
      : { status: 'fail', detail: 'Missing .env file', suggestion: 'Utwórz plik .env na bazie .env.example' };

    checks.config = tokenSet && nipSet
      ? { status: 'pass', detail: 'Token i NIP ustawione' }
      : {
          status: 'fail',
          detail: `Braki w konfiguracji: token=${tokenSet}, nip=${nipSet}`,
          suggestion: 'Uzupełnij KSEF_TOKEN i KSEF_NIP w .env',
        };

    // KSeF connectivity
    try {
      const t0 = Date.now();
      await axios.get(config.ksef.baseUrl, { timeout: 5000, validateStatus: () => true });
      const latency = Date.now() - t0;
      checks.ksef = { status: 'pass', detail: `Connectivity OK (${latency}ms)` };
    } catch (e: any) {
      checks.ksef = {
        status: 'fail',
        detail: `No connectivity: ${e?.code || e?.message || 'unknown'}`,
        suggestion: 'Sprawdź internet/VPN/DNS lub KSEF_BASE_URL',
      };
    }

    // Storage writable + index health
    try {
      await fs.mkdir(config.insert.outputDir, { recursive: true });
      await fs.access(config.insert.outputDir, fs.constants.W_OK as any);
      checks.storage = { status: 'pass', detail: 'Output dir writable' };
    } catch (e: any) {
      checks.storage = {
        status: 'fail',
        detail: `Output dir not writable: ${e?.code || e?.message || 'unknown'}`,
        suggestion: 'Sprawdź uprawnienia do folderu INSERT_OUTPUT_DIR',
      };
    }

    const indexPath = path.join(config.insert.outputDir, '.index.json');
    try {
      const raw = await fs.readFile(indexPath, 'utf-8');
      JSON.parse(raw);
      checks.index = { status: 'pass', detail: 'Index file readable and valid JSON' };
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        // No index yet — normal on a fresh install, will be created on first sync
        checks.index = { status: 'pass', detail: 'Index file not yet created (first run)' };
      } else {
        checks.index = {
          status: 'fail',
          detail: `Index file broken: ${e?.message || 'unknown'}`,
          suggestion: 'Usuń .index.json; aplikacja odtworzy go przy kolejnych zapisach',
        };
      }
    }

    // XSD schema — informational only, does not affect system health status
    const xsdPath = path.join(process.cwd(), 'FA(2).xsd');
    const xsdPresent = await fs.access(xsdPath).then(() => true).catch(() => false);
    checks.xsd = xsdPresent
      ? { status: 'pass', detail: 'XSD schema found' }
      : { status: 'fail', detail: 'XSD schema not found (validation skipped)', suggestion: 'Dodaj FA(2).xsd do katalogu projektu' };

    // Overall system health — xsd is informational only, excluded from core status
    const coreChecks = ['env', 'config', 'ksef', 'storage', 'index'] as const;
    const coreDegraded = coreChecks.some((k) => checks[k]?.status === 'fail');

    return c.json({
      status: coreDegraded ? 'degraded' : 'ok',
      environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
      outputDir: config.insert.outputDir,
      nip: config.ksef.nip ? maskNip(config.ksef.nip) : null,
      checks,
    });
  });

  // GET /api/status - Current status
  app.get('/api/status', async (c: Context) => {
    try {
      let totalInvoices = 0;

      try {
        const fileManager = await getSharedFileManager();
        const savedInvoices = await fileManager.listSaved();
        totalInvoices = savedInvoices?.length || 0;
      } catch (err) {
        serverLogger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Could not get invoice count');
        // Continue with totalInvoices = 0
      }

      const status = {
        connected: !!config.ksef.token,
        environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
        nip: config.ksef.nip ? maskNip(config.ksef.nip) : 'N/A',
        lastSync: new Date().toISOString(), // Would be from index in production
        totalInvoices,
        outputDir: config.insert.outputDir,
      };

      return c.json(status);
    } catch (error) {
      serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Status endpoint error');
      // Return minimal status
      return c.json(
        {
          connected: !!config.ksef.token,
          environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
          nip: config.ksef.nip ? maskNip(config.ksef.nip) : 'N/A',
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
          // Keep the SSE connection alive during long Retry-After waits (up to ~30 s
          // per the KSeF docs example, potentially more for hourly-limit violations).
          const heartbeatInterval = setInterval(() => {
            try { controller.enqueue(': keepalive\n\n'); } catch { /* stream closed */ }
          }, 15_000);

          try {
            const client = new KsefClient();
            const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });

            // Helper to send SSE message
            const sendProgress = (data: Record<string, unknown>) => {
              const message = `data: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(message);
              serverLogger.debug({ kind: 'sync-progress' }, 'SSE event sent');
            };

            // Initialize file manager
            await fileManager.initialize();

            // Authenticate
            sendProgress({ status: 'Autentykacja...' });

            const auth = createAuth(client);
            await auth.authenticate(config.ksef.nip!, config.ksef.token!);

            // Query invoices
            sendProgress({ status: 'Wyszukiwanie faktur...' });

            const subjectTypes: Array<'Subject1' | 'Subject2'> =
              type === 'sprzedaz' ? ['Subject1'] :
              type === 'zakup'    ? ['Subject2'] :
              /* wszystkie */       ['Subject1', 'Subject2'];

            // Set `to` to end of the selected day (23:59:59 UTC) so invoices
            // issued on the dateTo day are included in results
            const toDate = new Date(dateTo);
            toDate.setUTCHours(23, 59, 59, 999);

            const dateRange = {
              dateType: 'Invoicing' as const,
              from: new Date(dateFrom).toISOString(),
              to: toDate.toISOString(),
            };

            // KSeF limits: POST /invoices/query/metadata → 16 req/min (sliding window).
            // 60 000 ms / 16 = 3 750 ms minimum gap; we use 4 000 ms for a small safety margin.
            const QUERY_DELAY_MS = 4_000;
            // KSeF limits: GET /invoices/ksef/{ksefNumber} → 16 req/min, 64 req/h.
            // Per-minute constraint: 60 000 / 16 = 3 750 ms; we use 4 000 ms.
            // For batches > 64 the 64 req/h cap kicks in; the client's 429 retry
            // logic (with full Retry-After honour) handles that automatically.
            const INVOICE_DOWNLOAD_DELAY_MS = 4_000;
            const allInvoices: Array<{ data: Record<string, unknown>; folderType: 'sprzedaz' | 'zakup' }> = [];
            for (let qi = 0; qi < subjectTypes.length; qi++) {
              if (qi > 0) await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
              const subjectType = subjectTypes[qi];
              const folderType = subjectType === 'Subject1' ? 'sprzedaz' : 'zakup';
              let pageOffset = 0;
              const pageSize = 100;
              while (true) {
                const result = await client.queryInvoices({
                  pageSize,
                  pageOffset,
                  subjectType,
                  dateRange,
                });
                for (const inv of (result.invoices || []) as Array<Record<string, unknown>>) {
                  allInvoices.push({ data: inv, folderType });
                }
                if (!result.hasMore && !result.isTruncated) break;
                pageOffset += pageSize;
                await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
              }
            }
            const invoices = allInvoices;

            if (invoices.length === 0) {
              sendProgress({ status: 'Brak faktur w podanym zakresie dat.', downloaded: 0, skipped: 0, errors: 0, total: 0, failedInvoices: [], noResults: true });
              try { await client.terminateSession(); } catch { /* ignore */ }
              clearInterval(heartbeatInterval);
              controller.close();
              return;
            }

            // KSeF allows only 64 individual invoice downloads per hour (sliding window).
            // Warn the user early so they understand why a large batch takes a long time.
            if (invoices.length > 64) {
              sendProgress({
                status: `Uwaga: ${invoices.length} faktur do pobrania. Limit API KSeF wynosi 64 pobrania/godz. Proces może potrwać znacznie dłużej niż godzinę — aplikacja automatycznie oczekuje na zwolnienie limitu (Retry-After).`,
                warning: true,
                current: 0,
                total: invoices.length,
                percentage: 0,
              });
            }

            // Download and save invoices
            let downloaded = 0;
            let skipped = 0;
            let errors = 0;
            const failedInvoices: Array<{ ksefRef: string; error: string }> = [];

            for (let i = 0; i < invoices.length; i++) {
              const { data: invoice, folderType } = invoices[i];
              const ksefRef = (invoice.ksefNumber as string) || `invoice-${i}`;

              // Throttle to stay within the KSeF per-minute limit (16 req/min).
              // The delay is skipped for the very first invoice to avoid an
              // unnecessary wait before any work has been done.
              if (i > 0) {
                await new Promise((r) => setTimeout(r, INVOICE_DOWNLOAD_DELAY_MS));
              }

              try {
                // Get invoice content
                const invoiceData = await client.getInvoice(ksefRef);

                if (!invoiceData || !invoiceData.content) {
                  throw new Error('Empty invoice content');
                }

                // Use folderType from query context — KSeF invoice metadata does
                // not include subjectType, so we must derive it from the query
                const header = {
                  ksefReferenceNumber: ksefRef as string,
                  invoicingDate: (invoice.invoicingDate as string) || '',
                  issueDate: (invoice.issueDate as string) || '',
                  subjectType: folderType,
                  nip: ((invoice.seller as Record<string,unknown>)?.nip || (invoice.buyer as Record<string,unknown>)?.nip) as string,
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
                const errMsg = err instanceof Error ? err.message : String(err);
                serverLogger.error({ ksefRef, error: errMsg }, 'Error processing invoice');
                errors++;
                failedInvoices.push({ ksefRef, error: errMsg });
              }
            }

            // Cleanup session
            try {
              await client.terminateSession();
            } catch {
              // Ignore cleanup errors
            }

            // Send completion
            sendProgress({ downloaded, skipped, errors, total: invoices.length, failedInvoices });
            clearInterval(heartbeatInterval);
            controller.close();
          } catch (error) {
            serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Sync error');
            const message = `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`;
            controller.enqueue(message);
            clearInterval(heartbeatInterval);
            controller.close();
          }
        },
      });

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return new Response(stream);
    } catch (error) {
      serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Sync endpoint error');
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
      serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoices endpoint error');
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
      serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Download endpoint error');
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
      serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Validate endpoint error');
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
      serverLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Config endpoint error');
      return c.json({ error: 'Failed to get config' }, 500);
    }
  });
}
