## Kontekst projektu
Mam działające narzędzie CLI do pobierania e-faktur z KSeF
(TypeScript/Node.js). Klient API, file manager i CLI działają.
Teraz chcę dodać prosty web UI żeby użytkownik nie musiał
korzystać z terminala.

## Pliki do przeczytania
- `src/index.ts` → obecne CLI (commander.js)
- `src/ksef/client.ts` → klient API KSeF
- `src/storage/file-manager.ts` → zarządzanie plikami XML
- `src/storage/index-tracker.ts` → śledzenie pobranych faktur
- `src/config.ts` → konfiguracja .env

## Cel zadania
Dodaj prosty lokalny web UI (localhost:3000).
Użytkownik uruchamia JEDNĄ komendę i dostaje dashboard
w przeglądarce.

## Stack UI
- Serwer: Hono (npm: hono + @hono/node-server)
- Frontend: statyczne pliki HTML/CSS/JS (bez build stepa)
- Styl: prosty, nowoczesny, ciemny motyw
- Ikony: emoji (nie dodawaj bibliotek ikon)
- Responsywność: nie wymagana (desktop only)

## Struktura plików do stworzenia:
├── src/
│   ├── server/
│   │   ├── app.ts           # Hono app + routes
│   │   ├── api.ts           # REST endpointy
│   │   └── server.ts        # startuj serwer + otwórz przeglądarkę
│   └── ui/
│       ├── index.html       # główna strona
│       ├── style.css        # style
│       └── app.js           # logika frontend (vanilla JS)

## API Endpointy (src/server/api.ts):

