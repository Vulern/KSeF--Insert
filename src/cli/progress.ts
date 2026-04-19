/**
 * CLI Progress Tracking
 * Spinners, progress bars, and progress tracking
 */

import ora from 'ora';
import { colors, emojis, progressBar } from './formatter.js';

export class Progress {
  private spinner: ReturnType<typeof ora> | null = null;
  private current: number = 0;
  private total: number = 0;

  start(message: string): void {
    this.spinner = ora(message).start();
  }

  update(message: string): void {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }

  succeed(message?: string): void {
    if (this.spinner) {
      this.spinner.succeed(message || this.spinner.text);
      this.spinner = null;
    }
  }

  fail(message?: string): void {
    if (this.spinner) {
      this.spinner.fail(message || this.spinner.text);
      this.spinner = null;
    }
  }

  warn(message?: string): void {
    if (this.spinner) {
      this.spinner.warn(message || this.spinner.text);
      this.spinner = null;
    }
  }

  stop(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}

export class ProgressTracker {
  private current: number = 0;
  private total: number = 0;
  private prefix: string = '';

  setTotal(total: number): void {
    this.total = total;
    this.current = 0;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  increment(): void {
    this.current = Math.min(this.current + 1, this.total);
  }

  set(current: number): void {
    this.current = Math.min(current, this.total);
  }

  toString(): string {
    if (this.total === 0) return '';
    const bar = progressBar(this.current, this.total);
    const percent = Math.round((this.current / this.total) * 100);
    return `${this.prefix} ${bar} ${this.current}/${this.total} (${percent}%)`;
  }

  print(): void {
    console.log(this.toString());
  }
}

export function createSpinner(message: string): Progress {
  const spinner = new Progress();
  spinner.start(message);
  return spinner;
}
