@echo off
:: ============================================================
:: Registers the .tsp file type with Windows so it shows:
::   1. A thumbnail preview of the drawing (not a blank icon)
::   2. "TapStudio Pro Project" as the file type name
::   3. TapStudio Pro as the default app to open .tsp files
::
:: The .tsp file is a valid PNG with project data appended,
:: so Windows' built-in photo thumbnail handler can render it.
::
:: Run this ONCE. No admin required (uses HKCU).
:: ============================================================

echo Registering .tsp file type with Windows...

set "SCRIPT_DIR=%~dp0"
set "ICON_PATH=%SCRIPT_DIR%icon.ico"
set "EXE_PATH=%SCRIPT_DIR%dist\TapStudio Pro.exe"

:: ── File extension association ──
reg add "HKCU\Software\Classes\.tsp" /ve /d "TapStudioProject" /f >nul 2>&1
reg add "HKCU\Software\Classes\.tsp" /v "Content Type" /d "image/png" /f >nul 2>&1
reg add "HKCU\Software\Classes\.tsp" /v "PerceivedType" /d "image" /f >nul 2>&1

:: ── File type definition ──
reg add "HKCU\Software\Classes\TapStudioProject" /ve /d "TapStudio Pro Project" /f >nul 2>&1
reg add "HKCU\Software\Classes\TapStudioProject\DefaultIcon" /ve /d "\"%ICON_PATH%\"" /f >nul 2>&1

:: ── Thumbnail handler: use Windows' built-in photo thumbnail provider ──
:: This tells Windows to decode the .tsp as a PNG and show its content as thumbnail.
:: IID {e357fccd-a995-4576-b01f-234630154e96} = IThumbnailProvider
:: CLSID {C7657C4A-9F68-40fa-A4DF-96BC08EB3551} = Windows Photo Thumbnail Provider
reg add "HKCU\Software\Classes\.tsp\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" /ve /d "{C7657C4A-9F68-40fa-A4DF-96BC08EB3551}" /f >nul 2>&1
reg add "HKCU\Software\Classes\TapStudioProject\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" /ve /d "{C7657C4A-9F68-40fa-A4DF-96BC08EB3551}" /f >nul 2>&1

:: Force WIC to treat this as a PNG by associating it in the registry (optional but helps some Explorer versions)
reg add "HKCU\Software\Classes\.tsp\OpenWithProgids" /v "pngfile" /d "" /f >nul 2>&1

:: ── Open with TapStudio Pro (if built) ──
if exist "%EXE_PATH%" (
    reg add "HKCU\Software\Classes\TapStudioProject\shell\open\command" /ve /d "\"%EXE_PATH%\" \"%%1\"" /f >nul 2>&1
    echo [OK] Registered .tsp to open with TapStudio Pro.exe
) else (
    echo [--] TapStudio Pro.exe not found in dist\, skipping Open handler.
)

:: ── Refresh icon cache ──
ie4uinit.exe -show >nul 2>&1

echo.
echo Done! .tsp files should now show a thumbnail of the drawing.
echo If thumbnails don't appear yet:
echo   1. Open File Explorer
echo   2. View ^> Show ^> check "File name extensions" if not showing
echo   3. Try restarting Explorer (taskkill /f /im explorer.exe ^& start explorer.exe)
echo.
pause
