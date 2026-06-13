# Sets up a local Paper server for MineAgent dev (offline mode).
# Usage: powershell -File server\setup.ps1 [-McVersion 1.21.4]
param(
    [string]$McVersion = "1.21.4"
)

$ErrorActionPreference = "Stop"
$serverDir = Join-Path $PSScriptRoot "paper"
New-Item -ItemType Directory -Force $serverDir | Out-Null

# --- Fetch latest Paper build for the version ---
$buildsUrl = "https://api.papermc.io/v2/projects/paper/versions/$McVersion/builds"
Write-Host "Fetching Paper builds for $McVersion..."
$builds = (Invoke-RestMethod $buildsUrl).builds
$latest = $builds | Where-Object { $_.channel -eq "default" } | Select-Object -Last 1
if ($null -eq $latest) { $latest = $builds | Select-Object -Last 1 }
$build = $latest.build
$jarName = "paper-$McVersion-$build.jar"
$jarPath = Join-Path $serverDir $jarName

if (-not (Test-Path $jarPath)) {
    $dlUrl = "https://api.papermc.io/v2/projects/paper/versions/$McVersion/builds/$build/downloads/$jarName"
    Write-Host "Downloading $jarName..."
    Invoke-WebRequest $dlUrl -OutFile $jarPath
} else {
    Write-Host "$jarName already present."
}

# --- EULA + server.properties ---
Set-Content -Path (Join-Path $serverDir "eula.txt") -Value "eula=true" -Encoding ascii

$props = @"
online-mode=false
gamemode=creative
difficulty=peaceful
spawn-protection=0
view-distance=8
simulation-distance=6
motd=MineAgent dev server
enable-command-block=true
max-players=5
"@
Set-Content -Path (Join-Path $serverDir "server.properties") -Value $props -Encoding ascii

# --- Start script ---
$start = @"
Set-Location `$PSScriptRoot
java -Xms1G -Xmx2G -jar $jarName nogui
"@
Set-Content -Path (Join-Path $serverDir "start.ps1") -Value $start -Encoding ascii

Write-Host ""
Write-Host "Done. Start the server with: powershell -File server\paper\start.ps1"
