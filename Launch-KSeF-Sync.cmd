@echo off
chcp 65001 >nul
title KSeF Sync
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Nie znaleziono npm w PATH. Zainstaluj Node.js LTS ^(https://nodejs.org/^) i uruchom ponownie.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo Brak package.json w katalogu: %CD%
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Pierwsze uruchomienie: instalacja zależności ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo Instalacja nie powiodła się.
    pause
    exit /b 1
  )
)

echo Uruchamianie KSeF Sync ^(interfejs w przeglądarce^)...
echo Zamknij to okno lub naciśnij Ctrl+C, aby zatrzymać serwer.
echo.

call npm run start
if errorlevel 1 (
  echo.
  echo Aplikacja zakończyła się błędem.
  pause
)
