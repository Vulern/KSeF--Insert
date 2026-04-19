/**
 * Server API Tests
 * Test REST endpoints for web UI
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';

describe('Server API Endpoints', () => {
  let app: any;

  beforeAll(() => {
    app = createApp();
  });

  describe('GET /api/status', () => {
    it('should return status with correct structure', async () => {
      const response = await app.request('/api/status');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('connected');
      expect(data).toHaveProperty('environment');
      expect(data).toHaveProperty('nip');
      expect(data).toHaveProperty('lastSync');
      expect(data).toHaveProperty('totalInvoices');
      expect(data).toHaveProperty('outputDir');
    });

    it('should have valid environment value', async () => {
      const response = await app.request('/api/status');
      const data = await response.json();

      expect(['test', 'production']).toContain(data.environment);
    });

    it('should have totalInvoices as number', async () => {
      const response = await app.request('/api/status');
      const data = await response.json();

      expect(typeof data.totalInvoices).toBe('number');
      expect(data.totalInvoices).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /api/config', () => {
    it('should return config without secrets', async () => {
      const response = await app.request('/api/config');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('environment');
      expect(data).toHaveProperty('nip');
      expect(data).toHaveProperty('outputDir');
      expect(data).toHaveProperty('baseUrl');
    });

    it('should mask NIP in config', async () => {
      const response = await app.request('/api/config');
      const data = await response.json();

      // NIP should be masked (5213****01 pattern)
      if (data.nip && data.nip !== 'N/A') {
        expect(data.nip).toMatch(/\*{4}/);
      }
    });

    it('should not return raw token', async () => {
      const response = await app.request('/api/config');
      const data = await response.json();
      const dataString = JSON.stringify(data);

      // Token should not be in config response
      expect(dataString).not.toContain('KSEF_TOKEN');
    });
  });

  describe('GET /api/invoices', () => {
    it('should return invoices with correct structure', async () => {
      const response = await app.request('/api/invoices');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('invoices');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.invoices)).toBe(true);
    });

    it('should accept month parameter', async () => {
      const response = await app.request('/api/invoices?month=2024-01');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data.invoices)).toBe(true);
    });

    it('should accept type parameter', async () => {
      const response = await app.request('/api/invoices?type=zakup');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data.invoices)).toBe(true);
    });

    it('should have correct invoice structure', async () => {
      const response = await app.request('/api/invoices');
      const data = await response.json();

      if (data.invoices.length > 0) {
        const invoice = data.invoices[0];
        expect(invoice).toHaveProperty('ksefRef');
        expect(invoice).toHaveProperty('date');
        expect(invoice).toHaveProperty('nip');
        expect(invoice).toHaveProperty('fileName');
        expect(invoice).toHaveProperty('filePath');
      }
    });

    it('should return empty array gracefully', async () => {
      const response = await app.request('/api/invoices?month=2099-01');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.invoices).toEqual([]);
      expect(data.total).toBe(0);
    });
  });

  describe('POST /api/validate', () => {
    it('should return validation result structure', async () => {
      const response = await app.request('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: '2024-01' }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('valid');
      expect(data).toHaveProperty('invalid');
      expect(data).toHaveProperty('errors');
      expect(Array.isArray(data.errors)).toBe(true);
    });

    it('should have valid counts', async () => {
      const response = await app.request('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: '2024-01' }),
      });

      const data = await response.json();

      expect(typeof data.total).toBe('number');
      expect(typeof data.valid).toBe('number');
      expect(typeof data.invalid).toBe('number');
      expect(data.valid + data.invalid).toEqual(data.total);
    });

    it('should handle missing month gracefully', async () => {
      const response = await app.request('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data.total).toBe('number');
    });
  });

  describe('GET /api/invoices/:ksefRef/download', () => {
    it('should return 400 when ksefRef is missing', async () => {
      const response = await app.request('/api/invoices//download');
      expect([400, 404]).toContain(response.status);
    });

    it('should return 404 for non-existent invoice', async () => {
      const response = await app.request('/api/invoices/nonexistent-ref/download');
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/sync', () => {
    it('should require dateFrom and dateTo', async () => {
      const response = await app.request('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'zakup' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should accept sync request with valid dates', async () => {
      const response = await app.request('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom: '2024-01-01',
          dateTo: '2024-01-31',
          type: 'zakup',
        }),
      });

      // Should return 200 for streaming response
      expect([200, 201]).toContain(response.status);
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await app.request('/api/unknown-endpoint');
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('Static Files', () => {
    it('should serve index.html at root', async () => {
      const response = await app.request('/');
      expect([200, 304]).toContain(response.status);

      // Should be HTML content
      const text = await response.text();
      expect(text.toLowerCase()).toContain('html');
    });

    it('should serve CSS files', async () => {
      const response = await app.request('/style.css');
      expect([200, 304]).toContain(response.status);
    });

    it('should serve JavaScript files', async () => {
      const response = await app.request('/app.js');
      expect([200, 304]).toContain(response.status);
    });
  });
});
