# 🧾 KSeF Sync - Pobieranie e-faktur z KSeF

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue)](https://www.typescriptlang.org/)

Projekt TypeScript/Node.js do integracji KSeF (Krajowy System e-Faktur) z programem Insert (desktop).

## 🎯 Cechy

- ✅ **KSeF client** (sesje, requesty, retry/error handling)
- ✅ **Storage layer** (zapis XML na dysk, atomic writes, `.index.json` duplikaty)
- ✅ **Walidacja XML**
- ✅ **CLI + Web UI** (lokalne uruchomienie)

## 🚀 Quick Start

### 1. Wymagania
- **Node.js 20+** ([pobierz](https://nodejs.org/))
- **Token KSeF** ([uzyskaj w portalu MF](https://ksef.mf.gov.pl))
- **NIP firmy** (10 cyfr)

### 2. Instalacja
```bash
# Zainstaluj zależności
npm install

# Skopiuj i uzupełnij konfigurację
cp .env.example .env
# Edytuj .env: dodaj KSEF_TOKEN i KSEF_NIP
```

### 3. Pierwsze uruchomienie
```bash
# Pobierz faktury z miesiąca
npm start -- sync --from 2024-01-01 --to 2024-01-31

# Pliki XML pojawią się w ./output/faktury/2024-01/
```

### 4. Import do Insert
1. W Insert: `Plik → Import → Faktury XML`
2. Wskaż: `./output/faktury/2024-01/zakup/`
3. Kliknij Import ✅

## 📋 Komendy CLI

### `sync` - Synchronizacja faktur
```bash
# Faktury zakupowe (domyślnie)
npm start -- sync --from 2024-01-01 --to 2024-01-31

# Faktury sprzedażowe
npm start -- sync --from 2024-01-01 --to 2024-01-31 --type sprzedaz

# Obie strony
npm start -- sync --from 2024-01-01 --to 2024-01-31 --type wszystkie

# Wymuszenie ponownego pobrania
npm start -- sync --from 2024-01-01 --to 2024-01-31 --force
```

### `status` - Status synchronizacji
```bash
npm start -- status
# Pokazuje: ostatnia sync, liczba pobranych, środowisko
```

### `list` - Listowanie faktur
```bash
npm start -- list

# Tylko z danego miesiąca
npm start -- list --month 2024-01
```

### `get` - Pobierz konkretną fakturę
```bash
npm start -- get --ref 1234567890-20240115-ABC123
```

### `validate` - Waliduj XML-e
```bash
npm start -- validate

# Konkretny folder
npm start -- validate --dir ./output/faktury/2024-01/
```

## 📁 Struktura plików

Po synchronizacji:
```
output/faktury/
├── 2024-01/
│   ├── zakup/
│   │   ├── 2024-01-05_5213000001_ref123.xml
│   │   └── 2024-01-12_7891234567_ref456.xml
│   └── sprzedaz/
│       └── 2024-01-15_1234567890_ref789.xml
├── 2024-02/
│   └── ...
└── .index.json  ← nie usuwaj! (śledzenie duplikatów)
```

## ⚙️ Konfiguracja

### .env - Obowiązkowe
```env
KSEF_TOKEN=abc123def456...
KSEF_NIP=5213000001
```

### .env - Opcjonalne
```env
# Środowisko (test / produkcja)
KSEF_BASE_URL=https://ksef-test.mf.gov.pl/api

# Gdzie zapisywać pliki
INSERT_OUTPUT_DIR=./output

# Logowanie
LOG_LEVEL=info
```

## 📖 Dokumentacja

- [📚 Instrukcja użytkownika](docs/instrukcja-uzytkownika.md)
- [🛠️ Instrukcja techniczna](docs/instrukcja-techniczna.md)
- [🏗️ Architektura](docs/architektura.md)
- [🔌 API KSeF (referencja)](docs/ksef-api.md)
- [📝 Changelog](docs/changelog.md)

## 🧪 Testowanie

```bash
# Wszystkie testy
npm test

# Watch mode
npm test -- --watch

# Coverage
npm run test:coverage

# E2E testy
npm test -- tests/e2e/

# Testy z UI
npm run test:ui
```

## 🔧 Developerskie komendy

```bash
npm run dev              # Watch mode
npm run build            # Kompilacja TypeScript
npm run type-check       # Sprawdzenie typów
npm run lint             # Linting
npm run lint:fix         # Fix linting issues
npm run format           # Prettier formatting
```

## 🌍 Środowiska

### TEST
```env
KSEF_BASE_URL=https://ksef-test.mf.gov.pl/api
```
- Do nauki i testów
- Brak realnych faktur
- Nie wpływa na sprawozdania

### PRODUKCJA
```env
KSEF_BASE_URL=https://ksef.mf.gov.pl/api
```
- Rzeczywiste faktury
- Wpływa na sprawozdania
- ⚠️ Używaj ostrożnie!

### ❌ "Token expired"
```bash
# Wygeneruj nowy token w portalu KSeF
# Zaktualizuj .env
KSEF_TOKEN=nowy_token_tutaj
```

### ❌ "No invoices found"
```bash
# Spróbuj szerszego zakresu dat
npm start -- sync --from 2024-01-01 --to 2024-12-31

# Lub wszystkich typów
npm start -- sync --type wszystkie --from 2024-01-01 --to 2024-01-31
```

### ❌ "Validation error"
```bash
# Waliduj pliki
npm start -- validate

# Sprawdź logi
LOG_LEVEL=debug npm start -- sync --from 2024-01-01 --to 2024-01-31
```

## 📚 Zasoby

- [KSeF Official Portal](https://ksef.mf.gov.pl)
- [Ministerstwo Finansów - KSeF](https://www.mf.gov.pl/ksef)
- [FA(2) Schema Spec](https://www.mf.gov.pl)

## 📋 Licencja

MIT License - zobacz [LICENSE](LICENSE) dla szczegółów

---

## 📞 Wsparcie

- 📖 [Instrukcja użytkownika](docs/instrukcja-uzytkownika.md) - odpowiedzi na pytania
- 🛠️ [Instrukcja techniczna](docs/instrukcja-techniczna.md) - dla administratorów IT
- 🔌 [API Docs](docs/ksef-api.md) - szczegóły techniczne