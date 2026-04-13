/**
 * Main entry point / CLI
 */

import { logger } from './logger.js';
import { config } from './config.js';

const main = async (): Promise<void> => {
  logger.info('Starting KSeF-Insert Integration');
  logger.info(`Config loaded:`, {
    ksefBaseUrl: config.ksef.baseUrl,
    insertOutputDir: config.insert.outputDir,
  });

  // TODO: Implement main CLI logic
  // - Parse command line arguments
  // - Handle subcommands (sync, export, etc.)
  // - Orchestrate the workflow
};

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
