# KSeF API

## Dokumentacja

Więcej informacji: https://www.mf.gov.pl/ksef

## Autentykacja

- Endpoint: `POST /api/v3/Authenticate`
- Wymagane: NIP, token API
- Zwraca: Session token

## Operacje

### Wysłanie faktury

- Endpoint: `POST /api/v3/invoices/{sessionToken}`
- Format: XML FA-2
- Zwraca: ReferenceNumber

### Pobieranie faktury

- Endpoint: `GET /api/v3/invoices/{invoiceId}`
- Zwraca: XML FA-2

### Status

- Endpoint: `GET /api/v3/status/{sessionToken}`
- Zwraca: Status sesji

## Kody błędów

- `401` - Unauthorized
- `400` - Bad Request
- `500` - Server Error

## TODO

- [ ] Zaimplementować pełną obsługę API
- [ ] Dodać retry logic
- [ ] Obsługę rate limiting
