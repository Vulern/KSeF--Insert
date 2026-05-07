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
  /** Base64-encoded DER certificate */
  certificate: string;
  /** Key selector sent back to KSeF when using this key (e.g. in export requests) */
  publicKeyId: string;
  certificateId?: string;
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
 * Query parameters for invoice search (KSeF API v2)
 * pageSize / pageOffset are sent as URL query params.
 * The body fields (subjectType, dateRange) map to InvoiceQueryFilters.
 */
export interface QueryParams {
  pageSize?: number;
  pageOffset?: number;
  /** Subject1 = sprzedawca (seller), Subject2 = nabywca (buyer) */
  subjectType: 'Subject1' | 'Subject2' | 'Subject3' | 'SubjectAuthorized';
  dateRange: {
    /** Issue | Invoicing | PermanentStorage */
    dateType: 'Issue' | 'Invoicing' | 'PermanentStorage';
    /** ISO 8601 datetime, e.g. 2026-05-01T00:00:00 */
    from: string;
    /** ISO 8601 datetime, e.g. 2026-05-31T23:59:59 */
    to?: string;
  };
}

/**
 * Paginated invoice response from POST /invoices/query/metadata
 */
export interface InvoicePage {
  invoices?: InvoiceMetadata[];
  hasMore?: boolean;
  isTruncated?: boolean;
  permanentStorageHwmDate?: string;
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

// ---------------------------------------------------------------------------
// Batch export (POST /invoices/exports) types
// ---------------------------------------------------------------------------

/**
 * Encryption info sent to KSeF when initiating a batch export.
 * AES key is generated locally, RSA-encrypted with KSeF's SymmetricKeyEncryption
 * public certificate, then sent to KSeF so it can encrypt the returned ZIP.
 */
export interface ExportEncryptionInfo {
  /** Base64 of AES-256 key encrypted with KSeF RSA public cert */
  encryptedSymmetricKey: string;
  /** Base64 of the 16-byte AES IV */
  initializationVector: string;
  /** publicKeyId from the SymmetricKeyEncryption certificate — tells KSeF which key was used */
  publicKeyId: string;
}

export interface ExportRequest {
  encryption: ExportEncryptionInfo;
  filters: {
    subjectType: 'Subject1' | 'Subject2' | 'Subject3' | 'SubjectAuthorized';
    dateRange: {
      dateType: 'Issue' | 'Invoicing' | 'PermanentStorage';
      from: string;
      to?: string;
    };
  };
}

/** Response from POST /invoices/exports */
export interface ExportInitResponse {
  referenceNumber: string;
}

/** A single part of a multi-part export package */
export interface ExportPackagePart {
  ordinalNumber: number;
  partName: string;
  method: string;
  /** Pre-signed URL — no Authorization header needed */
  url: string;
  partSize?: number;
  partHash?: string;
  encryptedPartSize?: number;
  encryptedPartHash?: string;
  expirationDate?: string;
}

/** The package object inside the export status response */
export interface ExportPackage {
  invoiceCount?: number;
  size?: number;
  parts: ExportPackagePart[];
  /** If true, export hit the 10 000 invoice / 1 GB limit; do another export from lastPermanentStorageDate */
  isTruncated?: boolean;
  lastPermanentStorageDate?: string;
  permanentStorageHwmDate?: string;
}

/** Status response from GET /invoices/exports/{referenceNumber} */
export interface ExportStatusResponse {
  referenceNumber?: string;
  completedDate?: string;
  status: {
    code: number;
    description: string;
    details?: string[];
  };
  /** Singular "package" — not an array */
  package?: ExportPackage;
  [key: string]: unknown;
}

/**
 * Keys generated locally for a single export operation.
 * Keep these in memory — they are not stored to disk.
 */
export interface ExportKeyMaterial {
  aesKey: Buffer;
  iv: Buffer;
}

// ---------------------------------------------------------------------------

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
