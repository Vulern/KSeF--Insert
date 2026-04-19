/**
 * List Command
 * List downloaded invoices with optional filtering
 */

import { Command } from 'commander';
import { config } from '../../config.js';
import { InvoiceFileManager } from '../../storage/index.js';
import { emojis, printHeader, printInfo, printTable, printMuted } from '../formatter.js';

interface ListOptions {
  month?: string;
}

export function createListCommand(): Command {
  const command = new Command('list');
  command
    .description('List downloaded invoices')
    .option('--month <month>', 'Filter by month (YYYY-MM)')
    .action((options: ListOptions) => listAction(options).catch(handleError));

  return command;
}

async function listAction(options: ListOptions): Promise<void> {
  printHeader(`${emojis.list} Downloaded Invoices`);
  console.log();

  try {
    const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
    await fileManager.initialize();

    const indexTracker = (fileManager as any).indexTracker;
    const index = indexTracker.getIndex();

    if (!index.invoices || Object.keys(index.invoices).length === 0) {
      printMuted('No invoices downloaded yet');
      console.log();
      return;
    }

    let entries = Object.entries(index.invoices);

    // Filter by month if specified
    if (options.month) {
      if (!/^\d{4}-\d{2}$/.test(options.month)) {
        console.error(`${emojis.error} Invalid month format. Use YYYY-MM`);
        process.exit(1);
      }
      entries = entries.filter(([_, entry]) => (entry as any).invoiceDate.startsWith(options.month));
    }

    // Sort by date descending
    entries.sort((a, b) => {
      const dateA = new Date((a[1] as any).invoiceDate).getTime();
      const dateB = new Date((b[1] as any).invoiceDate).getTime();
      return dateB - dateA;
    });

    if (entries.length === 0) {
      printMuted(`No invoices found for ${options.month || 'the specified period'}`);
      console.log();
      return;
    }

    printInfo(`Found: ${entries.length} invoice${entries.length !== 1 ? 's' : ''}`);
    console.log();

    // Prepare table data
    const tableData = entries.map(([ref, entry]) => {
      const typedEntry = entry as any;
      return {
        'Date': typedEntry.invoiceDate,
        'NIP': typedEntry.nip,
        'KSeF Ref': ref.slice(0, 16) + '...',
        'Type': typedEntry.subjectType || 'unknown',
      };
    });

    printTable(tableData, ['Date', 'NIP', 'KSeF Ref', 'Type']);

    console.log();
    printMuted(`Total: ${entries.length} invoice${entries.length !== 1 ? 's' : ''}`);
    console.log();
  } catch (error) {
    throw error;
  }
}

function handleError(error: Error): void {
  console.error(`${emojis.error} Error:`, error.message);
  process.exit(1);
}
