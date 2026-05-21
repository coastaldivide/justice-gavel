@echo off
:: ── Justice Gavel Provider Scraper ──────────────────────────────────────────
cd /d "%~dp0"

set GOOGLE_PLACES_KEY=AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI

echo ============================================
echo  Justice Gavel - Provider Data Scraper
echo  Attorneys + Bail Agents + Recovery Agents
echo  Runtime: ~2.5 hours total
echo ============================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not installed.
    echo Download from https://nodejs.org
    pause
    exit /b 1
)

echo Working directory:
cd
echo.
echo Installing dependencies...
call npm install --silent
echo.

echo ── Scraping attorneys... ──────────────────
node src/scripts/scrape_providers_national.js --type lawyers
echo.

echo ── Scraping bail bondsmen... ──────────────
node src/scripts/scrape_providers_national.js --type bail
echo.

echo ── Scraping recovery agents... ────────────
node src/scripts/scrape_recovery_agents.js
echo.

echo ============================================
echo  DONE! All providers loaded.
echo  Close this window.
echo ============================================
pause
