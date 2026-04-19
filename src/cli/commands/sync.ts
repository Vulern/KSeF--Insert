/**
 * Sync Command
 * Main command to download invoices from KSeF and save to disk
 */

import { Command } from 'commander';
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import { InvoiceFileManager } from '../../storage/index.js';
import { createAuth } from '../../ksef/auth.js';
import { ksefClient } from '../../ksef/client.js';
import { KsefValidationError, KsefAuthError, KsefConnectionError } from '../../errors.js';
import {
  colors,
  emojis,
  divider,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from '../formatter.js';
import { Progress, ProgressTracker } from '../progress.js';

interface SyncOptions {
  from: string;
  to: string;
  type?: string;
  force?: boolean;
}

export function createSyncCommand(): Command {
  const command = new Command('sync');
  command
    .description('Synchronize invoices from KSeF and save to disk')
    .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
    .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
    .option('--type <type>', 'Invoice type: zakup (default), sprzedaz, or wszystkie', 'zakup')
    .option('--force', 'Override duplicate detection and re-download')
    .action((options: SyncOptions) => syncAction(options).catch(handleError));

  return command;
}

async function syncAction(options: SyncOptions): Promise<void> {
  printHeader(`${emojis.download} KSeF Synchronization`);

  // Validate options
  const startDate = validateDate(options.from, 'from');
  const endDate = validateDate(options.to, 'to');

  if (startDate > endDate) {
    printError('Start date cannot be after end date');
    process.exit(1);
  }

  const invoiceType = validateInvoiceType(options.type || 'zakup');
  const force = options.force || false;

  // Show options
  console.log();
  printInfo(`Environment: ${config.ksef.baseUrl.includes('test') ? 'TEST' : 'PRODUCTION'}`);
  printInfo(`Date range: ${options.from} → ${options.to}`);
  printInfo(`Invoice type: ${invoiceType}`);
  if (force) {
    printWarning(`Force mode: Duplicates will be re-downloaded`);
  }
  console.log();

  let sessionId: string | null = null;
  let totalQueried = 0;
  let totalDownloaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const errors: Array<{ invoiceId: string; error: string }> = [];

  try {
    // Initialize file manager
    const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
    await fileManager.initialize();

    // Connect to KSeF
    const connectSpinner = new Progress();
    connectSpinner.start(`${emojis.lock} Connecting to KSeF...`);

    try {
      const auth = createAuth(ksefClient);
      const session = await auth.authenticate(config.ksef.nip!, config.ksef.token!);
      sessionId = session.referenceNumber;
      connectSpinner.succeed(`Connected (Session ID: ${sessionId.slice(0, 8)}...)`);
    } catch (error) {
      connectSpinner.fail('Connection failed');
      if (error instanceof KsefAuthError) {
        printError('Authentication failed. Check KSEF_TOKEN and KSEF_NIP in .env');
      } else if (error instanceof KsefConnectionError) {
        printError('Network error. Check KSEF_BASE_URL in .env');
      } else {
        printError((error as Error).message);
      }
      throw error;
    }

    // Query invoices
    console.log();
    const querySpinner = new Progress();
    querySpinner.start(`${emojis.search} Searching for invoices...`);

    const invoices: any[] = [];
    try {
      // Simple query for now - in production would paginate
      const queryParams: any = {
        pageSize: 100,
        pageNumber: 1,
      };

      // Add date filters if available
      if (startDate) queryParams.fromDate = startDate.toISOString().split('T')[0];
      if (endDate) queryParams.toDate = endDate.toISOString().split('T')[0];

      // Add invoice type filter
      if (invoiceType === 'zakup') {
        queryParams.subjectType = 'subject_type.buyer';
      } else if (invoiceType === 'sprzedaz') {
        queryParams.subjectType = 'subject_type.seller';
      }
      // If 'wszystkie', don't filter by type

      // Query invoices
      const result = await ksefClient.queryInvoices(queryParams);
      if (result.invoiceHeaderList) {
        invoices.push(...result.invoiceHeaderList);
      }
      totalQueried = invoices.length;
      querySpinner.succeed(
        `Found ${totalQueried} invoice${totalQueried !== 1 ? 's' : ''}`
      );
    } catch (error) {
      querySpinner.fail('Query failed');
      throw error;
    }

    if (totalQueried === 0) {
      console.log();
      printWarning('No invoices found in the specified date range');
      return;
    }

    // Check for duplicates
    console.log();
    let invoicesToDownload = invoices;
    if (!force) {
      invoicesToDownload = invoices.filter((inv) => {
        const isDuplicate = fileManager['indexTracker'].isAlreadyDownloaded(inv.ksefReferenceNumber);
        if (isDuplicate) {
          totalSkipped++;
        }
        return !isDuplicate;
      });
    }

    printInfo(
      `${emojis.list} Found: ${colors.bold(String(totalQueried))} invoices (${colors.bold(
        String(invoicesToDownload.length)
      )} new${totalSkipped > 0 ? `, ${colors.warning(String(totalSkipped))} already downloaded` : ''})`
    );

    if (invoicesToDownload.length === 0) {
      console.log();
      printSuccess('All invoices already downloaded');
      return;
    }

    // Download invoices
    console.log();
    const tracker = new ProgressTracker();
    tracker.setTotal(invoicesToDownload.length);
    tracker.setPrefix(`${emojis.download} Downloading:`);

    const downloadSpinner = new Progress();
    downloadSpinner.start(tracker.toString());

    for (const invoice of invoicesToDownload) {
      try {
        // Get invoice XML as string
        const invoiceData = await ksefClient.getInvoice(invoice.ksefReferenceNumber);

        if (!invoiceData || !invoiceData.content) {
          throw new Error('Empty XML response');
        }

        // Save to disk
        const saveResult = await fileManager.saveInvoice({
          xml: invoiceData.content,
          header: invoice,
        });

        if (!saveResult.alreadyExisted) {
          totalDownloaded++;
        } else {
          totalSkipped++;
        }
      } catch (error) {
        totalErrors++;
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push({ invoiceId: invoice.ksefReferenceNumber, error: errorMsg });
      }

      tracker.increment();
      downloadSpinner.update(tracker.toString());
    }

    downloadSpinner.succeed(`Download complete: ${totalDownloaded} invoices saved`);

    // Terminate session
    if (sessionId != null) {
      const terminateSpinner = new Progress();
      terminateSpinner.start('Terminating KSeF session...');
      try {
        await ksefClient.terminateSession();
        terminateSpinner.succeed('Session terminated');
      } catch (error) {
        terminateSpinner.warn('Could not terminate session gracefully');
      }
    }

    // Print summary
    console.log();
    printHeader('✅ Synchronization Complete');
    console.log();
    console.log(colors.bold('Summary:'));
    console.log(`  ${emojis.calendar} Date range:      ${options.from} — ${options.to}`);
    console.log(`  ${emojis.list} Type:            ${invoiceType}`);
    console.log(`  ${emojis.download} Downloaded:      ${colors.success(String(totalDownloaded))} new invoices`);
    if (totalSkipped > 0) {
      console.log(`  ${emojis.arrow} Skipped:         ${colors.muted(String(totalSkipped))} already downloaded`);
    }
    if (totalErrors > 0) {
      console.log(`  ${emojis.error} Errors:          ${colors.error(String(totalErrors))} failed`);
      if (errors.length > 0 && errors.length <= 5) {
        console.log();
        console.log(colors.bold('Failed invoices:'));
        errors.forEach((err) => {
          console.log(`    - ${err.invoiceId}: ${err.error}`);
        });
      }
    }
    console.log(`  ${emojis.folder} Saved to:        ${colors.muted(config.insert.outputDir)}`);
    console.log();
  } catch (error) {
    if (sessionId) {
      try {
        await ksefClient.terminateSession();
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

function validateDate(dateStr: string, label: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    printError(`Invalid ${label} date format. Use YYYY-MM-DD`);
    process.exit(1);
  }
  return date;
}

function validateInvoiceType(type: string): 'zakup' | 'sprzedaz' | 'wszystkie' {
  const validTypes = ['zakup', 'sprzedaz', 'wszystkie'];
  if (!validTypes.includes(type)) {
    printError(
      `Invalid invoice type. Use: ${validTypes.join(', ')}`
    );
    process.exit(1);
  }
  return type as 'zakup' | 'sprzedaz' | 'wszystkie';
}

function handleError(error: Error): void {
  if (error instanceof KsefValidationError) {
    printError(`Validation error: ${error.message}`);
  } else if (error instanceof KsefAuthError) {
    printError(`Auth error: ${error.message}`);
  } else if (error instanceof KsefConnectionError) {
    printError(`Connection error: ${error.message}`);
  } else {
    printError(`Error: ${error.message}`);
  }
  logger.error('Sync command failed', error);
  process.exit(1);
}
