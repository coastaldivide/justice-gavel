@echo off
:: Recovery Agents only scraper
cd /d "%~dp0"
if "%GOOGLE_PLACES_KEY%"=="" (echo ERROR: set GOOGLE_PLACES_KEY in your environment first - keys are never stored in this file. && pause && exit /b 1)
if "%DATABASE_URL%"=="" (echo ERROR: set DATABASE_URL to the main Postgres database - the scrapers write it directly, new providers inserted, changes staged for admin review. && pause && exit /b 1)
echo ============================================
echo  Justice Gavel - Recovery Agent Scraper
echo  Runtime: ~20-40 minutes
echo ============================================
echo.
node --version >nul 2>&1
if %errorlevel% neq 0 (echo ERROR: Node.js not installed. && pause && exit /b 1)
echo Working directory:
cd
echo.
call npm install --silent
echo.
echo Scraping recovery agents...
node src/scripts/scrape_recovery_agents.js
echo.
echo ============================================
echo  DONE!
echo ============================================
pause
