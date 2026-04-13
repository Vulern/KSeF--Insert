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
  sessionToken: string;
  referenceNumber: string;
  expiryDate: Date;
  createdAt: Date;
}
