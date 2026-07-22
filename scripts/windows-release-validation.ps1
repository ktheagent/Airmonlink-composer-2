param(
  [string]$ReleaseDirectory = "release",
  [string]$ValidationDirectory = "validation",
  [int]$ExpectedBuild = 16
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path ".").Path
$release = Join-Path $root $ReleaseDirectory
$validation = Join-Path $root $ValidationDirectory
New-Item -ItemType Directory -Force $validation | Out-Null

$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$buildNumber = [string]$package.buildNumber
$buildVersion = [string]$package.build.buildVersion
$expectedSetup = "Airmonlink-Composer-$version-Build$ExpectedBuild-Setup.exe"
$expectedPortable = "Airmonlink-Composer-$version-Build$ExpectedBuild-Portable.exe"
$setupPath = Join-Path $release $expectedSetup
$portablePath = Join-Path $release $expectedPortable

$rows = [System.Collections.Generic.List[object]]::new()

function Add-Row([string]$Name, [string]$Status, [string]$Details) {
  $rows.Add([pscustomobject]@{ Name = $Name; Status = $Status; Details = $Details })
}

function Assert-Check([bool]$Condition, [string]$Name, [string]$Details) {
  if ($Condition) { Add-Row $Name "PASS" $Details }
  else { Add-Row $Name "FAIL" $Details }
}

Assert-Check ($buildNumber -eq [string]$ExpectedBuild) "Package build number" "Expected $ExpectedBuild; found $buildNumber"
Assert-Check ($buildVersion -eq "$version.$ExpectedBuild") "Windows build version" "Expected $version.$ExpectedBuild; found $buildVersion"
Assert-Check ([string]$package.main -eq "src/release-bootstrap.js") "Publishing bootstrap" "Package entry point is $($package.main)"
Assert-Check ([string]$package.build.nsis.artifactName -match "Build$ExpectedBuild") "Installer naming" ([string]$package.build.nsis.artifactName)
Assert-Check ([string]$package.build.portable.artifactName -match "Build$ExpectedBuild") "Portable naming" ([string]$package.build.portable.artifactName)

$requiredSource = @(
  "src\release-bootstrap.js",
  "src\bootstrap.js",
  "src\desktop\publishing.js",
  "src\ui\publishing-ui.js",
  "src\ui\publishing-exposure.js",
  "test\v122-dedicated-publishing.test.js",
  "test\v123-build16-publishing-exposure.test.js"
)

foreach ($relative in $requiredSource) {
  Assert-Check (Test-Path (Join-Path $root $relative)) "Required source: $relative" $relative
}

$releaseBootstrapPath = Join-Path $root "src\release-bootstrap.js"
$releaseBootstrapSource = if (Test-Path $releaseBootstrapPath) { Get-Content $releaseBootstrapPath -Raw } else { "" }
Assert-Check ($releaseBootstrapSource -match "const BUILD = $ExpectedBuild;") "Exposure build identity" "release-bootstrap.js declares Build $ExpectedBuild"
Assert-Check ($releaseBootstrapSource -match "publishing-exposure\.js") "Exposure source wiring" "release-bootstrap.js loads publishing-exposure.js"
Assert-Check ($releaseBootstrapSource -match "require\('\\.\\/bootstrap'\)") "Desktop bootstrap chaining" "release-bootstrap.js chains to src/bootstrap.js"

Assert-Check (Test-Path $setupPath) "Setup artifact exists" $setupPath
Assert-Check (Test-Path $portablePath) "Portable artifact exists" $portablePath

function Test-PeFile([string]$Path) {
  if (-not (Test-Path $Path)) { return $false }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    if ($stream.Length -lt 1024) { return $false }

    $reader = [System.IO.BinaryReader]::new($stream)
    if ($reader.ReadUInt16() -ne 0x5A4D) { return $false }

    $stream.Position = 0x3C
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 64 -or $peOffset -gt ($stream.Length - 4)) { return $false }

    $stream.Position = $peOffset
    return $reader.ReadUInt32() -eq 0x00004550
  } finally {
    $stream.Dispose()
  }
}

Assert-Check (Test-PeFile $setupPath) "Setup PE validation" "MZ and PE magic signatures"
Assert-Check (Test-PeFile $portablePath) "Portable PE validation" "MZ and PE magic signatures"

if (Test-Path $setupPath) {
  $setupInfo = Get-Item $setupPath
  Assert-Check ($setupInfo.Length -gt 10MB) "Setup size sanity" "$($setupInfo.Length) bytes"
}

if (Test-Path $portablePath) {
  $portableInfo = Get-Item $portablePath
  Assert-Check ($portableInfo.Length -gt 10MB) "Portable size sanity" "$($portableInfo.Length) bytes"
}

$hashLines = @()
foreach ($file in @($setupPath, $portablePath)) {
  if (Test-Path $file) {
    $hash = Get-FileHash $file -Algorithm SHA256
    $hashLines += "$($hash.Hash.ToLowerInvariant()) $([IO.Path]::GetFileName($file))"
  }
}

$hashPath = Join-Path $release "SHA256SUMS.txt"
$hashLines | Set-Content -Encoding ascii $hashPath
Assert-Check ((Test-Path $hashPath) -and ((Get-Item $hashPath).Length -gt 100)) "SHA256 manifest" $hashPath

# Launch the portable binary long enough to prove process creation, then close it.
if (Test-Path $portablePath) {
  try {
    $process = Start-Process -FilePath $portablePath -PassThru
    Start-Sleep -Seconds 8
    $alive = -not $process.HasExited
    Assert-Check $alive "Portable launch smoke test" "Process started and remained alive for 8 seconds"

    if ($alive) {
      $process.CloseMainWindow() | Out-Null
      Start-Sleep -Seconds 3
      if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
  } catch {
    Add-Row "Portable launch smoke test" "FAIL" $_.Exception.Message
  }
}

Add-Row "Human GUI inspection" "BLOCKED" "Requires a person on Windows."
Add-Row "MIDI hardware" "BLOCKED" "Requires physical MIDI hardware."
Add-Row "Audio device" "BLOCKED" "Requires physical audio output."
Add-Row "Code-signing trust" "BLOCKED" "No signing certificate was supplied."

$jsonPath = Join-Path $validation "windows-release-validation.json"
$csvPath = Join-Path $validation "windows-release-validation.csv"
$rows | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $jsonPath
$rows | Export-Csv -NoTypeInformation -Encoding utf8 $csvPath
$rows | Format-Table -AutoSize | Out-String | Set-Content -Encoding utf8 (Join-Path $validation "windows-release-validation.txt")

$failures = @($rows | Where-Object Status -eq "FAIL")
if ($failures.Count -gt 0) {
  $failures | Format-Table -AutoSize
  throw "Windows release validation found $($failures.Count) FAIL row(s)."
}

"OK" | Set-Content -Encoding ascii (Join-Path $validation "windows-validation.ok")
Write-Host "Windows validation completed without FAIL rows. BLOCKED rows remain explicitly reported."
exit 0
