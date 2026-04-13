# KSeF Client Implementation

## Overview

Complete implementation of KSeF (Krajowy System e-Faktur) API client with advanced features including:
- Session management with automatic renewal
- Retry logic with exponential backoff
- Comprehensive error handling
- XML parsing and validation
- Full logging support

## Architecture

### Core Components

1. **KsefClient** (`src/ksef/client.ts`)
   - Main HTTP client for API communication
   - Handles session lifecycle management
   - Implements retry logic and error handling
   - All API endpoints implemented

2. **KsefAuth** (`src/ksef/auth.ts`)
   - High-level authentication wrapper
   - Session state management
   - Automatic token refresh scheduling

3. **XML Parser** (`src/ksef/xml-parser.ts`)
   - XML/object conversion using fast-xml-parser
   - Built-in error handling
   - Field extraction utilities

4. **Error Classes** (`src/errors.ts`)
   - `KsefAuthError` - Authentication failures
   - `KsefApiError` - API errors with details
   - `KsefConnectionError` - Network/timeout errors
   - `KsefValidationError` - Validation errors

5. **Type Definitions** (`src/ksef/types.ts`)
   - Complete TypeScript interfaces for all entities
   - SessionInfo, InvoiceMetadata, QueryParams, etc.

## Features

### Session Management

- **Auto-renewal**: Session automatically re-authenticated when expired
- **Expiry tracking**: 30-minute session tracking
- **Multiple operations**: Execute all API operations within session context

```typescript
const client = new KsefClient();
const sessionInfo = await client.authenticate(nip, token);
// Session valid for 30 minutes from now
// Session automatically renewed when needed
```

### Retry Logic

- **3 retry attempts** for 5xx errors and timeouts
- **Exponential backoff**: 1s → 3s → 9s
- **Smart retry**: Never retries 4xx errors (except 403 session expired)
- **Configurable**: `client.setRetryConfig()`

```typescript
// Automatically retried with backoff
try {
  const result = await client.sendInvoice(xml);
} catch (error) {
  // Only thrown after exhausting retries
}
```

### Error Handling

```typescript
import { KsefAuthError, KsefApiError, KsefConnectionError } from './errors';

try {
  await client.sendInvoice(xml);
} catch (error) {
  if (error instanceof KsefAuthError) {
    // Handle authentication errors
  } else if (error instanceof KsefApiError) {
    // Handle API errors
    console.log(error.statusCode, error.details);
  } else if (error instanceof KsefConnectionError) {
    // Handle connection errors
  }
}
```

### API Methods

#### Authentication
```typescript
// Authenticate and create session
const sessionInfo = await client.authenticate(nip, token);

// Terminate session
await client.terminateSession();

// Check session validity
const isValid = client.isSessionValid();
```

#### Invoices
```typescript
// Send invoice
const result = await client.sendInvoice(invoiceXml);
// Returns: { elementReferenceNumber, processingCode }

// Get invoice by KSeF number
const invoice = await client.getInvoice(ksefNumber);

// Query invoices with filters
const page = await client.queryInvoices({
  pageSize: 100,
  pageOffset: 0,
  queryCriteria: {
    dateFrom: '2025-01-01',
    dateTo: '2025-12-31'
  }
});

// Get invoice status
const status = await client.getInvoiceStatus(elementRefNumber);
```

#### Session Management
```typescript
// List active sessions
const sessions = await client.listActiveSessions();

// Get current session info
const current = client.getCurrentSession();
```

## Usage Example

```typescript
import { KsefClient, KsefAuth, createAuth } from './src/ksef/index.js';
import { config } from './src/config.js';

async function main() {
  // Create client
  const client = new KsefClient({
    baseUrl: 'https://api.ksef.mf.gov.pl/v2',
    token: config.ksef.token,
    nip: config.ksef.nip,
    timeout: 30000,
  });

  // Create auth manager
  const auth = createAuth(client);

  try {
    // Authenticate
    const sessionInfo = await auth.authenticate(
      config.ksef.nip!,
      config.ksef.token!
    );

    // Query invoices
    const invoices = await client.queryInvoices({
      pageSize: 100,
    });

    // Send invoice
    const invoiceXml = '<Invoice>...</Invoice>';
    const result = await client.sendInvoice(invoiceXml);

    // Get status
    const status = await client.getInvoiceStatus(
      result.elementReferenceNumber
    );

    // Cleanup
    await auth.logout();
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## Testing

Run tests with vitest:

```bash
# Run all tests
npm run test

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Run specific test file
npm run test tests/ksef/client.test.ts

# Watch mode
npm run test -- --watch
```

### Test Coverage

- ✅ Successful authentication
- ✅ Invalid credentials error handling
- ✅ Session management (create, validate, terminate)
- ✅ Retry logic with exponential backoff
- ✅ 5xx error retries
- ✅ 4xx error no-retry (except 403)
- ✅ Timeout handling and retries
- ✅ Invoice operations (send, get, query, status)
- ✅ Session expiry and re-authentication
- ✅ Error details capturing

## Configuration

Set environment variables in `.env`:

```env
KSEF_BASE_URL=https://api.ksef.mf.gov.pl/v2
KSEF_TOKEN=your-api-token
KSEF_NIP=your-nip-number
INSERT_OUTPUT_DIR=./output
INSERT_CSV_DELIMITER=;
INSERT_CSV_ENCODING=win1250
LOG_LEVEL=info
```

## Logging

Logger configured at different levels:

```typescript
// DEBUG level logs all request/response details
// INFO logs important operations
// WARN logs warnings (retries, etc.)
// ERROR logs all errors

// Enable debug logging:
process.env.LOG_LEVEL = 'debug';
```

## Error Codes

### Authentication Errors
- `SESSION_EXPIRED` (403) - Session invalid/expired
- `AUTHENTICATION_FAILED` - Initial authentication failed
- `INVALID_RESPONSE` - Invalid API response

### API Errors
- `API_ERROR` - General API error
- `EMPTY_RESPONSE` - No data in response
- `INVALID_RESPONSE` - Malformed response

### Connection Errors
- `RETRY_EXHAUSTED` - All retries failed
- `CONNECTION_ERROR` - Network/timeout errors
- `UNKNOWN_ERROR` - Unexpected error

## Performance

- **Timeout**: 30 seconds per request
- **Session validity**: 30 minutes
- **Max page size**: 100 invoices
- **Retry overhead**: Max 1 + 3 + 9 seconds (13 seconds total)

## Known Limitations

1. **Authentication XML**: Currently uses Bearer token (v2 API). For v3/XML-based auth, implement according to KSeF docs.
2. **Token Refresh**: v2 API requires re-authentication. v3 API might support refresh tokens.
3. **Batch Operations**: Single invoice send per request; implement batch handling in application layer.

## Future Enhancements

- [ ] XML-based authentication (v3 API)
- [ ] Token refresh endpoint support
- [ ] Batch invoice operations
- [ ] Caching layer for frequently accessed data
- [ ] Webhook support for async notifications
- [ ] Circuit breaker pattern
- [ ] Request queuing/rate limiting
