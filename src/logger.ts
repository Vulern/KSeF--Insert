/**
 * Logger utilities (wrapper around console or pino)
 */

export interface ILogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: unknown): void;
}

class ConsoleLogger implements ILogger {
  private level: string;

  constructor(level: string = 'info') {
    this.level = level;
  }

  debug(message: string, data?: unknown): void {
    if (['debug'].includes(this.level)) {
      console.log(`[DEBUG] ${message}`, data || '');
    }
  }

  info(message: string, data?: unknown): void {
    if (['debug', 'info'].includes(this.level)) {
      console.log(`[INFO] ${message}`, data || '');
    }
  }

  warn(message: string, data?: unknown): void {
    if (['debug', 'info', 'warn'].includes(this.level)) {
      console.warn(`[WARN] ${message}`, data || '');
    }
  }

  error(message: string, error?: unknown): void {
    console.error(`[ERROR] ${message}`, error || '');
  }
}

export const createLogger = (level?: string): ILogger => {
  // TODO: Implement pino logger when needed
  return new ConsoleLogger(level);
};

export const logger = createLogger(process.env.LOG_LEVEL || 'info');
