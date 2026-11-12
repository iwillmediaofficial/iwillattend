@echo off
rem Starts IWILL Attend for local testing on this PC and on phones on the same network.
rem Keep this window open while testing. Close it to stop.
cd /d "%~dp0"
echo.
echo  Desktop:  https://localhost:5174
echo  Phone:    use the "Network" address printed below (same Wi-Fi / router)
echo  The browser shows a certificate warning the first time: choose Advanced, then Proceed.
echo.
call npm run dev:mobile
pause
