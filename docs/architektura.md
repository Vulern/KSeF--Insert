# Architektura projektu KSeF-Insert Integration

## Przegląd

Projekt integruje system KSeF (Krajowy System e-Faktur) z programem Insert (desktop). Poniżej opisana jest architektura rozwiązania.

## Struktura katalogów

```
src/
├── ksef/              # Moduł komunikacji z API KSeF
├── insert/            # Moduł eksportu do Insert
├── transformer/       # Moduł transformacji danych
├── config.ts          # Konfiguracja z .env
├── errors.ts          # Custom error classes
├── logger.ts          # Logger
└── index.ts           # Entry point / CLI
```

## Komponenty

### KSeF (`src/ksef/`)

- `client.ts` - HTTP client do API KSeF (axios)
- `types.ts` - Interfejsy dla danych z KSeF
- `auth.ts` - Obsługa autentykacji i sesji
- `xml-parser.ts` - Parsowanie XML FA-2

### Insert (`src/insert/`)

- `types.ts` - Interfejsy dla formatu Insert
- `csv-writer.ts` - Generowanie CSV (windows-1250)
- `validators.ts` - Walidacja (zod)

### Transformer (`src/transformer/`)

- `mapper.ts` - Konwersja KSeF → Insert
- `date-utils.ts` - Konwersja dat (ISO → DD.MM.YYYY)
- `number-utils.ts` - Konwersja liczb (. → ,)

### Core

- `config.ts` - Walidacja konfiguracji z `.env` (zod)
- `errors.ts` - Custom rozszerzenia Error
- `logger.ts` - Logger (console wrapper, pozniej pino)

## Flow danych

1. **Pobranie z KSeF** → XML FA-2
2. **Parsowanie** → Obiekty TypeScript
3. **Transformacja** → Format Insert
4. **Walidacja** → Zod schemas
5. **Eksport** → CSV (win1250)

## Zależności

- `axios` - HTTP client
- `fast-xml-parser` - Parsowanie XML
- `csv-stringify` - Generowanie CSV
- `iconv-lite` - Encoding (windows-1250)
- `zod` - Walidacja danych
