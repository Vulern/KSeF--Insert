/**
 * Main entry point / CLI
 */

import { logger } from './logger.js';
import { config } from './config.js';
import { ksefClient, KsefClient, KsefAuth, createAuth } from './ksef/index.js';

const main = async (): Promise<void> => {
  logger.info('Starting KSeF-Insert Integration');
  logger.info(`Config loaded:`, {
    ksefBaseUrl: config.ksef.baseUrl,
    insertOutputDir: config.insert.outputDir,
  });

  // TODO: Implement main CLI logic
  // - Parse command line arguments
  // - Handle subcommands (sync, export, auth, etc.)
  // - Orchestrate the workflow
  //
  // Example usage:
  // const auth = createAuth(ksefClient);
  // const sessionInfo = await auth.authenticate(config.ksef.nip!, config.ksef.token!);
  // const invoices = await ksefClient.queryInvoices({ pageSize: 100 });
};

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});

export { ksefClient, KsefClient, KsefAuth, createAuth };
export * from './errors.js';
export * from './config.js';
