/**
 * Main entry point / CLI
 * Orchestrates KSeF-Insert integration with full CLI support
 */

import { Command } from 'commander';
import { logger } from './logger.js';
import { config } from './config.js';
import { ksefClient, KsefClient, KsefAuth, createAuth } from './ksef/index.js';
import { InvoiceFileManager } from './storage/index.js';
import { setupCli } from './cli/index.js';
import { printHeader, printError, emojis } from './cli/formatter.js';

const main = async (): Promise<void> => {
  try {
    // Initialize CLI
    const program = new Command();
    program
      .name('ksef-sync')
      .description('KSeF Invoice Synchronization Tool')
      .version('0.1.0');

    // Set up all CLI commands
    setupCli(program);

    // If no args, show help
    if (process.argv.length <= 2) {
      program.help();
      process.exit(0);
    }

    // Parse command line arguments
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Fatal error', error);
    console.error(`${emojis.error} ${message}`);
    process.exit(1);
  }
};

// Run CLI
main().catch((error) => {
  logger.error('Startup error', error);
  process.exit(1);
});

// Exports for library use
export { ksefClient, KsefClient, KsefAuth, createAuth };
export * from './errors.js';
export * from './config.js';
