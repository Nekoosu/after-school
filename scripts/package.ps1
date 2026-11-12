# Pack the app into dist\ as a double-clickable desktop folder.
# Requires: real node at C:\Program Files\nodejs\node.exe, csc at Framework64 v4.0.30319.
# NOTE: keep this file ASCII-only. PS 5.1 reads .ps1 as GBK without a BOM, so Chinese
# comments would swallow the lines that follow them.
# Also: do NOT turn on output:"standalone" here - pnpm symlinks cannot be created on
# Windows without extra privileges, next build then fails with EPERM.
$ErrorActionPreference = "Continue"
$root   = "E:\after-school"
$node   = "C:\Program Files\nodejs\node.exe"
$npmCli = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
$csc    = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$dist   = Join-Path $root "dist"
$app    = Join-Path $dist "app"

function Step($m) { Write-Host ("== " + $m) }

Step "1/8 build"
Set-Location $root
& $node "node_modules\next\dist\bin\next" build 2>&1 | Select-String -Pattern "Compiled successfully|error" | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "next build failed" }

Step "2/8 clean dist"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Path $app -Force | Out-Null

Step "3/8 copy build output"
Copy-Item -Recurse -Force (Join-Path $root ".next") (Join-Path $app ".next")
if (Test-Path (Join-Path $app ".next\cache")) { Remove-Item -Recurse -Force (Join-Path $app ".next\cache") }
Copy-Item -Recurse -Force (Join-Path $root "public") (Join-Path $app "public")

Step "4/8 write runtime package.json + next.config.js"
$pkg = @'
{
  "name": "after-school",
  "private": true,
  "version": "1.1.0",
  "dependencies": {
    "better-sqlite3": "12.11.1",
    "next": "15.5.29",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  }
}
'@
[System.IO.File]::WriteAllText((Join-Path $app "package.json"), $pkg, [System.Text.UTF8Encoding]::new($false))
$cfg = 'module.exports = { serverExternalPackages: ["better-sqlite3"] };' + "`r`n"
[System.IO.File]::WriteAllText((Join-Path $app "next.config.js"), $cfg, [System.Text.UTF8Encoding]::new($false))

Step "5/8 npm install runtime deps (ignore-scripts, npmmirror)"
$env:npm_config_registry = "https://registry.npmmirror.com"
$env:npm_config_audit = "false"
$env:npm_config_fund = "false"
& $node $npmCli install --omit=dev --ignore-scripts --no-package-lock --loglevel=error --prefix $app 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Step "6/8 drop in native better-sqlite3 binary (ABI 137, built for real node v24)"
$srcBin = Join-Path $root "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
if (-not (Test-Path $srcBin)) { throw "native binary missing in project node_modules" }
New-Item -ItemType Directory -Path (Join-Path $app "node_modules\better-sqlite3\build\Release") -Force | Out-Null
Copy-Item -Force $srcBin (Join-Path $app "node_modules\better-sqlite3\build\Release\better_sqlite3.node")

Step "7/8 bundle node.exe + compile launcher exe (WebView2 shell)"
Copy-Item -Force "C:\Program Files\nodejs\node.exe" (Join-Path $app "node.exe")
$exe = Join-Path $dist "AfterSchool.exe"
$ico = Join-Path $root "public\app.ico"
$src = Join-Path $root "launcher\Launcher.cs"
$wv2 = Join-Path $root "launcher\shell\lib"
$wvCore = Join-Path $wv2 "Microsoft.Web.WebView2.Core.dll"
$wvForms = Join-Path $wv2 "Microsoft.Web.WebView2.WinForms.dll"
# 壳要跟 WebView2 的托管程序集一起编译，运行期 dll 也必须放在 exe 旁边
& $csc /nologo /target:winexe /platform:x64 /codepage:65001 /out:$exe /win32icon:$ico /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:$wvCore /r:$wvForms $src
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Copy-Item -Force $wvCore $dist
Copy-Item -Force $wvForms $dist
Copy-Item -Force (Join-Path $wv2 "WebView2Loader.dll") $dist

Step "8/8 copy the plain-text readme next to the exe"
Get-ChildItem (Join-Path $root "launcher") -Filter *.txt | Copy-Item -Destination $dist -Force
Remove-Item -Force (Join-Path $app ".next\trace") -ErrorAction SilentlyContinue

$size = [math]::Round(((Get-ChildItem -Recurse $dist | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ("DONE  dist size: " + $size + " MB")
Write-Host ("exe : " + $exe)
