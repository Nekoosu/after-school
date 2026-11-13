using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
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
    /// 界面只有三样东西：软件描述、进度、取消。装到哪固定是默认目录，**不给换**——
    /// 以前那个「换一个…」会让人选到没权限的目录（C:\Program Files、正在用的目录等），
    /// 一点就装失败；固定路径以后没有可点错的地方。
    ///
    /// 用法：
    ///   安装.exe            → 显示向导
    ///   安装.exe --silent   → 静默装到默认目录（给脚本和自动测试用）
    ///   安装.exe /D=目录    → 指定目录（可和 --silent 一起用，仅给脚本用，界面上不暴露）
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
            AfterSchoolUi.Dpi.Init();

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

            // 覆盖安装：旧的 .next（含 route-cache 预渲染快照与上一版 chunk 名）必须先清掉，
            // 否则装完还是旧界面、控制台报 404。app\data 账本不动。
            string oldNext = Path.Combine(dir, "app", ".next");
            if (Directory.Exists(oldNext)) DeleteTree(oldNext);

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

        /// <summary>删一整棵目录（只读属性先复位）；只给覆盖安装清 .next 用，失败不阻断安装。</summary>
        static void DeleteTree(string dir)
        {
            try
            {
                foreach (string f in Directory.GetFiles(dir))
                {
                    try { File.SetAttributes(f, FileAttributes.Normal); } catch { }
                    try { File.Delete(f); } catch { }
                }
                foreach (string d in Directory.GetDirectories(dir))
                {
                    try { File.SetAttributes(d, FileAttributes.Directory); } catch { }
                    DeleteTree(d);
                }
                Directory.Delete(dir, false);
            }
            catch { }
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

    /// <summary>
    /// 安装界面：描述 + 进度 + 取消，三个页面（准备 / 安装中 / 完成）。
    /// 安装位置固定为 DefaultDir()，界面上没有输入框、没有「换一个」。
    /// </summary>
    sealed class InstallForm : AfterSchoolUi.ModernForm
    {
        const int W = 720;
        const int H = 480;
        const int HeadH = 96;
        const int FootH = 94;

        readonly string src;
        readonly string dir;
        readonly Image appIcon;
        readonly string footText;

        Panel head, body, foot;
        AfterSchoolUi.ProgressBarEx bar;
        Label lblTitle, lblDesc, lblPath, lblPct, lblNow, lblFile, lblFoot, lblDoneSub;
        AfterSchoolUi.RoundedButton btnPrimary, btnSecondary;
        Panel pageWelcome, pageWorking, pageDone;

        Action primaryAction;
        bool busy;
        bool done;
        bool canceled;

        public InstallForm(string srcDir, string targetDir)
        {
            src = srcDir;
            dir = targetDir;
            bool installed = Setup.Installed(dir);

            Text = "安装 " + Setup.AppName;
            ClientSize = new Size(W, H);
            appIcon = LoadIcon(Path.Combine(src, "AfterSchool.exe"), 48);
            try { Icon = Icon.ExtractAssociatedIcon(Path.Combine(src, "AfterSchool.exe")); }
            catch { }

            footText = "不需要联网。卸载：Windows 设置 →「应用」→「" + Setup.AppName + "」";

            // —— 品牌区：图标 + 名称 + 一行描述
            head = new Panel();
            head.Location = new Point(0, 0);
            head.Size = new Size(W, HeadH);
            head.BackColor = AfterSchoolUi.Theme.Page;
            head.Paint += HeadPaint;
            EnableDrag(head);
            Controls.Add(head);

            // —— 内容区：三个页面切换
            body = new Panel();
            body.Location = new Point(0, HeadH);
            body.Size = new Size(W, H - HeadH - FootH);
            body.BackColor = AfterSchoolUi.Theme.Page;
            Controls.Add(body);

            BuildWelcome(installed);
            BuildWorking();
            BuildDone();

            // —— 底部：脚注 + 两个按钮
            buildFoot();

            AcceptButton = btnPrimary;
            CancelButton = btnSecondary;
            ShowPage(pageWelcome);
            primaryAction = Start;
            btnPrimary.Text = installed ? "覆盖安装" : "开始安装";
            btnSecondary.Text = "取消";

            close.BringToFront();
        }

        // ───────────────────────── 品牌区

        void HeadPaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            AfterSchoolUi.Theme.Text(g);
            using (GraphicsPath brushPath = AfterSchoolUi.Theme.RoundPath(new Rectangle(-1, -1, W + 2, HeadH + 2), 0))
            using (LinearGradientBrush bg = new LinearGradientBrush(
                new Rectangle(0, 0, W, HeadH), Color.FromArgb(233, 242, 255), AfterSchoolUi.Theme.Page,
                LinearGradientMode.Vertical))
                g.FillRectangle(bg, 0, 0, W, HeadH);

            if (appIcon != null)
            {
                using (GraphicsPath clip = AfterSchoolUi.Theme.RoundPath(new Rectangle(32, 24, 48, 48), 11))
                {
                    GraphicsState st = g.Save();
                    g.SetClip(clip);
                    g.DrawImage(appIcon, 32, 24, 48, 48);
                    g.Restore(st);
                }
            }

            TextRenderer.DrawText(g, Setup.AppName, AfterSchoolUi.Theme.FB(20f),
                new Rectangle(96, 20, 460, 34), AfterSchoolUi.Theme.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            TextRenderer.DrawText(g,
                "学生档案 · 排课 · 课时账 · 家长反馈 · 月报　　v" + Setup.Version,
                AfterSchoolUi.Theme.F(9f),
                new Rectangle(98, 58, 500, 22), AfterSchoolUi.Theme.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }

        // ───────────────────────── 第 1 页：准备

        void BuildWelcome(bool installed)
        {
            pageWelcome = NewPage();

            lblTitle = NewLabel("准备安装", 32, 16, 656, 34,
                AfterSchoolUi.Theme.FB(19f), AfterSchoolUi.Theme.Ink);
            pageWelcome.Controls.Add(lblTitle);

            string desc = installed
                ? "这个位置已经装过一份了。点「覆盖安装」会用新版本把程序文件替换一遍，\n账本数据（app\\data）原样保留。"
                : "把程序文件放到下面这个位置，再建好桌面和开始菜单的快捷方式。\n整个过程不需要联网，也不会改动系统设置。";
            lblDesc = NewLabel(desc, 32, 58, 656, 44,
                AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageWelcome.Controls.Add(lblDesc);

            AfterSchoolUi.CardPanel card = new AfterSchoolUi.CardPanel();
            card.Location = new Point(32, 110);
            card.Size = new Size(656, 78);
            pageWelcome.Controls.Add(card);

            Label lcap = NewLabel("安装位置", 18, 12, 300, 20,
                AfterSchoolUi.Theme.F(8.5f), AfterSchoolUi.Theme.InkFaint);
            card.Controls.Add(lcap);

            lblPath = NewLabel(dir, 18, 34, 556, 26,
                AfterSchoolUi.Theme.F(10.5f), AfterSchoolUi.Theme.Ink);
            lblPath.AutoEllipsis = true;
            card.Controls.Add(lblPath);

            Label lfixed = NewLabel("固定目录", 582, 36, 56, 20,
                AfterSchoolUi.Theme.F(8.5f), AfterSchoolUi.Theme.InkFaint);
            lfixed.TextAlign = ContentAlignment.MiddleRight;
            card.Controls.Add(lfixed);

            Panel bullets = new Panel();
            bullets.Location = new Point(32, 202);
            bullets.Size = new Size(656, 74);
            bullets.BackColor = AfterSchoolUi.Theme.Page;
            bullets.Paint += BulletsPaint;
            pageWelcome.Controls.Add(bullets);
        }

        void BulletsPaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            AfterSchoolUi.Theme.Text(g);
            string[] lines = new string[] {
                "桌面和开始菜单里都会出现快捷方式",
                "「设置 → 应用」里能正常卸载，不留垃圾",
                "账本数据放在 app\\data，以后升级不会丢"
            };
            int y = 2;
            for (int i = 0; i < lines.Length; i++)
            {
                using (SolidBrush b = new SolidBrush(AfterSchoolUi.Theme.SuccessSoft))
                    g.FillEllipse(b, 0, y + 6, 16, 16);
                using (Pen pen = new Pen(AfterSchoolUi.Theme.Success, 1.8f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawLines(pen, new Point[] {
                        new Point(4, y + 14), new Point(7, y + 17), new Point(13, y + 9)
                    });
                }
                TextRenderer.DrawText(g, lines[i], AfterSchoolUi.Theme.F(9.2f),
                    new Rectangle(26, y, 620, 26), AfterSchoolUi.Theme.InkSoft,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
                y += 24;
            }
        }

        // ───────────────────────── 第 2 页：安装中

        void BuildWorking()
        {
            pageWorking = NewPage();

            Label t = NewLabel("正在安装", 32, 16, 656, 34,
                AfterSchoolUi.Theme.FB(19f), AfterSchoolUi.Theme.Ink);
            pageWorking.Controls.Add(t);

            bar = new AfterSchoolUi.ProgressBarEx();
            bar.Location = new Point(32, 126);
            bar.Size = new Size(656, 14);
            pageWorking.Controls.Add(bar);

            lblNow = NewLabel("正在准备…", 32, 100, 540, 22,
                AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageWorking.Controls.Add(lblNow);

            lblPct = NewLabel("0%", 600, 100, 88, 22,
                AfterSchoolUi.Theme.FB(10f), AfterSchoolUi.Theme.Brand);
            lblPct.TextAlign = ContentAlignment.MiddleRight;
            pageWorking.Controls.Add(lblPct);

            lblFile = NewLabel("", 32, 150, 656, 22,
                AfterSchoolUi.Theme.F(8.8f), AfterSchoolUi.Theme.InkFaint);
            lblFile.AutoEllipsis = true;
            pageWorking.Controls.Add(lblFile);

            Label tip = NewLabel("文件正在写入，中途可以点「取消」。", 32, 178, 656, 22,
                AfterSchoolUi.Theme.F(8.8f), AfterSchoolUi.Theme.InkFaint);
            pageWorking.Controls.Add(tip);
        }

        // ───────────────────────── 第 3 页：完成

        void BuildDone()
        {
            pageDone = NewPage();

            Panel badge = new Panel();
            badge.Location = new Point(32, 24);
            badge.Size = new Size(56, 56);
            badge.BackColor = AfterSchoolUi.Theme.Page;
            badge.Paint += delegate(object s, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                AfterSchoolUi.Theme.Text(g);
                AfterSchoolUi.Theme.FillRound(g, new Rectangle(0, 0, 55, 55), 27,
                    AfterSchoolUi.Theme.SuccessSoft);
                using (Pen pen = new Pen(AfterSchoolUi.Theme.Success, 3.6f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawLines(pen, new Point[] {
                        new Point(15, 29), new Point(24, 38), new Point(41, 18)
                    });
                }
            };
            pageDone.Controls.Add(badge);

            Label t = NewLabel("装好了", 108, 26, 520, 40,
                AfterSchoolUi.Theme.FB(21f), AfterSchoolUi.Theme.Ink);
            pageDone.Controls.Add(t);

            lblDoneSub = NewLabel("桌面和开始菜单里都能找到「" + Setup.AppName + "」。",
                108, 68, 560, 24, AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageDone.Controls.Add(lblDoneSub);

            Label s2 = NewLabel("第一次打开会稍等几秒，软件会自己把服务拉起来。",
                108, 96, 560, 22, AfterSchoolUi.Theme.F(9f), AfterSchoolUi.Theme.InkFaint);
            pageDone.Controls.Add(s2);
        }

        // ───────────────────────── 底部

        void buildFoot()
        {
            foot = new Panel();
            foot.Location = new Point(0, H - FootH);
            foot.Size = new Size(W, FootH);
            foot.BackColor = AfterSchoolUi.Theme.Page;
            foot.Paint += delegate(object s, PaintEventArgs e)
            {
                using (Pen pen = new Pen(AfterSchoolUi.Theme.CardLine))
                    e.Graphics.DrawLine(pen, 0, 0, W, 0);
            };
            Controls.Add(foot);

            lblFoot = NewLabel(footText, 32, 36, 420, 20,
                AfterSchoolUi.Theme.F(8.8f), AfterSchoolUi.Theme.InkFaint);
            foot.Controls.Add(lblFoot);

            btnPrimary = new AfterSchoolUi.RoundedButton();
            btnPrimary.Kind = AfterSchoolUi.ButtonKind.Primary;
            btnPrimary.Font = AfterSchoolUi.Theme.FB(10f);
            btnPrimary.Size = new Size(148, 42);
            btnPrimary.Location = new Point(W - 32 - 148, 26);
            btnPrimary.Click += delegate { if (primaryAction != null) primaryAction(); };
            foot.Controls.Add(btnPrimary);

            btnSecondary = new AfterSchoolUi.RoundedButton();
            btnSecondary.Kind = AfterSchoolUi.ButtonKind.Ghost;
            btnSecondary.Font = AfterSchoolUi.Theme.F(10f);
            btnSecondary.Size = new Size(108, 42);
            btnSecondary.Location = new Point(W - 32 - 148 - 12 - 108, 26);
            btnSecondary.Click += delegate { Secondary(); };
            foot.Controls.Add(btnSecondary);
        }

        // ───────────────────────── 页面与流程

        Panel NewPage()
        {
            Panel p = new Panel();
            p.Location = new Point(0, 0);
            p.Size = new Size(W, H - HeadH - FootH);
            p.BackColor = AfterSchoolUi.Theme.Page;
            p.Visible = false;
            body.Controls.Add(p);
            return p;
        }

        static Label NewLabel(string text, int x, int y, int w, int h, Font font, Color color)
        {
            Label l = new Label();
            l.Text = text;
            l.Location = new Point(x, y);
            l.Size = new Size(w, h);
            l.Font = font;
            l.ForeColor = color;
            l.BackColor = Color.Transparent;
            l.TextAlign = ContentAlignment.MiddleLeft;
            return l;
        }

        void ShowPage(Panel page)
        {
            pageWelcome.Visible = false;
            pageWorking.Visible = false;
            pageDone.Visible = false;
            page.Visible = true;
            page.BringToFront();
        }

        void Secondary()
        {
            if (busy)
            {
                if (!canceled)
                {
                    canceled = true;
                    lblNow.Text = "正在取消…";
                }
                return;
            }
            Close();
        }

        void Start()
        {
            if (busy) return;
            if (done) { Open(); return; }

            busy = true;
            canceled = false;
            ShowPage(pageWorking);
            bar.Value = 0;
            lblPct.Text = "0%";
            lblNow.Text = "正在准备…";
            lblFile.Text = "";
            btnPrimary.Visible = false;
            btnSecondary.Text = "取消";
            Application.DoEvents();

            string err = null;
            try
            {
                Setup.Run(src, dir, delegate(string rel, int pct)
                {
                    if (canceled) throw new OperationCanceledException();
                    if (pct > 100) pct = 100;
                    if (pct < 0) pct = 0;
                    bar.Value = pct;
                    lblPct.Text = pct + "%";
                    lblNow.Text = pct < 100 ? "正在写入文件…" : "正在收尾…";
                    lblFile.Text = rel == null ? "" : rel;
                    Application.DoEvents();
                });
            }
            catch (Exception ex) { err = ex.Message; }

            busy = false;
            btnPrimary.Visible = true;
            btnPrimary.Text = "开始安装";
            btnSecondary.Text = "取消";
            primaryAction = Start;
            lblFoot.Text = footText;

            if (canceled)
            {
                canceled = false;
                bar.Value = 0;
                lblPct.Text = "0%";
                lblFile.Text = "";
                lblDesc.Text = "已取消。可能已经复制了一部分文件，可以再点一次「开始安装」把它装完。";
                ShowPage(pageWelcome);
                return;
            }
            if (err != null)
            {
                bar.Value = 0;
                lblPct.Text = "0%";
                lblFile.Text = "";
                lblDesc.Text = "没装成：" + err;
                ShowPage(pageWelcome);
                MessageBox.Show(this, "安装失败：" + err + "\r\n\r\n可以关掉这个窗口，把错误告诉管理员。",
                    Setup.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            bar.Value = 100;
            lblPct.Text = "100%";
            Application.DoEvents();
            done = true;
            ShowPage(pageDone);
            primaryAction = Open;
            btnPrimary.Text = "打开软件";
            btnSecondary.Text = "关闭";
            lblDoneSub.Text = "桌面和开始菜单里都能找到「" + Setup.AppName + "」。";
            lblFoot.Text = "可以在「设置 → 应用」里随时卸载。";
        }

        void Open()
        {
            try
            {
                string exe = Path.Combine(dir, "AfterSchool.exe");
                if (File.Exists(exe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = exe;
                    psi.WorkingDirectory = dir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                }
            }
            catch { }
            Close();
        }

        static Image LoadIcon(string exe, int size)
        {
            try
            {
                if (!File.Exists(exe)) return null;
                Icon ico = Icon.ExtractAssociatedIcon(exe);
                if (ico == null) return null;
                using (ico)
                {
                    Bitmap bmp = new Bitmap(size, size);
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.SmoothingMode = SmoothingMode.HighQuality;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        using (Icon scaled = new Icon(ico, size, size))
                            g.DrawIcon(scaled, new Rectangle(0, 0, size, size));
                    }
                    return bmp;
                }
            }
            catch { return null; }
        }
    }
}
