/**
 * Server Startup
 * Starts Hono server and opens browser
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { logger } from '../logger.js';
import open from 'open';

const PORT = 3000;
const HOST = '127.0.0.1'; // Only listen on localhost for security

/**
 * Start the web server
 */
export async function startWebServer(): Promise<void> {
  try {
    const app = createApp();

    const server = serve(
      {
        fetch: app.fetch,
        port: PORT,
        hostname: HOST,
      },
      (info) => {
        const url = `http://localhost:${PORT}`;
        logger.info(`🧾 KSeF Sync UI uruchomiony: ${url}`);
        logger.info(`Naciśnij Ctrl+C aby zatrzymać serwer`);

        // Open browser
        open(url).catch((err) => {
          logger.warn(`Nie udało się otworzyć przeglądarki automatycznie: ${err.message}`);
          logger.info(`Otwórz ręcznie: ${url}`);
        });
      }
    );

    // Graceful shutdown
    const handleShutdown = async () => {
      logger.info('Zatrzymywanie serwera...');
      process.exit(0);
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  } catch (error) {
    logger.error('Błąd podczas uruchamiania serwera:', error);
    process.exit(1);
  }
}
