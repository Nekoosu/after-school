# 一键跑浏览器点击检查：清空测试库 → 起服务 → 点一遍 → 停服务
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ui-check.ps1
param([int]$Port = 3318)

$ErrorActionPreference = "Continue"
$root = "E:\after-school"
$node = "C:\Program Files\nodejs\node.exe"

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Remove-Item "$root\data" -Force -Recurse -ErrorAction SilentlyContinue
Remove-Item "$root\backups" -Force -Recurse -ErrorAction SilentlyContinue
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath $node `
  -ArgumentList @("node_modules\next\dist\bin\next", "start", "-p", "$Port", "-H", "127.0.0.1") `
  -WorkingDirectory $root -PassThru -WindowStyle Hidden

$ready = $false
for ($i = 0; $i -lt 80; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/dashboard" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 400
}

if (-not $ready) {
  Write-Host "服务没起来（端口 $Port）" -ForegroundColor Red
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

& $node "$root\scripts\ui-check.mjs" "http://127.0.0.1:$Port"
$code = $LASTEXITCODE

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
exit $code
