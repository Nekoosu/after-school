using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AfterSchoolUninstall
{
    /// <summary>
    /// 课后服务管理 —— 卸载（1.8.14）。
    ///
    /// 干四件事：让正在跑的软件退出 → 删桌面/开始菜单快捷方式 → 删「应用」里的卸载登记 →
    /// 把自己所在的整个目录删掉（用 cmd 延时删，因为 exe 自己正在运行没法删自己）。
    ///
    /// 账本数据在 app\data\app.db，删目录就一起没了，所以有数据时可以先勾选备份到桌面。
    /// 用法：卸载.exe                向导
    ///       卸载.exe --silent       不问，全删（自动测试与 QuietUninstallString 用）
    ///       卸载.exe --silent --keep-data  不问，只删程序文件，app\data 账本留着（重装能接上）
    /// </summary>
    static class Program
    {
        internal const string AppName = "课后服务管理";
        const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AfterSchool";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            AfterSchoolUi.Dpi.Init();

            bool silent = false;
            bool keepData = false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] == null ? "" : args[i];
                if (a.Equals("--silent", StringComparison.OrdinalIgnoreCase) || a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
                if (a.Equals("--keep-data", StringComparison.OrdinalIgnoreCase)) keepData = true;
            }

            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (silent)
            {
                string err = DoUninstall(dir, null, keepData);
                Environment.ExitCode = err == null ? 0 : 1;
                // 静默模式下没人看得到失败原因，留一份在 %TEMP% 里方便排查
                if (err != null)
                {
                    try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "as-uninstall-error.txt"), err); }
                    catch { }
                }
                return;
            }

            using (UninstallForm f = new UninstallForm(dir))
            {
                Application.Run(f);
                Environment.ExitCode = f.Removed ? 0 : 1;
            }
        }

        /// <summary>真的卸载。返回 null = 卸完了，否则是给人看的失败原因。</summary>
        /// <param name="keepData">true = 只删程序文件，app\data 账本目录原样留着（重装能接上）。</param>
        internal static string DoUninstall(string dir, Action<string> stage, bool keepData)
        {
            string exe = Path.Combine(dir, "AfterSchool.exe");

            // 1) 让它退出（正常关窗会顺手 checkpoint + 备份）
            //    只在真的有一份在跑时才发 --quit：没有进程时起一个 --quit 会白开一个窗口。
            Step(stage, "正在关闭软件…");
            if (File.Exists(exe) && Process.GetProcessesByName("AfterSchool").Length > 0)
            {
                try
                {
                    Process p = Process.Start(exe, "--quit");
                    if (p != null) p.WaitForExit(8000);
                }
                catch { }
                System.Threading.Thread.Sleep(1200);
            }
            // 还不走就先温和地关窗，再不行才硬杀（否则目录删不干净）
            Process[] still = Process.GetProcessesByName("AfterSchool");
            if (still.Length > 0)
            {
                foreach (Process q in still) { try { q.CloseMainWindow(); } catch { } }
                System.Threading.Thread.Sleep(3000);
                still = Process.GetProcessesByName("AfterSchool");
                foreach (Process q in still) { try { q.Kill(); } catch { } }
                System.Threading.Thread.Sleep(1500);
            }
            if (Process.GetProcessesByName("AfterSchool").Length > 0)
                return "软件还开着，先关掉它（托盘图标右键 → 退出）再卸载。";

            // 2) 快捷方式
            Step(stage, "正在删桌面和开始菜单的快捷方式…");
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"));
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            TryDelete(Path.Combine(programs, AppName + ".lnk"));
            TryDelete(Path.Combine(programs, AppName + " 使用说明.lnk"));

            // 3) 「应用」里的登记
            Step(stage, "正在删「应用」里的卸载登记…");
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstKey, false); }
            catch { }

            // 4) 目录：先杀掉可能残留的 node.exe（只杀 app 目录下的），再交给 cmd 延时删
            //    「保留账本」时走另一条路：逐项删，唯独跳过 app\data（robocopy /XD 试过，会被 /MIR 一起清掉，不可靠）。
            KillUnder(Path.Combine(dir, "app"), "node");

            string dataDir = Path.Combine(dir, "app", "data");
            if (keepData && Directory.Exists(dataDir))
            {
                Step(stage, "正在删程序文件，账本留着…");
                try
                {
                    DelKeepData(new DirectoryInfo(dir));
                }
                catch (Exception e)
                {
                    return "删程序文件时出错：" + e.Message.TrimEnd('。') + "。账本还在：" + dataDir;
                }
                // 卸载.exe 自己还开着删不掉，交给 cmd 等几秒再删；账本目录和它所在的外层目录留着。
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo("cmd.exe");
                    psi.Arguments = "/c ping -n 4 127.0.0.1 >nul & del /f /q \"" +
                        Path.Combine(dir, "卸载.exe") + "\"";
                    psi.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    Process.Start(psi);
                }
                catch { }
                return null;
            }

            Step(stage, "正在删文件，这一步最慢…");
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe");
                psi.Arguments = "/c ping -n 4 127.0.0.1 >nul & rd /s /q \"" + dir + "\"";
                psi.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
            }
            catch (Exception e)
            {
                return "目录删不掉：" + e.Message + "。可以直接把这个文件夹拖进回收站：" + dir;
            }

            return null;
        }

        static void Step(Action<string> stage, string text)
        {
            if (stage != null) stage(text);
        }

        /// <summary>进程退出后再删一次：删自己 / 删整个目录。窗口关闭时调用，--silent 已由 DoUninstall 调度过，这里重复一次也无害。</summary>
        internal static void CleanupOnExit(string dir, bool keepData)
        {
            try
            {
                string cmd = keepData
                    ? "ping -n 3 127.0.0.1 >nul & del /f /q \"" + Path.Combine(dir, "卸载.exe") + "\""
                    : "ping -n 3 127.0.0.1 >nul & rd /s /q \"" + dir + "\"";
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe");
                psi.Arguments = "/c " + cmd;
                psi.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
            }
            catch { }
        }

        /// <summary>
        /// 删掉安装目录里所有东西，唯独留着 app\data（账本）。外层目录和 app 目录本身留着，卸载.exe 也留着（它还在跑，交给 cmd 延后删）。
        /// </summary>
        static void DelKeepData(DirectoryInfo root)
        {
            foreach (FileSystemInfo fsi in root.GetFileSystemInfos())
            {
                if (fsi.Name == "卸载.exe") continue;   // 自己还开着
                DirectoryInfo d = fsi as DirectoryInfo;
                if (d != null && d.Name == "app")
                {
                    foreach (FileSystemInfo inner in d.GetFileSystemInfos())
                    {
                        if (inner.Name == "data") continue;   // 账本
                        DelTree(inner);
                    }
                    continue;
                }
                DelTree(fsi);
            }
        }

        /// <summary>递归删一个文件或目录（先清掉只读、隐藏属性，免得删不动）。</summary>
        static void DelTree(FileSystemInfo fsi)
        {
            try { fsi.Attributes = FileAttributes.Normal; }
            catch { }
            DirectoryInfo d = fsi as DirectoryInfo;
            if (d != null)
            {
                foreach (FileSystemInfo c in d.GetFileSystemInfos()) DelTree(c);
                d.Delete(true);
            }
            else
            {
                fsi.Delete();
            }
        }

        static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch { }
        }

        /// <summary>只杀掉跑在这个安装目录里的同名进程，别误伤别处的 node。</summary>
        static void KillUnder(string appDir, string name)
        {
            try
            {
                Process[] ps = Process.GetProcessesByName(name);
                for (int i = 0; i < ps.Length; i++)
                {
                    try
                    {
                        string path = ps[i].MainModule.FileName;
                        if (!string.IsNullOrEmpty(path) && path.StartsWith(appDir, StringComparison.OrdinalIgnoreCase))
                            ps[i].Kill();
                    }
                    catch { }
                }
            }
            catch { }
        }
    }

    /// <summary>卸载向导：确认页 → 进行中 → 完成页。</summary>
    sealed class UninstallForm : AfterSchoolUi.ModernForm
    {
        const int W = 720, H = 480, HeadH = 96, FootH = 94;

        readonly string dir;
        readonly string db;
        readonly bool hasData;

        Panel head, body, foot;
        AfterSchoolUi.ProgressBarEx bar;
        Label lblDesc, lblPath, lblStage, lblNote, lblFoot, lblDoneSub;
        AfterSchoolUi.RoundedButton btnPrimary, btnSecondary;
        AfterSchoolUi.CheckBoxEx chkBackup, chkKeep;
        Panel list;
        Panel pageConfirm, pageWorking, pageDone;
        string backupName;
        bool busy, removed, finished, keepFlag;

        public bool Removed { get { return removed; } }

        public UninstallForm(string targetDir)
        {
            dir = targetDir;
            db = Path.Combine(dir, "app", "data", "app.db");
            hasData = File.Exists(db) && new FileInfo(db).Length > 30000;

            ClientSize = new Size(W, H);
            Text = "卸载 " + Program.AppName;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            head = new Panel();
            head.SetBounds(0, 0, W, HeadH);
            head.BackColor = AfterSchoolUi.Theme.Page;
            head.Paint += HeadPaint;
            EnableDrag(head);
            Controls.Add(head);

            body = new Panel();
            body.SetBounds(0, HeadH, W, H - HeadH - FootH);
            body.BackColor = AfterSchoolUi.Theme.Page;
            Controls.Add(body);

            foot = new Panel();
            foot.SetBounds(0, H - FootH, W, FootH);
            foot.BackColor = AfterSchoolUi.Theme.Page;
            foot.Paint += FootPaint;
            Controls.Add(foot);

            BuildConfirm();
            BuildWorking();
            BuildDone();
            BuildFoot();

            foreach (Panel p in new Panel[] { pageConfirm, pageWorking, pageDone }) body.Controls.Add(p);
            ShowPage(pageConfirm);
            close.BringToFront();
        }

        // ---------- 页面 ----------

        void BuildConfirm()
        {
            pageConfirm = NewPage();

            Label t = NewLabel("要卸载了", 36, 16, 520, 40, AfterSchoolUi.Theme.FB(21f), AfterSchoolUi.Theme.Ink);
            pageConfirm.Controls.Add(t);

            lblDesc = NewLabel("默认会把这个文件夹整个删掉，里面装的是软件本体和账本数据。",
                36, 60, 640, 22, AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageConfirm.Controls.Add(lblDesc);

            AfterSchoolUi.CardPanel card = new AfterSchoolUi.CardPanel();
            card.SetBounds(36, 88, 648, 62);
            pageConfirm.Controls.Add(card);

            Label cap = new Label();
            cap.Text = "安装位置";
            cap.Font = AfterSchoolUi.Theme.F(9f);
            cap.ForeColor = AfterSchoolUi.Theme.InkFaint;
            cap.SetBounds(20, 8, 200, 20);
            card.Controls.Add(cap);

            lblPath = new Label();
            lblPath.AutoEllipsis = true;
            lblPath.Text = dir;
            lblPath.Font = AfterSchoolUi.Theme.F(10.5f);
            lblPath.ForeColor = AfterSchoolUi.Theme.Ink;
            lblPath.SetBounds(20, 30, 600, 26);
            card.Controls.Add(lblPath);

            list = new Panel();
            list.SetBounds(36, 156, 648, 72);
            list.BackColor = AfterSchoolUi.Theme.Page;
            list.Paint += ListPaint;
            pageConfirm.Controls.Add(list);

            if (hasData)
            {
                chkKeep = new AfterSchoolUi.CheckBoxEx();
                chkKeep.Text = "保留账本数据（app\\data 不删，以后重装能接上）";
                chkKeep.SetBounds(36, 232, 648, 24);
                chkKeep.Click += delegate
                {
                    if (list != null) list.Invalidate();
                    SetHint(chkKeep.Checked ? "账本会留在原目录，只删程序文件。" : "卸载后这个文件夹就空了，可以直接删掉。", false);
                };
                pageConfirm.Controls.Add(chkKeep);

                chkBackup = new AfterSchoolUi.CheckBoxEx();
                chkBackup.Text = "同时备份一份到桌面（换机器、重装前留个底）";
                chkBackup.SetBounds(36, 260, 648, 24);
                pageConfirm.Controls.Add(chkBackup);
            }
        }

        void BuildWorking()
        {
            pageWorking = NewPage();

            Label t = NewLabel("正在卸载", 36, 34, 520, 40, AfterSchoolUi.Theme.FB(21f), AfterSchoolUi.Theme.Ink);
            pageWorking.Controls.Add(t);

            bar = new AfterSchoolUi.ProgressBarEx();
            bar.SetBounds(36, 92, 648, 12);
            bar.IsMarquee = true;
            pageWorking.Controls.Add(bar);

            lblStage = NewLabel("正在准备…", 36, 118, 560, 24, AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageWorking.Controls.Add(lblStage);

            lblNote = NewLabel("正在删除文件，这一步最慢，请稍等几秒。", 36, 150, 560, 24,
                AfterSchoolUi.Theme.F(9f), AfterSchoolUi.Theme.InkFaint);
            pageWorking.Controls.Add(lblNote);
        }

        void BuildDone()
        {
            pageDone = NewPage();

            Panel badge = new Panel();
            badge.SetBounds(36, 36, 56, 56);
            badge.BackColor = AfterSchoolUi.Theme.Page;
            badge.Paint += DoneBadgePaint;
            pageDone.Controls.Add(badge);

            Label t = NewLabel("卸载完了", 108, 36, 520, 40, AfterSchoolUi.Theme.FB(21f), AfterSchoolUi.Theme.Ink);
            pageDone.Controls.Add(t);

            lblDoneSub = NewLabel("", 108, 78, 560, 40, AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageDone.Controls.Add(lblDoneSub);
        }

        void BuildFoot()
        {
            lblFoot = new Label();
            lblFoot.Text = "卸载后这个文件夹就空了，可以直接删掉。";
            lblFoot.Font = AfterSchoolUi.Theme.F(9f);
            lblFoot.ForeColor = AfterSchoolUi.Theme.InkFaint;
            lblFoot.SetBounds(32, 36, 380, 22);
            lblFoot.BackColor = Color.Transparent;
            foot.Controls.Add(lblFoot);

            btnPrimary = new AfterSchoolUi.RoundedButton();
            btnPrimary.Kind = AfterSchoolUi.ButtonKind.Danger;
            btnPrimary.Text = "卸载";
            btnPrimary.SetBounds(W - 32 - 116, 26, 116, 42);
            btnPrimary.Click += delegate { OnPrimary(); };
            foot.Controls.Add(btnPrimary);

            btnSecondary = new AfterSchoolUi.RoundedButton();
            btnSecondary.Kind = AfterSchoolUi.ButtonKind.Ghost;
            btnSecondary.Text = "取消";
            btnSecondary.SetBounds(W - 32 - 116 - 12 - 108, 26, 108, 42);
            btnSecondary.Click += delegate { if (!busy) Close(); };
            foot.Controls.Add(btnSecondary);

            AcceptButton = btnPrimary;
            CancelButton = btnSecondary;
        }

        // ---------- 流程 ----------

        /// <summary>窗口关掉之后才删得掉 卸载.exe；DoUninstall 里那次调度是给 --silent 用的，界面路径等用户点关闭再兜一次。</summary>
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (busy) { e.Cancel = true; return; }
            if (finished) Program.CleanupOnExit(dir, keepFlag);
            base.OnFormClosing(e);
        }

        void OnPrimary()
        {
            if (busy) return;
            if (removed) { Close(); return; }
            Start();
        }

        void Start()
        {
            bool keep = chkKeep != null && chkKeep.Checked;

            if (chkBackup != null && chkBackup.Checked)
            {
                string name = Backup();
                if (name == null)
                {
                    SetHint("备份没成功，先别卸载。可以手动把 app\\data\\app.db 拷到桌面上。", true);
                    return;
                }
                backupName = name;
                chkBackup.Checked = false;
            }

            SetHint(keep ? "账本会留在原目录，只删程序文件。" : "卸载后这个文件夹就空了，可以直接删掉。", false);
            busy = true;
            btnPrimary.Enabled = false;
            btnSecondary.Enabled = false;
            btnSecondary.Text = "请稍候…";
            ShowPage(pageWorking);
            Application.DoEvents();

            string err = Program.DoUninstall(dir, delegate(string text)
            {
                lblStage.Text = text;
                bar.Invalidate();
                Application.DoEvents();
            }, keep);

            if (err != null)
            {
                busy = false;
                btnPrimary.Enabled = true;
                btnSecondary.Enabled = true;
                btnSecondary.Text = "取消";
                ShowPage(pageConfirm);
                SetHint(err, true);
                Application.DoEvents();
                return;
            }

            removed = true;
            finished = true;
            keepFlag = keep;
            busy = false;
            bar.IsMarquee = false;
            bar.Value = 100;
            ShowPage(pageDone);

            if (keep && backupName != null)
                lblDoneSub.Text = "程序文件清掉了；账本留在原目录，桌面也存了一份：" + backupName;
            else if (keep)
                lblDoneSub.Text = "程序文件清掉了，账本还留在 app\\data 里，重装后能接上。";
            else if (backupName == null)
                lblDoneSub.Text = "软件、快捷方式和「应用」里的登记都清掉了。";
            else
                lblDoneSub.Text = "软件都清掉了，账本备份还留在桌面上：" + backupName;

            btnPrimary.Text = "关闭";
            btnPrimary.Kind = AfterSchoolUi.ButtonKind.Primary;
            btnPrimary.Enabled = true;
            btnSecondary.Visible = false;
            SetHint(keep ? "想再装一遍，双击安装包就行，账本会自动接上。" : "想再装一遍，双击安装包就行。", false);
            Application.DoEvents();
        }

        /// <summary>把 app.db 拷到桌面，返回文件名；失败返回 null。</summary>
        string Backup()
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string name = Program.AppName + "-账本备份-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".db";
                File.Copy(db, Path.Combine(desktop, name), true);
                return name;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>脚注兼提示行：平时是灰色说明，出错时变红。</summary>
        void SetHint(string text, bool error)
        {
            lblFoot.Text = text;
            lblFoot.ForeColor = error ? AfterSchoolUi.Theme.Danger : AfterSchoolUi.Theme.InkFaint;
        }

        // ---------- 绘制 ----------

        void HeadPaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            AfterSchoolUi.Theme.Text(g);
            Rectangle r = new Rectangle(0, 0, head.Width, head.Height);
            using (LinearGradientBrush b = new LinearGradientBrush(r,
                Color.FromArgb(238, 242, 250), AfterSchoolUi.Theme.Page, 25f))
                g.FillRectangle(b, r);

            try
            {
                Icon ico = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (ico != null)
                {
                    using (Bitmap bmp = new Bitmap(48, 48))
                    {
                        using (Graphics gb = Graphics.FromImage(bmp))
                        {
                            gb.SmoothingMode = SmoothingMode.HighQuality;
                            gb.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            gb.DrawIcon(ico, new Rectangle(0, 0, 48, 48));
                        }
                        g.DrawImage(bmp, 36, (HeadH - 48) / 2, 48, 48);
                    }
                    ico.Dispose();
                }
            }
            catch { }

            TextRenderer.DrawText(g, "卸载 " + Program.AppName, AfterSchoolUi.Theme.FB(16f),
                new Rectangle(100, 28, 460, 30), AfterSchoolUi.Theme.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

            TextRenderer.DrawText(g, "账本在 app\\data，可以留着下次重装接着用，也可以一起删掉",
                AfterSchoolUi.Theme.F(9f), new Rectangle(100, 58, 560, 20),
                AfterSchoolUi.Theme.InkFaint,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }

        void FootPaint(object sender, PaintEventArgs e)
        {
            using (Pen pen = new Pen(Color.FromArgb(226, 232, 240), 1f))
                e.Graphics.DrawLine(pen, 0, 0, foot.Width, 0);
        }

        void ListPaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            AfterSchoolUi.Theme.Text(g);
            string[] items = new string[]
            {
                "桌面和开始菜单里的快捷方式",
                "「应用」列表里的卸载登记",
                chkKeep != null && chkKeep.Checked
                    ? "安装目录里的程序文件（app\\data 账本留着）"
                    : "整个安装目录，包括 app\\data\\app.db 账本"
            };
            for (int i = 0; i < items.Length; i++)
            {
                int y = i * 24;
                using (SolidBrush b = new SolidBrush(Color.FromArgb(220, 38, 38)))
                    g.FillEllipse(b, 2, y + 8, 7, 7);
                TextRenderer.DrawText(g, items[i], AfterSchoolUi.Theme.F(9.5f),
                    new Rectangle(20, y, 600, 24), AfterSchoolUi.Theme.InkSoft,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }

        void DoneBadgePaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            AfterSchoolUi.Theme.Text(g);
            Rectangle r = new Rectangle(0, 0, 55, 55);
            using (SolidBrush b = new SolidBrush(AfterSchoolUi.Theme.SuccessSoft)) g.FillEllipse(b, r);
            using (Pen pen = new Pen(AfterSchoolUi.Theme.Success, 3.2f))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                g.DrawLines(pen, new Point[] {
                    new Point(16, 28), new Point(24, 37), new Point(40, 18)
                });
            }
        }

        // ---------- 小工具 ----------

        Panel NewPage()
        {
            Panel p = new Panel();
            p.SetBounds(0, 0, W, H - HeadH - FootH);
            p.BackColor = AfterSchoolUi.Theme.Page;
            p.Visible = false;
            return p;
        }

        Label NewLabel(string text, int x, int y, int w, int h, Font font, Color color)
        {
            Label l = new Label();
            l.Text = text;
            l.Font = font;
            l.ForeColor = color;
            l.SetBounds(x, y, w, h);
            l.BackColor = Color.Transparent;
            l.AutoEllipsis = true;
            return l;
        }

        void ShowPage(Panel page)
        {
            pageConfirm.Visible = page == pageConfirm;
            pageWorking.Visible = page == pageWorking;
            pageDone.Visible = page == pageDone;
        }
    }
}
