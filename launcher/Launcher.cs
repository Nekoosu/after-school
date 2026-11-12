using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AfterSchool
{
    /// <summary>
    /// 课后服务管理 —— 桌面启动器（1.6.0 起改成「打开就是软件」）。
    /// 流程：找一个能用的端口 → 起 app\node.exe → 等 /api/health 通 → 用 WebView2 自己开一个
    /// 窗口（1.8.0 起不再借 Edge）→ 关窗收进托盘，托盘「退出」才优雅停机。
    /// 用 C# 5 写（本机 csc 只支持到 C# 5，别用 $"..."、nameof、?.）。
    /// </summary>
    static class Launcher
    {
        static Process child;
        static AppForm appForm;
        static string appDir;
        static string dataDir;
        static string webviewDir;
        static int port;
        static volatile bool ready;
        static volatile string lastError = "";
        static SplashForm splash;
        static IntPtr jobHandle = IntPtr.Zero;

        // 记住上次窗口多大、在哪儿：下次打开还是这个样子（跟真软件一样）
        static volatile int winW = 1320;
        static volatile int winH = 900;
        static volatile int winX = int.MinValue;
        static volatile int winY = int.MinValue;
        // 上次是不是最大化着关的：window.txt 前面加个 M 记着，回来还是最大化
        static volatile bool winMax;

        // 1.8.13 授权：机器码由壳算（网页侧只认壳给的 AS_MACHINE），
        // 闸门值随机生成后塞进 AS_GATE，网页用它挡住「浏览器直连」。
        // internal：AppForm.OnShown 里要把 gate 塞进页面 Cookie，得跨类访问。
        internal static string machine = "";
        internal static string gate = "";
        static bool licensed;
        static int trialDays;

        /// <summary>机器码：MachineGuid + 计算机名 的 SHA256 前 16 位，换机就变。</summary>
        static string MachineHash()
        {
            string g = "";
            try
            {
                object v = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography", "MachineGuid", "");
                if (v != null) g = v.ToString();
            }
            catch { }
            if (string.IsNullOrEmpty(g)) g = Environment.MachineName;
            using (SHA256 sha = SHA256.Create())
            {
                byte[] b = sha.ComputeHash(Encoding.UTF8.GetBytes(g + "|" + Environment.MachineName + "|after-school"));
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < b.Length; i++) sb.Append(b[i].ToString("x2"));
                return sb.ToString(0, 16);
            }
        }

        /// <summary>问服务端现在的授权状态：licensed? / 试用还剩几天。</summary>
        static void ReadLicense()
        {
            licensed = false;
            trialDays = 0;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port.ToString() + "/api/license");
                req.Timeout = 4000;
                req.Proxy = null;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    {
                        string body = sr.ReadToEnd();
                        licensed = body.IndexOf("\"mode\":\"licensed\"") >= 0;
                        string key = "\"daysLeft\":";
                        int i = body.IndexOf(key);
                        if (i >= 0)
                        {
                            int j = i + key.Length;
                            int k = j;
                            while (k < body.Length && (char.IsDigit(body[k]) || body[k] == '-')) k++;
                            int d;
                            if (int.TryParse(body.Substring(j, k - j), out d)) trialDays = d;
                        }
                    }
                }
            }
            catch { }
        }

        /// <summary>没激活、试用也过期了，就弹激活窗口；用户直接关掉就退出，不给白用。</summary>
        static bool EnsureLicensed()
        {
            ReadLicense();
            if (licensed || trialDays > 0) return true;

            // 服务没起来 / 状态读不到（比如老版本服务）时，别把人挡在外面
            if (!licensed && trialDays == 0 && !Health(port)) return true;

            using (ActivateForm f = new ActivateForm(machine, port))
            {
                if (f.ShowDialog() == DialogResult.OK) return true;
            }
            return false;
        }

        // 单实例：第二次双击 exe 不再开一个窗口，而是把已经在跑的那个叫到前面来
        static Mutex shellMutex;
        // 「叫出来」「真退出」用命名事件传递：比 FindWindow + PostMessage 可靠，
        // 不用去猜窗口标题，也不会抓到同名的辅助窗口。
        static EventWaitHandle showEvent;
        static EventWaitHandle quitEvent;
        internal const int WM_SHELL_SHOW = 0x8000 + 7;   // WM_APP + 7，我们自己约定的「把窗口亮出来」
        internal const int WM_SHELL_QUIT = 0x8000 + 8;   // WM_APP + 8，「真的退出」（AfterSchool.exe --quit 用）

        [DllImport("shcore.dll")]
        static extern int SetProcessDpiAwareness(int value);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr FindWindow(string cls, string title);

        [DllImport("user32.dll")]
        static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr w, IntPtr l);

        [DllImport("user32.dll")]
        internal static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumProc cb, IntPtr lp);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT r);

        delegate bool EnumProc(IntPtr hWnd, IntPtr lp);

        [StructLayout(LayoutKind.Sequential)]
        struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        // 让 node 子进程跟启动器同生共死：即使启动器被任务管理器强杀，
        // 关掉 job 句柄时系统也会把子进程一起收掉，不会留下占着端口的孤儿进程。
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr a, string lpName);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr hJob, int infoType, IntPtr lpInfo, uint cbInfo);

        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        const int JobObjectExtendedLimitInformation = 9;
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        static string Join(string a, string b)
        {
            return Path.Combine(a, b);
        }

        [STAThread]
        static void Main(string[] args)
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            appDir = Join(exeDir, "app");
            dataDir = Join(appDir, "data");
            webviewDir = Join(dataDir, "webview");

            // 高分屏（125%/150%/200% 缩放）下别糊：按显示器独立缩放
            try { SetProcessDpiAwareness(2); } catch { }

            // 这两句必须在任何窗口（包括启动画面）创建之前调用，否则 WinForms 直接抛异常
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // 只为了截图/调样式：AfterSchool.exe --splash 单独显示启动画面 4 秒，不启动服务
            if (args.Length > 0 && args[0] == "--splash")
            {
                Icon tmp = null;
                try
                {
                    string ip = Join(appDir, "public\\app.ico");
                    if (!File.Exists(ip)) ip = Join(exeDir, "public\\app.ico");
                    if (File.Exists(ip)) tmp = new Icon(ip);
                }
                catch { }
                SplashForm s = new SplashForm(tmp);
                System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
                t.Interval = 4000;
                t.Tick += delegate { t.Stop(); s.FadeOutAndClose(); };
                t.Start();
                Application.Run(s);
                return;
            }

            try
            {
                if (!Directory.Exists(appDir))
                {
                    MessageBox.Show("找不到 app 文件夹，请把整个压缩包解压后再运行。", "课后服务管理",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                Directory.CreateDirectory(dataDir);
                LoadWindowSize();

                // 第二次双击：不另开窗口，把已经在跑的那个叫到前面来
                bool firstInstance;
                shellMutex = new Mutex(true, "Local\\AfterSchoolShell", out firstInstance);
                bool madeEvent;
                showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\AfterSchoolShow", out madeEvent);
                quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\AfterSchoolQuit", out madeEvent);
                if (!firstInstance)
                {
                    bool quit = args.Length > 0 && args[0] == "--quit";
                    if (ActivateExisting(quit)) return;
                    // 没叫回来（极少见，多半是对方还在启动）就静默退出，别拿弹窗打断人
                    return;
                }

                // 已经有一份在跑：直接开窗口，不再起第二个
                int running = ReadPortFile();
                if (running > 0 && Health(running))
                {
                    port = running;
                    RunApp();
                    SaveWindowSize();
                    return;
                }

                port = FindFreePort(3210);
                if (port <= 0)
                {
                    MessageBox.Show("1 到 99 号端口都被占用了，请先关掉别的程序再试。", "课后服务管理",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                // 1.8.13：机器码 + 数据闸门。机器码给网页侧验激活码用，
                // 闸门值随机生成，只有壳注入到页面 Cookie 里——浏览器直连拿不到数据。
                machine = MachineHash();
                byte[] gb = new byte[16];
                using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) { rng.GetBytes(gb); }
                StringBuilder gs = new StringBuilder();
                for (int i = 0; i < gb.Length; i++) gs.Append(gb[i].ToString("x2"));
                gate = gs.ToString();

                StartServer();
                Thread t = new Thread(new ThreadStart(WaitReady));
                t.IsBackground = true;
                t.Start();

                ShowSplash();
                if (!ready)
                {
                    KillChild();
                    return;
                }

                // 试用过期 / 没激活：先弹激活窗口；直接关掉就等于退出
                if (!EnsureLicensed())
                {
                    ShutdownServer();
                    KillChild();
                    return;
                }

                // 服务好了，把启动画面收起来，换成我们自己的窗口
                RunApp();
                SaveWindowSize();
                ShutdownServer();
                KillChild();
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message, "课后服务管理", MessageBoxButtons.OK, MessageBoxIcon.Error);
                KillChild();
            }
        }

        static string WindowFile()
        {
            return Join(dataDir, "window.txt");
        }

        /// <summary>上次窗口多大、在哪儿，这次还这样（存成 1320x900+120+60 这种；最大化在开头记个 M）。</summary>
        static void LoadWindowSize()
        {
            try
            {
                if (File.Exists(WindowFile()))
                {
                    string s = File.ReadAllText(WindowFile()).Trim();
                    if (s.StartsWith("M"))
                    {
                        winMax = true;
                        s = s.Substring(1);
                    }
                    int plus = s.IndexOf('+');
                    string sizePart = plus >= 0 ? s.Substring(0, plus) : s;
                    string[] parts = sizePart.Split('x');
                    if (parts.Length == 2)
                    {
                        int w, h;
                        if (int.TryParse(parts[0], out w) && int.TryParse(parts[1], out h))
                        {
                            if (w >= 800 && w <= 4000 && h >= 600 && h <= 3000)
                            {
                                winW = w;
                                winH = h;
                            }
                        }
                    }
                    if (plus >= 0)
                    {
                        string[] pos = s.Substring(plus + 1).Split('+');
                        int x, y;
                        if (pos.Length == 2 && int.TryParse(pos[0], out x) && int.TryParse(pos[1], out y))
                        {
                            Rectangle screen = SystemInformation.VirtualScreen;
                            if (x > screen.Left - 200 && x < screen.Right - 200 &&
                                y > screen.Top - 100 && y < screen.Bottom - 100)
                            {
                                winX = x;
                                winY = y;
                            }
                        }
                    }
                }
            }
            catch { }
            ClampWindowSize();
        }

        /// <summary>记住的尺寸比屏幕还大（换了小笔记本）就缩到屏幕能放下，别开到屏幕外面。</summary>
        static void ClampWindowSize()
        {
            try
            {
                Rectangle area = Screen.PrimaryScreen.WorkingArea;
                if (winW > area.Width - 24) winW = area.Width - 24;
                if (winH > area.Height - 24) winH = area.Height - 24;
                if (winW < 800) winW = Math.Min(800, area.Width - 24);
                if (winH < 600) winH = Math.Min(600, area.Height - 24);
            }
            catch { }
        }

        static void SaveWindowSize()
        {
            try
            {
                string s = (winMax ? "M" : "") + winW.ToString() + "x" + winH.ToString();
                if (winX != int.MinValue && winY != int.MinValue)
                {
                    s += "+" + winX.ToString() + "+" + winY.ToString();
                }
                File.WriteAllText(WindowFile(), s);
            }
            catch { }
        }

        static string Url()
        {
            return "http://127.0.0.1:" + port.ToString() + "/";
        }

        static string LastPageFile()
        {
            return Join(dataDir, "lastpage.txt");
        }

        /// <summary>上次关掉时停在哪一页，这次还打开那儿（只记路径，不带 ? 和 #）。</summary>
        static string ZoomFile()
        {
            return Join(dataDir, "zoom.txt");
        }

        /// <summary>上次把页面放大/缩小到多少，这次照旧（1 = 原始大小）。</summary>
        internal static float LoadZoom()
        {
            try
            {
                string f = ZoomFile();
                if (!File.Exists(f)) return 1f;
                float z;
                if (!float.TryParse(File.ReadAllText(f).Trim(),
                        System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out z)) return 1f;
                if (z < 0.6f) z = 0.6f;
                if (z > 1.6f) z = 1.6f;
                return z;
            }
            catch { return 1f; }
        }

        internal static void SaveZoom(float z)
        {
            try
            {
                if (z <= 0f) z = 1f;
                if (Math.Abs(z - 1f) < 0.005f)
                {
                    if (File.Exists(ZoomFile())) File.Delete(ZoomFile());
                    return;
                }
                File.WriteAllText(ZoomFile(),
                    z.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
            }
            catch { }
        }

        internal static string LoadLastPage()
        {
            try
            {
                string f = LastPageFile();
                if (!File.Exists(f)) return "";
                string s = File.ReadAllText(f).Trim();
                if (s.Length == 0 || s.Length > 200) return "";
                if (!s.StartsWith("/")) return "";
                if (s.StartsWith("/share")) return "";
                if (s.IndexOf('?') >= 0 || s.IndexOf('#') >= 0) return "";
                return s;
            }
            catch { return ""; }
        }

        internal static void SaveLastPage(string path)
        {
            try
            {
                string f = LastPageFile();
                if (string.IsNullOrEmpty(path) || path == "/")
                {
                    if (File.Exists(f)) File.Delete(f);
                    return;
                }
                File.WriteAllText(f, path);
            }
            catch { }
        }

        static int ReadPortFile()
        {
            try
            {
                string f = Join(dataDir, ".port");
                if (!File.Exists(f)) return 0;
                string s = File.ReadAllText(f).Trim();
                int p;
                if (int.TryParse(s, out p) && p > 0 && p < 65536) return p;
            }
            catch { }
            return 0;
        }

        static bool Health(int p)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p.ToString() + "/api/health");
                req.Timeout = 1500;
                req.Proxy = null;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    using (StreamReader sr = new StreamReader(res.GetResponseStream()))
                    {
                        string body = sr.ReadToEnd();
                        return body.IndexOf("\"ok\":true") >= 0 && body.IndexOf("after-school") >= 0;
                    }
                }
            }
            catch { return false; }
        }

        static int FindFreePort(int from)
        {
            for (int p = from; p < from + 99; p++)
            {
                if (IsFree(p)) return p;
            }
            return 0;
        }

        static bool IsFree(int p)
        {
            TcpListener l = null;
            try
            {
                l = new TcpListener(IPAddress.Loopback, p);
                l.Start();
                return true;
            }
            catch { return false; }
            finally { if (l != null) { try { l.Stop(); } catch { } } }
        }

        static void StartServer()
        {
            string nodeExe = Join(appDir, "node.exe");
            string nextBin = Join(appDir, "node_modules\\next\\dist\\bin\\next");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\"" + nextBin + "\" start -H 127.0.0.1 -p " + port.ToString();
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
            // 告诉服务端「你是被桌面启动器拉起来的」：关窗口时它才允许 /api/shutdown 自停
            psi.EnvironmentVariables["AS_LAUNCHED"] = "1";
            // 1.8.13 授权：机器码（网页侧验 CDK / 算试用）与闸门值（/api/* 只认这个）
            if (!string.IsNullOrEmpty(machine)) psi.EnvironmentVariables["AS_MACHINE"] = machine;
            if (!string.IsNullOrEmpty(gate)) psi.EnvironmentVariables["AS_GATE"] = gate;

            child = new Process();
            child.StartInfo = psi;
            child.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { Log(e.Data); };
            child.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Log(e.Data); };
            child.Start();
            AttachJob(child);
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
        }

        static void AttachJob(Process p)
        {
            try
            {
                if (jobHandle == IntPtr.Zero)
                {
                    jobHandle = CreateJobObject(IntPtr.Zero, null);
                    if (jobHandle == IntPtr.Zero) return;

                    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                    int len = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                    IntPtr ptr = Marshal.AllocHGlobal(len);
                    try
                    {
                        Marshal.StructureToPtr(info, ptr, false);
                        SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, ptr, (uint)len);
                    }
                    finally { Marshal.FreeHGlobal(ptr); }
                }
                AssignProcessToJobObject(jobHandle, p.Handle);
            }
            catch { }
        }

        static readonly object logLock = new object();

        static void Log(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            if (line.IndexOf("Error", StringComparison.OrdinalIgnoreCase) >= 0 ||
                line.IndexOf("error", StringComparison.Ordinal) >= 0)
            {
                lastError = line;
            }
            lock (logLock)
            {
                try
                {
                    string f = Join(dataDir, "server.log");
                    if (File.Exists(f) && new FileInfo(f).Length > 1024 * 512) File.Delete(f);
                    File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine, Encoding.UTF8);
                }
                catch { }
            }
        }

        static void WaitReady()
        {
            // 首次启动要跑建表，给到 90 秒
            DateTime deadline = DateTime.Now.AddSeconds(90);
            while (DateTime.Now < deadline)
            {
                if (child != null && child.HasExited)
                {
                    lastError = "服务进程退出了（退出码 " + child.ExitCode.ToString() + "）";
                    break;
                }
                if (Health(port))
                {
                    ready = true;
                    try { File.WriteAllText(Join(dataDir, ".port"), port.ToString(), Encoding.ASCII); } catch { }
                    CloseSplash();
                    return;
                }
                Thread.Sleep(500);
            }
            UpdateSplash();
        }

        static void CloseSplash()
        {
            try
            {
                if (splash != null && splash.Visible)
                {
                    splash.FadeOutAndClose();
                }
            }
            catch { }
        }

        static void OpenBrowser(int p)
        {
            try { Process.Start("http://127.0.0.1:" + p.ToString() + "/"); } catch { }
        }

        /// <summary>找 Edge 的可执行文件；找不到返回 null。</summary>
        static string FindEdge()
        {
            string[] roots = new string[] {
                Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                Environment.GetEnvironmentVariable("ProgramFiles"),
                Environment.GetEnvironmentVariable("LocalAppData")
            };
            for (int i = 0; i < roots.Length; i++)
            {
                if (string.IsNullOrEmpty(roots[i])) continue;
                string p = Join(roots[i], "Microsoft\\Edge\\Application\\msedge.exe");
                try { if (File.Exists(p)) return p; } catch { }
            }
            return null;
        }

        /// <summary>把已经在跑的那个窗口叫出来：它可能最小化了，也可能躲在托盘里。</summary>
        static bool ActivateExisting(bool quit)
        {
            // 只发一个信号就够了：在跑的那份有个后台线程守着这两个事件。
            // 它可能还在启动画面里，信号会先攒着，等窗口建好再消费。
            try
            {
                if (quit) quitEvent.Set();
                else showEvent.Set();
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>守着「叫出来 / 真退出」两个事件，收到就转给界面线程去处理。</summary>
        static void StartWaiter(AppForm f)
        {
            Thread t = new Thread(delegate()
            {
                WaitHandle[] ws = new WaitHandle[] { showEvent, quitEvent };
                while (true)
                {
                    int which = WaitHandle.WaitAny(ws);
                    try
                    {
                        f.BeginInvoke((Action)delegate
                        {
                            if (which == 0) f.ShowFromTray();
                            else f.ExitApp();
                        });
                    }
                    catch
                    {
                        // 窗口已经销毁了（真退出过程中），线程自己收工
                        return;
                    }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        /// <summary>
        /// 用 WebView2 自己开一个窗口：窗口图标、标题、最小化最大化都是我们自己的，
        /// 任务栏里也不再是浏览器。服务已经是通的，这里只管把界面装进去。
        /// </summary>
        static void RunApp()
        {
            Icon ico = null;
            try
            {
                string ip = Join(appDir, "public\\app.ico");
                if (File.Exists(ip)) ico = new Icon(ip);
            }
            catch { }

            AppForm f = new AppForm(Url(), ico, winW, winH, winX, winY, webviewDir);
            if (winMax) f.WindowState = FormWindowState.Maximized;
            f.FormClosed += delegate
            {
                try
                {
                    winMax = f.WindowState == FormWindowState.Maximized;
                    // 最大化时 Bounds 是整块屏幕：记 RestoreBounds（还原后的样子），回来才不会错位
                    Rectangle b = f.WindowState == FormWindowState.Normal ? f.Bounds : f.RestoreBounds;
                    if (b.Width >= 800 && b.Width <= 4000 && b.Height >= 600 && b.Height <= 3000)
                    {
                        winW = b.Width;
                        winH = b.Height;
                        winX = b.Left;
                        winY = b.Top;
                    }
                }
                catch { }
            };
            appForm = f;
            StartWaiter(f);
            Application.Run(f);
            appForm = null;
        }

        /// <summary>请服务端自己收尾（WAL 写回主库）再退出，等不到就靠 KillChild 兜底。</summary>
        static void ShutdownServer()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(Url() + "api/shutdown");
                req.Method = "POST";
                req.Timeout = 3000;
                req.Proxy = null;
                req.ContentLength = 0;
                // 1.8.13 数据闸门：壳自己调的接口也带上闸门值，不然关窗时的收尾请求会被 403 挡掉
                req.Headers.Add("x-as-gate", gate);
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    res.Close();
                }
            }
            catch { }

            try
            {
                if (child != null && !child.HasExited) child.WaitForExit(4000);
            }
            catch { }
        }

        static void UpdateSplash()
        {
            try
            {
                if (splash == null) return;
                if (ready) splash.SetStatus("准备好了，正在打开窗口");
                else splash.SetStatus(lastError.Length > 0 ? lastError : "");
            }
            catch { }
        }

        /// <summary>启动画面：单独一块卡面，服务好了自动淡出换成应用窗口。</summary>
        static void ShowSplash()
        {
            Icon ico = null;
            string icoPath = Join(appDir, "public\\app.ico");
            try
            {
                if (File.Exists(icoPath)) ico = new Icon(icoPath);
            }
            catch { }

            SplashForm f = new SplashForm(ico);
            f.FormClosing += delegate { if (!ready) KillChild(); };
            splash = f;
            Application.Run(f);
            splash = null;
        }

        static void KillChild()
        {
            try
            {
                if (child != null && !child.HasExited)
                {
                    ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/PID " + child.Id.ToString() + " /T /F");
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    Process.Start(psi).WaitForExit(5000);
                }
            }
            catch { }
        }
    }

    /// <summary>
    /// 启动画面：一块手绘的卡面。图标外面转一圈弧、下面来回扫的进度条、状态文字随秒数呼吸。
    /// 服务就绪后主线程调 FadeOutAndClose()，淡出再换成应用窗口。
    /// 注意：csc.exe 是 .NET Framework 4 的 C# 5 编译器，不能用 $"..."、?.、nameof、表达式体成员。
    /// </summary>
    class SplashForm : Form
    {
        readonly Icon appIcon;
        readonly System.Windows.Forms.Timer tick;
        readonly DateTime started = DateTime.Now;
        double phase;
        double opacity = 0;
        bool closing;
        string status = "";

        static readonly Color BgTop = Color.FromArgb(26, 36, 58);
        static readonly Color BgBottom = Color.FromArgb(11, 16, 30);
        static readonly Color BrandA = Color.FromArgb(37, 99, 235);
        static readonly Color BrandB = Color.FromArgb(124, 92, 255);
        static readonly Color TextMain = Color.FromArgb(240, 245, 253);
        static readonly Color TextDim = Color.FromArgb(150, 163, 187);
        static readonly Color Track = Color.FromArgb(38, 50, 75);

        public SplashForm(Icon icon)
        {
            appIcon = icon;
            Text = "课后服务管理";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 248);
            BackColor = BgBottom;
            ShowInTaskbar = true;
            KeyPreview = true;
            Opacity = 0;
            if (icon != null) Icon = icon;

            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);

            Label cancel = new Label();
            cancel.Text = "取消";
            cancel.ForeColor = TextDim;
            cancel.Font = new Font("Microsoft YaHei UI", 9F);
            cancel.BackColor = Color.Transparent;
            cancel.Cursor = Cursors.Hand;
            cancel.AutoSize = true;
            cancel.Location = new Point(470, 200);
            cancel.Click += delegate { Close(); };
            Controls.Add(cancel);

            tick = new System.Windows.Forms.Timer();
            tick.Interval = 33;
            tick.Tick += delegate
            {
                phase += 0.045;
                if (phase > 100000) phase = 0;
                if (closing)
                {
                    opacity -= 0.16;
                    if (opacity <= 0)
                    {
                        tick.Stop();
                        Close();
                        return;
                    }
                }
                else if (opacity < 1)
                {
                    opacity += 0.14;
                    if (opacity > 1) opacity = 1;
                }
                try { Opacity = opacity; } catch { }
                Invalidate();
            };
            tick.Start();

            KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Escape) Close();
            };
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                Region r = new Region(Path(new Rectangle(0, 0, Width, Height), 18));
                Region = r;
            }
            catch { }
        }

        /// <summary>背景线程也能调：状态文字（空字符串 = 用默认的「正在启动服务」）。</summary>
        public void SetStatus(string s)
        {
            if (IsHandleCreated && InvokeRequired)
            {
                try { BeginInvoke(new MethodInvoker(delegate { SetStatus(s); })); }
                catch { }
                return;
            }
            status = s == null ? "" : s;
            Invalidate();
        }

        public void FadeOutAndClose()
        {
            if (IsHandleCreated && InvokeRequired)
            {
                try { BeginInvoke(new MethodInvoker(FadeOutAndClose)); }
                catch { }
                return;
            }
            closing = true;
        }

        static GraphicsPath Path(Rectangle r, int rad)
        {
            GraphicsPath p = new GraphicsPath();
            int d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            Rectangle full = new Rectangle(0, 0, Width, Height);
            using (LinearGradientBrush bg = new LinearGradientBrush(full, BgTop, BgBottom, 115f))
            {
                g.FillRectangle(bg, full);
            }

            // 图标那块的光晕
            for (int i = 4; i >= 1; i--)
            {
                int pad = 18 + i * 15;
                using (SolidBrush glow = new SolidBrush(Color.FromArgb(9, BrandA)))
                {
                    g.FillEllipse(glow, 76 - pad, 76 - pad, pad * 2, pad * 2);
                }
            }

            // 图标：圆角方块渐变底 + 白色图标
            Rectangle tile = new Rectangle(44, 44, 64, 64);

            // 绕着图标转的那两圈弧（先画，压在图标的下面）
            Rectangle ring = new Rectangle(34, 34, 84, 84);
            float start = (float)((phase * 70) % 360);
            using (Pen pen = new Pen(Color.FromArgb(150, 160, 200, 255), 2.2f))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                g.DrawArc(pen, ring, start, 100);
            }
            using (Pen pen2 = new Pen(Color.FromArgb(70, 120, 150, 255), 1.4f))
            {
                g.DrawArc(pen2, ring, start + 180, 46);
            }

            if (appIcon != null)
            {
                // 有正经图标就整块铺满，并裁成圆角，看着像一个完整的应用图标
                using (GraphicsPath clip = Path(tile, 16))
                {
                    GraphicsState st = g.Save();
                    g.SetClip(clip);
                    g.DrawIcon(appIcon, tile);
                    g.Restore(st);
                }
            }
            else
            {
                using (GraphicsPath tp = Path(tile, 16))
                {
                    using (LinearGradientBrush tb = new LinearGradientBrush(tile, BrandA, BrandB, 125f))
                    {
                        g.FillPath(tb, tp);
                    }
                }
                using (Font f = new Font("Microsoft YaHei UI", 22F, FontStyle.Bold))
                {
                    using (StringFormat sf = new StringFormat())
                    {
                        sf.Alignment = StringAlignment.Center;
                        sf.LineAlignment = StringAlignment.Center;
                        g.DrawString("课", f, Brushes.White, tile, sf);
                    }
                }
            }

            // 标题
            using (Font fTitle = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold))
            {
                g.DrawString("课后服务管理", fTitle, new SolidBrush(TextMain), 134, 46);
            }
            using (Font fSub = new Font("Microsoft YaHei UI", 8.8f))
            {
                g.DrawString("课表 · 课时 · 家长反馈 · 数据都在本机", fSub, new SolidBrush(TextDim), 136, 82);
            }

            // 进度条：轨道 + 来回扫的胶囊
            Rectangle track = new Rectangle(44, 136, 432, 6);
            using (GraphicsPath tp = Path(track, 3))
            {
                g.FillPath(new SolidBrush(Track), tp);
            }
            double u = (phase * 0.42) % 2.0;
            double t2 = u <= 1 ? u : 2 - u;
            double eased = 0.5 - 0.5 * Math.Cos(Math.PI * t2);
            int barW = 128;
            int barX = 44 + (int)(eased * (432 - barW));
            Rectangle bar = new Rectangle(barX, 136, barW, 6);
            using (GraphicsPath bp = Path(bar, 3))
            {
                using (LinearGradientBrush bb = new LinearGradientBrush(new Rectangle(barX, 136, barW, 6), BrandA, BrandB, 0f))
                {
                    g.FillPath(bb, bp);
                }
            }

            // 状态：默认「正在启动服务」，出错时显示原因；超过 3 秒带上秒数，让人知道还活着
            int secs = (int)(DateTime.Now - started).TotalSeconds;
            string s = status.Length > 0 ? status : "正在启动服务";
            if (!closing && status.Length == 0 && secs >= 3) s = s + " · " + secs.ToString() + " 秒";
            int dots = (int)(phase * 1.6) % 4;
            string trail = "";
            for (int i = 0; i < dots; i++) trail += "·";
            using (Font fStatus = new Font("Microsoft YaHei UI", 9.2f))
            {
                g.DrawString(status.Length > 0 ? s : s + " " + trail, fStatus, new SolidBrush(TextDim), 44, 156);
            }
            using (Font fTiny = new Font("Microsoft YaHei UI", 8.2f))
            {
                g.DrawString("第一次启动要建数据库，通常十几秒 · 数据都存在本机", fTiny, new SolidBrush(Color.FromArgb(110, 125, 150)), 44, 204);
            }
        }
    }

    /// <summary>
    /// 应用窗口本体：一个 WinForms 窗口 + 里面铺满的 WebView2。
    /// 这样标题栏图标、标题文字、最小化/最大化/关闭都是我们自己的，
    /// 任务栏里也是「课后服务管理」，不再露出浏览器。
    /// </summary>
    class AppForm : Form
    {
        readonly string startUrl;
        readonly string startPath;
        readonly string dataDir;
        readonly string dataRoot;
        WebView2 view;
        NotifyIcon tray;
        ToolStripMenuItem trayInfo;
        ToolStripMenuItem trayUpdate;
        ToolStripMenuItem trayPending;
        string updateUrl = "";
        string lastSaved = "";
        bool navigated;
        bool allowClose;
        bool trayTipShown;
        bool updateChecked;
        bool triedHome;

        public AppForm(string url, Icon ico, int w, int h, int x, int y, string webviewDataDir)
        {
            startUrl = url;
            startPath = Launcher.LoadLastPage();
            dataDir = webviewDataDir;
            dataRoot = Path.GetDirectoryName(webviewDataDir);

            Text = "课后服务管理";
            if (ico != null) Icon = ico;
            // window.txt 记的是窗口外框尺寸（GetWindowRect 量的），所以这里也用 Size
            Size = new Size(w, h);
            MinimumSize = new Size(900, 620);
            StartPosition = (x != int.MinValue && y != int.MinValue)
                ? FormStartPosition.Manual : FormStartPosition.CenterScreen;
            if (x != int.MinValue && y != int.MinValue) Location = new Point(x, y);
            BackColor = Color.FromArgb(246, 247, 249);
            DoubleBuffered = true;

            view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.Visible = false;
            view.DefaultBackgroundColor = Color.FromArgb(246, 247, 249);
            Controls.Add(view);

            Shown += OnShown;
            view.ZoomFactorChanged += delegate
            {
                try { Launcher.SaveZoom((float)view.ZoomFactor); } catch { }
            };
            BuildTray(ico);
        }

        /// <summary>F11 全屏看课表/报表，再按一次（或 Esc）回来。</summary>
        bool fullScreen;
        Rectangle boundsBeforeFull;
        bool wasMaxBeforeFull;

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.F11)
            {
                ToggleFullScreen();
                return true;
            }
            if (keyData == Keys.Escape && fullScreen)
            {
                ToggleFullScreen();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        void ToggleFullScreen()
        {
            if (!fullScreen)
            {
                boundsBeforeFull = Bounds;
                wasMaxBeforeFull = WindowState == FormWindowState.Maximized;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                Bounds = Screen.FromControl(this).Bounds;
                TopMost = true;
                fullScreen = true;
            }
            else
            {
                TopMost = false;
                FormBorderStyle = FormBorderStyle.Sizable;
                Bounds = boundsBeforeFull;
                if (wasMaxBeforeFull) WindowState = FormWindowState.Maximized;
                fullScreen = false;
            }
        }

        /// <summary>右下角托盘：点一下回来，右键能开数据文件夹、立刻备份、退出。</summary>
        void BuildTray(Icon ico)
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            try
            {
                menu.Font = new Font("Microsoft YaHei UI", 9f);
            }
            catch
            {
                menu.Font = SystemFonts.MenuFont;
            }

            ToolStripMenuItem open = new ToolStripMenuItem("打开主界面");
            open.Font = new Font(menu.Font, FontStyle.Bold);
            open.Click += delegate { ShowFromTray(); };
            menu.Items.Add(open);

            ToolStripMenuItem status = new ToolStripMenuItem("今天还没上课");
            status.Enabled = false;
            menu.Items.Add(status);
            trayInfo = status;
            menu.Opening += delegate { RefreshTrayInfo(); };

            // 「去记这一节」：最早一节该记还没记的课，点一下直接进那一节的记一笔
            ToolStripMenuItem pending = new ToolStripMenuItem("去记这一节");
            pending.Visible = false;
            pending.Click += delegate
            {
                int id = pending.Tag is int ? (int)pending.Tag : 0;
                if (id > 0) OpenLesson(id);
            };
            menu.Items.Add(pending);
            trayPending = pending;

            ToolStripMenuItem folder = new ToolStripMenuItem("打开数据文件夹");
            folder.Click += delegate { OpenFolder(); };
            menu.Items.Add(folder);

            ToolStripMenuItem backup = new ToolStripMenuItem("立即备份");
            backup.Click += delegate { BackupNow(); };
            menu.Items.Add(backup);

            ToolStripMenuItem upd = new ToolStripMenuItem("下载新版本");
            upd.Visible = false;
            upd.Click += delegate
            {
                if (!string.IsNullOrEmpty(updateUrl))
                {
                    try { Process.Start(updateUrl); } catch { }
                }
            };
            menu.Items.Add(upd);
            trayUpdate = upd;

            ToolStripMenuItem auto = new ToolStripMenuItem("开机时自动启动");
            auto.CheckOnClick = true;
            auto.Checked = AutoStartEnabled();
            auto.Click += delegate { SetAutoStart(auto.Checked); };
            menu.Items.Add(auto);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem quit = new ToolStripMenuItem("退出");
            quit.Click += delegate { ExitApp(); };
            menu.Items.Add(quit);

            tray = new NotifyIcon();
            tray.Icon = ico != null ? ico : SystemIcons.Application;
            tray.Text = "课后服务管理";
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { ShowFromTray(); };
            tray.Visible = true;
        }

        /// <summary>从托盘回来：可能是最小化的，也可能是隐藏着的。</summary>
        public void ShowFromTray()
        {
            try
            {
                if (!Visible) Show();
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
                BringToFront();
                Launcher.SetForegroundWindow(Handle);
            }
            catch { }
        }

        /// <summary>点右上角「×」：收到托盘，服务继续跑着（跟真软件一样），不是退出。</summary>
        void HideToTray()
        {
            Hide();
            if (!trayTipShown)
            {
                trayTipShown = true;
                Balloon("还在后台运行", "点托盘上的「课」图标回到窗口；右键图标选「退出」才是真的关掉。");
            }
        }

        /// <summary>点最小化也是一样的：收进托盘，不占任务栏（同类软件都这么干）。</summary>
        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (!allowClose && WindowState == FormWindowState.Minimized)
            {
                HideToTray();
            }
        }

        const string RunKey = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        const string RunName = "AfterSchool";

        /// <summary>看注册表里有没有「开机自动启动」这一条，并且指向当前这个 exe。</summary>
        static bool AutoStartEnabled()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, false))
                {
                    if (k == null) return false;
                    string v = k.GetValue(RunName) as string;
                    if (string.IsNullOrEmpty(v)) return false;
                    return v.IndexOf(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
            catch
            {
                return false;
            }
        }

        static void SetAutoStart(bool on)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (k == null) return;
                    if (on) k.SetValue(RunName, "\"" + Application.ExecutablePath + "\"");
                    else k.DeleteValue(RunName, false);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("设置开机启动失败：" + ex.Message, "课后服务管理",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        internal void ExitApp()
        {
            allowClose = true;
            try
            {
                if (tray != null)
                {
                    tray.Visible = false;
                    tray.Dispose();
                    tray = null;
                }
            }
            catch { }
            Close();
        }

        void Balloon(string title, string text)
        {
            try
            {
                if (tray != null) tray.ShowBalloonTip(4000, title, text, ToolTipIcon.Info);
            }
            catch { }
        }

        void OpenFolder()
        {
            try
            {
                if (!string.IsNullOrEmpty(dataRoot) && Directory.Exists(dataRoot))
                {
                    Process.Start("explorer.exe", "\"" + dataRoot + "\"");
                }
            }
            catch (Exception ex)
            {
                Balloon("打不开文件夹", ex.Message);
            }
        }

        /// <summary>托盘菜单第一行的小账：今天几节课、几个人课时不够。数据来自 /api/shell/tray。</summary>
        void RefreshTrayInfo()
        {
            if (trayInfo == null) return;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(startUrl + "api/shell/tray");
                req.Timeout = 3000;
                req.Proxy = null;
                req.Headers.Add("x-as-gate", Launcher.gate);
                string body = "";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    body = sr.ReadToEnd();
                }
                string text = PickString(body, "text");
                trayInfo.Text = text.Length > 0 ? text : "服务还没就绪";

                if (trayPending != null)
                {
                    int pid = PickInt(body, "pendingId");
                    string ptext = PickString(body, "pendingText");
                    if (pid > 0)
                    {
                        trayPending.Text = ptext.Length > 0 ? "去记：" + ptext : "去记这一节";
                        trayPending.Tag = pid;
                        trayPending.Visible = true;
                    }
                    else
                    {
                        trayPending.Visible = false;
                        trayPending.Tag = 0;
                    }
                }
            }
            catch
            {
                trayInfo.Text = "服务不在跑";
                if (trayPending != null) trayPending.Visible = false;
            }
        }

        /// <summary>页面彻底打不开时给的一页说明（不白屏，能点重试）。</summary>
        static string ErrorPage(string why)
        {
            return "<!doctype html><meta charset=\"utf-8\"><title>课后服务管理</title>" +
                "<style>html,body{height:100%;margin:0;font:15px/1.7 'Microsoft YaHei UI','Microsoft YaHei',sans-serif;" +
                "background:#f6f8fc;color:#1f2937;display:flex;align-items:center;justify-content:center}" +
                ".box{max-width:520px;padding:34px 38px;background:#fff;border:1px solid #e4e8f0;border-radius:16px;" +
                "box-shadow:0 12px 34px rgba(22,32,58,.08)}h1{font-size:19px;margin:0 0 10px}p{margin:0 0 8px;color:#55617a}" +
                "code{background:#f1f4fa;padding:1px 6px;border-radius:5px;font-size:13px}" +
                "button{margin-top:16px;padding:9px 20px;border:0;border-radius:9px;background:#2563eb;color:#fff;" +
                "font-size:14px;cursor:pointer}button:hover{background:#1d4ed8}" +
                "@media (prefers-color-scheme:dark){html,body{background:#0e1116;color:#eef2fb}.box{background:#161a21;" +
                "border-color:#252b36}p{color:#9aa6bd}code{background:#1d222b}button{background:#3b82f6}}</style>" +
                "<div class=\"box\"><h1>后台服务还没起来</h1>" +
                "<p>窗口能开，但页面打不开（" + why + "）。一般是服务刚启动还没热，或者端口被别的程序占了。</p>" +
                "<p>先点下面的「重试」；还不行就关掉软件重开一次，或者看看 <code>app\\data\\server.log</code>。</p>" +
                "<button onclick=\"try{window.chrome.webview.postMessage('as-reload')}catch(e){location.reload()}\">重试</button></div>";
        }

        /// <summary>托盘里点「去记这一节」：先亮出窗口，再走到那一节的记一笔页面。</summary>
        void OpenLesson(int id)
        {
            ShowFromTray();
            try
            {
                if (view != null && view.CoreWebView2 != null)
                {
                    view.CoreWebView2.Navigate(startUrl + "lessons/" + id);
                }
            }
            catch { }
        }

        /// <summary>从 JSON 里抠一个整数字段（<c>"pendingId":12</c>）。</summary>
        static int PickInt(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return 0;
            int k = json.IndexOf("\"" + key + "\":");
            if (k < 0) return 0;
            k += key.Length + 3;
            while (k < json.Length && json[k] == ' ') k++;
            int start = k;
            while (k < json.Length && json[k] >= '0' && json[k] <= '9') k++;
            if (k == start) return 0;
            int value;
            return int.TryParse(json.Substring(start, k - start), out value) ? value : 0;
        }

        /// <summary>从 JSON 里抠一个字符串字段（C# 5 没有 JSON 库，服务端也不转义中文，够用）。</summary>
        static string PickString(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            int k = json.IndexOf("\"" + key + "\":\"");
            if (k < 0) return "";
            k += key.Length + 4;
            StringBuilder sb = new StringBuilder();
            while (k < json.Length && json[k] != '"')
            {
                if (json[k] == '\\' && k + 1 < json.Length) k++;
                sb.Append(json[k]);
                k++;
            }
            return sb.ToString();
        }

        /// <summary>启动后问一次 GitHub 有没有新版本；有就弹个气泡，并在托盘菜单里放一个下载入口。</summary>
        void CheckUpdateInBackground()
        {
            try
            {
                Thread t = new Thread(delegate()
                {
                    try
                    {
                        Thread.Sleep(2500);
                        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(startUrl + "api/update");
                        req.Timeout = 12000;
                        req.ReadWriteTimeout = 12000;
                        req.Proxy = null;
                        req.UserAgent = "AfterSchoolShell";
                        string body = "";
                        using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                        using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                        {
                            body = sr.ReadToEnd();
                        }
                        if (body.IndexOf("\"hasUpdate\":true") < 0) return;
                        string latest = PickString(body, "latest");
                        string url = PickString(body, "url");
                        if (latest.Length == 0 || url.Length == 0) return;
                        updateUrl = url;
                        try
                        {
                            BeginInvoke((Action)delegate
                            {
                                if (trayUpdate != null)
                                {
                                    trayUpdate.Text = "下载新版本 " + latest;
                                    trayUpdate.Visible = true;
                                }
                                if (tray != null) tray.Text = "课后服务管理（有 " + latest + " 可更新）";
                                Balloon("有新版本 " + latest, "右键托盘图标选「下载新版本」，或者不管它，旧版照常用。");
                            });
                        }
                        catch { }
                    }
                    catch { }
                });
                t.IsBackground = true;
                t.Name = "update-check";
                t.Start();
            }
            catch { }
        }

        /// <summary>托盘菜单「立即备份」：请服务端现在存一份快照到 app\backups。</summary>
        void BackupNow()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(startUrl + "api/backup");
                req.Method = "POST";
                req.Timeout = 20000;
                req.Proxy = null;
                req.ContentLength = 0;
                req.Headers.Add("x-as-gate", Launcher.gate);
                string body = "";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    body = sr.ReadToEnd();
                }

                string name = "";
                int i = body.IndexOf("\"name\":\"", StringComparison.Ordinal);
                if (i >= 0)
                {
                    int from = i + 8;
                    int to = body.IndexOf('"', from);
                    if (to > from) name = body.Substring(from, to - from);
                }
                Balloon("已经存了一份备份", string.IsNullOrEmpty(name) ? "在 app\\backups 里。" : name);
            }
            catch (Exception ex)
            {
                Balloon("备份没成功", ex.Message);
            }
        }

        protected override void WndProc(ref Message m)
        {
            // 第二个实例双击了 exe：不新开窗口，让它把我们叫出来
            if (m.Msg == Launcher.WM_SHELL_SHOW)
            {
                ShowFromTray();
                return;
            }
            // 第二个实例带 --quit：真的退出（走正常的收尾流程：写盘、备份、停服务）
            if (m.Msg == Launcher.WM_SHELL_QUIT)
            {
                ExitApp();
                return;
            }
            // 点右上角的 ×（Alt+F4 也是这条路）：不退出，收进托盘。
            // 这里必须自己拦 WM_CLOSE：外面用 PostMessage 发 WM_CLOSE 时 CloseReason 不一定是
            // UserClosing，光靠 OnFormClosing 的判断会漏，应用就真的关了。
            if (m.Msg == 0x0010 && !allowClose)
            {
                HideToTray();
                return;
            }
            base.WndProc(ref m);
        }

        async void OnShown(object sender, EventArgs e)
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir, null);
                await view.EnsureCoreWebView2Async(env);

                CoreWebView2 core = view.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = true;
                // Ctrl+N/Ctrl+Shift+N 这类页面级快捷键会先撞上 WebView2 内置的 Ctrl+N（开新窗），
                // 干脆把内置浏览器快捷键全关掉，页面里的 keydown 才收得到（Ctrl+P/Ctrl+F 页面里也拦了）。
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;

                // 上次放大的比例接着用（Ctrl+滚轮 / Ctrl+加号 改，Ctrl+0 回原样）
                float zoom = Launcher.LoadZoom();
                if (Math.Abs(zoom - 1f) > 0.005f)
                {
                    try { view.ZoomFactor = zoom; } catch { }
                }
                core.Settings.IsPasswordAutosaveEnabled = false;

                // 让页面知道自己跑在桌面壳里（顶栏不再重复写软件名、右键菜单也不弹）
                try
                {
                    core.Settings.UserAgent = core.Settings.UserAgent + " AfterSchoolShell/1.0";
                }
                catch { }

                // 页面里那些「打印」按钮调的是 window.print()，WebView2 默认什么都不做。
                // 把它改成给外壳发个消息，由外壳调系统的打印预览。
                string printBridge =
                    "window.print = function () { try { window.chrome.webview.postMessage('as-print'); } catch (e) {} };" +
                    "document.addEventListener('keydown', function (e) {" +
                    "  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {" +
                    "    e.preventDefault(); try { window.chrome.webview.postMessage('as-print'); } catch (err) {}" +
                    "  }" +
                    "}, true);";
                await core.AddScriptToExecuteOnDocumentCreatedAsync(printBridge);

                // 1.8.13 数据闸门：页面里发出去的每个请求（fetch / RSC / 导航）都带这个 Cookie，
                // 服务端 middleware 只认它；浏览器直连就没有，所以拿不到数据。
                if (!string.IsNullOrEmpty(Launcher.gate))
                {
                    string gateScript = "try{document.cookie='as_gate=" + Launcher.gate + "; Path=/; SameSite=Strict';}catch(e){}";
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(gateScript);
                }

                core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs a)
                {
                    string msg = "";
                    try { msg = a.TryGetWebMessageAsString(); } catch { }
                    if (msg == "as-print") DoPrint(core);
                    if (msg == "as-reload")
                    {
                        try { core.Navigate(startUrl); } catch { }
                    }
                    // 页面名由网页自己报过来。不能靠 document.title：
                    // Next 的 metadata 会在流式渲染收尾时把 <title> 再写一遍，把页面名盖掉。
                    if (msg != null && msg.StartsWith("as-page:"))
                    {
                        string n = msg.Substring(8);
                        Text = string.IsNullOrEmpty(n) ? "课后服务管理" : n + " · 课后服务管理";
                    }
                };

                // 页面里的外链（比如 GitHub）用系统默认浏览器打开，别在软件里跳走
                core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs a)
                {
                    a.Handled = true;
                    try { Process.Start(a.Uri); } catch { }
                };

                core.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs a)
                {
                    if (!a.IsSuccess)
                    {
                        // 上次那一页已经不在了、或者服务刚起来还没热：先回首页，再不行给一页说明
                        if (!triedHome && !string.IsNullOrEmpty(startPath) && startPath != "/")
                        {
                            triedHome = true;
                            try { core.Navigate(startUrl); return; }
                            catch { }
                        }
                        if (!navigated)
                        {
                            navigated = true;
                            view.Visible = true;
                        }
                        try { view.NavigateToString(ErrorPage(a.WebErrorStatus.ToString())); }
                        catch { }
                        return;
                    }

                    if (!navigated)
                    {
                        navigated = true;
                        view.Visible = true;
                        if (!updateChecked)
                        {
                            updateChecked = true;
                            CheckUpdateInBackground();
                        }
                    }
                };

                // 窗口标题跟着当前页面走（Alt+Tab、任务栏上就能看出停在哪一页）。
                // 不用 DocumentTitleChanged：页面的 document.title 会被 Next 的 metadata
                // 在流式渲染收尾时重写回「课后服务管理」，标题会闪一下又变回去。
                // 改由网页在换页时 postMessage("as-page:<页面名>")，见上面的 WebMessageReceived。

                // 关了再开，还停在上次那一页（像正经软件那样）
                core.SourceChanged += RememberPage;

                core.Navigate(startUrl + startPath);
            }
            catch (Exception ex)
            {
                DialogResult r = MessageBox.Show(
                    "界面组件（WebView2）启动失败：\n" + ex.Message +
                    "\n\n这台电脑可能缺少 WebView2 运行时。点「确定」用浏览器打开。",
                    "课后服务管理", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
                if (r == DialogResult.OK)
                {
                    try { Process.Start(startUrl); } catch { }
                }
                Close();
            }
        }

        /// <summary>换页时把当前路径记下来（查询串、锚点都不记，免得下次一开就弹出窗口）。</summary>
        void RememberPage(object sender, CoreWebView2SourceChangedEventArgs a)
        {
            try
            {
                CoreWebView2 c = (CoreWebView2)sender;
                string u = c.Source;
                if (string.IsNullOrEmpty(u)) return;
                if (!u.StartsWith(startUrl)) return;
                string rest = u.Substring(startUrl.Length);
                int cut = rest.IndexOfAny(new char[] { '?', '#' });
                if (cut >= 0) rest = rest.Substring(0, cut);
                // startUrl 本身以「/」结尾，剥完剩下的「records」要补回前导斜杠
                if (rest.Length > 0 && !rest.StartsWith("/")) rest = "/" + rest;
                if (rest.Length > 200) return;
                if (rest == lastSaved) return;
                lastSaved = rest;
                Launcher.SaveLastPage(rest);
            }
            catch { }
        }

        void DoPrint(CoreWebView2 core)
        {
            try
            {
                core.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
            }
            catch (Exception ex)
            {
                MessageBox.Show("打印打不开：" + ex.Message, "课后服务管理",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // 点 × 只收进托盘；只有托盘菜单里的「退出」才真的关掉
            if (!allowClose && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray();
                return;
            }
            // 全屏着关掉的话，先退回普通窗口，免得把整屏尺寸记成「上次的大小」
            if (fullScreen) ToggleFullScreen();
            // 退出时再记一次放大比例：Ctrl+滚轮 有时不走 ZoomFactorChanged，兜个底
            try { if (view != null && view.CoreWebView2 != null) Launcher.SaveZoom((float)view.ZoomFactor); }
            catch { }
            base.OnFormClosing(e);
        }
    }

    /// <summary>
    /// 激活窗口（1.8.13）：试用过期后出现——上面是机器码（可复制），下面是激活码输入框。
    /// 校验全部走本地服务 /api/license（Node 那边用内置公钥验 RSA 签名），私钥不在安装包里。
    /// C# 5：不用 $"..."、nameof、?.。
    /// </summary>
    class ActivateForm : Form
    {
        string machine;
        int port;
        TextBox box;
        Label status;

        static readonly Color Ink = Color.FromArgb(23, 30, 43);
        static readonly Color Muted = Color.FromArgb(104, 117, 140);
        static readonly Color Brand = Color.FromArgb(37, 99, 235);
        static readonly Color Bg = Color.FromArgb(246, 248, 252);

        public ActivateForm(string machineHash, int p)
        {
            machine = machineHash;
            port = p;

            Text = "激活 · 课后服务管理";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 400);
            BackColor = Bg;
            Font = new Font("Microsoft YaHei UI", 9f);

            Label title = new Label();
            title.Text = "这台电脑还没激活";
            title.Font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold);
            title.ForeColor = Ink;
            title.AutoSize = true;
            title.Location = new Point(28, 24);
            Controls.Add(title);

            Label sub = new Label();
            sub.Text = "把下面的机器码发给作者，拿到激活码后粘到下面，点「激活」。\r\n一个激活码对应一台电脑；以后要做续费，会另发新的码。";
            sub.ForeColor = Muted;
            sub.AutoSize = false;
            sub.Size = new Size(504, 46);
            sub.Location = new Point(28, 66);
            Controls.Add(sub);

            Label ml = new Label();
            ml.Text = "机器码";
            ml.ForeColor = Muted;
            ml.AutoSize = true;
            ml.Location = new Point(28, 126);
            Controls.Add(ml);

            TextBox mbox = new TextBox();
            mbox.Text = machine;
            mbox.ReadOnly = true;
            mbox.Font = new Font("Consolas", 12f);
            mbox.Location = new Point(28, 148);
            mbox.Size = new Size(330, 28);
            mbox.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(mbox);

            Button copy = new Button();
            copy.Text = "复制";
            copy.Location = new Point(370, 147);
            copy.Size = new Size(76, 30);
            copy.FlatStyle = FlatStyle.System;
            copy.Click += delegate
            {
                try { Clipboard.SetText(machine); status.Text = "机器码已复制。"; }
                catch { status.Text = "复制失败，可以手抄这 16 位。"; }
            };
            Controls.Add(copy);

            Button contact = new Button();
            contact.Text = "邮件联系";
            contact.Location = new Point(452, 147);
            contact.Size = new Size(80, 30);
            contact.FlatStyle = FlatStyle.System;
            contact.Click += delegate
            {
                try { Process.Start("mailto:?subject=" + Uri.EscapeDataString("课后服务管理 激活 - " + machine) + "&body=" + Uri.EscapeDataString("我的机器码：" + machine)); }
                catch { }
            };
            Controls.Add(contact);

            Label cl = new Label();
            cl.Text = "激活码";
            cl.ForeColor = Muted;
            cl.AutoSize = true;
            cl.Location = new Point(28, 192);
            Controls.Add(cl);

            box = new TextBox();
            box.Font = new Font("Consolas", 9f);
            box.Location = new Point(28, 214);
            box.Size = new Size(504, 28);
            box.BorderStyle = BorderStyle.FixedSingle;
            box.MaxLength = 2000;
            Controls.Add(box);

            Button act = new Button();
            act.Text = "激活";
            act.Location = new Point(28, 258);
            act.Size = new Size(120, 36);
            act.FlatStyle = FlatStyle.System;
            act.Click += delegate { DoActivate(); };
            Controls.Add(act);

            Button later = new Button();
            later.Text = "先不用";
            later.Location = new Point(160, 258);
            later.Size = new Size(96, 36);
            later.FlatStyle = FlatStyle.System;
            later.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            Controls.Add(later);

            status = new Label();
            status.ForeColor = Muted;
            status.AutoSize = false;
            status.Size = new Size(504, 60);
            status.Location = new Point(28, 310);
            Controls.Add(status);

            AcceptButton = act;
        }

        void DoActivate()
        {
            string cdk = box.Text.Trim();
            if (cdk.Length == 0)
            {
                status.Text = "先把激活码粘进来。";
                return;
            }
            status.Text = "正在核对…";
            try
            {
                string body = "{\"cdk\":" + JsonQuote(cdk) + "}";
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port.ToString() + "/api/license");
                req.Method = "POST";
                req.ContentType = "application/json; charset=utf-8";
                req.Timeout = 8000;
                req.Proxy = null;
                byte[] bytes = Encoding.UTF8.GetBytes(body);
                req.ContentLength = bytes.Length;
                using (Stream s = req.GetRequestStream()) { s.Write(bytes, 0, bytes.Length); }
                string resp;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) resp = sr.ReadToEnd();
                }
                if (resp.IndexOf("\"mode\":\"licensed\"") >= 0)
                {
                    status.Text = "激活成功。";
                    DialogResult = DialogResult.OK;
                    Close();
                    return;
                }
                string err = PickString(resp, "error");
                status.Text = err.Length > 0 ? err : "激活码没通过核对，检查一下是不是复制全了。";
            }
            catch (Exception ex)
            {
                status.Text = "连本地服务失败：" + ex.Message;
            }
        }

        static string JsonQuote(string s)
        {
            StringBuilder sb = new StringBuilder("\"");
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c < ' ') sb.Append(' ');
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        /// <summary>从一段 JSON 里抠出 "key":"值"（不引第三方库）。</summary>
        static string PickString(string json, string key)
        {
            string needle = "\"" + key + "\":\"";
            int i = json.IndexOf(needle);
            if (i < 0) return "";
            int j = i + needle.Length;
            StringBuilder sb = new StringBuilder();
            while (j < json.Length)
            {
                char c = json[j];
                if (c == '\\' && j + 1 < json.Length)
                {
                    char n = json[j + 1];
                    if (n == 'u' && j + 5 < json.Length)
                    {
                        int code;
                        if (int.TryParse(json.Substring(j + 2, 4), System.Globalization.NumberStyles.HexNumber, null, out code)) sb.Append((char)code);
                        j += 6;
                        continue;
                    }
                    if (n == 'n') sb.Append('\n');
                    else if (n == 'r') sb.Append('\r');
                    else if (n == 't') sb.Append('\t');
                    else sb.Append(n);
                    j += 2;
                    continue;
                }
                if (c == '"') break;
                sb.Append(c);
                j++;
            }
            return sb.ToString();
        }
    }
}