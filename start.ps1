# Embedded Python: D:\TOOLS\embedded\python
# Start Image Compare Share on port 8765
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path "D:\TOOLS\embedded\python" "python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}
Set-Location $root
Write-Host "Using Python: $python"
Write-Host "Open admin:  http://127.0.0.1:8765/"
& $python -m uvicorn app.main:app --host 0.0.0.0 --port 8765
