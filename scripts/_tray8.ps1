# 临时：验证 1.8.3（托盘那句话、最大化记忆、单实例静默唤回）。测完删掉。
$ErrorActionPreference = "Stop"
$root = "E:\after-school"
$exe  = Join-Path $root "dist\AfterSchool.exe"
$app  = Join-Path $root "dist\app"

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W8 {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  public static string Title(IntPtr h) { StringBuilder s = new StringBuilder(256); GetWindowTextW(h, s, 256); return s.ToString(); }
  public static string Rect(IntPtr h) { RECT r; if (!GetWindowRect(h, out r)) return "?"; return (r.R - r.L) + "x" + (r.B - r.T) + "+" + r.L + "+" + r.T; }
  public static int W(IntPtr h) { RECT r; if (!GetWindowRect(h, out r)) return 0; return r.R - r.L; }
  public static IntPtr FindMain(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if ((int)p == pid && Title(h) == "课后服务管理" && W(h) >= 900) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static int CountTitled(int pid, string t) {
    int n = 0;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if ((int)p == pid && Title(h) == t) { n++; }
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
'@

function Health([int]$p) {
  try { return (Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 2).Content } catch { return "" }
}

function WaitApp($proc) {
  $port = 0; $h = [IntPtr]::Zero
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt 90000) {
    for ($i = 3210; $i -le 3219; $i++) { if ((Health $i).Length -gt 0) { $port = $i } }
    if ($port -gt 0) { break }
    Start-Sleep -Milliseconds 400
  }
  while ($sw.ElapsedMilliseconds -lt 120000) {
    $h = [W8]::FindMain($proc.Id)
    if ($h -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 300
  }
  return @{ port = $port; h = $h; sec = [int]($sw.ElapsedMilliseconds / 1000) }
}

"== 预清理（留一份干净的 data）"
Get-Process AfterSchool -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Remove-Item (Join-Path $app "data") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $app "backups") -Recurse -Force -ErrorAction SilentlyContinue

"== 第一次启动"
$p = Start-Process -FilePath $exe -PassThru
$a = WaitApp $p
"就绪 $($a.sec) s，端口 $($a.port)，窗口 $([W8]::Rect($a.h))"

"== 托盘那句话（网页接口 → 桌面壳托盘菜单第一行吃的就是它）"
$tray = (Invoke-WebRequest -Uri "http://127.0.0.1:$($a.port)/api/shell/tray" -UseBasicParsing -TimeoutSec 5).Content
"接口返回 = $tray"

"== 最大化，再 --quit：应该把「最大化着关的」记进 window.txt"
[void][W8]::PostMessage($a.h, 0x0112, [IntPtr]0xF030, [IntPtr]::Zero)  # WM_SYSCOMMAND + SC_MAXIMIZE
Start-Sleep -Seconds 2
"最大化后窗口 = $([W8]::Rect($a.h))"
$q = Start-Process -FilePath $exe -ArgumentList "--quit" -PassThru
[void]$q.WaitForExit(20000)
for ($i = 0; $i -lt 40; $i++) { if ($p.HasExited) { break }; Start-Sleep -Milliseconds 250 }
"主进程退出 = $($p.HasExited)"
"window.txt = " + ([System.IO.File]::ReadAllText((Join-Path $app "data\window.txt"))).Trim()

"== 第二次启动：应该直接是最大化"
$p2 = Start-Process -FilePath $exe -PassThru
$b = WaitApp $p2
"就绪 $($b.sec) s，窗口 $([W8]::Rect($b.h))"
$scr = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Add-Type -AssemblyName System.Windows.Forms
$scr = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
"屏幕可用区 = $($scr.Width)x$($scr.Height)"
$maxed = $b.h

"== 收进托盘，再双击一次：应该静默唤回、不弹窗"
[void][W8]::PostMessage($maxed, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_CLOSE → 收进托盘
Start-Sleep -Seconds 2
"藏起来了 = " + (-not [W8]::IsWindowVisible($maxed)) + "；进程活 = " + (-not $p2.HasExited)
$p3 = Start-Process -FilePath $exe -PassThru
$sw3 = [Diagnostics.Stopwatch]::StartNew()
[void]$p3.WaitForExit(30000)
"第二实例退出 = $($p3.HasExited)，用时 $([int]($sw3.ElapsedMilliseconds/1000)) s"
Start-Sleep -Milliseconds 800
"窗口回来 = " + [W8]::IsWindowVisible($maxed)
"有弹窗吗（同标题的第二个窗口）= " + [W8]::CountTitled($p2.Id, "课后服务管理")

"== 收尾：--quit"
$q2 = Start-Process -FilePath $exe -ArgumentList "--quit" -PassThru
[void]$q2.WaitForExit(20000)
for ($i = 0; $i -lt 40; $i++) { if ($p2.HasExited) { break }; Start-Sleep -Milliseconds 250 }
"主进程退出 = $($p2.HasExited)"
"端口还在听 = " + [bool](Get-NetTCPConnection -LocalPort $b.port -State Listen -ErrorAction SilentlyContinue)
"wal = " + (Get-Item (Join-Path $app "data\app.db-wal") -ErrorAction SilentlyContinue).Length
