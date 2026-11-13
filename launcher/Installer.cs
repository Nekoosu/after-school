using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AfterSchoolSetup
{
    /// <summary>
    /// 课后服务管理 —— 安装向导（1.8.14）。
    ///
    /// 为什么是「复制」而不是压缩包：dist 里本来就是一个能直接双击的文件夹（AfterSchool.exe +
    /// app\ 一整套 .next 与 node_modules），安装器要做的只是把它搬到 %LOCALAPPDATA%、
    /// 建两个快捷方式、在「卸载或更改程序」里挂个名字。这样卸载时也不依赖任何解压工具。
    ///
    /// 用法：
    ///   安装.exe            → 显示向导
    ///   安装.exe --silent   → 静默装到默认目录（给脚本和自动测试用）
    ///   安装.exe /D=目录    → 指定目录（可和 --silent 一起用）
    ///
    /// 用 C# 5 写（本机 csc 只支持 C# 5，别用 $"..."、nameof、?.）。
    /// </summary>
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string src = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string dir = DefaultDir();
            bool silent = false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] == null ? "" : args[i];
                if (a.Equals("--silent", StringComparison.OrdinalIgnoreCase) || a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
                else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) dir = a.Substring(3).Trim('"');
                else if (a.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase)) dir = a.Substring(6).Trim('"');
            }

            string err = Setup.Validate(src);
            if (err != null)
            {
                if (!silent) MessageBox.Show(err, "没法安装", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Environment.ExitCode = 2;
                return;
            }

            if (silent)
            {
                try
                {
                    Setup.Run(src, dir, null);
                    Environment.ExitCode = 0;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("install failed: " + ex.Message);
                    Environment.ExitCode = 1;
                }
                return;
            }

            Application.Run(new InstallForm(src, dir));
        }

        public static string DefaultDir()
        {
            string b = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrEmpty(b)) b = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Local");
            return Path.Combine(b, Setup.AppName);
        }
    }

    /// <summary>安装的实际动作（向导与 --silent 共用）。</summary>
    static class Setup
    {
        public const string AppName = "课后服务管理";
        // 这个占位符由 scripts\package.ps1 在编译时替换成真实版本（src\lib\version.ts 是唯一来源）
        public const string Version = "__VER__";
        public const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AfterSchool";

        /// <summary>源目录是不是一份能装的东西；返回错误文案，null = 没问题。</summary>
        public static string Validate(string src)
        {
            if (!File.Exists(Path.Combine(src, "AfterSchool.exe")))
                return "安装包不完整：这个文件要跟 AfterSchool.exe 放在同一个文件夹里。\r\n\r\n" +
                       "请把下载的 zip 整个解压，再双击里面的「安装.exe」——不要在压缩包里直接双击。";
            if (!File.Exists(Path.Combine(src, "app", "node.exe")))
                return "安装包不完整：缺少 app\\node.exe。\r\n\r\n请重新解压整个 zip。";
            if (!File.Exists(Path.Combine(src, "卸载.exe")))
                return "安装包不完整：缺少「卸载.exe」。\r\n\r\n请重新解压整个 zip。";
            return null;
        }

        /// <summary>已经在跑就先让它退出，否则 exe 被占用复制不过去。</summary>
        public static string CloseRunning(string dir)
        {
            string exe = Path.Combine(dir, "AfterSchool.exe");
            if (!File.Exists(exe)) return null;
            Process[] ps = Process.GetProcessesByName("AfterSchool");
            if (ps.Length == 0) return null;
            try
            {
                Process p = Process.Start(exe, "--quit");
                if (p != null) p.WaitForExit(6000);
            }
            catch { }
            // 再保险一次：等两秒还活着就不硬杀，让用户自己关
            System.Threading.Thread.Sleep(1500);
            if (Process.GetProcessesByName("AfterSchool").Length > 0)
                return "软件现在正开着，安装前请先关掉（托盘图标右键 → 退出），然后再点安装。";
            return null;
        }

        /// <summary>真的开始装：校验 → 关掉在跑的 → 复制 → 快捷方式 → 注册表。</summary>
        public static void Run(string src, string dir, Action<string, int> progress)
        {
            string err = Validate(src);
            if (err != null) throw new Exception(err);
            err = CloseRunning(dir);
            if (err != null) throw new Exception(err);

            string[] files = ListFiles(src);
            long total = 0;
            for (int i = 0; i < files.Length; i++) total += new FileInfo(files[i]).Length;
            if (total <= 0) total = 1;

            Directory.CreateDirectory(dir);
            long done = 0;
            for (int i = 0; i < files.Length; i++)
            {
                string rel = files[i].Substring(src.Length).TrimStart('\\');
                string dst = Path.Combine(dir, rel);
                string parent = Path.GetDirectoryName(dst);
                if (!Directory.Exists(parent)) Directory.CreateDirectory(parent);
                File.Copy(files[i], dst, true);
                done += new FileInfo(files[i]).Length;
                if (progress != null)
                {
                    int pct = (int)(done * 100 / total);
                    progress(rel, pct);
                }
            }

            // 账本目录先建好，第一次打开就有地方写
            string dataDir = Path.Combine(dir, "app", "data");
            if (!Directory.Exists(dataDir)) Directory.CreateDirectory(dataDir);

            string exe = Path.Combine(dir, "AfterSchool.exe");
            Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"), exe, dir);
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            Shortcut(Path.Combine(programs, AppName + ".lnk"), exe, dir);
            try { Shortcut(Path.Combine(programs, AppName + " 使用说明.lnk"), Path.Combine(dir, "使用说明.txt"), dir); }
            catch { }
            WriteUninstallEntry(exe, dir, (int)(total / 1024));
        }

        /// <summary>要复制的文件：除了安装器自己，其余整个目录都要（含 app\ 与三个 WebView2 dll）。</summary>
        static string[] ListFiles(string src)
        {
            string[] all = Directory.GetFiles(src, "*", SearchOption.AllDirectories);
            System.Collections.Generic.List<string> keep = new System.Collections.Generic.List<string>();
            for (int i = 0; i < all.Length; i++)
            {
                string name = Path.GetFileName(all[i]);
                if (name.Equals("安装.exe", StringComparison.OrdinalIgnoreCase)) continue;
                keep.Add(all[i]);
            }
            return keep.ToArray();
        }

        /// <summary>建一个 .lnk（走 WScript.Shell 的 COM，省得引 Interop）。</summary>
        public static void Shortcut(string lnk, string target, string workDir)
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            object sc = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            Type t = sc.GetType();
            t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            t.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { AppName });
            t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        static void WriteUninstallEntry(string exe, string dir, int sizeKb)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstKey))
            {
                k.SetValue("DisplayName", AppName);
                k.SetValue("DisplayVersion", Version);
                k.SetValue("Publisher", "nekoosu");
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + Path.Combine(dir, "卸载.exe") + "\"");
                k.SetValue("QuietUninstallString", "\"" + Path.Combine(dir, "卸载.exe") + "\" --silent");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
            }
        }

        /// <summary>已经装过的痕迹（给向导判断「是覆盖安装还是新装」）。</summary>
        public static bool Installed(string dir)
        {
            return File.Exists(Path.Combine(dir, "AfterSchool.exe")) && File.Exists(Path.Combine(dir, "卸载.exe"));
        }
    }

    sealed class InstallForm : Form
    {
        readonly string src;
        readonly string dir;
        TextBox txt;
        Button btnBrowse;
        Button btnGo;
        Button btnClose;
        ProgressBar bar;
        Label lblNow;
        Label lblPct;
        bool busy;
        bool done;

        public InstallForm(string srcDir, string targetDir)
        {
            src = srcDir;
            dir = targetDir;

            Text = "安装 " + Setup.AppName;
            ClientSize = new Size(560, 400);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(246, 247, 251);
            Font = new Font("Microsoft YaHei UI", 9f);
            try { Icon = Icon.ExtractAssociatedIcon(Path.Combine(src, "AfterSchool.exe")); }
            catch { }

            // 顶部品牌条
            Panel head = new Panel();
            head.Dock = DockStyle.Top;
            head.Height = 92;
            head.BackColor = Color.FromArgb(37, 99, 235);
            Controls.Add(head);

            Label h1 = new Label();
            h1.Text = Setup.AppName;
            h1.Font = new Font("Microsoft YaHei UI", 17f, FontStyle.Bold);
            h1.ForeColor = Color.White;
            h1.AutoSize = true;
            h1.Location = new Point(24, 18);
            head.Controls.Add(h1);

            Label h2 = new Label();
            h2.Text = "学生档案 · 排课 · 课时账 · 家长反馈 · 月报    版本 " + Setup.Version;
            h2.ForeColor = Color.FromArgb(214, 228, 255);
            h2.AutoSize = true;
            h2.Location = new Point(26, 58);
            head.Controls.Add(h2);

            Label l1 = new Label();
            l1.Text = Setup.Installed(dir)
                ? "这台电脑已经装过了。点「覆盖安装」会把程序换成这一版，账本数据（app\\data）原样保留。"
                : "安装到下面这个位置。装完桌面和开始菜单里都会有快捷方式，账本数据也存在这个目录里。";
            l1.Location = new Point(24, 112);
            l1.Size = new Size(500, 40);
            Controls.Add(l1);

            txt = new TextBox();
            txt.Text = dir;
            txt.Location = new Point(24, 158);
            txt.Width = 412;
            txt.Height = 26;
            Controls.Add(txt);

            btnBrowse = new Button();
            btnBrowse.Text = "换一个…";
            btnBrowse.Location = new Point(444, 156);
            btnBrowse.Size = new Size(90, 28);
            btnBrowse.Click += delegate { Browse(); };
            Controls.Add(btnBrowse);

            bar = new ProgressBar();
            bar.Location = new Point(24, 204);
            bar.Size = new Size(510, 14);
            bar.Style = ProgressBarStyle.Continuous;
            Controls.Add(bar);

            lblNow = new Label();
            lblNow.Text = "准备好了就点下面的按钮。";
            lblNow.Location = new Point(24, 226);
            lblNow.Size = new Size(430, 20);
            lblNow.ForeColor = Color.FromArgb(90, 100, 120);
            lblNow.AutoEllipsis = true;
            Controls.Add(lblNow);

            lblPct = new Label();
            lblPct.Text = "";
            lblPct.Location = new Point(456, 226);
            lblPct.Size = new Size(78, 20);
            lblPct.TextAlign = ContentAlignment.MiddleRight;
            lblPct.ForeColor = Color.FromArgb(90, 100, 120);
            Controls.Add(lblPct);

            Label tip = new Label();
            tip.Text = "不需要联网。卸载：开始菜单 →「课后服务管理」右键，或 Windows 设置 →「应用」里找「课后服务管理」。";
            tip.Location = new Point(24, 258);
            tip.Size = new Size(510, 20);
            tip.ForeColor = Color.FromArgb(130, 140, 158);
            Controls.Add(tip);

            btnGo = new Button();
            btnGo.Text = Setup.Installed(dir) ? "覆盖安装" : "开始安装";
            btnGo.Location = new Point(330, 330);
            btnGo.Size = new Size(110, 36);
            btnGo.BackColor = Color.FromArgb(37, 99, 235);
            btnGo.ForeColor = Color.White;
            btnGo.FlatStyle = FlatStyle.Flat;
            btnGo.FlatAppearance.BorderSize = 0;
            btnGo.Click += delegate { Go(); };
            Controls.Add(btnGo);

            btnClose = new Button();
            btnClose.Text = "取消";
            btnClose.Location = new Point(452, 330);
            btnClose.Size = new Size(82, 36);
            btnClose.FlatStyle = FlatStyle.Flat;
            btnClose.Click += delegate { Close(); };
            Controls.Add(btnClose);

            AcceptButton = btnGo;
            CancelButton = btnClose;
        }

        void Browse()
        {
            FolderBrowserDialog d = new FolderBrowserDialog();
            d.Description = "装到哪个文件夹";
            d.SelectedPath = txt.Text;
            if (d.ShowDialog() == DialogResult.OK) txt.Text = Path.Combine(d.SelectedPath, Setup.AppName);
        }

        void Go()
        {
            if (busy) return;
            if (done) { Open(); return; }
            string target = txt.Text.Trim();
            if (target.Length < 4 || target.IndexOf(':') < 0)
            {
                MessageBox.Show(this, "安装目录要是完整的路径，比如 C:\\Users\\你\\AppData\\Local\\" + Setup.AppName, "路径不对", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            busy = true;
            btnGo.Enabled = false;
            btnBrowse.Enabled = false;
            txt.Enabled = false;
            lblNow.Text = "正在准备…";
            bar.Value = 0;
            Application.DoEvents();
            string err = null;
            try
            {
                Setup.Run(src, target, delegate (string rel, int pct)
                {
                    if (bar.Value != pct) bar.Value = pct > 100 ? 100 : pct;
                    lblPct.Text = pct + "%";
                    lblNow.Text = "正在复制 " + Shorten(rel);
                    Application.DoEvents();
                });
            }
            catch (Exception ex)
            {
                err = ex.Message;
            }
            busy = false;
            btnGo.Enabled = true;
            if (err != null)
            {
                btnBrowse.Enabled = true;
                txt.Enabled = true;
                bar.Value = 0;
                lblPct.Text = "";
                lblNow.Text = "没装成。";
                MessageBox.Show(this, err, "安装中断", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            done = true;
            bar.Value = 100;
            lblPct.Text = "100%";
            lblNow.Text = "装好了，桌面和开始菜单里都有快捷方式。";
            btnGo.Text = "打开";
            btnClose.Text = "关闭";
            if (MessageBox.Show(this, "装好了，现在就打开吗？", "安装完成", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                Open();
        }

        static string Shorten(string rel)
        {
            if (rel.Length <= 44) return rel;
            return rel.Substring(0, 20) + "…" + rel.Substring(rel.Length - 22);
        }

        void Open()
        {
            string exe = Path.Combine(txt.Text.Trim(), "AfterSchool.exe");
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe);
                psi.WorkingDirectory = Path.GetDirectoryName(exe);
                Process.Start(psi);
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "打不开：" + ex.Message, "出错了", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
