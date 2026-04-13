/**
 * KSeF HTTP Client
 * Klient HTTP do komunikacji z API KSeF z obsługą sesji i retry logic
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  KsefConnectionError,
  KsefApiError,
  KsefAuthError,
  KsefValidationError,
} from '../errors.js';
import {
  parseKsefXml,
  xmlToObject,
  extractFromXml,
} from './xml-parser.js';
import type {
  SessionInfo,
  SendInvoiceResult,
  KsefInvoice,
  QueryParams,
  InvoicePage,
  InvoiceStatus,
  InvoiceMetadata,
  KsefClientConfig,
  RetryConfig,
  SessionState,
} from './types.js';

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 9000,
};

/**
 * HTTP status codes that should trigger retry
 */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Main KSeF HTTP Client
 */
export class KsefClient {
  private httpClient: AxiosInstance;
  private sessionState: SessionState | null = null;
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;
  private clientConfig: KsefClientConfig;

  constructor(clientConfig?: Partial<KsefClientConfig>) {
    this.clientConfig = {
      baseUrl: config.ksef.baseUrl || 'https://api.ksef.mf.gov.pl/v2',
      token: config.ksef.token,
      nip: config.ksef.nip,
      timeout: 30000,
      ...clientConfig,
    };

    this.httpClient = axios.create({
      baseURL: this.clientConfig.baseUrl,
      timeout: this.clientConfig.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request/response interceptors
    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for logging and error handling
   */
  private setupInterceptors(): void {
    this.httpClient.interceptors.request.use(
      (requestConfig) => {
        const method = requestConfig.method?.toUpperCase() || 'GET';
        const url = requestConfig.url || '';
        logger.info(`KSeF Request: ${method} ${url}`);

        if (requestConfig.data) {
          logger.debug(`Request body:`, requestConfig.data);
        }

        return requestConfig;
      },
      (error) => {
        logger.error('Request config error', error);
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        logger.info(
          `KSeF Response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`
        );
        if (response.data) {
          logger.debug(`Response body:`, response.data);
        }
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(`KSeF API Error: ${error.response.status}`, error.response.data);
        } else if (error.code) {
          logger.error(`KSeF Connection Error: ${error.code}`, error.message);
        } else {
          logger.error('KSeF Request Error', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = Math.pow(3, attempt) * this.retryConfig.baseDelayMs;
    const maxDelay = this.retryConfig.maxDelayMs || exponentialDelay;
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Check if response should be retried
   */
  private shouldRetry(
    error: AxiosError | unknown,
    attempt: number
  ): boolean {
    if (attempt >= this.retryConfig.maxRetries) {
      return false;
    }

    if (axios.isAxiosError(error)) {
      // Don't retry 4xx errors except 403 (session expired) and 408 (timeout)
      if (error.response?.status) {
        return RETRYABLE_STATUS_CODES.includes(error.response.status);
      }

      // Retry on connection errors
      if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND'
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | unknown;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.shouldRetry(error, attempt)) {
          throw this.handleError(error, operationName);
        }

        const delay = this.calculateBackoffDelay(attempt);
        logger.warn(
          `Attempt ${attempt + 1} failed for ${operationName}, retrying in ${delay}ms`,
          error instanceof Error ? error.message : String(error)
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw this.handleError(lastError, operationName);
  }

  /**
   * Handle and normalize errors
   */
  private handleError(error: unknown, operationName: string): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const message = String(data?.message || error.message || `${operationName} failed`);

      if (status === 401 || status === 403) {
        // Session expired or auth failed
        if (status === 403) {
          this.sessionState = null; // Clear session on 403
        }
        return new KsefAuthError(message, 'SESSION_EXPIRED', status);
      }

      if (RETRYABLE_STATUS_CODES.includes(status || 0)) {
        return new KsefConnectionError(
          `${operationName} failed after retries: ${message}`,
          'RETRY_EXHAUSTED',
          status
        );
      }

      return new KsefApiError(message, 'API_ERROR', status, data);
    }

    if (error instanceof Error) {
      return error;
    }

    return new KsefConnectionError(
      `${operationName} failed: ${String(error)}`,
      'UNKNOWN_ERROR'
    );
  }

  /**
   * Authenticate and create a session
   * Returns session info with token valid for 30 minutes
   */
  async authenticate(nip?: string, token?: string): Promise<SessionInfo> {
    const authNip = nip || this.clientConfig.nip;
    const authToken = token || this.clientConfig.token;

    if (!authNip || !authToken) {
      throw new KsefValidationError('NIP and token are required for authentication', {
        nip: !!authNip,
        token: !!authToken,
      });
    }

    logger.info(`Authenticating KSeF with NIP: ${authNip}`);

    const sessionInfo = await this.executeWithRetry(
      async () => {
        // TODO: Implement actual authentication XML payload construction
        // For now, using Bearer token authentication based on v2 API
        const response = await this.httpClient.post<SessionInfo>(
          '/auth/sessions',
          {},
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }
        );

        if (!response.data || !response.data.referenceNumber) {
          throw new KsefAuthError('Invalid authentication response', 'INVALID_RESPONSE');
        }

        return response.data;
      },
      'authenticate'
    );

    // Store session state
    this.sessionState = {
      sessionToken: sessionInfo.sessionToken.token,
      referenceNumber: sessionInfo.referenceNumber,
      expiryDate: new Date(sessionInfo.sessionToken.expiryDate),
      createdAt: new Date(),
    };

    logger.info(`Authentication successful. Session: ${sessionInfo.referenceNumber}`);
    return sessionInfo;
  }

  /**
   * Terminate current session
   */
  async terminateSession(): Promise<void> {
    if (!this.sessionState) {
      throw new KsefValidationError('No active session to terminate');
    }

    logger.info(`Terminating session: ${this.sessionState.referenceNumber}`);

    await this.executeWithRetry(
      async () => {
        await this.httpClient.delete('/auth/sessions/current', {
          headers: this.getAuthHeaders(),
        });
      },
      'terminateSession'
    );

    this.sessionState = null;
    logger.info('Session terminated');
  }

  /**
   * Check if session is still valid
   */
  isSessionValid(): boolean {
    if (!this.sessionState) {
      return false;
    }

    return new Date() < this.sessionState.expiryDate;
  }

  /**
   * Get or refresh session token
   */
  private async ensureValidSession(): Promise<string> {
    if (this.isSessionValid()) {
      return this.sessionState!.sessionToken;
    }

    // Session expired, re-authenticate
    logger.info('Session expired, re-authenticating...');
    const sessionInfo = await this.authenticate();
    return sessionInfo.sessionToken.token;
  }

  /**
   * Get authorization headers with session token
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.sessionState) {
      throw new KsefAuthError('No active session', 'NO_SESSION');
    }

    return {
      Authorization: `Bearer ${this.sessionState.sessionToken}`,
    };
  }

  /**
   * Send invoice XML to KSeF
   * Returns element reference number and processing code
   */
  async sendInvoice(invoiceXml: string): Promise<SendInvoiceResult> {
    const token = await this.ensureValidSession();

    logger.info('Sending invoice to KSeF');

    const result = await this.executeWithRetry(
      async () => {
        // TODO: Implement actual invoice sending - this is a simplified example
        const response = await this.httpClient.post<SendInvoiceResult>(
          `/sessions/${this.sessionState!.referenceNumber}/invoices`,
          invoiceXml,
          {
            headers: {
              ...this.getAuthHeaders(),
              'Content-Type': 'application/xml',
            },
          }
        );

        if (!response.data || !response.data.elementReferenceNumber) {
          throw new KsefApiError('Invalid send response', 'INVALID_RESPONSE');
        }

        return response.data;
      },
      'sendInvoice'
    );

    logger.info(`Invoice sent successfully: ${result.elementReferenceNumber}`);
    return result;
  }

  /**
   * Get invoice by KSeF number
   */
  async getInvoice(ksefNumber: string): Promise<KsefInvoice> {
    await this.ensureValidSession();

    if (!ksefNumber) {
      throw new KsefValidationError('KSeF number is required');
    }

    logger.info(`Fetching invoice from KSeF: ${ksefNumber}`);

    const invoice = await this.executeWithRetry(
      async () => {
        const response = await this.httpClient.get<string>(
          `/invoices/ksef/${ksefNumber}`,
          {
            headers: this.getAuthHeaders(),
          }
        );

        if (!response.data) {
          throw new KsefApiError('Empty invoice response', 'EMPTY_RESPONSE');
        }

        // Parse XML response
        return parseKsefXml(response.data);
      },
      'getInvoice'
    );

    logger.info(`Invoice fetched successfully: ${ksefNumber}`);
    return invoice;
  }

  /**
   * Query invoices with filters and pagination
   */
  async queryInvoices(params: QueryParams): Promise<InvoicePage> {
    await this.ensureValidSession();

    const pageSize = Math.min(params.pageSize || 100, 100);
    const pageOffset = params.pageOffset || 0;

    logger.info(`Querying invoices: pageSize=${pageSize}, pageOffset=${pageOffset}`);

    const result = await this.executeWithRetry(
      async () => {
        const response = await this.httpClient.post<InvoicePage>(
          '/invoices/query/metadata',
          {
            pageSize,
            pageOffset,
            queryCriteria: params.queryCriteria || {},
          },
          {
            headers: this.getAuthHeaders(),
          }
        );

        if (!response.data) {
          throw new KsefApiError('Empty query response', 'EMPTY_RESPONSE');
        }

        return response.data;
      },
      'queryInvoices'
    );

    logger.info(
      `Query completed: ${result.numberOfElements || 0} invoices found (page ${pageOffset})`
    );
    return result;
  }

  /**
   * Get invoice status
   */
  async getInvoiceStatus(elementRefNumber: string): Promise<InvoiceStatus> {
    await this.ensureValidSession();

    if (!elementRefNumber) {
      throw new KsefValidationError('Element reference number is required');
    }

    logger.info(`Fetching invoice status: ${elementRefNumber}`);

    const status = await this.executeWithRetry(
      async () => {
        const response = await this.httpClient.get<InvoiceStatus>(
          `/invoices/exports/${elementRefNumber}`,
          {
            headers: this.getAuthHeaders(),
          }
        );

        if (!response.data) {
          throw new KsefApiError('Empty status response', 'EMPTY_RESPONSE');
        }

        return response.data;
      },
      'getInvoiceStatus'
    );

    logger.info(`Invoice status: ${status.processingCode}`);
    return status;
  }

  /**
   * List active sessions
   */
  async listActiveSessions(): Promise<SessionInfo[]> {
    await this.ensureValidSession();

    logger.info('Listing active sessions');

    const sessions = await this.executeWithRetry(
      async () => {
        const response = await this.httpClient.get<{ items: SessionInfo[] }>(
          '/auth/sessions',
          {
            headers: this.getAuthHeaders(),
            params: {
              pageSize: 100,
            },
          }
        );

        if (!response.data || !Array.isArray(response.data.items)) {
          throw new KsefApiError('Invalid sessions response', 'INVALID_RESPONSE');
        }

        return response.data.items;
      },
      'listActiveSessions'
    );

    logger.info(`Found ${sessions.length} active sessions`);
    return sessions;
  }

  /**
   * Get current session info
   */
  getCurrentSession(): SessionState | null {
    return this.sessionState;
  }

  /**
   * Set retry configuration
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
    logger.info('Retry configuration updated', this.retryConfig);
  }
}

/**
 * Create and export default client instance
 */
export const ksefClient = new KsefClient();
