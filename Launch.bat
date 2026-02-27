@echo off
title Scrcpy GUI Launcher
echo Starting Scrcpy GUI...
npm run dev
if %errorlevel% neq 0 (
    echo.
    echo Error: Something went wrong. Make sure Node.js is installed.
    pause
)
