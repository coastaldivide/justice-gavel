@echo off
:: Bail bondsman scraper — runs after seed data cleared
cd /d "%~dp0"

set GOOGLE_PLACES_KEY=AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI

echo ============================================
echo  Justice Gavel - BAIL BONDSMEN Scraper
echo  Seed data cleared. Inserting real data.
echo  Runtime: ~30 minutes
echo ============================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not installed.
    pause
    exit /b 1
)

echo Working directory:
cd
echo.
echo Installing dependencies...
call npm install --silent
echo.
echo Scraping bail bondsmen...
node src/scripts/scrape_providers_national.js --type bail
echo.
echo ============================================
echo  DONE! Check counts above.
echo ============================================
pause
