$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Airmonlink Composer Windows Setup" -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22 is required. Install it from the official Node.js website, then run this script again."
}

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
Write-Host "Validating source..." -ForegroundColor Yellow
npm run validate
Write-Host "Starting Airmonlink Composer..." -ForegroundColor Green
npm start
