Architektura logowania
Źródła logów:
├── KSeF Client     → requesty HTTP, auth, błędy API
├── File Manager    → zapis/odczyt plików, duplikaty
├── XML Validator   → wyniki walidacji
├── Web Server      → requesty do UI, SSE
├── CLI             → komendy użytkownika
└── System          → startup, shutdown, config

Gdzie trafiają:
├── Konsola         → kolorowe, skrócone (dla usera)
├── Plik .log       → pełne, structured JSON (dla Ciebie)
└── UI              → ostatnie zdarzenia w dashboardzie

System logowania i monitoringu
## Kontekst projektu
Mam działające narzędzie KSeF Sync (TypeScript/Node.js):
- ✅ KSeF Client
- ✅ File Manager
- ✅ CLI + Web UI
Teraz potrzebuję profesjonalnego systemu logowania
i monitoringu żeby móc utrzymywać aplikację
i diagnozować problemy użytkowników.

## Pliki do przeczytania
- `src/logger.ts` → istniejący szkielet loggera
- `src/ksef/client.ts` → do dodania logów
- `src/storage/file-manager.ts` → do dodania logów
- `src/server/app.ts` → do dodania logów
- `src/config.ts` → konfiguracja

## Cel zadania
1. Profesjonalny logger (pino)
2. Logi do pliku (rotacja)
3. Logi w Web UI (live feed)
4. Health check endpoint
5. Error tracking

## Stack
- Logger: pino + pino-pretty (konsola) + pino-roll (rotacja plików)
- Nowe zależności: pino, pino-pretty, pino-roll

---

### Część 1: Logger (src/logger.ts)

