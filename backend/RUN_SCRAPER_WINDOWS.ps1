# Justice Gavel - Provider Data Scraper
# Right-click -> Run with PowerShell

if (-not $env:GOOGLE_PLACES_KEY) { Write-Host "Set GOOGLE_PLACES_KEY in your environment first (keys are never stored in this file)." -ForegroundColor Red; Read-Host; exit 1 }
if (-not $env:DATABASE_URL) { Write-Host "Set DATABASE_URL to the main Postgres database first: new providers are inserted, changes are staged for admin review." -ForegroundColor Red; Read-Host; exit 1 }

Write-Host "Justice Gavel - Provider Data Scraper" -ForegroundColor Cyan
Write-Host "Runtime ~2 hours | Cost ~$14" -ForegroundColor Cyan

try { $v = node --version; Write-Host "Node.js: $v" -ForegroundColor Green }
catch { Write-Host "Node.js not found. Install from https://nodejs.org" -ForegroundColor Red; Read-Host; exit 1 }

npm install --silent
Write-Host "Scraping attorneys..." -ForegroundColor Yellow
node src/scripts/scrape_providers_national.js --type lawyers
Write-Host "Scraping bail bondsmen..." -ForegroundColor Yellow
node src/scripts/scrape_providers_national.js --type bail
Write-Host "COMPLETE!" -ForegroundColor Green
Read-Host "Press Enter to close"
