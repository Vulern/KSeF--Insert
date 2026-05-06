# 🔌 KSeF API Documentation

Technical reference for KSeF API 2.x integration used by this project.

## Environments

### Test Environment
```
Base URL: https://api-test.ksef.mf.gov.pl/v2
Purpose: Development and testing
Real invoices: No
Tax reporting: No impact
```

### Production Environment
```
Base URL: https://api.ksef.mf.gov.pl/v2
Purpose: Real invoice handling
Real invoices: Yes
Tax reporting: Yes (officially recorded)
⚠️ Warning: Changes affect tax records
```

**Note**: This project is configured to use **Production** by default (unless `KSEF_BASE_URL` overrides it).

---

## Authentication

### Tokens used by KSeF API 2.x

This project starts from a **KSeF token** (system token from the portal) and exchanges it for:
- **`accessToken` (JWT)**: used for API calls via `Authorization: Bearer {accessToken}`
- **`refreshToken` (JWT)**: used only for refreshing access via `POST /auth/token/refresh`

### Authentication Flow (KSeF token → access/refresh tokens)

```
1) POST /auth/challenge
   → { challenge, timestampMs }

2) GET /security/public-key-certificates
   → pick certificate with usage "KsefTokenEncryption"

3) Encrypt string: "{ksefToken}|{timestampMs}" using RSA-OAEP with SHA-256, Base64 output

4) POST /auth/ksef-token
   Body:
   {
     "challenge": "...",
     "contextIdentifier": { "type": "Nip", "value": "5213000001" },
     "encryptedToken": "base64..."
   }
   → { referenceNumber, authenticationToken }

5) Poll GET /auth/{referenceNumber} with header:
   Authorization: Bearer {authenticationToken}
   until status.code != 100 (in progress) and expect 200 (success)

6) POST /auth/token/redeem with header:
   Authorization: Bearer {authenticationToken}
   → { accessToken, refreshToken }

7) Use accessToken for all protected endpoints.
   When accessToken expires, refresh:
   POST /auth/token/refresh with header Authorization: Bearer {refreshToken}
```

### Error Handling

If token expires:
```json
{
  "code": "AUTH_001",
  "message": "Token expired or invalid",
  "statusCode": 401
}
```

**Solution**: Generate new token from portal

---

## Endpoints

### 1. Query Invoices

```
POST /invoices/query/metadata
```

**Parameters:**
```json
{
  "pageSize": 100,           // Max items per page
  "pageOffset": 0,           // Pagination offset
  "queryCriteria": {
    "subjectType": "subject_type.buyer",  // or "subject_type.seller"
    "dateFrom": "2024-01-01",
    "dateTo": "2024-01-31",
    "status": "invoice_status.new"
  }
}
```

**Response:**
```json
{
  "invoiceHeaderList": [
    {
      "ksefReferenceNumber": "1234567890-20240115-ABC123",
      "invoicingDate": "2024-01-15",
      "issueDate": "2024-01-15",
      "acquisitionTimestamp": "2024-01-15T10:30:00Z",
      "status": "invoice_status.new",
      "sellerNip": "5213000001",
      "buyerNip": "7891234567",
      "invoiceAmount": "1234.56",
      "invoiceCurrency": "PLN"
    }
  ],
  "numberOfElements": 35,
  "pageSize": 100,
  "pageOffset": 0,
  "totalElements": 35
}
```

### 2. Get Invoice XML

```
GET /invoices/ksef/{ksefReferenceNumber}
```

**Example:**
```
GET /invoices/ksef/1234567890-20240115-ABC123
```

**Response:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <UBLVersionID>2.1</UBLVersionID>
  <CustomizationID>urn:cec:names:specification:ubl:schema:xsd:CommonBasicComponents-2</CustomizationID>
  <!-- ... faktury treść ... -->
