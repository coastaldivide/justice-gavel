@echo off
:: Recovery Agents only scraper
cd /d "%~dp0"
set GOOGLE_PLACES_KEY=AIzaSyDs4EqwD_SgeRVhQk-FdbbHEjabu7TsQwI
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
