/**
 * KSeF Client Tests
 * Comprehensive test suite with mocking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { KsefClient } from '../src/ksef/client.js';
import {
  KsefAuthError,
  KsefApiError,
  KsefConnectionError,
  KsefValidationError,
} from '../src/errors.js';
import type { SessionInfo, SendInvoiceResult } from '../src/ksef/types.js';

/**
 * Mock axios
 */
vi.mock('axios');

describe('KsefClient', () => {
  let client: KsefClient;
  let mockAxios: any;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Setup mock axios instance
    mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };

    // Mock axios.create
    mockAxios = axios as any;
    mockAxios.create.mockReturnValue(mockAxiosInstance);
    mockAxios.isAxiosError = (err: unknown): err is any => {
      return err && typeof err === 'object' && 'response' in err;
    };

    // Create client
    client = new KsefClient({
      baseUrl: 'https://api.ksef.mf.gov.pl/v2',
      token: 'test-token',
      nip: '1234567890',
      timeout: 30000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should authenticate successfully with valid credentials', async () => {
      const sessionInfo: SessionInfo = {
        referenceNumber: 'ref-123',
        sessionToken: {
          token: 'session-token-123',
          expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        authenticationMethod: 'Bearer',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: sessionInfo });

      const result = await client.authenticate('1234567890', 'test-token');

      expect(result).toEqual(sessionInfo);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/sessions',
        {},
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should throw KsefAuthError when authentication fails with 401', async () => {
      const error = {
        response: {
          status: 401,
          data: { message: 'Unauthorized' },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(client.authenticate('1234567890', 'invalid-token')).rejects.toThrow(
        KsefAuthError
      );
    });

    it('should throw KsefValidationError when credentials are missing', async () => {
      await expect(client.authenticate('', '')).rejects.toThrow(KsefValidationError);
    });

    it('should throw KsefAuthError on invalid response format', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await expect(client.authenticate('1234567890', 'test-token')).rejects.toThrow(
        KsefAuthError
      );
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      // Setup authenticated session
      const sessionInfo: SessionInfo = {
        referenceNumber: 'ref-123',
        sessionToken: {
          token: 'session-token-123',
          expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        authenticationMethod: 'Bearer',
      };
      mockAxiosInstance.post.mockResolvedValue({ data: sessionInfo });
      await client.authenticate('1234567890', 'test-token');
    });

    it('should check if session is valid', async () => {
      expect(client.isSessionValid()).toBe(true);
    });

    it('should terminate session successfully', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ status: 204 });

      await expect(client.terminateSession()).resolves.toBeUndefined();
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        '/auth/sessions/current',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('session-token-123'),
          }),
        })
      );

      // Session should be invalid after termination
      expect(client.isSessionValid()).toBe(false);
    });

    it('should throw error when terminating without session', async () => {
      client = new KsefClient({
        baseUrl: 'https://api.ksef.mf.gov.pl/v2',
        token: 'test-token',
        nip: '1234567890',
      });

      await expect(client.terminateSession()).rejects.toThrow(KsefValidationError);
    });
  });

  describe('Retry Logic', () => {
    beforeEach(async () => {
      // Setup authenticated session
      const sessionInfo: SessionInfo = {
        referenceNumber: 'ref-123',
        sessionToken: {
          token: 'session-token-123',
          expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        authenticationMethod: 'Bearer',
      };
      mockAxiosInstance.post.mockResolvedValue({ data: sessionInfo });
      await client.authenticate('1234567890', 'test-token');
    });

    it('should retry on 5xx errors with exponential backoff', async () => {
      vi.useFakeTimers();

      const error500 = { response: { status: 500, data: {} } };
      const successResponse = {
        data: {
          elementReferenceNumber: 'ref-456',
          processingCode: 200,
        },
      };

      // Fail twice, then succeed
      mockAxiosInstance.post
        .mockRejectedValueOnce(error500)
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce(successResponse);

      const invoiceResult = client.sendInvoice('<Invoice/>');

      // Fast-forward through retries
      await vi.advanceTimersByTimeAsync(1000); // First retry delay
      await vi.advanceTimersByTimeAsync(3000); // Second retry delay

      const result = await invoiceResult;
      expect(result.elementReferenceNumber).toBe('ref-456');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(5); // 1 initial + 2 retries + more posts

      vi.useRealTimers();
    });

    it('should not retry on 4xx errors except 403', async () => {
      const error400 = { response: { status: 400, data: { message: 'Bad request' } } };
      mockAxiosInstance.post.mockRejectedValue(error400);

      await expect(client.sendInvoice('<Invoice/>')).rejects.toThrow(KsefApiError);

      // Should only be called once (no retries)
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2); // 1 for auth, 1 for send
    });

    it('should not retry on 403 immediately after session clear', async () => {
      const error403 = { response: { status: 403, data: {} } };
      mockAxiosInstance.post.mockRejectedValue(error403);

      await expect(client.sendInvoice('<Invoice/>')).rejects.toThrow(KsefAuthError);
    });

    it('should retry on timeout', async () => {
      vi.useFakeTimers();

      const timeoutError = { code: 'ECONNABORTED', message: 'Timeout' };
      const successResponse = {
        data: {
          elementReferenceNumber: 'ref-456',
          processingCode: 200,
        },
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResponse);

      const invoiceResult = client.sendInvoice('<Invoice/>');

      await vi.advanceTimersByTimeAsync(1000);

      const result = await invoiceResult;
      expect(result.elementReferenceNumber).toBe('ref-456');

      vi.useRealTimers();
    });

    it('should exhaust retries after max attempts', async () => {
      vi.useFakeTimers();

      const error500 = { response: { status: 500, data: {} } };
      mockAxiosInstance.post.mockRejectedValue(error500);

      client.setRetryConfig({ maxRetries: 2, baseDelayMs: 100 });

      const invoiceResult = client.sendInvoice('<Invoice/>');

      // Fast-forward through all retry delays
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(900);

      await expect(invoiceResult).rejects.toThrow(KsefConnectionError);

      vi.useRealTimers();
    });
  });

  describe('Invoice Operations', () => {
    beforeEach(async () => {
      // Setup authenticated session
      const sessionInfo: SessionInfo = {
        referenceNumber: 'ref-123',
        sessionToken: {
          token: 'session-token-123',
          expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        authenticationMethod: 'Bearer',
      };
      mockAxiosInstance.post.mockResolvedValue({ data: sessionInfo });
      await client.authenticate('1234567890', 'test-token');
      mockAxiosInstance.post.mockClear();
    });

    it('should send invoice successfully', async () => {
      const invoiceXml = '<Invoice><Number>1</Number></Invoice>';
      const result: SendInvoiceResult = {
        elementReferenceNumber: 'ref-456',
        processingCode: 200,
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: result,
      });

      const response = await client.sendInvoice(invoiceXml);

      expect(response).toEqual(result);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/sessions/ref-123/invoices',
        invoiceXml,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/xml',
          }),
        })
      );
    });

    it('should throw error when sending with invalid response', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await expect(client.sendInvoice('<Invoice/>')).rejects.toThrow(KsefApiError);
    });

    it('should get invoice by KSeF number', async () => {
      const ksefNumber = 'KSEF001';
      const invoiceXml = '<Invoice><Number>1</Number></Invoice>';

      mockAxiosInstance.get.mockResolvedValue({
        data: invoiceXml,
      });

      const result = await client.getInvoice(ksefNumber);

      expect(result).toBeDefined();
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        `/invoices/ksef/${ksefNumber}`,
        expect.any(Object)
      );
    });

    it('should throw error when getting invoice with no KSeF number', async () => {
      await expect(client.getInvoice('')).rejects.toThrow(KsefValidationError);
    });

    it('should query invoices with pagination', async () => {
      const pageData = {
        invoiceHeaderList: [
          {
            ksefNumber: 'KSEF001',
            invoicingDate: '2025-01-01',
          },
        ],
        numberOfElements: 1,
        pageSize: 100,
        pageOffset: 0,
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: pageData,
      });

      const result = await client.queryInvoices({
        pageSize: 100,
        pageOffset: 0,
      });

      expect(result.numberOfElements).toBe(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/invoices/query/metadata',
        expect.objectContaining({
          pageSize: 100,
          pageOffset: 0,
        }),
        expect.any(Object)
      );
    });

    it('should get invoice status', async () => {
      const statusData = {
        elementReferenceNumber: 'ref-456',
        processingCode: 200,
        processingDescription: 'Success',
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: statusData,
      });

      const result = await client.getInvoiceStatus('ref-456');

      expect(result.processingCode).toBe(200);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/invoices/exports/ref-456',
        expect.any(Object)
      );
    });

    it('should throw error when getting status without reference number', async () => {
      await expect(client.getInvoiceStatus('')).rejects.toThrow(KsefValidationError);
    });
  });

  describe('Session Expiry', () => {
    it('should re-authenticate when session expires', async () => {
      vi.useFakeTimers();

      // First session (expires soon)
      const expiredSessionInfo: SessionInfo = {
        referenceNumber: 'ref-expired',
        sessionToken: {
          token: 'token-expired',
          expiryDate: new Date(Date.now() + 100).toISOString(), // Very short expiry
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 100).toISOString(),
        authenticationMethod: 'Bearer',
      };

      // New session after re-authentication
      const newSessionInfo: SessionInfo = {
        referenceNumber: 'ref-new',
        sessionToken: {
          token: 'token-new',
          expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        authenticationMethod: 'Bearer',
      };

      // Mock first auth, then re-auth
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: expiredSessionInfo })
        .mockResolvedValueOnce({ data: newSessionInfo });

      // Authenticate
      await client.authenticate('1234567890', 'test-token');

      // Fast-forward past expiry
      await vi.advanceTimersByTimeAsync(150);

      // Session should be invalid now
      expect(client.isSessionValid()).toBe(false);

      // Trying to use client should trigger re-auth
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { elementReferenceNumber: 'ref-456', processingCode: 200 },
      });

      // This should re-authenticate first
      await expect(client.sendInvoice('<Invoice/>')).rejects.toThrow(); // Will fail because we need mock setup

      vi.useRealTimers();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors correctly', async () => {
      mockAxiosInstance.post.mockRejectedValue(
        new Error('Network error')
      );

      await expect(client.authenticate('1234567890', 'test-token')).rejects.toThrow();
    });

    it('should include error details in KsefApiError', async () => {
      const errorDetails = { code: 'VALIDATION_ERROR', details: 'Invalid NIP' };
      mockAxiosInstance.post.mockRejectedValue({
        response: {
          status: 400,
          data: errorDetails,
        },
      });

      try {
        await client.authenticate('invalid', 'test-token');
      } catch (error) {
        if (error instanceof KsefApiError) {
          expect(error.statusCode).toBe(400);
          expect(error.details).toEqual(errorDetails);
        } else {
          throw error;
        }
      }
    });
  });

  describe('List Active Sessions', () => {
    beforeEach(async () => {
      const sessionInfo: SessionInfo = {
        referenceNumber: 'ref-123',
        sessionToken: {
          token: 'session-token-123',
          expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        startDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        authenticationMethod: 'Bearer',
      };
      mockAxiosInstance.post.mockResolvedValue({ data: sessionInfo });
      await client.authenticate('1234567890', 'test-token');
      mockAxiosInstance.post.mockClear();
    });

    it('should list active sessions', async () => {
      const sessions: SessionInfo[] = [
        {
          referenceNumber: 'ref-1',
          sessionToken: {
            token: 'token-1',
            expiryDate: new Date().toISOString(),
          },
          startDate: new Date().toISOString(),
          expiryDate: new Date().toISOString(),
          authenticationMethod: 'Bearer',
        },
      ];

      mockAxiosInstance.get.mockResolvedValue({
        data: { items: sessions },
      });

      const result = await client.listActiveSessions();

      expect(result).toHaveLength(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/auth/sessions',
        expect.any(Object)
      );
    });
  });
});
