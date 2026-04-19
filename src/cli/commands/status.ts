/**
 * Status Command
 * Display synchronization status and statistics
 */

import { Command } from 'commander';
import { config } from '../../config.js';
import { InvoiceFileManager } from '../../storage/index.js';
import { emojis, printHeader, printInfo, formatDateTime } from '../formatter.js';

export function createStatusCommand(): Command {
  const command = new Command('status');
  command
    .description('Display synchronization status and statistics')
    .action(() => statusAction().catch(handleError));

  return command;
}

async function statusAction(): Promise<void> {
  printHeader(`${emojis.chart} Synchronization Status`);
  console.log();

  try {
    const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
    await fileManager.initialize();

    const stats = fileManager.getStats();
    const indexTracker = (fileManager as any).indexTracker;
    const index = indexTracker.getIndex() as any;

    printInfo(`Environment:       ${config.ksef.baseUrl.includes('test') ? 'TEST' : 'PRODUCTION'}`);
    printInfo(
      `Last sync:          ${
        index.lastSync ? formatDateTime(new Date(index.lastSync)) : 'Never'
      }`
    );
    printInfo(`Total invoices:     ${stats.total}`);
    printInfo(`Output directory:   ${config.insert.outputDir}`);
    console.log();

    if (index.invoices && Object.keys(index.invoices).length > 0) {
      printInfo('Recent invoices:');
      const recent = Object.entries(index.invoices)
        .sort((a, b) => {
          const dateA = new Date((a[1] as any).downloadedAt).getTime();
          const dateB = new Date((b[1] as any).downloadedAt).getTime();
          return dateB - dateA;
        })
        .slice(0, 5);

      recent.forEach(([ref, entry]) => {
        const typedEntry = entry as any;
        console.log(
          `  - ${typedEntry.invoiceDate} | NIP: ${typedEntry.nip} | ${ref.slice(0, 20)}...`
        );
      });
    }

    console.log();
  } catch (error) {
    throw error;
  }
}

function handleError(error: Error): void {
  console.error(`${emojis.error} Error:`, error.message);
  process.exit(1);
}
