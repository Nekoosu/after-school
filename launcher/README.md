# launcher —— 桌面启动器（C# 5 单文件）

打包出来的 `dist\AfterSchool.exe` 就是这个文件编译的。双击它 → 起内置 node → 轮询 `/api/health` → 打开浏览器 → 关窗口时把 node 一起带走。

```
Launcher.cs   启动器源码（WinForms，单文件，编译后约 22 KB）
使用说明.txt   随包发给用户的纯文本说明（打包时原样复制到 dist\ 下）
mac/          macOS 版启动脚本（package-mac.sh 会把它们拷进 .app）
  start.sh    双击 .app 时执行的启动器：挑端口 → nohup 起 next → 轮询 /api/health → open 浏览器
  stop.sh     读 data/.pid 结束服务，兜底 pkill
  停止课后服务.command  放在 .app 旁边的双击入口（内容与 stop.sh 同一套逻辑）
```

## 编译

```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:anycpu `
  /codepage:65001 /out:dist\AfterSchool.exe /win32icon:public\app.ico `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  launcher\Launcher.cs
```

平时不用手敲，`scripts\package.ps1` 第 7 步会做这件事。

## 它做的四件事

1. **找端口**：从 3210 起试 99 个 `TcpListener`，第一个绑得上的就用；把结果写进 `app\data\.port`
2. **起服务**：`app\node.exe "app\node_modules\next\dist\bin\next" start -H 127.0.0.1 -p <端口>`，工作目录是 `app\`（所以数据落在 `app\data\`）；stdout/stderr 重定向到 `app\data\server.log`（超过 512 KB 自动重建）
3. **等就绪**：轮询 `/api/health` 直到返回 `"ok":true`（最多 90 秒），然后 `Process.Start` 打开浏览器
4. **收尾**：窗口关闭时 `taskkill /PID <pid> /T /F`

另外还做了两件容易忽略的事：

- **已经在跑就只开浏览器**：读 `data\.port`，若那个端口上跑的是本应用（`/api/health` 里带 `after-school`），不再起第二个进程
- **Job Object 兜底**：`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，即使启动器被强杀，node 子进程也会一起结束——不会留下占端口、锁数据库的僵尸

## 写这个文件时的限制

这台机器上的 `csc.exe` 是 **C# 5**（`version 4.8.9363.0 for C# 5`），所以：

- 不能用字符串插值 `$"..."`（用 `"a" + b`）
- 不能用 `nameof`、`?.`、表达式体成员
- 不能用 `async` / `await`（轮询用 `Thread.Sleep`）

`scripts\package.ps1` 同理：它是**纯 ASCII、无中文注释**的（PS5.1 会按 GBK 解），中文文件名通过「复制目录里所有 `.txt`」绕开。
