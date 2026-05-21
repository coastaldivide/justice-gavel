# Justice Gavel - Provider Data Scraper
# Right-click -> Run with PowerShell

$env:GOOGLE_PLACES_KEY = "AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI"

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
