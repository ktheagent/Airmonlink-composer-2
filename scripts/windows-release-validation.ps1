[CmdletBinding()]
param(
  [string]$ReleaseDir = "release",
  [string]$ValidationDir = "validation",
  [string]$ExpectedVersion = "1.1.0",
  [int]$ExpectedBuild = 14
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$releasePath = (Resolve-Path $ReleaseDir).Path
New-Item -ItemType Directory -Force -Path $ValidationDir | Out-Null
$validationPath = (Resolve-Path $ValidationDir).Path
$results = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Result {
  param(
    [string]$Id,
    [ValidateSet("PASS", "FAIL", "BLOCKED")][string]$Status,
    [string]$Evidence
  )
  $results.Add([pscustomobject]@{ id = $Id; status = $Status; evidence = $Evidence })
  if ($Status -eq "FAIL") { $failures.Add("$Id`: $Evidence") }
}

function Assert-True {
  param([bool]$Condition, [string]$Id, [string]$Evidence)
  if ($Condition) { Add-Result $Id "PASS" $Evidence }
  else { Add-Result $Id "FAIL" $Evidence }
}

function Test-PEFile {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  return $bytes.Length -gt 2 -and $bytes[0] -eq 0x4d -and $bytes[1] -eq 0x5a
}

function Wait-ForCondition {
  param(
    [scriptblock]$Condition,
    [int]$TimeoutSeconds = 30,
    [int]$IntervalMilliseconds = 500
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds $IntervalMilliseconds
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Invoke-SilentInstaller {
  param([string]$Installer, [string]$Destination)
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
  $arguments = @("/S", "/D=$Destination")
  $process = Start-Process -FilePath $Installer -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }
}

function Invoke-SilentUninstaller {
  param([string]$Uninstaller)
  $process = Start-Process -FilePath $Uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstaller exited with code $($process.ExitCode)." }
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  $terminationLog = Join-Path $validationPath "process-termination.log"
  $output = & taskkill.exe /PID $ProcessId /T /F 2>&1
  $taskkillExitCode = $LASTEXITCODE

  $output | Out-File -Append -FilePath $terminationLog
  "taskkkill-exit-code=$taskkkillExitCode; pid=$ProcessId" |
    Out-File -Append -FilePath $terminationLog

  # taskkill can return 128 when the process has already exited. That is not
  # a release-validation failure, and its native exit code must not leak into
  # the successful script result.
  $global:LASTEXITCODE = 0
}

$installerName = "Airmonlink-Composer-$ExpectedVersion-Build$ExpectedBuild-Setup.exe"
$portableName = "Airmonlink-Composer-$ExpectedVersion-Build$ExpectedBuild-Portable.exe"
$installer = Join-Path $releasePath $installerName
$portable = Join-Path $releasePath $portableName

$testLog = Join-Path $validationPath "tests.log"
if (Test-Path $testLog -PathType Leaf) {
  $testText = Get-Content $testLog -Raw
  $testCountMatch = [regex]::Match($testText, '(?m)^# tests\s+(\d+)\s*$')
  $passCountMatch = [regex]::Match($testText, '(?m)^# pass\s+(\d+)\s*$')
  $failCountMatch = [regex]::Match($testText, '(?m)^# fail\s+(\d+)\s*$')
  if ($testCountMatch.Success -and $passCountMatch.Success -and $failCountMatch.Success) {
    $testCount = [int]$testCountMatch.Groups[1].Value
    $passCount = [int]$passCountMatch.Groups[1].Value
    $failCount = [int]$failCountMatch.Groups[1].Value
    Assert-True ($testCount -ge 141 -and $passCount -eq $testCount -and $failCount -eq 0) "automated-tests" "TAP summary proves $passCount/$testCount tests passed with $failCount failures."
  } else {
    Add-Result "automated-tests" "FAIL" "The TAP totals could not be parsed from validation/tests.log."
  }
} else {
  Add-Result "automated-tests" "FAIL" "validation/tests.log was not found."
}

Assert-True (Test-Path $installer -PathType Leaf) "installer-present" "Expected installer: $installerName"
Assert-True (Test-Path $portable -PathType Leaf) "portable-present" "Expected portable executable: $portableName"

if ((Test-Path $installer) -and (Test-Path $portable)) {
  $installerInfo = Get-Item $installer
  $portableInfo = Get-Item $portable
  Assert-True ($installerInfo.Length -gt 0 -and (Test-PEFile $installer)) "installer-pe" "Installer is non-empty and begins with the PE MZ signature; size=$($installerInfo.Length)."
  Assert-True ($portableInfo.Length -gt 0 -and (Test-PEFile $portable)) "portable-pe" "Portable executable is non-empty and begins with the PE MZ signature; size=$($portableInfo.Length)."

  foreach ($item in @($installerInfo, $portableInfo)) {
    $versionInfo = $item.VersionInfo
    $metadataOk = ($versionInfo.ProductName -eq "Airmonlink Composer") -and
      ($versionInfo.ProductVersion -like "$ExpectedVersion*") -and
      ($versionInfo.FileVersion -like "$ExpectedVersion.$ExpectedBuild*")
    Assert-True $metadataOk "metadata-$($item.BaseName)" "ProductName='$($versionInfo.ProductName)'; ProductVersion='$($versionInfo.ProductVersion)'; FileVersion='$($versionInfo.FileVersion)'."
  }

  $signatureRows = foreach ($item in @($installerInfo, $portableInfo)) {
    $signature = Get-AuthenticodeSignature -FilePath $item.FullName
    $signer = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    [pscustomobject]@{ artifact = $item.Name; status = [string]$signature.Status; signer = $signer }
  }
  $signatureRows | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $validationPath "signature-status.json")
  if (($signatureRows | Where-Object status -ne "Valid").Count -eq 0) {
    Add-Result "code-signing" "PASS" "Every Windows distributable has a valid Authenticode signature."
  } else {
    Add-Result "code-signing" "BLOCKED" "One or more artifacts are unsigned or lack a valid trusted signature; SmartScreen warnings remain likely."
  }

  $checksums = foreach ($item in @($installerInfo, $portableInfo)) {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $item.FullName).Hash.ToLowerInvariant()
    "$hash  $($item.Name)"
  }
  $checksums | Set-Content -Encoding ascii (Join-Path $releasePath "SHA256SUMS.txt")

  $portableLog = Join-Path $validationPath "portable-launch.jsonl"
  $env:AIRMONLINK_VALIDATION_LOG = $portableLog
  $portableStdout = Join-Path $validationPath "portable-stdout.log"
  $portableStderr = Join-Path $validationPath "portable-stderr.log"
  $portableProcess = Start-Process -FilePath $portable -PassThru -RedirectStandardOutput $portableStdout -RedirectStandardError $portableStderr
  $portableReady = Wait-ForCondition -TimeoutSeconds 25 -Condition {
    (Test-Path $portableLog) -and ((Get-Content $portableLog -Raw) -match '"stage":"renderer-ready"')
  }
  $portableRunning = -not $portableProcess.HasExited
  Assert-True ($portableReady -and $portableRunning) "portable-launch" "Portable process remained alive and emitted renderer-ready diagnostics."
  if (-not $portableProcess.HasExited) { Stop-ProcessTree -ProcessId $portableProcess.Id }

  $installDir = Join-Path $env:RUNNER_TEMP "AirmonlinkComposer-Build$ExpectedBuild-Clean"
  if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
  try {
    Invoke-SilentInstaller -Installer $installer -Destination $installDir
    $installedExe = Join-Path $installDir "Airmonlink Composer.exe"
    Assert-True (Test-Path $installedExe -PathType Leaf) "clean-install" "Silent installer completed and installed executable exists at the disposable destination."

    $startMenuRoots = @(
      [Environment]::GetFolderPath("CommonStartMenu"),
      [Environment]::GetFolderPath("StartMenu")
    ) | Where-Object { $_ }
    $desktopRoots = @(
      [Environment]::GetFolderPath("CommonDesktopDirectory"),
      [Environment]::GetFolderPath("DesktopDirectory")
    ) | Where-Object { $_ }
    $startShortcut = Get-ChildItem $startMenuRoots -Filter "*Airmonlink*Composer*.lnk" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    $desktopShortcut = Get-ChildItem $desktopRoots -Filter "*Airmonlink*Composer*.lnk" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert-True ($null -ne $startShortcut) "start-menu-shortcut" "An Airmonlink Composer Start Menu shortcut exists."
    Assert-True ($null -ne $desktopShortcut) "desktop-shortcut" "The configured desktop shortcut exists."

    $installedLog = Join-Path $validationPath "installed-launch.jsonl"
    $env:AIRMONLINK_VALIDATION_LOG = $installedLog
    $installedStdout = Join-Path $validationPath "installed-stdout.log"
    $installedStderr = Join-Path $validationPath "installed-stderr.log"
    $installedProcess = Start-Process -FilePath $installedExe -PassThru -RedirectStandardOutput $installedStdout -RedirectStandardError $installedStderr
    $installedReady = Wait-ForCondition -TimeoutSeconds 25 -Condition {
      (Test-Path $installedLog) -and ((Get-Content $installedLog -Raw) -match '"stage":"renderer-ready"')
    }
    $installedRunning = -not $installedProcess.HasExited
    Assert-True ($installedReady -and $installedRunning) "installed-startup" "Installed process remained alive and emitted renderer-ready diagnostics."
    if (-not $installedProcess.HasExited) { Stop-ProcessTree -ProcessId $installedProcess.Id }

    $classRoot = $null
    foreach ($candidate in @(
      "Registry::HKEY_LOCAL_MACHINE\Software\Classes\.airscore",
      "Registry::HKEY_CURRENT_USER\Software\Classes\.airscore"
    )) {
      if (Test-Path $candidate) { $classRoot = $candidate; break }
    }
    if ($classRoot) {
      $className = (Get-Item $classRoot).GetValue("")
      $hivePrefix = if ($classRoot -like "*LOCAL_MACHINE*") { "Registry::HKEY_LOCAL_MACHINE\Software\Classes" } else { "Registry::HKEY_CURRENT_USER\Software\Classes" }
      $commandKey = Join-Path (Join-Path $hivePrefix $className) "shell\open\command"
      $openCommand = if (Test-Path $commandKey) { (Get-Item $commandKey).GetValue("") } else { $null }
      Assert-True ([bool]$openCommand -and $openCommand -match '%1') "airscore-registration" "The .airscore class and quoted document argument are registered."
    } else {
      Add-Result "airscore-registration" "FAIL" "No .airscore registry class was found after installation."
    }

    $sampleScore = Join-Path $validationPath "Windows-Association-Validation.airscore"
    & node scripts/create-validation-score.js $sampleScore | Out-File -Encoding utf8 (Join-Path $validationPath "sample-score-generation.log")
    if ($LASTEXITCODE -ne 0) { throw "Validation score generation failed." }
    $sampleHashBefore = (Get-FileHash $sampleScore -Algorithm SHA256).Hash
    if (Test-Path $installedLog) { Remove-Item -Force $installedLog }
    Start-Process -FilePath $sampleScore | Out-Null
    $associationOpened = Wait-ForCondition -TimeoutSeconds 30 -Condition {
      (Test-Path $installedLog) -and
      ((Get-Content $installedLog -Raw) -match '"stage":"associated-open-result"') -and
      ((Get-Content $installedLog -Raw) -match '"success":true')
    }
    Assert-True $associationOpened "airscore-open" "Launching the sample through Windows association produced a successful renderer open result."
    Get-Process -Name "Airmonlink Composer" -ErrorAction SilentlyContinue | ForEach-Object { Stop-ProcessTree -ProcessId $_.Id }

    $uninstaller = Get-ChildItem $installDir -Filter "Uninstall*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert-True ($null -ne $uninstaller) "uninstaller-present" "Installed uninstaller executable exists."
    if ($uninstaller) {
      Invoke-SilentUninstaller -Uninstaller $uninstaller.FullName
      $removed = Wait-ForCondition -TimeoutSeconds 30 -Condition { -not (Test-Path $installedExe) }
      Assert-True $removed "uninstall-cleanup" "Silent uninstall removed the installed application executable."
      $sampleHashAfter = (Get-FileHash $sampleScore -Algorithm SHA256).Hash
      Assert-True ($sampleHashBefore -eq $sampleHashAfter) "user-score-preserved" "The user-created validation score remained byte-identical after uninstall."
    }
  } catch {
    Add-Result "windows-install-cycle" "FAIL" $_.Exception.Message
  } finally {
    Get-Process -Name "Airmonlink Composer" -ErrorAction SilentlyContinue | ForEach-Object {
      try { Stop-ProcessTree -ProcessId $_.Id } catch {}
    }
  }

  $previousInstaller = $env:PREVIOUS_AIRMONLINK_INSTALLER
  if ($previousInstaller -and (Test-Path $previousInstaller -PathType Leaf)) {
    $upgradeDir = Join-Path $env:RUNNER_TEMP "AirmonlinkComposer-Build$ExpectedBuild-Upgrade"
    if (Test-Path $upgradeDir) { Remove-Item -Recurse -Force $upgradeDir }
    $upgradeScore = Join-Path $validationPath "upgrade-preservation.airscore"
    & node scripts/create-validation-score.js $upgradeScore | Out-Null
    $upgradeHashBefore = (Get-FileHash $upgradeScore -Algorithm SHA256).Hash
    try {
      Invoke-SilentInstaller -Installer $previousInstaller -Destination $upgradeDir
      Invoke-SilentInstaller -Installer $installer -Destination $upgradeDir
      $upgradeExe = Join-Path $upgradeDir "Airmonlink Composer.exe"
      $upgradeVersion = if (Test-Path $upgradeExe) { (Get-Item $upgradeExe).VersionInfo.ProductVersion } else { "" }
      $upgradeHashAfter = (Get-FileHash $upgradeScore -Algorithm SHA256).Hash
      Assert-True ((Test-Path $upgradeExe) -and $upgradeVersion -like "$ExpectedVersion*" -and $upgradeHashBefore -eq $upgradeHashAfter) "upgrade-preservation" "Previous installer upgraded to $upgradeVersion and preserved the validation score."
      $upgradeUninstaller = Get-ChildItem $upgradeDir -Filter "Uninstall*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($upgradeUninstaller) { Invoke-SilentUninstaller $upgradeUninstaller.FullName }
    } catch {
      Add-Result "upgrade-preservation" "FAIL" $_.Exception.Message
    }
  } else {
    Add-Result "upgrade-preservation" "BLOCKED" "No previous installable Airmonlink Composer artifact was available to this workflow."
  }
}