### GET /api/status
Zwraca aktualny status:
```json
{
  "connected": false,
  "environment": "test",
  "nip": "5213000001",
  "lastSync": "2024-01-15T14:30:00Z",
  "totalInvoices": 234,
  "outputDir": "./output/faktury"
}
POST /api/sync
Rozpoczyna synchronizację:
Body:
{
  "dateFrom": "2024-01-01",
  "dateTo": "2024-01-31",
  "type": "zakup"
}
Response (Server-Sent Events dla progressu):
event: progress
data: {"current": 5, "total": 47, "status": "Pobieram fakturę 5/47..."}

event: progress  
data: {"current": 47, "total": 47, "status": "Zapisuję pliki..."}

event: done
data: {"downloaded": 35, "skipped": 12, "errors": 0}

GET /api/invoices?month=2024-01&type=zakup
Lista pobranych faktur:
{
  "invoices": [
    {
      "ksefRef": "ref123",
      "date": "2024-01-05",
      "nip": "5213000001",
      "fileName": "2024-01-05_521..._ref123.xml",
      "filePath": "./output/faktury/2024-01/zakup/..."
    }
  ],
  "total": 35
}
GET /api/invoices/:ksefRef/download
Pobierz konkretny plik XML (Content-Disposition: attachment).

POST /api/validate
Waliduj pobrane XML-e:
Body: { "month": "2024-01" }
Response: { "total": 35, "valid": 33, "invalid": 2, "errors": [...] }

GET /api/config
Zwraca aktualną konfigurację (bez tokenów!):
{
  "environment": "test",
  "nip": "5213****01",
  "outputDir": "./output/faktury",
  "baseUrl": "https://ksef-test.mf.gov.pl/api"
}

Frontend (src/ui/index.html):
Layout:
┌──────────────────────────────────────────────────┐
│  🧾 KSeF Sync                    ● Połączono     │
├──────────────────────────────────────────────────┤
│                                                   │
│  ┌─ Synchronizacja ────────────────────────────┐ │
│  │                                              │ │
│  │  Od: [2024-01-01]  Do: [2024-01-31]         │ │
│  │                                              │ │
│  │  Typ: (●) Zakup  ( ) Sprzedaż  ( ) Oba     │ │
│  │                                              │ │
│  │  [ 🔄 Synchronizuj ]                        │ │
│  │                                              │ │
│  │  ████████████░░░░░░░░ 24/47 (51%)           │ │
│  │  Pobieram fakturę 24/47...                   │ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Pobrane faktury ──────────────────────────┐  │
│  │                                              │ │
│  │  Miesiąc: [Styczeń 2024 ▼]                  │ │
│  │                                              │ │
│  │  Data       NIP          Nr KSeF      📥    │ │
│  │  2024-01-05 5213000001   ref123...    [⬇]   │ │
│  │  2024-01-12 7891234567   ref456...    [⬇]   │ │
│  │  2024-01-15 1112223334   ref789...    [⬇]   │ │
│  │  ...                                         │ │
│  │                                              │ │
│  │  Łącznie: 35 faktur                          │ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Status ───────────────────────────────────┐  │
│  │  Środowisko:    test                        │ │
│  │  NIP:           5213****01                  │ │
│  │  Ostatnia sync: 2024-01-15 14:30            │ │
│  │  Łącznie:       234 faktury                 │ │
│  │  Folder:        ./output/faktury/           │ │
│  │  [ 📂 Otwórz folder ]                      │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
├──────────────────────────────────────────────────┤
│  KSeF Sync v1.0.0 | Środowisko: test            │
└──────────────────────────────────────────────────┘

Interakcje:
Po załadowaniu strony → fetch /api/status → pokaż dane

Klik "Synchronizuj":
Disable przycisk
Pokaż progress bar
EventSource na /api/sync (SSE)
Po zakończeniu → odśwież listę faktur
Pokaż podsumowanie (toast/alert)

Zmiana miesiąca → fetch /api/invoices?month=...

Klik ⬇ przy fakturze → pobierz XML

Klik "Otwórz folder" → informacja ze ścieżką
(nie możemy otworzyć folderu z przeglądarki)

Styl CSS (src/ui/style.css):
Ciemny motyw (dark mode)
Background: #1a1a2e lub #0f0f1a
Karty: #16213e
Akcent: #0ea5e9 (niebieski)
Tekst: #e2e8f0
Sukces: #22c55e
Błąd: #ef4444
Font: system-ui
Border-radius: 8px
Padding karty: 20px
Max-width: 900px, wycentrowane
Tabela: zebra striping

Server startup (src/server/server.ts):
// 1. Startuj Hono na porcie 3000
// 2. Serwuj statyczne pliki z src/ui/
// 3. Automatycznie otwórz przeglądarkę (open npm package)
// 4. Log: "🧾 KSeF Sync działa na http://localhost:3000"

Zmodyfikuj src/index.ts:
Dodaj komendę:
# Uruchom web UI (domyślna komenda)
npx tsx src/index.ts

# Lub jawnie
npx tsx src/index.ts ui

# Stare komendy CLI nadal działają
npx tsx src/index.ts sync --from 2024-01-01 --to 2024-01-31

Wymagania:
Zero build stepa dla frontendu (vanilla JS)
Serwer i frontend w jednym procesie
SSE (Server-Sent Events) dla progressu sync
Automatyczne otwarcie przeglądarki po starcie
Graceful shutdown (Ctrl+C → zamknij serwer)
Brak autentykacji (localhost only)
Zabezpiecz: serwer nasłuchuje TYLKO na 127.0.0.1
(nie 0.0.0.0 - żeby nie był widoczny w sieci)

Nowe zależności:
hono
@hono/node-server
open (do otwarcia przeglądarki)

Testy
Plik: tests/server/api.test.ts

GET /api/status → 200 + poprawna struktura
GET /api/invoices → lista faktur
GET /api/config → config bez tokenów
POST /api/sync → SSE stream z progressem
GET /api/invoices/:ref/download → plik XML

Nie rób
Nie używaj React, Vue, Svelte (vanilla JS only)
Nie dodawaj build stepa (webpack, vite)
Nie dodawaj autentykacji
Nie słuchaj na 0.0.0.0
Nie modyfikuj istniejących modułów
(ksef client, file manager, index tracker)

Zamiast tego:
$ npx tsx src/index.ts sync --from 2024-01-01 --to 2024-01-31
⬇️ Pobieram: [████████░░░░░░░░] 15/35 (43%)

Użytkownik zobaczy to:
$ npx tsx src/index.ts
🧾 KSeF Sync działa na http://localhost:3000

otwiera się przeglądarka z ładnym dashboardem
klika "Synchronizuj"
widzi progress bar
pobiera pliki jednym klikiem