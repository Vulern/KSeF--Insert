text


---

### Prompt 5: Dokumentacja + walidacja XSD

```markdown
## Kontekst projektu
Narzędzie CLI do pobierania e-faktur z KSeF (TypeScript).
Wszystko działa:
- ✅ KSeF Client
- ✅ File Manager + Index Tracker
- ✅ CLI (sync, list, status, get)
Teraz: dokumentacja po polsku + walidator XSD.

## Pliki do przeczytania
- Wszystkie pliki w `src/`
- `README.md`

## Cel zadania
1. Walidator XML vs schemat FA(2)
2. Kompletna dokumentacja

---

### Część 1: Walidator XML

## Plik: `src/validator/xml-validator.ts`

```typescript
class InvoiceXMLValidator {
  constructor(xsdPath: string)  // ścieżka do FA(2).xsd
  
  // Waliduj pojedynczy plik
  async validate(xmlPath: string): Promise<ValidationResult>
  // → { valid: boolean, errors: ValidationError[] }
  
  // Waliduj folder
  async validateDir(dirPath: string): Promise<BatchValidationResult>
  // → { total, valid, invalid, results[] }
}
Użyj biblioteki libxmljs2 (obsługuje XSD validation)
lub alternatywnie xsd-schema-validator.

Output walidacji:

text

🔍 Walidacja XML vs schemat FA(2)
──────────────────────────────────
 ✅ 2024-01-05_521..._ref123.xml
 ✅ 2024-01-12_789..._ref987.xml
 ❌ 2024-01-15_111..._ref555.xml
    → Linia 23: Element 'P_1' - wymagany ale brak wartości
    → Linia 45: Element 'NIP' - wartość '123' nie spełnia wzorca

 Wynik: 2/3 poprawne
Część 2: Dokumentacja
Plik: docs/instrukcja-uzytkownika.md
Dla księgowego (osoba nietechniczna):

Co robi program (2 zdania)
Wymagania:
Komputer z Windows/Mac/Linux
Node.js 20+ (link do pobrania + jak zainstalować)
Token KSeF (jak uzyskać w MF)
NIP firmy
Instalacja (krok po kroku, z przykładami komend)
Konfiguracja .env:
Skąd wziąć token KSeF
(link do strony MF + kroki)
Jaki NIP wpisać
Środowisko test vs produkcja
Pierwsze uruchomienie:
text

npx tsx src/index.ts sync --from 2024-01-01 --to 2024-01-31
Gdzie są pobrane pliki:
Struktura folderów
Jak otworzyć XML w Insert
Codzienne użycie:
Poranna synchronizacja
Sprawdzanie statusu
Rozwiązywanie problemów:
"Błąd autoryzacji" → token wygasł
"Timeout" → problemy z serwerem KSeF
"0 faktur" → sprawdź zakres dat i typ
"Plik XML nie otwiera się w Insert" → sprawdź wersję
Plik: docs/instrukcja-techniczna.md
Dla developera:

Architektura (diagram Mermaid):
mermaid

flowchart TD
  CLI[CLI - commander.js] --> Client[KSeF Client]
  CLI --> FM[File Manager]
  CLI --> Val[XML Validator]
  Client --> Auth[Auth Module]
  Client --> API[KSeF REST API]
  FM --> IDX[Index Tracker]
  FM --> Disk[System plików]
  Val --> XSD[Schemat FA-2 XSD]
Opis modułów
Jak dodać nową komendę CLI
Jak zmienić strukturę folderów
Testy: jak uruchomić, jak dodać nowe
CI/CD: jak zautomatyzować
Znane ograniczenia
Plik: docs/ksef-api.md
Skrócona dokumentacja API KSeF:

Środowiska + URL-e
Autentykacja (flow)
Endpointy (request/response examples)
Kody błędów KSeF
Rate limits
Schemat FA(2) - opis najważniejszych pól
Plik: docs/changelog.md
v1.0.0 - Pierwsza wersja
Pobieranie faktur zakupowych i sprzedażowych
Zapis XML na dysk
Śledzenie duplikatów
Walidacja vs schemat FA(2)
CLI z komendami: sync, list, status, get, validate
Część 3: Finalne README.md
Markdown

# 🧾 KSeF Sync - Pobieranie e-faktur z KSeF

Narzędzie CLI do automatycznego pobierania e-faktur
z Krajowego Systemu e-Faktur (KSeF) i zapisywania
jako pliki XML gotowe do otwarcia w programie Insert.

## Quick Start
1. `git clone ...`
2. `pnpm install`
3. `cp .env.example .env` → uzupełnij token i NIP
4. `pnpm run sync -- --from 2024-01-01 --to 2024-01-31`
5. Pliki XML w `./output/faktury/`

## Komendy
...

## Dokumentacja
- [Instrukcja użytkownika](docs/instrukcja-uzytkownika.md)
- [Instrukcja techniczna](docs/instrukcja-techniczna.md)
- [API KSeF](docs/ksef-api.md)

## Licencja
MIT
Testy walidatora
Plik: tests/validator/xml-validator.test.ts

Poprawny XML FA(2) → valid: true
Brakujące pole wymagane → valid: false + czytelny błąd
Niepoprawny NIP → błąd walidacji
Plik nie-XML → obsłużony error
Walidacja folderu z 5 plikami (3 ok, 2 błędne)
Nie rób
Nie modyfikuj istniejącego kodu w src/
(chyba że znajdziesz buga)
Nie zmieniaj istniejących testów