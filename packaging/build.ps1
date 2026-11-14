# Builds Sensfinder: UI -> PyInstaller onedir -> headless check -> portable zip (always) -> installer (if Inno
# Setup is installed) -> SHA-256 file. Run from anywhere:  powershell -File packaging\build.ps1
param([switch]$SkipUi, [switch]$SkipInstaller)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Select-String -Path pyproject.toml -Pattern '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
$py = if (Test-Path .venv\Scripts\python.exe) { ".venv\Scripts\python.exe" } else { "python" }
Write-Host "== Sensfinder $version"

if (-not $SkipUi -or -not (Test-Path ui\dist\index.html)) {
    Write-Host "== building the UI"
    Push-Location ui
    if (-not (Test-Path node_modules)) { npm ci; if ($LASTEXITCODE) { throw "npm ci failed" } }
    npm run build; if ($LASTEXITCODE) { throw "UI build failed" }
    Pop-Location
}
if (-not (Select-String -Path ui\dist\index.html -Pattern "SF_BOOT" -Quiet)) { throw "ui/dist/index.html has no SF_BOOT marker" }

Write-Host "== icon"
& $py -c "import sys; sys.path.insert(0, '.'); from shell.main import make_icon; make_icon(256).save('packaging/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
if ($LASTEXITCODE) { throw "icon failed" }

Write-Host "== PyInstaller (onedir)"
& $py -m PyInstaller packaging\sensfinder.spec --noconfirm --distpath dist --workpath build --log-level WARN
if ($LASTEXITCODE) { throw "PyInstaller failed" }

Write-Host "== headless check of the built exe"
$check = Join-Path $env:TEMP "sensfinder-check-$PID.json"
Remove-Item $check -ErrorAction SilentlyContinue
$p = Start-Process -FilePath dist\Sensfinder\Sensfinder.exe -ArgumentList "--headless-check", "`"$check`"" -PassThru
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw "the built exe did not finish its headless check in 120 s" }
if (-not (Test-Path $check)) { throw "the built exe wrote no check result" }
$result = Get-Content $check -Raw | ConvertFrom-Json
Write-Host "   $(Get-Content $check -Raw)"
if (-not $result.ok) { throw "headless check failed" }
Remove-Item $check

New-Item -ItemType Directory -Force release | Out-Null
$zip = "release\Sensfinder-$version-portable.zip"
Write-Host "== $zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path dist\Sensfinder -DestinationPath $zip -CompressionLevel Optimal
$artifacts = @($zip)

$iscc = @((Get-Command iscc -ErrorAction SilentlyContinue).Source,
          "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
          "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($SkipInstaller) {
    Write-Host "== installer skipped (-SkipInstaller)"
} elseif ($iscc) {
    Write-Host "== installer (Inno Setup)"
    & $iscc "/DAppVersion=$version" /Qp packaging\sensfinder.iss
    if ($LASTEXITCODE) { throw "Inno Setup failed" }
    $artifacts += "release\Sensfinder-$version-setup.exe"
} else {
    Write-Host "== Inno Setup not found: installer skipped (winget install JRSoftware.InnoSetup)"
}

$sums = $artifacts | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_ -Algorithm SHA256).Hash.ToLower(), (Split-Path $_ -Leaf) }
$sums | Set-Content "release\SHA256SUMS.txt" -Encoding ascii
Write-Host "== done"
$sums | ForEach-Object { Write-Host "   $_" }