Add-Result "staff-rendering-windows" "BLOCKED" "The runner proves renderer startup but does not provide human visual confirmation of staff rendering and responsiveness."
Add-Result "tonic-solfa-responsive-windows" "BLOCKED" "Common Windows laptop/desktop viewport appearance requires human GUI inspection."
Add-Result "zoom-controls-windows" "BLOCKED" "Fit Width, Fit Page, 100%, and manual zoom remain covered by source/browser tests but not human Windows GUI inspection."
Add-Result "printing-windows" "BLOCKED" "One-page and long multi-page tonic-solfa printing/PDF require human Windows print-dialog or printer/PDF verification."
Add-Result "publication-text-windows" "BLOCKED" "Save/reopen persistence is automated, but Windows drag/edit interaction requires human GUI inspection."
Add-Result "chord-input-windows" "BLOCKED" "Model and browser tests cover chord creation; Windows keyboard, piano, and MIDI interaction need human/device testing."
Add-Result "lyric-isolation-windows" "BLOCKED" "Automated tests cover verse-number isolation; Windows human editing remains unverified."
Add-Result "right-dock-windows" "BLOCKED" "Automated layout tests cover non-obstruction; Windows human visual confirmation remains unverified."
Add-Result "blank-window-visual" "BLOCKED" "Renderer-ready and process-liveness evidence cannot prove the visible window is not blank."
Add-Result "smartscreen-presentation" "BLOCKED" "SmartScreen presentation requires a Windows user-interaction check; unsigned status is reported separately."

$summary = [pscustomobject]@{
  product = "Airmonlink Composer"
  version = $ExpectedVersion
  build = $ExpectedBuild
  generatedAt = [DateTime]::UtcNow.ToString("o")
  runner = if (Test-Path Env:RUNNER_NAME) { $env:RUNNER_NAME } else { "local-or-unknown" }
  results = $results
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $validationPath "windows-validation-summary.json")
$results | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path $validationPath "windows-validation-summary.csv")

if ($failures.Count -gt 0) {
  throw "Windows validation failed:`n$($failures -join "`n")"
}

$successMarker = Join-Path $validationPath "windows-validation.ok"
@(
  "status=PASS"
  "product=Airmonlink Composer"
  "version=$ExpectedVersion"
  "build=$ExpectedBuild"
  "generatedAt=$([DateTime]::UtcNow.ToString('o'))")
} | Set-Content -Encoding ascii $successMarker

# Ensure an earlier native utility such as taskkill cannot determine the
# caller's result after validation has completed successfully.
$global:LASTEXITCODE = 0
Write-Host "Windows validation completed without FAIL rows. BLOCKED rows remain explicitly reported."
