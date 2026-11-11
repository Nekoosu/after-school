using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace AfterSchool
{
    /// <summary>
    /// 课后服务管理 —— 桌面启动器（1.6.0 起改成「打开就是软件」）。
    /// 流程：找一个能用的端口 → 起 app\node.exe → 等 /api/health 通 → 用 Edge 的
    /// --app 模式开出无地址栏的窗口（看着就是一个桌面软件）→ 窗口关掉就优雅停机。
    /// 用 C# 5 写（本机 csc 只支持到 C# 5，别用 $"..."、nameof、?.）。
    /// </summary>
    static class Launcher
    {
        static Process child;
        static Process appWindow;
        static string appDir;
        static string dataDir;
        static string profileDir;
        static int port;
        static volatile bool ready;
        static volatile string lastError = "";
        static SplashForm splash;
        static IntPtr jobHandle = IntPtr.Zero;

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
            profileDir = Join(dataDir, "window-profile");

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

                // 已经有一份在跑：直接开窗口，不再起第二个
                int running = ReadPortFile();
                if (running > 0 && Health(running))
                {
                    port = running;
                    OpenAppWindow();
                    if (appWindow != null) appWindow.WaitForExit();
                    return;
                }

                port = FindFreePort(3210);
                if (port <= 0)
                {
                    MessageBox.Show("1 到 99 号端口都被占用了，请先关掉别的程序再试。", "课后服务管理",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

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

                // 服务好了，把启动画面收起来，换成真正的应用窗口
                OpenAppWindow();
                if (appWindow != null)
                {
                    appWindow.WaitForExit();
                }
                ShutdownServer();
                KillChild();
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message, "课后服务管理", MessageBoxButtons.OK, MessageBoxIcon.Error);
                KillChild();
            }
        }

        static string Url()
        {
            return "http://127.0.0.1:" + port.ToString() + "/";
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

        /// <summary>
        /// 用 Edge 的 --app 模式开一个没有地址栏、没有标签页的窗口，
        /// 看起来就是一个独立软件；这个窗口关掉，进程就退出，我们据此停机。
        /// </summary>
        static void OpenAppWindow()
        {
            string edge = FindEdge();
            if (edge == null)
            {
                OpenBrowser(port);
                return;
            }
            try
            {
                try { Directory.CreateDirectory(profileDir); } catch { }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = edge;
                psi.Arguments = "--app=" + Url() +
                    " --user-data-dir=\"" + profileDir + "\"" +
                    " --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2" +
                    " --window-size=1320,900";
                psi.UseShellExecute = false;
                appWindow = Process.Start(psi);
            }
            catch
            {
                OpenBrowser(port);
            }
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
}
