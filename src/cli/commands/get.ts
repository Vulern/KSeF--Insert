/**
 * Get Command
 * Retrieve and display a specific invoice
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { config } from '../../config.js';
import { InvoiceFileManager } from '../../storage/index.js';
import { emojis, printHeader, printSuccess, printError, printInfo } from '../formatter.js';

interface GetOptions {
  ref: string;
}

export function createGetCommand(): Command {
  const command = new Command('get');
  command
    .description('Retrieve a specific invoice by KSeF reference')
    .requiredOption('--ref <reference>', 'KSeF reference number')
    .action((options: GetOptions) => getAction(options).catch(handleError));

  return command;
}

async function getAction(options: GetOptions): Promise<void> {
  printHeader(`${emojis.download} Retrieve Invoice`);
  console.log();

  try {
    const fileManager = new InvoiceFileManager({ outputDir: config.insert.outputDir });
    await fileManager.initialize();

    const indexTracker = (fileManager as any).indexTracker;
    const index = indexTracker.getIndex();

    if (!index.invoices?.[options.ref]) {
      printError(`Invoice not found: ${options.ref}`);
      process.exit(1);
    }

    const entry = index.invoices[options.ref];
    printSuccess(`Invoice found: ${entry.invoiceDate}`);
    console.log();

    printInfo(`KSeF Reference:  ${options.ref}`);
    printInfo(`Invoice Date:    ${entry.invoiceDate}`);
    printInfo(`NIP:             ${entry.nip}`);
    printInfo(`Type:            ${entry.subjectType || 'unknown'}`);
    printInfo(`Downloaded:      ${new Date(entry.downloadedAt).toLocaleString()}`);
    printInfo(`File:            ${entry.filePath}`);
    console.log();

    // Try to read and display file preview
    try {
      const fullPath = resolve(entry.filePath);
      const content = await readFile(fullPath, 'utf-8');
      const lines = content.split('\n').slice(0, 10);

      printInfo('File preview (first 10 lines):');
      console.log();
      lines.forEach((line) => console.log(`  ${line}`));
      if (content.split('\n').length > 10) {
        console.log(`  ... (${content.split('\n').length - 10} more lines)`);
      }
      console.log();
    } catch (readError) {
      printError(`Could not read file: ${(readError as Error).message}`);
    }
  } catch (error) {
    throw error;
  }
}

function handleError(error: Error): void {
  console.error(`${emojis.error} Error:`, error.message);
  process.exit(1);
}
