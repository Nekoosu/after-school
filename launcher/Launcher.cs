using System;
using System.Diagnostics;
using System.Drawing;
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
    /// 课后服务管理 —— 桌面启动器。
    /// 干三件事：找一个能用的端口、把 app\node.exe 起起来、等服务 /api/health 通了就打开浏览器。
    /// 窗口关掉就把 node 子进程一起结束，不留后台。
    /// 用 C# 5 写（本机 csc 只支持到 C# 5，别用 $"..."、nameof、?.）。
    /// </summary>
    static class Launcher
    {
        static Process child;
        static string appDir;
        static string dataDir;
        static int port;
        static volatile bool ready;
        static volatile string lastError = "";
        static Label statusLabel;
        static Button openButton;
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

            try
            {
                if (!Directory.Exists(appDir))
                {
                    MessageBox.Show("找不到 app 文件夹，请把整个压缩包解压后再运行。", "课后服务管理",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                Directory.CreateDirectory(dataDir);

                // 已经有一份在跑：直接开浏览器，不再起第二个
                int running = ReadPortFile();
                if (running > 0 && Health(running))
                {
                    OpenBrowser(running);
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

                ShowWindow();
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
                    OpenBrowser(port);
                    UpdateUi();
                    return;
                }
                Thread.Sleep(600);
            }
            UpdateUi();
        }

        static void OpenBrowser(int p)
        {
            try { Process.Start("http://127.0.0.1:" + p.ToString() + "/"); } catch { }
        }

        static void UpdateUi()
        {
            try
            {
                statusLabel.Text = ready
                    ? "正在运行，浏览器里可以开始用了。\r\n地址：" + Url() + "\r\n关掉这个窗口就等于关掉软件。"
                    : "启动中…\r\n" + (lastError.Length > 0 ? "最后一条提示：" + lastError : "第一次打开要建数据库，稍等十几秒。");
                openButton.Enabled = ready;
            }
            catch { }
        }

        static void ShowWindow()
        {
            Form f = new Form();
            f.Text = "课后服务管理";
            f.Width = 460;
            f.Height = 220;
            f.StartPosition = FormStartPosition.CenterScreen;
            f.FormBorderStyle = FormBorderStyle.FixedSingle;
            f.MaximizeBox = false;
            f.BackColor = Color.White;

            try
            {
                string ico = Join(appDir, "public\\app.ico");
                if (File.Exists(ico)) f.Icon = new Icon(ico);
            }
            catch { }

            Label title = new Label();
            title.Text = "课后服务管理";
            title.Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(22, 18);
            f.Controls.Add(title);

            statusLabel = new Label();
            statusLabel.Text = "启动中…";
            statusLabel.Font = new Font("Microsoft YaHei UI", 9F);
            statusLabel.Location = new Point(24, 56);
            statusLabel.Size = new Size(400, 70);
            f.Controls.Add(statusLabel);

            openButton = new Button();
            openButton.Text = "打开界面";
            openButton.Location = new Point(24, 132);
            openButton.Size = new Size(120, 32);
            openButton.Enabled = false;
            openButton.Click += delegate { OpenBrowser(port); };
            f.Controls.Add(openButton);

            Button stop = new Button();
            stop.Text = "关闭软件";
            stop.Location = new Point(300, 132);
            stop.Size = new Size(120, 32);
            stop.Click += delegate { f.Close(); };
            f.Controls.Add(stop);

            if (ready) UpdateUi();

            f.FormClosing += delegate { KillChild(); };
            Application.Run(f);
            KillChild();
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
}
