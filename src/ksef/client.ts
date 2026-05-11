/**
 * KSeF HTTP Client
 * Klient HTTP do komunikacji z API KSeF z obsługą sesji i retry logic
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { X509Certificate, constants, publicEncrypt } from 'node:crypto';
import { config } from '../config.js';
import { ksefLogger } from '../logger.js';
import {
  KsefConnectionError,
  KsefApiError,
  KsefAuthError,
  KsefValidationError,
} from '../errors.js';
import { maskNip, maskToken, sanitizeHeaders, truncateBody } from '../utils/sanitize.js';
import {
  parseKsefXml,
  xmlToObject,
  extractFromXml,
} from './xml-parser.js';
import {
  generateExportKeyMaterial,
  buildExportEncryptionInfo,
  decryptExportZip,
} from './export-crypto.js';
import type {
  AuthenticationChallengeResponse,
  AuthenticationInitResponse,
  AuthenticationOperationStatusResponse,
  AuthenticationTokensResponse,
  AuthenticationTokenRefreshResponse,
  InitTokenAuthenticationRequest,
  PublicKeyCertificate,
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
  ExportRequest,
  ExportInitResponse,
  ExportStatusResponse,
  ExportKeyMaterial,
} from './types.js';

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * HTTP status codes that should trigger retry
 */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * How many times to retry a 429 rate-limit response.
 * Higher than the default maxRetries because each attempt honours the
 * full Retry-After wait given by KSeF, so extra retries are safe.
 */
const RATE_LIMIT_MAX_RETRIES = 10;

