# Installs FFmpeg on the Windows runner (Chocolatey, falling back to the gyan.dev build)
# and checks that it has libx264 and libass, which UNLOCK CLIPS needs.
$ErrorActionPreference = "Stop"

function Test-FFmpeg { return [bool](Get-Command ffmpeg -ErrorAction SilentlyContinue) }

for ($attempt = 1; $attempt -le 2 -and -not (Test-FFmpeg); $attempt++) {
    Write-Host "choco install ffmpeg (attempt $attempt)"
    choco install ffmpeg -y --no-progress
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + $env:Path
}

if (-not (Test-FFmpeg)) {
    Write-Host "Chocolatey did not provide ffmpeg; downloading the gyan.dev essentials build"
    $zip = Join-Path $env:RUNNER_TEMP "ffmpeg.zip"
    $dest = Join-Path $env:RUNNER_TEMP "ffmpeg"
    Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $dest -Force
    $bin = (Get-ChildItem $dest -Recurse -Filter ffmpeg.exe | Select-Object -First 1).DirectoryName
    $env:Path = "$bin;$env:Path"
}

$ffmpeg = (Get-Command ffmpeg).Source
$bin = Split-Path -Parent $ffmpeg
Add-Content -Path $env:GITHUB_PATH -Value $bin -Encoding ascii
Write-Host "ffmpeg: $ffmpeg"
& $ffmpeg -hide_banner -version | Select-Object -First 1 | Write-Host
$encoders = (& $ffmpeg -hide_banner -encoders) -join "`n"
$filters = (& $ffmpeg -hide_banner -filters) -join "`n"
if ($encoders -notmatch " libx264 ") { throw "ffmpeg without libx264" }
if ($filters -notmatch " ass ") { throw "ffmpeg without libass" }
if (-not (Get-Command ffprobe -ErrorAction SilentlyContinue)) { throw "ffprobe not found" }
Write-Host "ffmpeg OK (libx264 + libass)"
