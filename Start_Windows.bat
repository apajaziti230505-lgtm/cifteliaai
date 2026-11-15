@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Ciftelia Studio AI

echo.
echo ==========================================
echo   CIFTELIA STUDIO AI - PROGRAM LOKAL
echo ==========================================
echo.
if exist ".venv\Scripts\python.exe" goto InstallPackages
where py >nul 2>nul
if not errorlevel 1 (
    py -3 -m venv .venv
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Nuk gjendet Python. Instalo Python 3.11-3.13 nga https://www.python.org/downloads/
        echo Gjate instalimit aktivizo "Add Python to PATH".
        pause
        exit /b 1
    )
    python -m venv .venv
)
if errorlevel 1 (
    echo Nuk u krijua ambienti Python. Kontrollo instalimin.
    pause
    exit /b 1
)
:InstallPackages
if exist ".venv\READY_V3.txt" goto Launch
echo Instalimi i paketave falas (kerkon internet vetem heren e pare)...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo Gabim gjate instalimit. Verifiko internetin dhe provo perseri.
    pause
    exit /b 1
)
echo Ready>".venv\READY_V3.txt"
:Launch
echo.
echo Aplikacioni hapet ne shfletues ne http://127.0.0.1:8765
echo Mbaje kete dritare hapur. Ctrl+C per ta mbyllur.
echo.
".venv\Scripts\python.exe" -m transcriber.api
if errorlevel 1 (
    echo Programi u mbyll me gabim.
    pause
)
endlocal
