@echo off
title Journal
cd /d "%~dp0"

where python >nul 2>nul || (
  echo Python wasn't found. Install it from python.org and tick "Add to PATH".
  pause
  exit /b 1
)

python -c "import flask" 2>nul || (
  echo First run: installing Flask...
  python -m pip install -q -r requirements.txt
)

python app.py
if errorlevel 1 pause
