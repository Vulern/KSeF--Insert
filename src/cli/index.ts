/**
 * CLI Main Entry Point
 * Orchestrates all CLI commands and handles graceful shutdown
 */

import { Command } from 'commander';
import { createSyncCommand } from './commands/sync.js';
import { createStatusCommand } from './commands/status.js';
import { createListCommand } from './commands/list.js';
import { createGetCommand } from './commands/get.js';
import { createValidateCommand } from './commands/validate.js';
import { logger } from '../logger.js';
import { ksefClient } from '../ksef/client.js';
import { printError, emojis } from './formatter.js';

let sessionActive = false;

export function setupCli(program: Command): void {
  // Add all commands
  program.addCommand(createSyncCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createListCommand());
  program.addCommand(createGetCommand());
  program.addCommand(createValidateCommand());

  // Set up graceful shutdown
  setupGracefulShutdown();

  // Error handling
  program.exitOverride((err: any) => {
    if (err.code !== 'executeSubcommand') {
      logger.error('CLI error', err);
      process.exit(1);
    }
  });
}

export function markSessionActive(active: boolean = true): void {
  sessionActive = active;
}

function setupGracefulShutdown(): void {
  const signals = ['SIGINT', 'SIGTERM'];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      console.log();
      console.log(`${emojis.warning} Received ${signal}. Shutting down gracefully...`);

      try {
        if (sessionActive) {
          console.log(`${emojis.lock} Terminating KSeF session...`);
          try {
            await ksefClient.terminateSession();
            console.log(`${emojis.success} Session terminated`);
          } catch (error) {
            console.log(`${emojis.warning} Could not terminate session`);
          }
        }

        console.log(`${emojis.success} Shutdown complete`);
        process.exit(0);
      } catch (error) {
        logger.error('Graceful shutdown failed', error);
        process.exit(1);
      }
    });
  });
}
