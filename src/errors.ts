/**
 * KSeF Error Classes
 */

export class KsefError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'KsefError';
  }
}

export class KsefAuthError extends KsefError {
  constructor(message: string, code: string = 'AUTH_ERROR', statusCode?: number) {
    super(message, code, statusCode);
    this.name = 'KsefAuthError';
  }
}

export class KsefApiError extends KsefError {
  constructor(
    message: string,
    code: string = 'API_ERROR',
    statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message, code, statusCode);
    this.name = 'KsefApiError';
  }
}

export class KsefConnectionError extends KsefError {
  constructor(message: string, code: string = 'CONNECTION_ERROR', statusCode?: number) {
    super(message, code, statusCode);
    this.name = 'KsefConnectionError';
  }
}

export class KsefValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'KsefValidationError';
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class TransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransformError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
