# 📖 KSeF Sync - Instrukcja użytkownika

Przewodnik dla księgowych i administratorów rozliczeniowych.

## Wstęp

**KSeF Sync** to narzędzie CLI do automatycznego pobierania e-faktur z Krajowego Systemu e-Faktur (KSeF) i zapisywania ich jako pliki XML gotowe do import w programie Insert.

Program obsługuje:
- Pobieranie faktur zakupowych i sprzedażowych
- Automatyczne śledzenie pobranych plików (bez duplikatów)
- Walidację XML vs schemat FA(2)
- Zaplanowane synchronizacje

---

## 1. Wymagania systemowe

### Sprzęt i system operacyjny
- **System**: Windows 10+, macOS 10.14+, Linux (Ubuntu 18.04+)
- **RAM**: Minimum 2 GB (zalecane 4 GB)
- **Dysk**: 1 GB wolnego miejsca na faktury

### Oprogramowanie
- **Node.js 20.0+** ([pobierz ze strony nodejs.org](https://nodejs.org/))
  
  Po pobraniu i zainstalowaniu sprawdź:
  ```bash
  node --version  # Powinno być 20.0 lub wyżej
  npm --version
  ```

### Przygotowanie dostępu do KSeF
1. Zaloguj się na [portal KSeF MF](https://ksef.mf.gov.pl/)
2. Przejdź do ustawień → Integracje
3. Wygeneruj token dostępu (zapisz bezpiecznie!)
4. Sprawdź NIP Twojej firmy

---

## 2. Instalacja

### Krok 1: Pobranie kodu
```bash
# Sklonuj projekt
git clone https://github.com/twoj-username/ksef-sync.git
cd ksef-sync
```

### Krok 2: Zainstalowanie zależności
```bash
npm install
```

### Krok 3: Konfiguracja środowiska
```bash
# Skopiuj plik przykładowy
cp .env.example .env

# Otwórz .env w edytorze i uzupełnij:
# KSEF_TOKEN=tu_wklej_token_z_KSeF
# KSEF_NIP=5213000001
# KSEF_BASE_URL=https://ksef-test.mf.gov.pl/api  (test)
# lub
# KSEF_BASE_URL=https://ksef.mf.gov.pl/api        (produkcja)
```

### Krok 4: Test połączenia
```bash
npm start -- status
# Powinien pokazać: "Ostatnia sync: nigdy" i "Łącznie pobranych: 0 faktur"
```

---

## 3. Konfiguracja (.env)

### Obowiązkowe parametry

| Parametr | Przykład | Opis |
|----------|----------|------|
| `KSEF_TOKEN` | `abc123def456...` | Token dostępu z portalu KSeF |
| `KSEF_NIP` | `5213000001` | 10-cyfrowy NIP Twojej firmy |

### Parametry opcjonalne

| Parametr | Wartość | Opis |
|----------|---------|------|
| `KSEF_BASE_URL` | `https://ksef-test.mf.gov.pl/api` | Test |
| | `https://ksef.mf.gov.pl/api` | Produkcja (domyślnie) |
| `INSERT_OUTPUT_DIR` | `./output` | Gdzie zapisywać pliki (domyślnie `./output`) |
| `INSERT_CSV_DELIMITER` | `;` | Separator w CSV (Windows domyślnie) |
| `INSERT_CSV_ENCODING` | `win1250` | Kodowanie CSV (domyślnie) |
| `LOG_LEVEL` | `info` | Poziom logów: `debug`, `info`, `warn`, `error` |

### Środowisko TEST vs PRODUKCJA

#### TEST (do nauki i testów)
```env
KSEF_BASE_URL=https://ksef-test.mf.gov.pl/api
KSEF_TOKEN=token_testowy
```
- Brak realnych faktur
- Nie wpływa na sprawozdania podatkowe
- Idealny do przetestowania procesu

#### PRODUKCJA (do używania)
```env
KSEF_BASE_URL=https://ksef.mf.gov.pl/api
KSEF_TOKEN=token_produkcyjny
```
- Pobiera **rzeczywiste faktury**
- Wpływa na sprawozdania
- **Uwaga**: Używaj ostrożnie!

---

## 4. Pierwsze uruchomienie

### Poranna synchronizacja

Pobierz faktury z całego miesiąca:
```bash
npm start -- sync --from 2024-01-01 --to 2024-01-31
```

Wynik w terminalu:
```
✅ Synchronizacja zakończona!
─────────────────────────────
📅 Zakres:     2024-01-01 — 2024-01-31
📂 Typ:        faktury zakupowe
📥 Pobrano:    35 nowych faktur
⏭️  Pominięto:  12 (już pobrane)
❌ Błędy:      0
📁 Zapisano w: ./output/faktury/2024-01/zakup/
```

### Pobieranie tylko faktur sprzedażowych
```bash
npm start -- sync --from 2024-01-01 --to 2024-01-31 --type sprzedaz
```

### Pobieranie obu typów
```bash
npm start -- sync --from 2024-01-01 --to 2024-01-31 --type wszystkie
```

### Wymuszenie ponownego pobrania (nadpisanie)
```bash
npm start -- sync --from 2024-01-01 --to 2024-01-31 --force
```

---

## 5. Struktura plików i folderów

Po synchronizacji pliki organizują się w strukturę:

```
output/
└── faktury/
    ├── 2024-01/
    │   ├── zakup/
    │   │   ├── 2024-01-05_5213000001_ref123.xml
    │   │   ├── 2024-01-12_7891234567_ref456.xml
    │   └── sprzedaz/
    │       └── 2024-01-15_1234567890_ref789.xml
    ├── 2024-02/
    │   ├── zakup/
    │   └── sprzedaz/
    └── .index.json  ← nie usuwaj! (śledzenie duplikatów)
```

**Opis struktury:**
- `2024-01/` - miesiąc faktury
- `zakup/` lub `sprzedaz/` - typ faktury
- `2024-01-05_5213000001_ref123.xml` - format: DATA_NIP_KSEFREF

---

## 6. Codzienne użycie

### Sprawdzenie statusu
```bash
npm start -- status
```

Wynik:
```
📊 Status synchronizacji
────────────────────────
Ostatnia sync:    2024-01-15 14:30:22
Łącznie pobranych: 234 faktury
Środowisko:       test
Folder:           ./output/faktury/
```

### Listowanie pobranych faktur
```bash
npm start -- list

# Lub tylko z danego miesiąca:
npm start -- list --month 2024-01
```

### Pobranie konkretnej faktury
```bash
npm start -- get --ref 1234567890-20240115-ABC123
```

### Walidacja plików XML
```bash
npm start -- validate

# Lub konkretny folder:
npm start -- validate --dir ./output/faktury/2024-01/
```

---

## 7. Import do programu Insert

### Gdzie znaleźć pliki
1. Otwórz folder: `./output/faktury/`
2. Przejdź do odpowiedniego miesiąca i typu
3. Pliki XML są gotowe do import

### Jak dodać faktury do Insert
1. W Insert otwórz: `Plik → Import → Faktury XML`
2. Wskaż folder: `./output/faktury/2024-01/zakup/`
3. Insert automatycznie zaimportuje wszystkie XML-e
4. ✅ Faktury pojawią się w księdze

---

## 8. Rozwiązywanie problemów

### ❌ "Błąd autoryzacji KSeF. Sprawdź KSEF_TOKEN w .env"

**Przyczyna**: Token wygasł lub jest nieprawidłowy

**Rozwiązanie**:
1. Zaloguj się do [portalu KSeF](https://ksef.mf.gov.pl/)
2. Przejdź do: Ustawienia → Integracje
3. Wygeneruj **nowy token**
4. Zaktualizuj plik `.env`
5. Spróbuj ponownie: `npm start -- sync --from 2024-01-01 --to 2024-01-31`

### ❌ "Network error. Check KSEF_BASE_URL in .env"

**Przyczyna**: Problem z połączeniem do serwera KSeF

**Rozwiązanie**:
1. Sprawdź połączenie internetowe
2. Sprawdź, czy `KSEF_BASE_URL` jest poprawny:
   - Test: `https://ksef-test.mf.gov.pl/api`
   - Produkcja: `https://ksef.mf.gov.pl/api`
3. Czekaj 5 minut i spróbuj ponownie (serwer może być przeciążony)

### ❌ "No invoices found in the specified date range"

**Przyczyna**: Brak faktur w podanym zakresie dat

**Rozwiązanie**:
1. Sprawdź daty: `--from YYYY-MM-DD --to YYYY-MM-DD`
2. Spróbuj zakresu: `--from 2024-01-01 --to 2024-12-31`
3. Sprawdź typ: `--type wszystkie` (pobiera i zakup i sprzedaż)
4. Upewnij się, że w KSeF istnieją faktury w tym zakresie

### ❌ "XML file cannot be opened in Insert"

**Przyczyna**: Plik XML jest uszkodzony lub ma nieprawidłowy format

**Rozwiązanie**:
1. Waliduj plik: `npm start -- validate`
2. Sprawdź błędy w raporcie
3. Jeśli błąd pozostaje, spróbuj pobrać ponownie: `npm start -- sync --force --from 2024-01-01 --to 2024-01-31`

### ❌ "0 duplicates skipped" ale powinno być więcej

**Przyczyna**: Plik `.index.json` został usunięty lub uszkodzony

**Rozwiązanie**:
1. **NIE USUWAJ** pliku `.index.json` w folderze `./output/faktury/`
2. Ten plik śledzą pobranych faktur
3. Jeśli go usuniesz, program nie będzie wiedzieć które faktury już pobrano

---

## 9. Zaplanowana synchronizacja (scheduler)

Aby faktury pobierały się automatycznie każdego ranka:

### Na Windows (Task Scheduler)
1. Otwórz: `Harmonogram zadań`
2. Kliknij: `Utwórz zadanie`
3. Nazwa: `KSeF Sync Daily`
4. Akcja: `C:\Program Files\nodejs\node.exe`
5. Argumenty: `C:\ścieżka\do\ksef-sync\node_modules\.bin\tsx src/index.ts sync --from 2024-01-01 --to 2024-12-31`
6. Powtarzaj codziennie o 08:00

### Na macOS/Linux (cron)
```bash
# Otwórz crontab
crontab -e

# Dodaj linię (codziennie o 8 rano):
0 8 * * * cd /ścieżka/do/ksef-sync && npm start -- sync --from 2024-01-01 --to 2024-12-31 >> /tmp/ksef-sync.log 2>&1
```

---

## 10. Wsparcie i feedback

Jeśli napotkasz problem:
1. Przeczytaj sekcję "Rozwiązywanie problemów"
2. Sprawdź pliki logów: `npm run dev` (widzi więcej szczegółów)
3. Skontaktuj się: [email do wsparcia]

Czy chcesz się dowiedzieć więcej? Przeczytaj:
- [Dokumentacja techniczna](instrukcja-techniczna.md) - dla administratorów IT
- [API KSeF](ksef-api.md) - szczegóły techniczne API

---

**Licencja**: MIT  
**Wersja**: 1.0.0  
**Ostatnia aktualizacja**: Styczeń 2024
