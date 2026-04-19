/**
 * Hono Server Application
 * Web UI server for KSeF Sync
 */

import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFile } from 'fs/promises';
import { setupApiRoutes } from './api.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create and configure Hono app
 */
export function createApp(): Hono {
  const app = new Hono();

  // Serve static files from src/ui
  const uiPath = resolve(dirname(__dirname), 'ui');

  // Serve index.html at root
  app.get('/', async (c) => {
    try {
      const html = await readFile(resolve(uiPath, 'index.html'), 'utf-8');
      return c.html(html);
    } catch (error) {
      logger.error('Error serving index.html:', error);
      return c.text('Not Found', 404);
    }
  });

  // Serve other static files (CSS, JS)
  app.get('/:filename', async (c) => {
    const filename = c.req.param('filename');

    // Only serve known static files
    if (!/\.(css|js|jpg|png|svg|ico)$/.test(filename)) {
      // Not a static file, continue to API routes
      return undefined;
    }

    try {
      const filePath = resolve(uiPath, filename);
      const content = await readFile(filePath, 'utf-8');

      const contentTypes: Record<string, string> = {
        css: 'text/css',
        js: 'application/javascript',
        jpg: 'image/jpeg',
        png: 'image/png',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
      };

      const ext = filename.split('.').pop() || 'js';
      c.header('Content-Type', contentTypes[ext] || 'text/plain');

      return c.text(content);
    } catch (error) {
      logger.warn(`Static file not found: ${filename}`);
      return c.text('Not Found', 404);
    }
  });

  // Setup API routes
  setupApiRoutes(app);

  // 404 handler
  app.notFound((c) => {
    logger.warn(`404 Not Found: ${c.req.path}`);
    return c.json({ error: 'Not Found' }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    logger.error('Request error:', err);
    return c.json({ error: 'Internal Server Error', message: err.message }, 500);
  });

  return app;
}
