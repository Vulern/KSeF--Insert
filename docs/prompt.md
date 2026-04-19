## Kontekst projektu
Mam działające narzędzie KSeF Sync z lokalnym Web UI.
Stack:
- Node.js + TypeScript
- Hono jako lokalny serwer HTTP
- statyczne pliki HTML/CSS/JS (bez React, bez Vite, bez build stepa)
- UI działa na localhost:3000

Aktualnie UI jest zbyt surowe:
- wygląda prawie jak sam tekst HTML
- wszystko jest przyklejone do lewej strony
- brak sensownego layoutu, kart, spacingu i hierarchii wizualnej
- możliwe, że CSS nie jest poprawnie ładowany lub nie jest poprawnie serwowany

## Cel zadania
Popraw istniejący Web UI tak, żeby wyglądał nowocześnie, czytelnie i “jak prawdziwa aplikacja”, ale nadal był prosty i lekki.

Chcę:
1. sprawdzić i naprawić ładowanie CSS/JS jeśli jest błędne
2. przeprojektować layout i styl strony
3. zachować obecną funkcjonalność backendu i endpointów API
4. nie dodawać żadnych frameworków frontendowych

## Najpierw przeczytaj i przeanalizuj
- `src/server/app.ts`
- `src/server/server.ts`
- `src/ui/index.html`
- `src/ui/style.css`
- `src/ui/app.js`

## Ważne
Najpierw sprawdź czy:
- pliki statyczne HTML/CSS/JS są poprawnie serwowane przez Hono
- `index.html` faktycznie ładuje `style.css` i `app.js` poprawnymi ścieżkami
- po wejściu na stronę CSS naprawdę działa
Jeśli trzeba, popraw routing / middleware statycznych plików, ale bez zmiany API biznesowego.

## Zakres zmian
Skup się głównie na:
- `src/ui/index.html`
- `src/ui/style.css`
- `src/ui/app.js`

Możesz też minimalnie poprawić:
- `src/server/app.ts`
- `src/server/server.ts`
jeśli to konieczne do poprawnego serwowania statycznych plików.

## Oczekiwany efekt wizualny
Chcę estetyczny dashboard desktopowy:
- wycentrowany kontener
- szerokość max około 1100–1200px
- ciemny motyw
- nowoczesne karty/panele
- sensowny spacing
- lepsza typografia
- czytelne formularze
- ładna tabela faktur
- estetyczny progress bar
- badge statusu
- przyciski primary/secondary
- puste stany i komunikaty błędów
- UI ma wyglądać schludnie i profesjonalnie, nie “developersko surowo”

## Styl wizualny
### Motyw
Dark mode:
- tło strony: bardzo ciemne, np. `#0b1020` lub `#0f172a`
- karty: `#111827` / `#162033`
- obramowania: subtelne, np. `rgba(255,255,255,0.08)`
- tekst główny: `#e5e7eb`
- tekst poboczny: `#94a3b8`
- akcent primary: `#3b82f6`
- success: `#22c55e`
- warning: `#f59e0b`
- error: `#ef4444`

### Typografia
- font: system-ui, sans-serif
- wyraźny nagłówek strony
- lepsze odstępy między sekcjami
- hierarchia nagłówków: h1, h2, label, helper text

### Layout
Strona ma być zbudowana z sekcji:
1. **Header**
   - nazwa aplikacji: `KSeF Sync`
   - krótki opis
   - badge statusu połączenia / środowiska
2. **Stat cards**
   - środowisko
   - ostatnia synchronizacja
   - liczba pobranych faktur
   - katalog docelowy
3. **Sekcja synchronizacji**
   - pola daty od/do
   - wybór typu faktur
   - duży przycisk “Synchronizuj”
   - progress bar
   - tekst statusu pod progress barem
4. **Sekcja pobranych faktur**
   - nagłówek sekcji
   - filtr miesiąca
   - tabela
   - licznik rekordów
5. **Sekcja diagnostyki / statusu**
   - podstawowe informacje o systemie
   - ostatnie zdarzenia lub komunikaty
6. **Footer**
   - wersja
   - środowisko
   - linki tekstowe lub krótka informacja

