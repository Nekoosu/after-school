$ErrorActionPreference = "Continue"
$node = "C:\Program Files\nodejs\node.exe"
$root = "E:\after-school"
$base = "http://127.0.0.1:3319"

Set-Location $root

Write-Output "== 清空数据库与进程 =="
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node } | Stop-Process -Force
Start-Sleep -Seconds 2
if (Test-Path "$root\data") { Remove-Item -Recurse -Force "$root\data" }
if (Test-Path "$root\backups") { Get-ChildItem "$root\backups" -Force | Remove-Item -Recurse -Force }

Write-Output "== 起服务 =="
$env:NODE_ENV = "production"
$out = "$env:TEMP\as-smoke-out.log"
$err = "$env:TEMP\as-smoke-err.log"
$p = Start-Process -FilePath $node -ArgumentList "node_modules\next\dist\bin\next","start","-H","127.0.0.1","-p","3319" -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err

$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $h = Invoke-RestMethod "$base/api/health" -TimeoutSec 2
    if ($h.ok) { $up = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (-not $up) {
  Write-Output "服务没起来，stderr:"
  Get-Content $err -ErrorAction SilentlyContinue | Select-Object -Last 30
  exit 1
}
Write-Output "服务已就绪 pid=$($p.Id)"

$total = 0
$bad = 0
foreach ($n in 2..15) {
  Write-Output ""
  Write-Output "########## smoke$n ##########"
  $res = & $node "scripts\smoke$n.mjs" $base 2>&1
  $res | ForEach-Object { $_ }
  $line = ($res | Select-String -Pattern "passed, \d+ failed" | Select-Object -Last 1)
  if ($line) {
    $m = [regex]::Match([string]$line, "(\d+) passed, (\d+) failed")
    $total += [int]$m.Groups[1].Value
    $bad += [int]$m.Groups[2].Value
  } else {
    Write-Output "!! smoke$n 没有输出统计行"
    $bad += 1
  }
}

Write-Output ""
Write-Output "===== 合计 $total 项通过，$bad 项失败 ====="

Write-Output "== 停服务 =="
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node } | Stop-Process -Force