</Faktura>
```

### 3. Get Invoice Details

```
GET /invoices/{elementReferenceNumber}
```

**Response:**
```json
{
  "elementReferenceNumber": "ref-123",
  "ksefReferenceNumber": "1234567890-20240115-ABC123",
  "processingCode": 200,
  "processingDescription": "OK",
  "invoiceContent": "<xml>...</xml>"
}
```

### 4. Get Invoice Status

```
GET /invoices/{elementReferenceNumber}/status
```

**Response:**
```json
{
  "elementReferenceNumber": "ref-123",
  "processingCode": 200,
  "description": "Invoice successfully received",
  "status": "invoice_status.accepted"
}
```

### 5. Send Invoice

```
POST /invoices
```

**Request:**
```json
{
  "invoiceContent": "<xml>...</xml>",
  "description": "Sending invoice"
}
```

**Response:**
```json
{
  "elementReferenceNumber": "ref-123",
  "processingCode": 201,
  "processingDescription": "Invoice accepted"
}
```

---

## Error Codes

### Authentication Errors

| Code | Message | Solution |
|------|---------|----------|
| AUTH_001 | Token invalid or expired | Refresh token from portal |
| AUTH_002 | NIP not authorized | Check NIP in .env |
| AUTH_003 | Session not found | Re-authenticate |

### Query Errors

| Code | Message | Solution |
|------|---------|----------|
| QUERY_001 | Invalid date range | Check --from and --to dates |
| QUERY_002 | Invalid subject type | Use: zakup, sprzedaz, or wszystkie |
| QUERY_003 | No results found | Expand date range |

### XML Errors

| Code | Message | Solution |
|------|---------|----------|
| XML_001 | Invalid XML structure | Re-download invoice |
| XML_002 | Missing required fields | Contact invoice sender |
| XML_003 | XSD validation failed | Check FA(2) compliance |

### Rate Limit

| Code | Message | Solution |
|------|---------|----------|
| RATE_001 | Too many requests | Wait 1 minute, retry |
| RATE_002 | Daily limit exceeded | Try tomorrow |

### Server Errors

| Code | Message | Solution |
|------|---------|----------|
| SERVER_001 | Internal server error | Retry in 5 minutes |
| SERVER_002 | Service unavailable | Check KSeF status page |
| SERVER_003 | Database connection error | Wait 10 minutes |

---

## Rate Limits

| Limit | Value |
|-------|-------|
| Requests/minute | ~100 |
| Requests/hour | ~5000 |
| Requests/day | ~50000 |
| File size max | 10 MB |
| Batch size max | 1000 invoices |

**Handling**: Client automatically throttles requests. Monitor logs for rate limit warnings.

---

## FA(2) Schema - Key Fields

### Faktura (Invoice)

| Field | Type | Required | Example |
|-------|------|----------|---------|
| UBLVersionID | string | Yes | "2.1" |
| CustomizationID | string | Yes | "urn:cec:names:..." |
| ID | string | Yes | "INV/2024/001" |
| IssueDate | date | Yes | "2024-01-15" |
| DueDate | date | No | "2024-02-15" |
| InvoiceTypeCode | code | Yes | "380" (normal) |
| DocumentCurrencyCode | string | Yes | "PLN" |

### Strona (Party - Seller/Buyer)

| Field | Type | Required | Example |
|-------|------|----------|---------|
| EndpointID | string | Yes | "5213000001" |
| Name | string | Yes | "ACME Inc." |
| PartyTaxScheme/CompanyID | string | Yes | "PL5213000001" |

### Pozycja (Line Item)

| Field | Type | Required | Example |
|-------|------|----------|---------|
| ID | string | Yes | "1" |
| InvoicedQuantity | decimal | Yes | "100.00" |
| LineExtensionAmount | decimal | Yes | "1000.00" |
| Item/Name | string | Yes | "Service description" |
| Price/PriceAmount | decimal | Yes | "10.00" |

### Podsumowanie (Summary)

| Field | Type | Required | Example |
|-------|------|----------|---------|
| LegalMonetaryTotal/LineExtensionAmount | decimal | Yes | "1000.00" |
| LegalMonetaryTotal/TaxExclusiveAmount | decimal | Yes | "1000.00" |
| LegalMonetaryTotal/PayableAmount | decimal | Yes | "1230.00" |

---

## Code Examples

### Query Invoices (JavaScript)

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api-test.ksef.mf.gov.pl/v2',
  headers: {
    // accessToken (JWT) from /auth/token/redeem or /auth/token/refresh
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// Query
const response = await client.post('/invoices/query/metadata', {
  pageSize: 100,
  pageOffset: 0,
  queryCriteria: {
    subjectType: 'subject_type.buyer',
    dateFrom: '2024-01-01',
    dateTo: '2024-01-31'
  }
});

console.log(response.data.invoiceHeaderList);
```

### Get Invoice (JavaScript)

```javascript
const response = await client.get(
  '/invoices/ksef/1234567890-20240115-ABC123'
);

console.log(response.data);
// XML content as string
```

### Error Handling (JavaScript)

```javascript
try {
  const response = await client.get('/invoices', { params });
} catch (error) {
  if (error.response?.status === 401) {
    console.error('Authentication failed - refresh token');
  } else if (error.response?.status === 429) {
    console.error('Rate limited - wait before retry');
  } else {
    console.error('API error:', error.message);
  }
}
```

---

## Headers

### Required Headers

```
Authorization: Bearer {accessToken}
Content-Type: application/json
Accept: application/json
```

### Optional Headers

```
User-Agent: KSeF-Sync/1.0.0
X-Request-ID: {uuid}  (for tracking)
```

### Response Headers

```
Content-Type: application/json
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-15T11:00:00Z
```

---

## Webhook Support

KSeF supports webhooks for real-time invoice notifications (optional).

**Configuration:**
1. KSeF Portal → Settings → Webhooks
2. Add endpoint: `https://your-domain.com/ksef/webhook`
3. Events: `invoice.received`, `invoice.rejected`

**Webhook Payload:**
```json
{
  "event": "invoice.received",
  "ksefReferenceNumber": "1234567890-20240115-ABC123",
  "timestamp": "2024-01-15T10:30:00Z",
  "status": "invoice_status.new"
}
```

---

## Session Management (auth sessions)

KSeF API exposes endpoints for listing/revoking **authentication sessions**:
- `GET /auth/sessions`
- `DELETE /auth/sessions/current`

This project does not create sessions via `/auth/sessions`. It follows the auth-token flow described above and uses `accessToken`/`refreshToken`.

---

## Testing with curl

### Query invoices
```bash
curl -X POST "https://api-test.ksef.mf.gov.pl/v2/invoices/query/metadata" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pageSize": 10,
    "pageOffset": 0,
    "queryCriteria": {
      "subjectType": "subject_type.buyer",
      "dateFrom": "2024-01-01",
      "dateTo": "2024-01-31"
    }
  }'
```

### Get invoice
```bash
curl -X GET "https://api-test.ksef.mf.gov.pl/v2/invoices/ksef/1234567890-20240115-ABC123" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## API Version

**Current**: v2.x  

**Note**: API contracts may change; rely on the bundled OpenAPI (`ksef-docs/open-api.json`) and official KSeF documentation.
