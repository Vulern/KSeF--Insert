import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { createLogger, ksefLogger } from '../src/logger.js';
import { maskNip, maskToken } from '../src/utils/sanitize.js';
import { KSeFSyncError } from '../src/errors.js';
import { vi } from 'vitest';

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

describe('Logger + diagnostics basics', () => {
  it('logger creates child with correct module', () => {
    const bindings = (ksefLogger as any).bindings?.() || {};
    expect(bindings.module).toBe('ksef-client');
  });

  it('log file is created in LOG_DIR', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ksef-logs-'));
    const logger = createLogger({ console: false, file: true, logDir: tmpDir, maxFiles: 2, maxSize: '1m' });

    logger.info('test log line', { module: 'test' });

    // allow transport to flush
    await new Promise((r) => setTimeout(r, 1000));

    const files = await fs.readdir(tmpDir);
    expect(files.some((f) => f.includes('ksef-sync'))).toBe(true);
  });

  it('maskNip("5213000001") → "5213****01"', () => {
    expect(maskNip('5213000001')).toBe('5213****01');
  });

  it('maskToken("abc123def456") → "abc1...f456"', () => {
    expect(maskToken('abc123def456')).toBe('abc1...f456');
  });

  it('KSeFSyncError stores code + context + suggestion', () => {
    const err = new KSeFSyncError('boom', 'CONF_002', { key: 'value' }, 'fix it');
    expect(err.code).toBe('CONF_002');
    expect(err.context).toEqual({ key: 'value' });
    expect(err.suggestion).toBe('fix it');
  });

  it('Health check returns correct JSON structure', async () => {
    const { createApp } = await import('../src/server/app.js');
    const app = createApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('uptime');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('checks');
    expect(data.checks).toHaveProperty('ksef');
    expect(data.checks).toHaveProperty('storage');
    expect(data.checks).toHaveProperty('config');
  });

  it('Diagnose detects missing .env → status: fail', async () => {
    vi.resetModules();
    vi.doMock('fs/promises', async () => {
      const actual: any = await vi.importActual('fs/promises');
      return {
        ...actual,
        access: async (p: any) => {
          if (String(p).endsWith('.env')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          return actual.access(p);
        },
      };
    });

    const { createApp } = await import('../src/server/app.js');
    const app = createApp();
    const res = await app.request('/api/diagnose');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checks?.env?.status).toBe('fail');
  });

  it('Filters logs by level and module', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ksef-filter-'));
    const logDir = path.join(tmpDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    process.env.LOG_DIR = logDir;

    const logPath = path.join(logDir, `ksef-sync-${todayIsoDate()}.log`);
    const lines = [
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', module: 'ksef-client', msg: 'a' }),
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', module: 'ksef-client', msg: 'b' }),
      JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', module: 'web-server', msg: 'c' }),
    ].join('\n');
    await fs.writeFile(logPath, lines + '\n', 'utf-8');

    const { createApp } = await import('../src/server/app.js');
    const app = createApp();
    const res = await app.request('/api/logs?lines=100&level=error&module=ksef-client');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].msg).toBe('b');

    delete process.env.LOG_DIR;
  });
});

