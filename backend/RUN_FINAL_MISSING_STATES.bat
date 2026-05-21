@echo off
:: ═══════════════════════════════════════════════════════════════════
:: Justice Gavel — FINAL ONE-TIME MISSING STATES SCRAPER
::
:: This bat file exists for ONE purpose: fill the 11 states that
:: have never had real attorney data scraped:
::   DC DE ME MT ND NH RI SD VT WV WY
:: Plus 12 states missing bail agent data (adds KY).
::
:: After this runs successfully, DELETE this bat file.
:: Use RUN_SCRAPER_WINDOWS.bat for future full rescapes.
::
:: Runtime:  ~45-60 minutes
:: API cost: ~$5-6
:: Key:      embedded below
:: ═══════════════════════════════════════════════════════════════════
cd /d "%~dp0"

set GOOGLE_PLACES_KEY=AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI

echo.
echo ═══════════════════════════════════════════════════════════════
echo   FINAL MISSING STATES SCRAPER
echo   Attorneys:  DC DE ME MT ND NH RI SD VT WV WY
echo   Bail:       DC DE KY ME MT ND NH RI SD VT WV WY
echo ═══════════════════════════════════════════════════════════════
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not installed. Get it from https://nodejs.org
    pause & exit /b 1
)
echo Node.js found. Working directory:
cd
echo.

call npm install --silent
echo.

echo ──────────────────────────────────────────────────────────────
echo  ATTORNEYS ^(11 states^)
echo ──────────────────────────────────────────────────────────────
echo   Attorneys: DC
node src/scripts/scrape_providers_national.js --type lawyers --state DC
echo.
echo   Attorneys: DE
node src/scripts/scrape_providers_national.js --type lawyers --state DE
echo.
echo   Attorneys: ME
node src/scripts/scrape_providers_national.js --type lawyers --state ME
echo.
echo   Attorneys: MT
node src/scripts/scrape_providers_national.js --type lawyers --state MT
echo.
echo   Attorneys: ND
node src/scripts/scrape_providers_national.js --type lawyers --state ND
echo.
echo   Attorneys: NH
node src/scripts/scrape_providers_national.js --type lawyers --state NH
echo.
echo   Attorneys: RI
node src/scripts/scrape_providers_national.js --type lawyers --state RI
echo.
echo   Attorneys: SD
node src/scripts/scrape_providers_national.js --type lawyers --state SD
echo.
echo   Attorneys: VT
node src/scripts/scrape_providers_national.js --type lawyers --state VT
echo.
echo   Attorneys: WV
node src/scripts/scrape_providers_national.js --type lawyers --state WV
echo.
echo   Attorneys: WY
node src/scripts/scrape_providers_national.js --type lawyers --state WY
echo.

echo ──────────────────────────────────────────────────────────────
echo  BAIL AGENTS ^(12 states^)
echo ──────────────────────────────────────────────────────────────
echo   Bail: DC
node src/scripts/scrape_providers_national.js --type bail --state DC
echo.
echo   Bail: DE
node src/scripts/scrape_providers_national.js --type bail --state DE
echo.
echo   Bail: KY
node src/scripts/scrape_providers_national.js --type bail --state KY
echo.
echo   Bail: ME
node src/scripts/scrape_providers_national.js --type bail --state ME
echo.
echo   Bail: MT
node src/scripts/scrape_providers_national.js --type bail --state MT
echo.
echo   Bail: ND
node src/scripts/scrape_providers_national.js --type bail --state ND
echo.
echo   Bail: NH
node src/scripts/scrape_providers_national.js --type bail --state NH
echo.
echo   Bail: RI
node src/scripts/scrape_providers_national.js --type bail --state RI
echo.
echo   Bail: SD
node src/scripts/scrape_providers_national.js --type bail --state SD
echo.
echo   Bail: VT
node src/scripts/scrape_providers_national.js --type bail --state VT
echo.
echo   Bail: WV
node src/scripts/scrape_providers_national.js --type bail --state WV
echo.
echo   Bail: WY
node src/scripts/scrape_providers_national.js --type bail --state WY
echo.

echo ═══════════════════════════════════════════════════════════════
echo   DONE. Upload the zip for final packaging.
echo ═══════════════════════════════════════════════════════════════
pause
