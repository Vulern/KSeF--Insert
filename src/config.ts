/**
 * Configuration from environment variables
 * Validated using Zod
 */

import { z } from 'zod';
import { ConfigError } from './errors.js';

const configSchema = z.object({
  ksef: z.object({
    baseUrl: z.string().url(),
    token: z.string().optional(),
    nip: z.string().optional(),
  }),
  insert: z.object({
    outputDir: z.string(),
    csvDelimiter: z.string(),
    csvEncoding: z.enum(['win1250', 'utf8']),
  }),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

type Config = z.infer<typeof configSchema>;

export const loadConfig = (): Config => {
  try {
    const config = {
      ksef: {
        baseUrl: process.env.KSEF_BASE_URL || 'https://ksef-test.mf.gov.pl/api',
        token: process.env.KSEF_TOKEN,
        nip: process.env.KSEF_NIP,
      },
      insert: {
        outputDir: process.env.INSERT_OUTPUT_DIR || './output',
        csvDelimiter: process.env.INSERT_CSV_DELIMITER || ';',
        csvEncoding: (process.env.INSERT_CSV_ENCODING || 'win1250') as 'win1250' | 'utf8',
      },
      logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
    };

    return configSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ConfigError(`Invalid configuration: ${error.message}`);
    }
    throw error;
  }
};

export const config = loadConfig();
