@echo off
rem ---------------------------------------------------------------------------
rem Launch Edge with the unpacked extension and a debugging port.
rem Why: the panel needs to be verified on the real platform, and we want to
rem      observe it from the outside (CDP) without touching credentials.
rem Note: uses a dedicated profile under %TEMP%, so you must log in once here.
rem ---------------------------------------------------------------------------
setlocal
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo Edge not found. Set EDGE_PATH manually.
  pause
  exit /b 1
)

set "EXT=%~dp0..\apps\extension"
set "PROFILE=%TEMP%\edge-bt-profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"

start "" "%EDGE%" ^
  --remote-debugging-port=9333 ^
  --user-data-dir="%PROFILE%" ^
  --load-extension="%EXT%" ^
  --disable-extensions-except="%EXT%" ^
  --no-first-run ^
  --no-default-browser-check ^
  "https://skeletaltraction.cqmu.edu.cn/mengoo/"

echo Edge started with extension + CDP on 127.0.0.1:9333
echo Log in manually, open the experiment page, then click the launch button.
endlocal
