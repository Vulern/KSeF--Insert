/**
 * CLI Output Formatting
 * Colors, emojis, and formatted output using chalk
 */

import chalk from 'chalk';

export const colors = {
  success: (text: string) => chalk.green(text),
  error: (text: string) => chalk.red(text),
  warning: (text: string) => chalk.yellow(text),
  info: (text: string) => chalk.blue(text),
  muted: (text: string) => chalk.gray(text),
  bold: (text: string) => chalk.bold(text),
  header: (text: string) => chalk.bold.cyan(text),
};

export const emojis = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  lock: '🔐',
  search: '🔍',
  list: '📋',
  download: '⬇️',
  folder: '📁',
  calendar: '📅',
  chart: '📊',
  arrow: '⏭️',
  check: '✓',
};

export const divider = (char = '─', length = 50) => chalk.gray(char.repeat(length));

export const printHeader = (title: string) => {
  console.log();
  console.log(colors.header(title));
  console.log(divider('─', title.length + 2));
};

export const printSuccess = (message: string) => {
  console.log(colors.success(`${emojis.success} ${message}`));
};

export const printError = (message: string) => {
  console.log(colors.error(`${emojis.error} ${message}`));
};

export const printWarning = (message: string) => {
  console.log(colors.warning(`${emojis.warning} ${message}`));
};

export const printInfo = (message: string) => {
  console.log(colors.info(`${emojis.info} ${message}`));
};

export const printMuted = (message: string) => {
  console.log(colors.muted(message));
};

export const printTable = (
  data: Array<Record<string, string | number>>,
  columns: string[]
) => {
  if (data.length === 0) {
    printMuted('  (brak danych)');
    return;
  }

  // Calculate column widths
  const widths: Record<string, number> = {};
  columns.forEach((col) => {
    widths[col] = Math.max(
      col.length,
      Math.max(...data.map((row) => String(row[col]).length))
    );
  });

  // Print header
  const header = columns.map((col) => col.padEnd(widths[col])).join(' | ');
  console.log(colors.bold(header));
  console.log(
    colors.muted(
      columns
        .map((col) => '─'.repeat(widths[col]))
        .join('─┼─')
    )
  );

  // Print rows
  data.forEach((row) => {
    const values = columns.map((col) => String(row[col]).padEnd(widths[col])).join(' | ');
    console.log(values);
  });
};

export const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export const formatDateTime = (date: Date): string => {
  return date.toISOString().replace('T', ' ').split('.')[0];
};

export const formatSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

export const formatPercent = (value: number, total: number): string => {
  const percent = Math.round((value / total) * 100);
  return `${percent}%`;
};

export const progressBar = (current: number, total: number, width = 20): string => {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
};
