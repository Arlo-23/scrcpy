@echo off
title Scrcpy GUI Clean Uninstall
echo ==========================================
echo Scrcpy GUI - Clean Uninstall Utility
echo This will remove settings and build files.
echo ==========================================
echo.

set /p confirm="Are you sure you want to remove all Scrcpy GUI data? (Y/N): "
if /i "%confirm%" neq "Y" goto :cancel

echo.
echo [1/3] Removing User Settings and Cache...
if exist "%APPDATA%\scrcpy-gui" (
    rd /s /q "%APPDATA%\scrcpy-gui"
    echo Done.
) else (
    echo No settings folder found.
)

echo.
echo [2/3] Cleaning up build folders...
if exist "dist" (
    echo Removing dist folder...
    rd /s /q "dist"
)
if exist "node_modules" (
    echo Removing node_modules...
    rd /s /q "node_modules"
)

echo.
echo [3/3] Checking for installed version...
echo Note: If you installed via the .exe setup, please also use 
echo 'Add or Remove Programs' in Windows Settings to fully uninstall.
echo.

echo ==========================================
echo Cleanup Complete!
echo ==========================================
pause
exit

:cancel
echo.
echo Uninstall cancelled.
pause
exit
