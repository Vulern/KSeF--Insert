/**
 * Logger (Pino)
 * - Console: human-friendly (pretty), short, colored
 * - File: JSON Lines for maintenance (rolled daily + size limit)
 */

import pino, { type Logger, type LoggerOptions, multistream } from 'pino';
import path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AppLogger = Logger;

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function envString(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function envLogLevel(name: string, fallback: LogLevel): LogLevel {
  const raw = (process.env[name] ?? fallback).toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return fallback;
}

export type CreateLoggerOptions = {
  level?: LogLevel;
  console?: boolean;
  file?: boolean;
  logDir?: string;
  maxSize?: string; // e.g. "10m"
  maxFiles?: number; // number of rolled files to keep (+1 active)
};

function getTodayIsoDate(): string {
  // YYYY-MM-DD in local time
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function createConsoleTransport(): any {
  return pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      // NOTE: options passed to pino.transport must be structured-cloneable (no functions)
      messageFormat: '{levelLabel} [{module}] {msg}',
    },
  });
}

function createFileTransport(params: {
  logDir: string;
  maxSize: string;
  maxFiles: number;
}): any {
  const { logDir, maxSize, maxFiles } = params;
  const file = path.join(logDir, `ksef-sync-${getTodayIsoDate()}.log`);

  return pino.transport({
    target: 'pino-roll',
    options: {
      file,
      mkdir: true,
      frequency: 'daily',
      size: maxSize,
      limit: { count: maxFiles },
      // Keep JSONL as-is (no pretty)
    },
  });
}

export function createLogger(opts: CreateLoggerOptions = {}): AppLogger {
  const level = opts.level ?? envLogLevel('LOG_LEVEL', 'info');
  const consoleEnabled = opts.console ?? envBool('LOG_CONSOLE', true);
  const fileEnabled = opts.file ?? envBool('LOG_FILE', true);

  const logDir = opts.logDir ?? envString('LOG_DIR', './logs');
  const maxSize = opts.maxSize ?? envString('LOG_MAX_SIZE', '10m');
  const maxFiles = opts.maxFiles ?? Number(envString('LOG_MAX_FILES', '30'));

  const streams: Array<{ level?: LogLevel; stream: any }> = [];

  if (consoleEnabled) {
    streams.push({ stream: createConsoleTransport() });
  }
  if (fileEnabled) {
    streams.push({
      stream: createFileTransport({
        logDir,
        maxSize,
        maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : 30,
      }),
    });
  }

  const loggerOptions: LoggerOptions = {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // If no outputs enabled, avoid crashing: fallback to console pretty
  const destination = streams.length > 0 ? multistream(streams) : multistream([{ stream: createConsoleTransport() }]);

  return pino(loggerOptions, destination);
}

export const logger = createLogger();

// Child loggers per module
export const ksefLogger = logger.child({ module: 'ksef-client' });
export const storageLogger = logger.child({ module: 'file-manager' });
export const serverLogger = logger.child({ module: 'web-server' });
export const validatorLogger = logger.child({ module: 'xml-validator' });
