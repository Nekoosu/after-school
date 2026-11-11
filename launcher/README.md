# launcher —— 桌面启动器（C# 5 单文件）

打包出来的 `dist\AfterSchool.exe` 就是这个文件编译的。双击它 → 起内置 node → 轮询 `/api/health` → 用 Edge 的 `--app` 模式弹出**无地址栏的应用窗口（那就是软件本身，不是浏览器）** → 用户关掉窗口就优雅停机退出。

```
Launcher.cs   启动器源码（WinForms，单文件，编译后约 15 KB）
使用说明.txt   随包发给用户的纯文本说明（打包时原样复制到 dist\ 下）
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
2. **起服务**：`app\node.exe "app\node_modules\next\dist\bin\next" start -H 127.0.0.1 -p <端口>`，工作目录是 `app\`（所以数据落在 `app\data\`）；stdout/stderr 重定向到 `app\data\server.log`（超过 512 KB 自动重建）；环境变量里带 `AS_LAUNCHED=1`——网页端 `/api/shutdown` 只认这个标记，浏览器里 curl 关不掉服务
3. **等就绪、开应用窗口**：轮询 `/api/health` 直到返回 `"ok":true`（最多 90 秒），`FindEdge()` 找到 `msedge.exe` 后用 `--app=<url> --user-data-dir="<app>\data\window-profile" --no-first-run --window-size=1320,900` 拉起应用窗口；**没有 Edge 就退回默认浏览器**
4. **收尾**：应用窗口 `WaitForExit()` 返回 = 用户关了软件 → 先 `POST /api/shutdown` 让 node 把数据写回磁盘（WAL checkpoint）再退出，然后 `taskkill /PID <pid> /T /F` 兜底

另外还做了三件容易忽略的事：

- **已经在跑就只开窗口**：读 `data\.port`，若那个端口上跑的是本应用（`/api/health` 里带 `after-school`），不再起第二个进程
- **Job Object 兜底**：`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，即使启动器被强杀，node 子进程也会一起结束——不会留下占端口、锁数据库的僵尸
- **`--user-data-dir` 指到 `app\data\window-profile`**：不和用户日常 Edge 抢配置，也让「二次启动」行为可预期（实例已占用 profile 时第二个窗口进程立刻退出，启动器跟着退出，不会误杀服务）

## 写这个文件时的限制

这台机器上的 `csc.exe` 是 **C# 5**（`version 4.8.9363.0 for C# 5`），所以：

- 不能用字符串插值 `$"..."`（用 `"a" + b`）
- 不能用 `nameof`、`?.`、表达式体成员
- 不能用 `async` / `await`（轮询用 `Thread.Sleep`）

`scripts\package.ps1` 同理：它是**纯 ASCII、无中文注释**的（PS5.1 会按 GBK 解），中文文件名通过「复制目录里所有 `.txt`」绕开。
