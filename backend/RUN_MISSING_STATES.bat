@echo off
:: ── Justice Gavel — Missing States Gap Fill ─────────────────────────────────
:: Runs scrapers ONLY for states with no real data yet.
:: Much faster than full rescrape (~30-45 min vs 2.5 hrs)
cd /d "%~dp0"

set GOOGLE_PLACES_KEY=AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI

echo ============================================================
echo  Justice Gavel - GAP FILL SCRAPER
echo  Targets only states missing real data
echo  Attorneys: DC DE ME MT ND NH RI SD VT WV WY
echo  Bail: DC DE KY ME MT ND NH RI SD VT WV WY
echo  Recovery: DC
echo  Runtime: ~30-45 minutes
echo ============================================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not installed. Download from https://nodejs.org
    pause & exit /b 1
)

echo Working directory:
cd
echo.
echo Installing dependencies...
call npm install --silent
echo.

echo ── Attorneys (missing states only) ────────────────────────
node src/scripts/scrape_providers_national.js --type lawyers --state DC
node src/scripts/scrape_providers_national.js --type lawyers --state DE
node src/scripts/scrape_providers_national.js --type lawyers --state ME
node src/scripts/scrape_providers_national.js --type lawyers --state MT
node src/scripts/scrape_providers_national.js --type lawyers --state ND
node src/scripts/scrape_providers_national.js --type lawyers --state NH
node src/scripts/scrape_providers_national.js --type lawyers --state RI
node src/scripts/scrape_providers_national.js --type lawyers --state SD
node src/scripts/scrape_providers_national.js --type lawyers --state VT
node src/scripts/scrape_providers_national.js --type lawyers --state WV
node src/scripts/scrape_providers_national.js --type lawyers --state WY

echo.
echo ── Bail agents (missing states only) ──────────────────────
node src/scripts/scrape_providers_national.js --type bail --state DC
node src/scripts/scrape_providers_national.js --type bail --state DE
node src/scripts/scrape_providers_national.js --type bail --state KY
node src/scripts/scrape_providers_national.js --type bail --state ME
node src/scripts/scrape_providers_national.js --type bail --state MT
node src/scripts/scrape_providers_national.js --type bail --state ND
node src/scripts/scrape_providers_national.js --type bail --state NH
node src/scripts/scrape_providers_national.js --type bail --state RI
node src/scripts/scrape_providers_national.js --type bail --state SD
node src/scripts/scrape_providers_national.js --type bail --state VT
node src/scripts/scrape_providers_national.js --type bail --state WV
node src/scripts/scrape_providers_national.js --type bail --state WY

echo.
echo ── Recovery agents (DC only) ──────────────────────────────
node src/scripts/scrape_recovery_agents.js --state DC
echo.

echo ============================================================
echo  GAP FILL COMPLETE!
echo  Close this window.
echo ============================================================
pause
