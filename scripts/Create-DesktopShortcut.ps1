# Tworzy skrót na pulpicie wskazujący na Launch-KSeF-Sync.cmd (podwójne kliknięcie = UI w przeglądarce).
# Uruchom: prawy przycisk -> "Uruchom w programie PowerShell" lub: powershell -ExecutionPolicy Bypass -File .\scripts\Create-DesktopShortcut.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot 'Launch-KSeF-Sync.cmd'

if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Error "Nie znaleziono launchera: $launcher"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'KSeF Sync.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 1
$shortcut.Description = 'KSeF Sync — integracja KSeF / Insert (UI w przeglądarce)'
# Ikona dokumentu (shell32) — można później podmienić na własny .ico w polu IconLocation
$shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,104"
$shortcut.Save()

Write-Host "Utworzono skrót: $shortcutPath"
