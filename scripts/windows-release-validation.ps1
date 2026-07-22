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
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  return $bytes.Length -ge 2 -and $bytes[0] -eq 0x4d -and $bytes[1] -eq 0x5a
}

function Stop-Tree {
  param([int]$ProcessId)
  $output = & taskkill.exe /PID $ProcessId /T /F 2>&1
  $code = $LASTEXITCODE
  $output | Out-File -Append (Join-Path $validationPath "process-termination.log")
  "taskkkill-exit-code=$code; pid=$ProcessId" | Out-File -Append (Join-Path $validationPath "process-termination.log")
  $global:LASTEXITCODE = 0
}

function Wait-ForFileText {
  param([string]$Path,[string]$Pattern,[int]$TimeoutSeconds=30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ((Test-Path $Path) -and ((Get-Content $Path -Raw) -match $Pattern)) { return $true }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

$installerName = "Airmonlink-Composer-$ExpectedVersion-Build$ExpectedBuild-Setup.exe"
$portableName = "Airmonlink-Composer-$ExpectedVersion-Build$ExpectedBuild-Portable.exe"
$installer = Join-Path $releasePath $installerName
$portable = Join-Path $releasePath $portableName

$testLog = Join-Path $validationPath "tests.log"
if (Test-Path $testLog) {
  $text = Get-Content $testLog -Raw
  $tests = [regex]::Match($text,'(?m)^# tests\s+(\d+)\s*$')
  $pass = [regex]::Match($text,'(?m)^# pass\s+(\d+)\s*$')
  $fail = [regex]::Match($text,'(?m)^# fail\s+(\d+)\s*$')
  $ok = $tests.Success -and $pass.Success -and $fail.Success -and
        [int]$tests.Groups[1].Value -ge 141 -and
        [int]$pass.Groups[1].Value -eq [int]$tests.Groups[1].Value -and
        [int]$fail.Groups[1].Value -eq 0
  Assert-Result $ok "automated-tests" "TAP totals found in validation/tests.log."
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
    $v = $item.VersionInfo
    $ok = $v.ProductName -eq "Airmonlink Composer" -and
          $v.ProductVersion -like "$ExpectedVersion*" -and
          $v.FileVersion -like "$ExpectedVersion.$ExpectedBuild*"
    Assert-Result $ok "metadata-$($item.BaseName)" "ProductName=$($v.ProductName); ProductVersion=$($v.ProductVersion); FileVersion=$($v.FileVersion)."
  }
}

$signatureRows = foreach ($path in @($installer,$portable)) {
  if (Test-Path $path -PathType Leaf) {
    $sig = Get-AuthenticodeSignature -FilePath $path
    [pscustomobject]@{
      artifact = (Split-Path $path -Leaf)
      status = [string]$sig.Status
      signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
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

if (Test-Path $portable -PathType Leaf) {
  $portableLog = Join-Path $validationPath "portable-launch.jsonl"
  $env:AIRMONLINK_VALIDATION_LOG = $portableLog
  Remove-Item $portableLog -Force -ErrorAction SilentlyContinue
  $stdout = Join-Path $validationPath "portable-stdout.log"
  $stderr = Join-Path $validationPath "portable-stderr.log"
  $proc = Start-Process -FilePath $portable -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $ready = Wait-ForFileText $portableLog '"stage":"renderer-ready"' 25
  $running = -not $proc.HasExited
  Assert-Result ($ready -and $running) "portable-launch" "Portable process reached renderer-ready and remained alive."
  if (-not $proc.HasExited) { Stop-Tree $proc.Id }
}

$installDir = Join-Path $env:RUNNER_TEMP "AirmonlinkComposer-Build$ExpectedBuild-Clean"
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
try {
  $installProc = Start-Process -FilePath $installer -ArgumentList @("/S","/D=$installDir") -Wait -PassThru
  if ($installProc.ExitCode -ne 0) { throw "Installer exited with code $($installProc.ExitCode)." }

  $installedExe = Join-Path $installDir "Airmonlink Composer.exe"
  Assert-Result (Test-Path $installedExe -PathType Leaf) "clean-install" "Installed executable exists."

  $uninstaller = Get-ChildItem $installDir -Filter "Uninstall*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  Assert-Result ($null -ne $uninstaller) "uninstaller-present" "Uninstaller exists."

  if ($uninstaller) {
    $uninstallProc = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
    if ($uninstallProc.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstallProc.ExitCode)." }
    $removed = -not (Test-Path $installedExe)
    Assert-Result $removed "uninstall-cleanup" "Installed executable was removed."
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