```typescript
// Konfiguracja z .env:
// LOG_LEVEL=info          (debug|info|warn|error)
// LOG_DIR=./logs          (folder na logi)
// LOG_MAX_SIZE=10m        (max rozmiar pliku)  
// LOG_MAX_FILES=30        (ile plików trzymać = 30 dni)

import pino from 'pino';

// Stwórz fabrykę loggerów z child loggerami per moduł:
const logger = createLogger();

// Użycie w modułach:
const ksefLogger = logger.child({ module: 'ksef-client' });
const storageLogger = logger.child({ module: 'file-manager' });
const serverLogger = logger.child({ module: 'web-server' });
const validatorLogger = logger.child({ module: 'xml-validator' });

// Każdy log MUSI mieć:
// - timestamp (ISO 8601)
// - level (debug/info/warn/error)
// - module (który moduł)
// - message (co się stało)
// - kontekst (dodatkowe dane jako obiekt)

Dwa outputy jednocześnie:
1. Konsola (dla użytkownika):
Kolorowe, czytelne, skrócone:

14:30:01 INFO  [ksef] 🔐 Sesja otwarta (token: abc...xyz)
14:30:02 INFO  [ksef] 🔍 Query: 2024-01-01 — 2024-01-31, zakup
14:30:03 INFO  [ksef] 📋 Znaleziono 47 faktur
14:30:04 INFO  [ksef] ⬇️  Pobrano 1/47: ref123456
14:30:05 WARN  [ksef] ⚠️  Retry 1/3: timeout na ref789012
14:30:08 INFO  [ksef] ⬇️  Pobrano 2/47: ref789012 (po retry)
14:30:45 INFO  [storage] 💾 Zapisano 35 plików w ./output/2024-01/
14:30:45 INFO  [storage] ⏭️  Pominięto 12 duplikatów
14:30:46 INFO  [ksef] 🔓 Sesja zamknięta
14:30:46 ERROR [ksef] ❌ Nie udało się pobrać 2 faktur:
                        - ref111: 500 Internal Server Error
                        - ref222: timeout po 3 próbach

2. Plik JSON (dla developera/maintenance):
Lokalizacja: ./logs/ksef-sync-2024-01-15.log
Format: JSON Lines (jedna linia = jeden wpis)
Rotacja: nowy plik co dzień, max 30 plików

Przykład linii:
```json
{"timestamp":"2024-01-15T14:30:05.123Z","level":"warn","module":"ksef-client","msg":"Request retry","context":{"attempt":1,"maxAttempts":3,"url":"/api/online/Invoice/Get/ref789012","error":"ETIMEDOUT","responseTime":30002}}
{"timestamp":"2024-01-15T14:30:08.456Z","level":"info","module":"ksef-client","msg":"Invoice downloaded","context":{"ksefRef":"ref789012","attempt":2,"responseTime":2341,"size":4521}}
{"timestamp":"2024-01-15T14:30:45.789Z","level":"info","module":"file-manager","msg":"Batch save complete","context":{"saved":35,"skipped":12,"errors":0,"duration":1234,"outputDir":"./output/faktury/2024-01/zakup"}}
{"timestamp":"2024-01-15T14:30:46.012Z","level":"error","module":"ksef-client","msg":"Failed to download invoices","context":{"failed":[{"ref":"ref111","error":"500 Internal Server Error","attempts":3},{"ref":"ref222","error":"ETIMEDOUT","attempts":3}]}}```

Część 2: Co logować w każdym module
KSeF Client (src/ksef/client.ts):
// AUTH
ksefLogger.info({ env: config.env, nip: maskNip(config.nip) }, 
  'Inicjalizacja sesji');
ksefLogger.info({ sessionId: mask(token), expiresAt }, 
  'Sesja otwarta');
ksefLogger.warn({ reason }, 
  'Sesja wygasła, odnawiam');
ksefLogger.error({ statusCode, body: truncate(body, 500) }, 
  'Błąd autentykacji');

// REQUESTY
ksefLogger.debug({ method, url, headers: sanitize(headers) }, 
  'Request wysłany');
ksefLogger.debug({ statusCode, responseTime, size }, 
  'Response otrzymany');

// QUERY
ksefLogger.info({ dateFrom, dateTo, subjectType }, 
  'Query faktur');
ksefLogger.info({ found: count, pages }, 
  'Wyniki query');

// POBIERANIE
ksefLogger.info({ ksefRef, current, total }, 
  'Pobrano fakturę');
ksefLogger.warn({ ksefRef, attempt, maxAttempts, error: err.message }, 
  'Retry pobierania');
ksefLogger.error({ ksefRef, attempts, lastError: err.message }, 
  'Nie udało się pobrać faktury');

// RATE LIMIT
ksefLogger.warn({ retryAfter, endpoint }, 
  'Rate limit, czekam');

// SESJA
ksefLogger.info('Sesja zamknięta');

File Manager (src/storage/file-manager.ts):
// ZAPIS
storageLogger.info({ fileName, dir, size },
  'Faktura zapisana');
storageLogger.debug({ ksefRef, filePath },
  'Ścieżka pliku');
storageLogger.info({ ksefRef },
  'Pominięto duplikat');
storageLogger.error({ filePath, error: err.message },
  'Błąd zapisu pliku');

// BATCH
storageLogger.info({ saved, skipped, errors, duration },
  'Batch zapis zakończony');

// INDEX
storageLogger.debug({ entries: count },
  'Index załadowany');
storageLogger.warn({ indexPath, error: err.message },
  'Błąd odczytu indexu, tworzę nowy');

// FOLDER
storageLogger.info({ dir },
  'Utworzono katalog');
storageLogger.error({ dir, error: err.message },
  'Brak uprawnień do zapisu');

  Web Server (src/server/app.ts):
  // REQUEST LOG (middleware)
serverLogger.info({ method, path, statusCode, responseTime },
  'HTTP request');

// SSE
serverLogger.debug({ clientId, event },
  'SSE event wysłany');

// STARTUP
serverLogger.info({ port, host: '127.0.0.1' },
  'Serwer uruchomiony');

// SHUTDOWN  
serverLogger.info({ reason },
  'Serwer zatrzymany');

  Część 3: Maskowanie wrażliwych danych
  // src/utils/sanitize.ts

// NIGDY nie loguj pełnych tokenów, kluczy API, pełnych NIP-ów

function maskNip(nip: string): string {
  // "5213000001" → "5213****01"
  return nip.slice(0, 4) + '****' + nip.slice(-2);
}

function maskToken(token: string): string {
  // "abc123def456ghi789" → "abc1...i789"
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '...' + token.slice(-4);
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  // Ukryj Authorization, SessionToken
  const sanitized = { ...headers };
  if (sanitized['Authorization']) sanitized['Authorization'] = '***';
  if (sanitized['SessionToken']) sanitized['SessionToken'] = maskToken(sanitized['SessionToken']);
  return sanitized;
}

function truncateBody(body: string, maxLength = 500): string {
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength) + `... (truncated, full: ${body.length} chars)`;
}

Część 4: Health Check + diagnostyka w Web UI
Nowy endpoint: GET /api/health
{
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0",
  "checks": {
    "ksef": {
      "status": "ok",
      "lastContact": "2024-01-15T14:30:00Z",
      "environment": "test",
      "latency": 234
    },
    "storage": {
      "status": "ok",
      "outputDir": "./output/faktury",
      "diskSpace": "2.3 GB free",
      "writable": true,
      "totalInvoices": 234
    },
    "config": {
      "status": "ok",
      "envFile": true,
      "tokenSet": true,
      "nipSet": true
    }
  }
}

Nowy endpoint: GET /api/logs?lines=100&level=error&module=ksef
{
  "logs": [
    {
      "timestamp": "2024-01-15T14:30:05Z",
      "level": "error",
      "module": "ksef-client",
      "msg": "Nie udało się pobrać faktury",
      "context": { "ksefRef": "ref111", "error": "500" }
    }
  ],
  "total": 5,
  "filters": { "level": "error", "module": "ksef" }
}
Nowy endpoint: GET /api/logs/download
Pobierz pełny plik logów z dzisiaj jako attachment.

Web UI - nowa sekcja w index.html:
┌─ Diagnostyka ──────────────────────────────────┐
│                                                  │
│  System:  ● Healthy          Uptime: 1h 23m     │
│  KSeF:    ● Połączony        Latency: 234ms     │
│  Dysk:    ● OK               Wolne: 2.3 GB      │
│  Config:  ● OK               Env: test           │
│                                                  │
│  ┌─ Ostatnie zdarzenia ─────────────────────┐   │
│  │ 14:30 ❌ [ksef] Nie udało się pobrać ref111│   │
│  │ 14:30 ✅ [storage] Zapisano 35 faktur      │   │
│  │ 14:29 ⚠️ [ksef] Retry 1/3: timeout        │   │
│  │ 14:28 ℹ️ [ksef] Pobrano 44/47              │   │
│  │ ...                                        │   │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Filtr: [Wszystkie ▼] [Tylko błędy] [ksef ▼]   │
│                                                  │
│  [ 📥 Pobierz logi ] [ 🔄 Odśwież ]            │
│                                                  │
└──────────────────────────────────────────────────┘

Live feed logów przez SSE:
// Endpoint: GET /api/logs/stream
// Server-Sent Events - logi w czasie rzeczywistym

// Frontend:
const eventSource = new EventSource('/api/logs/stream');
eventSource.onmessage = (event) => {
  const log = JSON.parse(event.data);
  appendLogToUI(log);
};

Część 5: Error handling + diagnostyka
Plik: src/errors.ts (rozszerz istniejący)
// Każdy custom error MUSI zawierać:
// - message: co się stało (po polsku dla logów)
// - code: unikalny kod błędu (dla maintenance)
// - context: dodatkowe dane do diagnostyki
// - suggestion: co może zrobić użytkownik

class KSeFSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context: Record<string, unknown>,
    public readonly suggestion?: string
  ) {
    super(message);
  }
}

// Kody błędów:
// KSEF_AUTH_001  → Token wygasł lub nieprawidłowy
// KSEF_AUTH_002  → Brak tokenu w konfiguracji
// KSEF_AUTH_003  → NIP nie pasuje do tokenu
// KSEF_CONN_001 → Timeout połączenia z KSeF
// KSEF_CONN_002 → KSeF niedostępny (503)
// KSEF_CONN_003 → Błąd DNS / brak internetu
// KSEF_API_001  → Nieoczekiwana odpowiedź API
// KSEF_API_002  → Rate limit exceeded
// KSEF_API_003  → Faktura nie znaleziona
// STOR_WRITE_001 → Brak uprawnień do zapisu
// STOR_WRITE_002 → Brak miejsca na dysku
// STOR_READ_001  → Uszkodzony plik indeksu
// CONF_001       → Brak pliku .env
// CONF_002       → Nieprawidłowa wartość w .env
// VAL_001        → XML nie przechodzi walidacji XSD

// Przykład użycia:
throw new KSeFSyncError(
  'Nie udało się połączyć z KSeF',
  'KSEF_CONN_001',
  { url: baseUrl, timeout: 30000, attempts: 3 },
  'Sprawdź połączenie internetowe. Jeśli problem się powtarza, ' +
  'serwer KSeF może być niedostępny - spróbuj za kilka minut.'
);

Globalny error handler:
// src/utils/error-handler.ts

function handleError(error: unknown, logger: Logger): void {
  if (error instanceof KSeFSyncError) {
    logger.error({
      code: error.code,
      context: error.context,
      suggestion: error.suggestion,
      stack: error.stack
    }, error.message);
  } else if (error instanceof Error) {
    logger.error({
      code: 'UNKNOWN_001',
      stack: error.stack
    }, `Nieoczekiwany błąd: ${error.message}`);
  } else {
    logger.error({
      code: 'UNKNOWN_002',
      raw: String(error)
    }, 'Nieoczekiwany błąd nieznanego typu');
  }
}

Część 6: Diagnostyczny raport
Nowa komenda CLI i endpoint:
npx tsx src/index.ts diagnose
// Endpoint: GET /api/diagnose

// Sprawdza WSZYSTKO i zwraca raport:
{
  "timestamp": "2024-01-15T14:30:00Z",
  "version": "1.0.0",
  "node": "v20.10.0",
  "os": "win32 x64",
  "checks": [
    {
      "name": "Plik .env",
      "status": "pass",
      "detail": "Znaleziono, wszystkie wymagane pola ustawione"
    },
    {
      "name": "Połączenie z KSeF",
      "status": "pass",
      "detail": "Odpowiedź w 234ms (test environment)"
    },
    {
      "name": "Autentykacja KSeF",
      "status": "fail",
      "detail": "Token wygasł 2024-01-10",
      "suggestion": "Wygeneruj nowy token na stronie KSeF"
    },
    {
      "name": "Folder output",
      "status": "pass",
      "detail": "./output/faktury - istnieje, zapisywalny, 2.3 GB wolne"
    },
    {
      "name": "Plik indeksu",
      "status": "pass",
      "detail": "234 wpisów, ostatni sync 2024-01-15"
    },
    {
      "name": "Schemat XSD",
      "status": "pass",
      "detail": "schemas/FA(2).xsd - obecny"
    }
  ],
  "recentErrors": [
    {
      "timestamp": "2024-01-15T13:00:00Z",
      "code": "KSEF_CONN_001",
      "message": "Timeout",
      "count": 3
    }
  ]
}
W konsoli:
🔍 Diagnostyka KSeF Sync
═══════════════════════════

✅ Plik .env            Znaleziono, kompletny
✅ Połączenie z KSeF    234ms (test)
❌ Autentykacja KSeF    Token wygasł 2024-01-10
   💡 Wygeneruj nowy token na stronie KSeF
✅ Folder output        2.3 GB wolne
✅ Plik indeksu         234 faktur
✅ Schemat XSD          FA(2).xsd obecny

Ostatnie błędy (24h):
  ⚠️ KSEF_CONN_001 (x3): Timeout połączenia

Raport zapisany: ./logs/diagnose-2024-01-15.json

Część 7: Aktualizacja .env.example
Dodaj do .env.example:
# Logowanie
LOG_LEVEL=info              # debug|info|warn|error
LOG_DIR=./logs              # folder na pliki logów
LOG_MAX_SIZE=10m            # max rozmiar jednego pliku
LOG_MAX_FILES=30            # ile dni logów trzymać
LOG_CONSOLE=true            # logi w konsoli
LOG_FILE=true               # logi do pliku

Wymagania:
Dwa outputy: konsola (pretty) + plik (JSON lines)
Rotacja plików logów (dziennie, max 30 plików)
NIGDY nie loguj pełnych tokenów, kluczy, NIP-ów
Kody błędów z prefiksem modułu (KSEF_, STOR_, CONF_)
Każdy error z suggestion dla użytkownika
Live log feed w UI przez SSE
Endpoint diagnostyczny
Child loggery per moduł

Testy:
Plik: tests/logger.test.ts

Logger tworzy child z modułem
Plik logów tworzony w LOG_DIR
Maskowanie NIP → "5213****01"
Maskowanie tokenu → "abc1...i789"
KSeFSyncError ma code + context + suggestion
Health check zwraca poprawną strukturę
Diagnose wykrywa brak .env
Diagnose wykrywa brak schematu XSD
Log rotation (mock fs)
Filtrowanie logów po level i module

Nowe zależności:
pino
pino-pretty
pino-roll (lub pino-rotating-file-stream)

Nie rób
Nie modyfikuj logiki biznesowej (ksef client, file manager)
Tylko DODAJ logi do istniejących funkcji
Nie loguj danych osobowych (poza zamaskowanym NIP)
Nie loguj pełnej treści XML faktur (tylko metadane)
Nie dodawaj zewnętrznych serwisów (Sentry, Datadog)
Wszystko lokalne

## Struktura logów po wdrożeniu
./logs/
├── ksef-sync-2024-01-15.log # dzienny log (JSON lines)
├── ksef-sync-2024-01-14.log
├── ksef-sync-2024-01-13.log
├── ... # max 30 plików
└── diagnose-2024-01-15.json # ostatni raport diagnostyczny