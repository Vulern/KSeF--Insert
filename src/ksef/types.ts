/**
 * KSeF API Types
 * Interfejsy oraz typy dla faktur z KSeF
 */

/**
 * Session Information returned from authentication
 */
export interface SessionInfo {
  referenceNumber: string;
  sessionToken: SessionToken;
  startDate: string;
  expiryDate: string;
  authenticationMethod: string;
}

export interface SessionToken {
  token: string;
  expiryDate: string;
}

/**
 * Generic token returned by KSeF auth endpoints
 */
export interface AuthToken {
  token: string;
  validUntil: string;
}

export interface AuthenticationChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp?: string;
}

export type ContextIdentifierType = 'Nip' | 'InternalId' | 'NipVatUe';

export interface ContextIdentifier {
  type: ContextIdentifierType;
  value: string;
}

export interface InitTokenAuthenticationRequest {
  challenge: string;
  contextIdentifier: ContextIdentifier;
  encryptedToken: string;
  authorizationPolicy?: unknown;
}

export interface AuthenticationInitResponse {
  referenceNumber: string;
  authenticationToken: AuthToken;
}

export interface AuthenticationOperationStatus {
  code: number;
  description: string;
  details?: string[];
}

export interface AuthenticationOperationStatusResponse {
  startDate: string;
  authenticationMethod: string;
  status: AuthenticationOperationStatus;
}

export interface AuthenticationTokensResponse {
  accessToken: AuthToken;
  refreshToken: AuthToken;
}

export interface AuthenticationTokenRefreshResponse {
  accessToken: AuthToken;
}

export type PublicKeyCertificateUsage = 'KsefTokenEncryption' | 'SymmetricKeyEncryption';

export interface PublicKeyCertificate {
  /**
   * Base64-encoded DER certificate
   */
  certificate: string;
  validFrom: string;
  validTo: string;
  usage: PublicKeyCertificateUsage[];
}

/**
 * Authentication response
 */
export interface AuthenticationResponse {
  sessionReferenceNumber: string;
  sessionToken: SessionToken;
  refreshToken?: string;
}

/**
 * Invoice sending result
 */
export interface SendInvoiceResult {
  elementReferenceNumber: string;
  processingCode: number;
  processingDescription?: string;
}

/**
 * KSeF Invoice structure (from FA-2 schema)
 */
export interface KsefInvoice {
  invoicingDate?: string;
  issueDate?: string;
  content?: string;
  [key: string]: unknown;
}

/**
 * Invoice metadata for query results
 */
export interface InvoiceMetadata {
  ksefNumber?: string;
  invoiceReferenceNumber?: string;
  invoicingDate?: string;
  issueDate?: string;
  acquisitionTimestamp?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Query parameters for invoice search
 */
export interface QueryParams {
  pageSize?: number;
  pageOffset?: number;
  queryCriteria?: {
    subjectType?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    [key: string]: unknown;
  };
}

/**
 * Paginated invoice response
 */
export interface InvoicePage {
  invoiceHeaderList?: InvoiceMetadata[];
  numberOfElements?: number;
  pageSize?: number;
  pageOffset?: number;
  totalElements?: number;
  [key: string]: unknown;
}

/**
 * Invoice status
 */
export interface InvoiceStatus {
  elementReferenceNumber: string;
  processingCode: number;
  processingDescription?: string;
  invoiceStatus?: string;
}

/**
 * KSeF API response wrapper
 */
export interface KsefResponse<T> {
  data?: T;
  error?: KsefErrorResponse;
}

export interface KsefErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * API Configuration for KSeF client
 */
export interface KsefClientConfig {
  baseUrl: string;
  token?: string;
  nip?: string;
  timeout?: number;
  /**
   * Optional PEM public key override (primarily for tests/offline).
   * If set, client will not fetch `/security/public-key-certificates`.
   */
  ksefTokenEncryptionPublicKeyPem?: string;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

/**
 * Session state tracking
 */
export interface SessionState {
  /**
   * Reference number of the authentication operation (AU-...).
   */
  referenceNumber: string;
  accessToken: string;
  accessTokenValidUntil: Date;
  refreshToken: string;
  refreshTokenValidUntil: Date;
  createdAt: Date;
}
