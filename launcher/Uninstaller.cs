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
    /// 用法：卸载.exe          向导
    ///       卸载.exe --silent 不问，全删（自动测试与 QuietUninstallString 用）
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
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] == null ? "" : args[i];
                if (a.Equals("--silent", StringComparison.OrdinalIgnoreCase) || a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            }

            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (silent)
            {
                Environment.ExitCode = DoUninstall(dir, null) == null ? 0 : 1;
                return;
            }

            using (UninstallForm f = new UninstallForm(dir))
            {
                Application.Run(f);
                Environment.ExitCode = f.Removed ? 0 : 1;
            }
        }

        /// <summary>真的卸载。返回 null = 卸完了，否则是给人看的失败原因。</summary>
        internal static string DoUninstall(string dir, Action<string> stage)
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
            Step(stage, "正在删文件，这一步最慢…");
            KillUnder(Path.Combine(dir, "app"), "node");
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
        AfterSchoolUi.CheckBoxEx chkBackup;
        Panel pageConfirm, pageWorking, pageDone;
        string backupName;
        bool busy, removed;

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

            Label t = NewLabel("要卸载了", 36, 24, 520, 40, AfterSchoolUi.Theme.FB(21f), AfterSchoolUi.Theme.Ink);
            pageConfirm.Controls.Add(t);

            lblDesc = NewLabel("会把这个文件夹整个删掉，里面装的是软件本体和账本数据。",
                36, 70, 640, 24, AfterSchoolUi.Theme.F(10f), AfterSchoolUi.Theme.InkSoft);
            pageConfirm.Controls.Add(lblDesc);

            AfterSchoolUi.CardPanel card = new AfterSchoolUi.CardPanel();
            card.SetBounds(36, 100, 648, 66);
            pageConfirm.Controls.Add(card);

            Label cap = new Label();
            cap.Text = "安装位置";
            cap.Font = AfterSchoolUi.Theme.F(9f);
            cap.ForeColor = AfterSchoolUi.Theme.InkFaint;
            cap.SetBounds(20, 10, 200, 20);
            card.Controls.Add(cap);

            lblPath = new Label();
            lblPath.AutoEllipsis = true;
            lblPath.Text = dir;
            lblPath.Font = AfterSchoolUi.Theme.F(10.5f);
            lblPath.ForeColor = AfterSchoolUi.Theme.Ink;
            lblPath.SetBounds(20, 32, 600, 26);
            card.Controls.Add(lblPath);

            Panel list = new Panel();
            list.SetBounds(36, 168, 648, 74);
            list.BackColor = AfterSchoolUi.Theme.Page;
            list.Paint += ListPaint;
            pageConfirm.Controls.Add(list);

            if (hasData)
            {
                chkBackup = new AfterSchoolUi.CheckBoxEx();
                chkBackup.Text = "先把账本备份到桌面（学生、课时、反馈都在 app\\data\\app.db 里）";
                chkBackup.SetBounds(36, 248, 648, 26);
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

        void OnPrimary()
        {
            if (busy) return;
            if (removed) { Close(); return; }
            Start();
        }

        void Start()
        {
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

            SetHint("卸载后这个文件夹就空了，可以直接删掉。", false);
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
            });

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
            busy = false;
            bar.IsMarquee = false;
            bar.Value = 100;
            ShowPage(pageDone);

            lblDoneSub.Text = backupName == null
                ? "软件、快捷方式和「应用」里的登记都清掉了。"
                : "软件都清掉了，账本备份还留在桌面上：" + backupName;

            btnPrimary.Text = "关闭";
            btnPrimary.Kind = AfterSchoolUi.ButtonKind.Primary;
            btnPrimary.Enabled = true;
            btnSecondary.Visible = false;
            SetHint("想再装一遍，双击安装包就行。", false);
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

            TextRenderer.DrawText(g, "学生的课时账会在卸载时删掉，先备份好再动手",
                AfterSchoolUi.Theme.F(9f), new Rectangle(100, 58, 520, 20),
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
                "整个安装目录，包括 app\\data\\app.db 账本"
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