const DEFAULT_AUTH_POLL_CONFIG = {
  maxAttempts: 60,
  delayMs: 1000,
};

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private toDateOrThrow(value: string, fieldName: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new KsefApiError(`Invalid date in ${fieldName}`, 'INVALID_RESPONSE', undefined, { value });
    }
    return d;
  }

  private pickCertByUsage(
    certs: PublicKeyCertificate[],
    usage: 'KsefTokenEncryption' | 'SymmetricKeyEncryption'
  ): PublicKeyCertificate {
    const now = Date.now();
    const candidates = certs
      .filter((c) => Array.isArray(c.usage) && c.usage.includes(usage))
      .filter((c) => {
        const from = new Date(c.validFrom).getTime();
        const to = new Date(c.validTo).getTime();
        return !Number.isNaN(from) && !Number.isNaN(to) && from <= now && now <= to;
      })
      .sort((a, b) => new Date(b.validTo).getTime() - new Date(a.validTo).getTime());

    if (!candidates[0]) {
      throw new KsefAuthError(`No valid certificate with usage=${usage}`, 'NO_PUBLIC_KEY');
    }
    return candidates[0];
  }

  private pickKsefTokenEncryptionCert(certs: PublicKeyCertificate[]): PublicKeyCertificate {
    return this.pickCertByUsage(certs, 'KsefTokenEncryption');
  }

  private getPublicKeyPemFromCertificateBase64(certificateBase64Der: string): string {
    const der = Buffer.from(certificateBase64Der, 'base64');
    const x509 = new X509Certificate(der);
    return x509.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  private encryptKsefTokenTokenAndTimestamp(tokenKsef: string, timestampMs: number, publicKeyPem: string): string {
    const plaintext = `${tokenKsef}|${timestampMs}`;
    const encrypted = publicEncrypt(
      {
        key: publicKeyPem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(plaintext, 'utf8')
    );
    return encrypted.toString('base64');
  }

  private async fetchPublicCerts(): Promise<PublicKeyCertificate[]> {
    const resp = await this.httpClient.get<PublicKeyCertificate[]>('/security/public-key-certificates');
    if (!Array.isArray(resp.data)) {
      throw new KsefApiError('Invalid public key certificates response', 'INVALID_RESPONSE');
    }
    return resp.data;
  }

  private async fetchKsefTokenEncryptionPublicKeyPem(): Promise<string> {
    if (this.clientConfig.ksefTokenEncryptionPublicKeyPem) {
      return this.clientConfig.ksefTokenEncryptionPublicKeyPem;
    }
    const certs = await this.fetchPublicCerts();
    const cert = this.pickKsefTokenEncryptionCert(certs);
    return this.getPublicKeyPemFromCertificateBase64(cert.certificate);
  }

  private async fetchSymmetricKeyEncryptionCert(): Promise<{ pem: string; publicKeyId: string }> {
    const certs = await this.fetchPublicCerts();
    const cert = this.pickCertByUsage(certs, 'SymmetricKeyEncryption');
    return {
      pem: this.getPublicKeyPemFromCertificateBase64(cert.certificate),
      publicKeyId: cert.publicKeyId,
    };
  }

  private async getChallenge(): Promise<AuthenticationChallengeResponse> {
    const resp = await this.httpClient.post<AuthenticationChallengeResponse>('/auth/challenge');
    if (!resp.data?.challenge || typeof resp.data.timestampMs !== 'number') {
      throw new KsefAuthError('Invalid challenge response', 'INVALID_RESPONSE');
    }
    return resp.data;
  }

  private async initAuthWithKsefToken(nip: string, tokenKsef: string): Promise<AuthenticationInitResponse> {
    const challenge = await this.getChallenge();
    const publicKeyPem = await this.fetchKsefTokenEncryptionPublicKeyPem();
    const encryptedToken = this.encryptKsefTokenTokenAndTimestamp(tokenKsef, challenge.timestampMs, publicKeyPem);

    const body: InitTokenAuthenticationRequest = {
      challenge: challenge.challenge,
      contextIdentifier: { type: 'Nip', value: nip },
      encryptedToken,
    };

    const resp = await this.httpClient.post<AuthenticationInitResponse>('/auth/ksef-token', body);
    if (!resp.data?.referenceNumber || !resp.data?.authenticationToken?.token) {
      throw new KsefAuthError('Invalid authentication init response', 'INVALID_RESPONSE');
    }
    return resp.data;
  }

  private async pollAuthStatus(referenceNumber: string, authenticationToken: string): Promise<AuthenticationOperationStatusResponse> {
    for (let i = 0; i < DEFAULT_AUTH_POLL_CONFIG.maxAttempts; i++) {
      const resp = await this.httpClient.get<AuthenticationOperationStatusResponse>(`/auth/${referenceNumber}`, {
        headers: { Authorization: `Bearer ${authenticationToken}` },
      });
      if (!resp.data?.status || typeof resp.data.status.code !== 'number') {
        throw new KsefAuthError('Invalid auth status response', 'INVALID_RESPONSE');
      }

      if (resp.data.status.code !== 100) {
        return resp.data;
      }

      await this.sleep(DEFAULT_AUTH_POLL_CONFIG.delayMs);
    }

    throw new KsefAuthError('Authentication timed out while waiting for status', 'TIMEOUT');
  }

  private async redeemTokens(authenticationToken: string): Promise<AuthenticationTokensResponse> {
    const resp = await this.httpClient.post<AuthenticationTokensResponse>(
      '/auth/token/redeem',
      {},
      { headers: { Authorization: `Bearer ${authenticationToken}` } }
    );

    if (!resp.data?.accessToken?.token || !resp.data?.refreshToken?.token) {
      throw new KsefAuthError('Invalid redeem token response', 'INVALID_RESPONSE');
    }
    return resp.data;
  }

  private async refreshAccessToken(refreshToken: string): Promise<AuthenticationTokenRefreshResponse> {
    const resp = await this.httpClient.post<AuthenticationTokenRefreshResponse>(
      '/auth/token/refresh',
      {},
      { headers: { Authorization: `Bearer ${refreshToken}` } }
    );
    if (!resp.data?.accessToken?.token) {
      throw new KsefAuthError('Invalid refresh token response', 'INVALID_RESPONSE');
    }
    return resp.data;
  }

  /**
   * Setup axios interceptors for logging and error handling
   */
  private setupInterceptors(): void {
    this.httpClient.interceptors.request.use(
      (requestConfig) => {
        const method = requestConfig.method?.toUpperCase() || 'GET';
        const url = requestConfig.url || '';
        (requestConfig as any).metadata = { startTime: Date.now() };

        ksefLogger.debug('HTTP request sent', {
          method,
          url,
          headers: sanitizeHeaders(requestConfig.headers as any),
          body: this.sanitizeBodyForLogs(requestConfig.data),
        });

        return requestConfig;
      },
      (error) => {
        ksefLogger.error('Request config error', { error: error instanceof Error ? error.message : String(error) });
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        const method = response.config.method?.toUpperCase() || 'GET';
        const url = response.config.url || '';
        const startTime = (response.config as any)?.metadata?.startTime as number | undefined;
        const responseTime = startTime ? Date.now() - startTime : undefined;

        ksefLogger.debug('HTTP response received', {
          method,
          url,
          statusCode: response.status,
          responseTime,
          body: this.sanitizeBodyForLogs(response.data, response.headers?.['content-type']),
        });
        return response;
      },
      (error) => {
        const axiosErr = axios.isAxiosError(error) ? error : undefined;
        const method = axiosErr?.config?.method?.toUpperCase();
        const url = axiosErr?.config?.url;
        const startTime = (axiosErr?.config as any)?.metadata?.startTime as number | undefined;
        const responseTime = startTime ? Date.now() - startTime : undefined;

        if (error.response) {
          ksefLogger.error(`KSeF API error ${error.response.status} ${method} ${url}`, {
            method,
            url,
            statusCode: error.response.status,
            responseTime,
            body: this.sanitizeBodyForLogs(error.response.data, error.response.headers?.['content-type']),
          });
        } else if (error.code) {
          ksefLogger.error(`KSeF connection error [${error.code}] ${method} ${url}`, {
            method,
            url,
            error: error.code,
            message: error.message,
            responseTime,
          });
        } else {
          ksefLogger.error(`KSeF request error ${method} ${url}: ${error?.message}`, {
            method,
            url,
            message: error?.message,
            responseTime,
          });
        }
        return Promise.reject(error);
      }
    );
  }

  private sanitizeBodyForLogs(body: unknown, contentType?: string): unknown {
    if (body == null) return body;

    const ct = String(contentType || '').toLowerCase();
    if (ct.includes('xml')) return '[XML omitted]';
    if (typeof body === 'string' && body.trim().startsWith('<')) return '[XML omitted]';

    return truncateBody(body, 500);
  }

  /**
   * Calculate delay before the next retry.
   *
   * For 429 responses the KSeF Retry-After header is honoured in full —
   * it is intentionally NOT capped by maxDelayMs because shortening the
   * wait would just trigger another 429 immediately (KSeF uses a sliding
   * window; repeated violations extend the block duration).
   * If no Retry-After is present a conservative 60 s fallback is used.
   *
   * All other retriable errors use standard exponential backoff capped
   * by maxDelayMs.
   */
  private calculateBackoffDelay(attempt: number, error?: unknown): number {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const retryAfter = error.response.headers?.['retry-after'];
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0) {
          return seconds * 1000;
        }
      }
      return 60_000;
    }

    const maxDelay = this.retryConfig.maxDelayMs ?? 10000;
    const exponentialDelay = Math.pow(3, attempt) * this.retryConfig.baseDelayMs;
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Check if a failed request should be retried.
   *
   * 429 rate-limit responses use a separate, higher retry ceiling
   * (RATE_LIMIT_MAX_RETRIES) because each attempt already waits the full
   * Retry-After duration dictated by KSeF.
   */
  private shouldRetry(
    error: AxiosError | unknown,
    attempt: number
  ): boolean {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        return attempt < RATE_LIMIT_MAX_RETRIES;
      }

      if (attempt >= this.retryConfig.maxRetries) {
        return false;
      }

      if (error.response?.status) {
        return RETRYABLE_STATUS_CODES.includes(error.response.status);
      }

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
   * Execute request with retry logic.
   *
   * Uses a while loop so that 429 responses (which have their own higher
   * retry ceiling via RATE_LIMIT_MAX_RETRIES) are not cut short by the
   * default maxRetries counter that governs other error types.
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | unknown;
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.shouldRetry(error, attempt)) {
          throw this.handleError(error, operationName);
        }

        const delay = this.calculateBackoffDelay(attempt, error);
        const is429 = axios.isAxiosError(error) && error.response?.status === 429;
        const retryAfterSec = is429
          ? (Number(error.response?.headers?.['retry-after']) || null)
          : null;

        if (is429) {
          ksefLogger.warn('⏱️ Limit API KSeF (429) — oczekuję zgodnie z Retry-After', {
            attempt: attempt + 1,
            maxAttempts: RATE_LIMIT_MAX_RETRIES,
            operationName,
            retryAfterSeconds: retryAfterSec,
            delayMs: delay,
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          ksefLogger.warn('🔄 Retry żądania', {
            attempt: attempt + 1,
            maxAttempts: this.retryConfig.maxRetries + 1,
            operationName,
            delayMs: delay,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      }
    }
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

      if (status === 429) {
        const retryAfterHeader = axios.isAxiosError(error)
          ? error.response?.headers?.['retry-after']
          : undefined;
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : null;
        const waitHint =
          retryAfterSec && !Number.isNaN(retryAfterSec)
            ? ` Wymagane oczekiwanie: ${retryAfterSec}s.`
            : '';
        return new KsefConnectionError(
          `Przekroczono limit żądań API KSeF (429) dla operacji "${operationName}".${waitHint} Spróbuj ponownie później.`,
          'RETRY_EXHAUSTED',
          429
        );
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
   * Authenticate to KSeF using KSeF token (documented v2 flow)
   * Stores access/refresh tokens for subsequent requests.
   */
  async authenticate(nip?: string, token?: string): Promise<{ referenceNumber: string }> {
    const authNip = nip ?? this.clientConfig.nip;
    const tokenKsef = token ?? this.clientConfig.token;

    if (!authNip || !tokenKsef) {
      throw new KsefValidationError('NIP and token are required for authentication', {
        nip: !!authNip,
        token: !!tokenKsef,
      });
    }

    ksefLogger.info('🔐 Inicjalizacja uwierzytelnienia KSeF', {
      nip: maskNip(authNip),
      token: maskToken(tokenKsef),
    });

    const init = await this.executeWithRetry(
      async () => {
        return await this.initAuthWithKsefToken(authNip, tokenKsef);
      },
      'authenticate'
    );

    const status = await this.executeWithRetry(
      async () => {
        return await this.pollAuthStatus(init.referenceNumber, init.authenticationToken.token);
      },
      'authenticate.status'
    );

    if (status.status.code !== 200) {
      const details = Array.isArray(status.status.details) ? status.status.details.join('; ') : undefined;
      throw new KsefAuthError(
        details
          ? `Authentication failed: ${status.status.description} (${details})`
          : `Authentication failed: ${status.status.description}`,
        'AUTH_FAILED'
      );
    }

    const tokens = await this.executeWithRetry(
      async () => {
        return await this.redeemTokens(init.authenticationToken.token);
      },
      'authenticate.redeem'
    );

    this.sessionState = {
      referenceNumber: init.referenceNumber,
      accessToken: tokens.accessToken.token,
      accessTokenValidUntil: this.toDateOrThrow(tokens.accessToken.validUntil, 'accessToken.validUntil'),
      refreshToken: tokens.refreshToken.token,
      refreshTokenValidUntil: this.toDateOrThrow(tokens.refreshToken.validUntil, 'refreshToken.validUntil'),
      createdAt: new Date(),
    };

    ksefLogger.info('🔐 Uwierzytelniono', { referenceNumber: init.referenceNumber });
    return { referenceNumber: init.referenceNumber };
  }

  /**
   * Terminate current session
   */
  async terminateSession(): Promise<void> {
    if (!this.sessionState) {
      throw new KsefValidationError('No active session to terminate');
    }

    ksefLogger.info('🔒 Zamykam sesję', { referenceNumber: this.sessionState.referenceNumber });

    await this.executeWithRetry(
      async () => {
        await this.httpClient.delete('/auth/sessions/current', {
          headers: this.getAuthHeaders(),
        });
      },
      'terminateSession'
    );

    this.sessionState = null;
    ksefLogger.info('🔒 Sesja zamknięta');
  }

  /**
   * Check if session is still valid
   */
  isSessionValid(): boolean {
    if (!this.sessionState) {
      return false;
    }

    return new Date() < this.sessionState.accessTokenValidUntil;
  }

  /**
   * Get or refresh access token
   */
  private async ensureValidSession(): Promise<string> {
    if (this.isSessionValid()) {
      return this.sessionState!.accessToken;
    }

    if (!this.sessionState) {
      throw new KsefAuthError('No active session', 'NO_SESSION');
    }

    ksefLogger.warn('⚠️ Access token wygasł — odświeżam refresh tokenem');
    const refreshed = await this.executeWithRetry(
      async () => {
        return await this.refreshAccessToken(this.sessionState!.refreshToken);
      },
      'refreshAccessToken'
    );

    this.sessionState.accessToken = refreshed.accessToken.token;
    this.sessionState.accessTokenValidUntil = this.toDateOrThrow(
      refreshed.accessToken.validUntil,
      'accessToken.validUntil'
    );

    return this.sessionState.accessToken;
  }

  /**
   * Get authorization headers with access token
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.sessionState) {
      throw new KsefAuthError('No active session', 'NO_SESSION');
    }

    return {
      Authorization: `Bearer ${this.sessionState.accessToken}`,
    };
  }

  /**
   * Send invoice XML to KSeF
   * Returns element reference number and processing code
   */
  async sendInvoice(invoiceXml: string): Promise<SendInvoiceResult> {
    await this.ensureValidSession();

    ksefLogger.info('📤 Wysyłam fakturę do KSeF');

    throw new KsefApiError(
      'Interactive invoice send is not implemented (requires sessions/online flow per documentation)',
      'NOT_IMPLEMENTED'
    );
  }

  /**
   * Get invoice by KSeF number
   */
  async getInvoice(ksefNumber: string): Promise<KsefInvoice> {
    await this.ensureValidSession();

    if (!ksefNumber) {
      throw new KsefValidationError('KSeF number is required');
    }

    ksefLogger.info('📄 Pobieram fakturę', { ksefReferenceNumber: ksefNumber });

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

        // Keep raw XML as `content` so callers can save it directly to disk.
        // Merge with parsed fields (dates etc.) for convenience.
        const parsed = parseKsefXml(response.data);
        return { ...parsed, content: response.data };
      },
      'getInvoice'
    );

    ksefLogger.info('📄 Pobrano fakturę', { ksefReferenceNumber: ksefNumber });
    return invoice;
  }

  /**
   * Query invoices with filters and pagination
   */
  async queryInvoices(params: QueryParams): Promise<InvoicePage> {
    await this.ensureValidSession();

    const pageSize = Math.min(params.pageSize || 100, 100);
    const pageOffset = params.pageOffset || 0;

    ksefLogger.info('📋 Query faktur', { pageSize, pageOffset, subjectType: params.subjectType });

    const result = await this.executeWithRetry(
      async () => {
        const response = await this.httpClient.post<InvoicePage>(
          '/invoices/query/metadata',
          // Body: InvoiceQueryFilters — subjectType + dateRange are required
          {
            subjectType: params.subjectType,
            dateRange: params.dateRange,
          },
          {
            headers: this.getAuthHeaders(),
            // pageSize / pageOffset go in the URL, not the body
            params: { pageSize, pageOffset },
          }
        );

        if (!response.data) {
          throw new KsefApiError('Empty query response', 'EMPTY_RESPONSE');
        }

        return response.data;
      },
      'queryInvoices'
    );

    ksefLogger.info('📋 Znaleziono faktury', {
      found: result.numberOfElements || 0,
      pageOffset,
    });
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

    ksefLogger.info('📦 Pobieram status faktury', { elementReferenceNumber: elementRefNumber });

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

    ksefLogger.info('📦 Status faktury', { processingCode: status.processingCode });
    return status;
  }

  /**
   * List active sessions
   */
  async listActiveSessions(): Promise<SessionInfo[]> {
    await this.ensureValidSession();

    ksefLogger.info('📋 Lista aktywnych sesji');

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

    ksefLogger.info('📋 Aktywne sesje', { count: sessions.length });
    return sessions;
  }

  // ---------------------------------------------------------------------------
  // Batch export — POST /invoices/exports
  // ---------------------------------------------------------------------------

  /**
   * Initiate an asynchronous batch export for the given filters.
   *
   * Generates a fresh AES-256 key + IV locally, RSA-encrypts the key with
   * KSeF's SymmetricKeyEncryption certificate, and sends it with the export
   * request.  KSeF will encrypt the resulting ZIP with our AES key so we can
   * decrypt it after download.
   *
   * Returns the server-side referenceNumber and the local key material needed
   * to decrypt the downloaded packages.
   */
  async startExport(params: {
    subjectType: 'Subject1' | 'Subject2' | 'Subject3' | 'SubjectAuthorized';
    dateRange: { dateType: 'Issue' | 'Invoicing' | 'PermanentStorage'; from: string; to?: string };
  }): Promise<{ referenceNumber: string; keyMaterial: ExportKeyMaterial }> {
    await this.ensureValidSession();

    ksefLogger.info('📦 Inicjuję eksport faktur', { subjectType: params.subjectType });

    const { pem: symmetricKeyPem, publicKeyId } = await this.fetchSymmetricKeyEncryptionCert();
    const keyMaterial = generateExportKeyMaterial();
    const encryptionInfo = buildExportEncryptionInfo(keyMaterial, symmetricKeyPem, publicKeyId);

    const body: ExportRequest = {
      encryption: encryptionInfo,
      filters: {
        subjectType: params.subjectType,
        dateRange: params.dateRange,
      },
    };

    const response = await this.executeWithRetry(async () => {
      const res = await this.httpClient.post<ExportInitResponse>('/invoices/exports', body, {
        headers: this.getAuthHeaders(),
      });
      if (!res.data?.referenceNumber) {
        throw new KsefApiError('Invalid export init response', 'EMPTY_RESPONSE');
      }
      return res.data;
    }, 'startExport');

    ksefLogger.info('📦 Eksport zainicjowany', { referenceNumber: response.referenceNumber });
    return { referenceNumber: response.referenceNumber, keyMaterial };
  }

  /**
   * Poll GET /invoices/exports/{referenceNumber} until the export is ready or
   * fails.  Polls every `pollIntervalMs` (default 5 s) for up to `timeoutMs`
   * (default 30 min).
   */
  async waitForExport(
    referenceNumber: string,
    opts: { pollIntervalMs?: number; timeoutMs?: number } = {}
  ): Promise<ExportStatusResponse> {
    await this.ensureValidSession();

    const pollInterval = opts.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1_000);

    ksefLogger.info('⏳ Czekam na gotowość eksportu', { referenceNumber });

    while (Date.now() < deadline) {
      const status = await this.executeWithRetry(async () => {
        const res = await this.httpClient.get<ExportStatusResponse>(
          `/invoices/exports/${referenceNumber}`,
          { headers: this.getAuthHeaders() }
        );
        if (!res.data?.status) {
          throw new KsefApiError('Invalid export status response', 'EMPTY_RESPONSE');
        }
        return res.data;
      }, 'waitForExport');

      const code = status.status.code;

      // 100 = in progress / queued
      if (code === 100) {
        ksefLogger.debug('⏳ Eksport w toku, czekam…', { referenceNumber, code });
        await this.sleep(pollInterval);
        continue;
      }

      // 200 = ready
      if (code === 200) {
        ksefLogger.info('✅ Eksport gotowy', {
          referenceNumber,
          invoiceCount: status.package?.invoiceCount,
          parts: status.package?.parts?.length ?? 0,
          isTruncated: status.package?.isTruncated,
        });
        return status;
      }

      // Any other code is an error
      const details = status.status.details?.join('; ') ?? '';
      throw new KsefApiError(
        `Export failed (${code}): ${status.status.description}${details ? ` — ${details}` : ''}`,
        'EXPORT_FAILED',
        code
      );
    }

    throw new KsefApiError(`Export timed out after ${opts.timeoutMs ?? 30 * 60 * 1_000}ms`, 'EXPORT_TIMEOUT');
  }

  /**
   * Download a single export part (pre-signed Azure Blob URL) and decrypt it.
   * These URLs do NOT require an Authorization header — they are self-contained.
   * Returns the decrypted ZIP buffer ready for extraction.
   */
  async downloadExportPackage(partUrl: string, keyMaterial: ExportKeyMaterial): Promise<Buffer> {
    ksefLogger.info('⬇️ Pobieram część paczki eksportu', { url: partUrl.split('?')[0] });

    const response = await axios.get<ArrayBuffer>(partUrl, {
      responseType: 'arraybuffer',
      timeout: 5 * 60 * 1_000,
    });

    const encrypted = Buffer.from(response.data);
    ksefLogger.info('🔓 Deszyfrowanie części paczki', { encryptedBytes: encrypted.length });
    return decryptExportZip(encrypted, keyMaterial);
  }

  // ---------------------------------------------------------------------------

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
    ksefLogger.info('Retry configuration updated', this.retryConfig);
  }
}

/**
 * Create and export default client instance
 */
export const ksefClient = new KsefClient();
