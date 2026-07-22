[CmdletBinding()]
param(
  [string]$ReleaseDir = "release",
  [string]$ValidationDir = "validation",
  [string]$ExpectedVersion = "1.1.0",
  [int]$ExpectedBuild = 14
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

New-Item -ItemType Directory -Force -Path $ValidationDir | Out-Null
$releasePath = (Resolve-Path $ReleaseDir).Path
$validationPath = (Resolve-Path $ValidationDir).Path
$results = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Result {
  param(
    [string]$Id,
    [ValidateSet("PASS","FAIL","BLOCKED")][string]$Status,
    [string]$Evidence
  )
  $results.Add([pscustomobject]@{ id=$Id; status=$Status; evidence=$Evidence })
  if ($Status -eq "FAIL") { $failures.Add("${Id}: ${Evidence}") }
}

function Assert-Result {
  param([bool]$Condition,[string]$Id,[string]$Evidence)
  if ($Condition) { Add-Result $Id "PASS" $Evidence }
  else { Add-Result $Id "FAIL" $Evidence }
}

function Test-PE {
  param([string]$Path)
  if (-not (Test-Path $Path -PathType Leaf)) { return $false }
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return $stream.Length -gt 2 -and $stream.ReadByte() -eq 0x4d -and $stream.ReadByte() -eq 0x5a
  } finally {
    $stream.Dispose()
  }
}

$installerName = "Airmonlink-Composer-$ExpectedVersion-Build$ExpectedBuild-Setup.exe"
$portableName = "Airmonlink-Composer-$ExpectedVersion-Build$ExpectedBuild-Portable.exe"
$installer = Join-Path $releasePath $installerName
$portable = Join-Path $releasePath $portableName

$testLog = Join-Path $validationPath "tests.log"
if (Test-Path $testLog -PathType Leaf) {
  $text = Get-Content $testLog -Raw
  $tests = [regex]::Match($text,'(?m)^# tests\s+(\d+)\s*$')
  $pass = [regex]::Match($text,'(?m)^# pass\s+(\d+)\s*$')
  $fail = [regex]::Match($text,'(?m)^# fail\s+(\d+)\s*$')
  $ok = $tests.Success -and $pass.Success -and $fail.Success -and
        [int]$tests.Groups[1].Value -ge 141 -and
        [int]$pass.Groups[1].Value -eq [int]$tests.Groups[1].Value -and
        [int]$fail.Groups[1].Value -eq 0
  Assert-Result $ok "automated-tests" "TAP totals in validation/tests.log prove the automated test result."
} else {
  Add-Result "automated-tests" "FAIL" "validation/tests.log was not found."
}

Assert-Result (Test-Path $installer -PathType Leaf) "installer-present" $installerName
Assert-Result (Test-Path $portable -PathType Leaf) "portable-present" $portableName
Assert-Result (Test-PE $installer) "installer-pe" "Installer has a valid MZ header."
Assert-Result (Test-PE $portable) "portable-pe" "Portable executable has a valid MZ header."

foreach ($path in @($installer,$portable)) {
  if (Test-Path $path -PathType Leaf) {
    $item = Get-Item $path
    $version = $item.VersionInfo
    $metadataOk = $version.ProductName -eq "Airmonlink Composer" -and
                  $version.ProductVersion -like "$ExpectedVersion*" -and
                  $version.FileVersion -like "$ExpectedVersion.$ExpectedBuild*"
    Assert-Result $metadataOk "metadata-$($item.BaseName)" "ProductName=$($version.ProductName); ProductVersion=$($version.ProductVersion); FileVersion=$($version.FileVersion)."
  }
}

$signatureRows = foreach ($path in @($installer,$portable)) {
  if (Test-Path $path -PathType Leaf) {
    $signature = Get-AuthenticodeSignature -FilePath $path
    [pscustomobject]@{
      artifact = Split-Path $path -Leaf
      status = [string]$signature.Status
      signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    }
  }
}
$signatureRows | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $validationPath "signature-status.json")
if (($signatureRows | Where-Object status -ne "Valid").Count -eq 0) {
  Add-Result "code-signing" "PASS" "All Windows artifacts have valid Authenticode signatures."
} else {
  Add-Result "code-signing" "BLOCKED" "One or more artifacts are unsigned or untrusted."
}

if ((Test-Path $installer) -and (Test-Path $portable)) {
  @(
    "$((Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant())  $installerName"
    "$((Get-FileHash $portable -Algorithm SHA256).Hash.ToLowerInvariant())  $portableName"
  ) | Set-Content -Encoding ascii (Join-Path $releasePath "SHA256SUMS.txt")
}

$installDir = Join-Path $env:RUNNER_TEMP "AirmonlinkComposer-Build$ExpectedBuild-Clean"
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
try {
  $install = Start-Process -FilePath $installer -ArgumentList @("/S","/D=$installDir") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "Installer exited with code $($install.ExitCode)." }
  $installedExe = Join-Path $installDir "Airmonlink Composer.exe"
  Assert-Result (Test-Path $installedExe -PathType Leaf) "clean-install" "Installed executable exists."

  $uninstaller = Get-ChildItem $installDir -Filter "Uninstall*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  Assert-Result ($null -ne $uninstaller) "uninstaller-present" "Uninstaller exists."
  if ($uninstaller) {
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstall.ExitCode)." }
    Assert-Result (-not (Test-Path $installedExe)) "uninstall-cleanup" "Installed executable was removed."
  }
} catch {
  Add-Result "windows-install-cycle" "FAIL" $_.Exception.Message
}

Add-Result "upgrade-preservation" "BLOCKED" "No previous installer artifact was supplied."
Add-Result "human-gui-validation" "BLOCKED" "Human visual and interaction checks require a Windows user session."
Add-Result "printing-windows" "BLOCKED" "Printer/PDF verification requires a Windows print target."
Add-Result "midi-windows" "BLOCKED" "MIDI device validation requires hardware."
Add-Result "smartscreen-presentation" "BLOCKED" "SmartScreen presentation requires human verification."

$summary = [pscustomobject]@{
  product = "Airmonlink Composer"
  version = $ExpectedVersion
  build = $ExpectedBuild
  generatedAt = [DateTime]::UtcNow.ToString("o")
  runner = if ($env:RUNNER_NAME) { $env:RUNNER_NAME } else { "unknown" }
  results = $results
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $validationPath "windows-validation-summary.json")
$results | Export-Csv -NoTypeInformation -Encoding utf8 (Join-Path $validationPath "windows-validation-summary.csv")

if ($failures.Count -gt 0) {
  throw "Windows validation failed:`n$($failures -join "`n")"
}

$successMarker = Join-Path $validationPath "windows-validation.ok"
@(
  "status=PASS"
  "product=Airmonlink Composer"
  "version=$ExpectedVersion"
  "build=$ExpectedBuild"
  "generatedAt=$([DateTime]::UtcNow.ToString('o'))"
) | Set-Content -Encoding ascii $successMarker

$global:LASTEXITCODE = 0
Write-Host "Windows validation completed without FAIL rows. BLOCKED rows remain explicitly reported."
