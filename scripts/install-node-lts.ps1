param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeRoot = Join-Path $projectRoot ".runtime"
$nodeDir = Join-Path $runtimeRoot "node"
$nodeExe = Join-Path $nodeDir "node.exe"

function Test-NodeVersionText {
  param([string]$Version)

  $clean = $Version.TrimStart("v")
  $parts = $clean.Split(".")
  if ($parts.Length -lt 3) {
    return $false
  }

  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  $patch = [int]$parts[2]

  return (
    ($major -eq 20 -and ($minor -gt 19 -or ($minor -eq 19 -and $patch -ge 0))) -or
    ($major -eq 22 -and ($minor -gt 12 -or ($minor -eq 12 -and $patch -ge 0))) -or
    ($major -gt 22)
  )
}

function Test-NodeExe {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $version = & $Path -p "process.versions.node" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
    return $false
  }

  return Test-NodeVersionText $version
}

if (Test-NodeExe $nodeExe) {
  Write-Host "Node.js portable da san sang: $(& $nodeExe -v)"
  exit 0
}

if ($CheckOnly) {
  Write-Host "Node.js portable chua duoc cai."
  exit 1
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "Dang tim Node.js LTS phu hop..."
$index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
$release = $index | Where-Object {
  $_.lts -and
  (Test-NodeVersionText $_.version) -and
  ([int]$_.version.TrimStart("v").Split(".")[0] -le 22)
} | Select-Object -First 1

if (-not $release) {
  throw "Khong tim thay ban Node.js LTS phu hop tren nodejs.org."
}

$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$version = $release.version
$zipName = "node-$version-win-$arch.zip"
$zipUrl = "https://nodejs.org/dist/$version/$zipName"
$zipPath = Join-Path $runtimeRoot $zipName
$extractDir = Join-Path $runtimeRoot ("node-extract-" + [guid]::NewGuid().ToString("N"))

Write-Host "Dang tai $zipName..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Host "Dang giai nen Node.js..."
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
$expandedNodeDir = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1

if (-not $expandedNodeDir) {
  throw "Giai nen Node.js that bai."
}

if (Test-Path -LiteralPath $nodeDir) {
  $runtimeResolved = (Resolve-Path -LiteralPath $runtimeRoot).Path
  $nodeResolved = (Resolve-Path -LiteralPath $nodeDir).Path
  if (-not $nodeResolved.StartsWith($runtimeResolved, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Duong dan Node.js portable khong an toan de thay the."
  }
  Remove-Item -LiteralPath $nodeDir -Recurse -Force
}

Move-Item -LiteralPath $expandedNodeDir.FullName -Destination $nodeDir
Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

if (-not (Test-NodeExe $nodeExe)) {
  throw "Node.js portable da tai nhung khong chay duoc."
}

Write-Host "Da cai Node.js portable: $(& $nodeExe -v)"
Write-Host "npm: $(& (Join-Path $nodeDir "npm.cmd") -v)"
