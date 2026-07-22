$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Building Airmonlink Composer for Windows x64" -ForegroundColor Cyan
npm ci
npm run validate
npm run dist:win

$release = Join-Path $PSScriptRoot "release"
$checksum = Join-Path $release "SHA256SUMS.txt"
if (Test-Path $checksum) { Remove-Item $checksum -Force }
Get-ChildItem $release -File | Where-Object { $_.Name -ne "SHA256SUMS.txt" } | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
    "$hash  $($_.Name)" | Add-Content $checksum
}
Write-Host "Build complete: $release" -ForegroundColor Green
Invoke-Item $release
