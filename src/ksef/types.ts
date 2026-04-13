/**
 * KSeF API Types
 * Interfejsy oraz typy dla faktur z KSeF
 */

export interface KsefInvoice {
  // TODO: Define KSeF invoice structure based on FA-2 schema
}

export interface KsefSession {
  // TODO: Define KSeF session structure
}

export interface KsefResponse<T> {
  // TODO: Define KSeF API response wrapper
  data?: T;
  error?: string;
}
