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

Step "1/9 build"
Set-Location $root
& $node "node_modules\next\dist\bin\next" build 2>&1 | Select-String -Pattern "Compiled successfully|error" | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "next build failed" }

# Single source of truth for the version: src\lib\version.ts. Everything else
# (installer exe, version.txt, runtime package.json) reads it from there.
$verLine = Select-String -Path (Join-Path $root "src\lib\version.ts") -Pattern 'APP_VERSION\s*=\s*"([0-9.]+)"' | Select-Object -First 1
if (-not $verLine) { throw "cannot read APP_VERSION from src\lib\version.ts" }
$script:ver = $verLine.Matches[0].Groups[1].Value
Write-Host ("version: " + $ver)

Step "2/9 clean dist"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Path $app -Force | Out-Null

Step "3/9 copy build output"
Copy-Item -Recurse -Force (Join-Path $root ".next") (Join-Path $app ".next")
if (Test-Path (Join-Path $app ".next\cache")) { Remove-Item -Recurse -Force (Join-Path $app ".next\cache") }
Copy-Item -Recurse -Force (Join-Path $root "public") (Join-Path $app "public")

Step "4/9 write runtime package.json + next.config.js"
$pkg = @'
{
  "name": "after-school",
  "private": true,
  "version": "__VER__",
  "dependencies": {
    "better-sqlite3": "12.11.1",
    "next": "15.5.29",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  }
}
'@
$pkg = $pkg.Replace("__VER__", $ver)
[System.IO.File]::WriteAllText((Join-Path $app "package.json"), $pkg, [System.Text.UTF8Encoding]::new($false))
$cfg = 'module.exports = { serverExternalPackages: ["better-sqlite3"] };' + "`r`n"
[System.IO.File]::WriteAllText((Join-Path $app "next.config.js"), $cfg, [System.Text.UTF8Encoding]::new($false))

Step "5/9 npm install runtime deps (ignore-scripts, npmmirror)"
$env:npm_config_registry = "https://registry.npmmirror.com"
$env:npm_config_audit = "false"
$env:npm_config_fund = "false"
& $node $npmCli install --omit=dev --ignore-scripts --no-package-lock --loglevel=error --prefix $app 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Step "6/9 drop in native better-sqlite3 binary (ABI 137, built for real node v24)"
$srcBin = Join-Path $root "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
if (-not (Test-Path $srcBin)) { throw "native binary missing in project node_modules" }
New-Item -ItemType Directory -Path (Join-Path $app "node_modules\better-sqlite3\build\Release") -Force | Out-Null
Copy-Item -Force $srcBin (Join-Path $app "node_modules\better-sqlite3\build\Release\better_sqlite3.node")

Step "7/9 bundle node.exe + compile launcher exe (WebView2 shell)"
Copy-Item -Force "C:\Program Files\nodejs\node.exe" (Join-Path $app "node.exe")
$exe = Join-Path $dist "AfterSchool.exe"
$ico = Join-Path $root "public\app.ico"
$src = Join-Path $root "launcher\Launcher.cs"
$wv2 = Join-Path $root "launcher\shell\lib"
$wvCore = Join-Path $wv2 "Microsoft.Web.WebView2.Core.dll"
$wvForms = Join-Path $wv2 "Microsoft.Web.WebView2.WinForms.dll"
# The shell is compiled against the WebView2 managed assemblies, so the runtime
# dlls have to sit next to the exe.
& $csc /nologo /target:winexe /platform:x64 /codepage:65001 /out:$exe /win32icon:$ico /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:$wvCore /r:$wvForms $src
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Copy-Item -Force $wvCore $dist
Copy-Item -Force $wvForms $dist
Copy-Item -Force (Join-Path $wv2 "WebView2Loader.dll") $dist

Step "8/9 compile installer + uninstaller (plain .NET 4, no WebView2 needed)"
# Chinese file names are built from code points on purpose: this .ps1 is ASCII-only
# (PS 5.1 reads a BOM-less script as GBK, which would mangle literal Chinese).
$cnInstall = [string][char]0x5B89 + [char]0x88C5 + ".exe"
$cnUninstall = [string][char]0x5378 + [char]0x8F7D + ".exe"
$installer = Join-Path $dist $cnInstall
$uninstaller = Join-Path $dist $cnUninstall
$uninstSrc = Join-Path $root "launcher\Uninstaller.cs"
$instSrc = Join-Path $root "launcher\Installer.cs"
# Show the real version in the installer window: swap the Setup.Version placeholder
# (Installer.cs carries __VER__) for the value read above.
$instText = [System.IO.File]::ReadAllText($instSrc)
if ($instText.Contains("__VER__")) { $instText = $instText.Replace("__VER__", $ver) }
$instGen = Join-Path $env:TEMP ("Installer." + $ver + ".cs")
[System.IO.File]::WriteAllText($instGen, $instText, [System.Text.UTF8Encoding]::new($false))
& $csc /nologo /target:winexe /platform:anycpu /codepage:65001 /win32icon:$ico /out:$installer /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll $instGen (Join-Path $root "launcher\Ui.cs")
if ($LASTEXITCODE -ne 0) { throw "csc installer failed" }
Remove-Item -Force $instGen -ErrorAction SilentlyContinue
$uninstIco = Join-Path $root "public\app.ico"
& $csc /nologo /target:winexe /platform:anycpu /codepage:65001 /win32icon:$uninstIco /out:$uninstaller /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll $uninstSrc (Join-Path $root "launcher\Ui.cs")
if ($LASTEXITCODE -ne 0) { throw "csc uninstaller failed" }

Step "9/9 copy the plain-text readme next to the exe"
Get-ChildItem (Join-Path $root "launcher") -Filter *.txt | Copy-Item -Destination $dist -Force
Remove-Item -Force (Join-Path $app ".next\trace") -ErrorAction SilentlyContinue

$size = [math]::Round(((Get-ChildItem -Recurse $dist | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ("DONE  dist size: " + $size + " MB")
Write-Host ("exe : " + $exe)