## Konkretny układ
### Górna część
- Header w jednej linii:
  - po lewej: tytuł i subtitle
  - po prawej: badge statusu, np. `Test`, `Połączono`, `Lokalnie`
- pod headerem siatka 4 kart statystycznych

### Środkowa część
- sekcja synchronizacji jako duża karta
- formularz w układzie grid:
  - data od
  - data do
  - typ
  - przycisk synchronizacji
- pod formularzem pasek postępu i komunikat statusu

### Dolna część
- duża karta z tabelą faktur
- nagłówek karty + filtr miesiąca + przycisk odśwież
- tabela z:
  - Data
  - NIP
  - Nr KSeF
  - Plik
  - Akcja
- akcja jako estetyczny przycisk “Pobierz”

### Dodatkowo
- sekcja diagnostyczna w postaci mniejszej karty pod tabelą
- pokazuj np.:
  - środowisko
  - katalog wyjściowy
  - liczba faktur
  - ostatni błąd / ostatnie zdarzenie

## UX / interakcje
- przycisk synchronizacji ma stany:
  - normalny
  - loading
  - disabled
- podczas synchronizacji:
  - progress bar animowany
  - przycisk disabled
  - komunikat np. `Pobieram fakturę 12 z 47...`
- po zakończeniu:
  - pokaż estetyczny komunikat sukcesu
- po błędzie:
  - pokaż estetyczny komunikat błędu
- dodaj prosty system toastów / alertów w vanilla JS
- puste stany:
  - jeśli brak faktur, pokaż kartę / wiersz z informacją:
    `Brak pobranych faktur dla wybranego miesiąca`

## Wymagania techniczne
- bez React/Vue/Svelte
- bez Tailwind
- bez build stepa
- czysty HTML/CSS/JS
- zachowaj istniejące endpointy API
- nie zmieniaj logiki biznesowej synchronizacji
- możesz uporządkować markup HTML i klasy CSS
- użyj CSS Grid + Flexbox
- użyj CSS variables (`:root`) dla kolorów i spacingu
- dodaj:
  - hover states
  - focus states
  - transitions
  - radiusy
  - cienie kart
- desktop-first, ale niech nie rozsypuje się przy mniejszym oknie

## Bardzo ważne: jakość frontendu
Nie chcę “minimalnego MVP”.
Chcę nadal prosty frontend, ale wizualnie dopracowany:
- schludny
- czytelny
- z nowoczesnym spacingiem
- z kartami
- z siatką
- z sensowną tabelą
- z estetycznymi formularzami i przyciskami

## Style które chcę zobaczyć
Dodaj w CSS m.in.:
- global reset / box-sizing
- `body` z tłem gradientowym lub subtelnym tłem
- `.app-shell` lub `.container` z max-width i centrowaniem
- `.card`
- `.stats-grid`
- `.form-grid`
- `.table-wrapper`
- `.badge`
- `.btn`, `.btn-primary`, `.btn-secondary`
- `.progress`, `.progress-bar`
- `.toast-container`, `.toast`
- `.empty-state`
- `.status-dot`

## Tabela
Tabela ma wyglądać profesjonalnie:
- sticky header mile widziany
- lepszy padding komórek
- zebra rows
- hover na wierszu
- skrócone długie referencje KSeF z możliwością title/tooltip
- kolumna akcji wyrównana ładnie do prawej

## Formularze
Form controls mają być estetyczne:
- dark inputs
- obramowanie
- focus ring
- labels nad polami
- helper text jeśli potrzebne
- radio group / select ma być czytelne

## Jeśli obecna struktura HTML jest zbyt słaba
Możesz ją przebudować, ale:
- zachowaj istniejące funkcje w `app.js`
- albo zrefaktoruj `app.js` tak, żeby działał z nowym markupem
- nie usuwaj obecnych funkcjonalności

## Oczekiwany rezultat
Po zakończeniu chcę mieć:
1. dopracowany wizualnie dashboard
2. poprawnie ładowany CSS i JS
3. zachowaną obecną funkcjonalność
4. kod frontendu bardziej uporządkowany i łatwiejszy w maintenance

## Na koniec
Po wdrożeniu:
- opisz krótko co zostało poprawione
- wypisz, czy problem z ładowaniem CSS/JS istniał i jak został naprawiony
- podaj, które pliki zostały zmienione