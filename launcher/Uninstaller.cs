using System;
using System.Diagnostics;
using System.Drawing;
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
    /// 账本数据在 app\data\app.db，删目录就一起没了，所以有数据时会先问一句要不要备份到桌面。
    /// 用法：卸载.exe          向导
    ///       卸载.exe --silent 不问，全删（自动测试与 QuietUninstallString 用）
    /// </summary>
    static class Program
    {
        const string AppName = "课后服务管理";
        const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AfterSchool";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] == null ? "" : args[i];
                if (a.Equals("--silent", StringComparison.OrdinalIgnoreCase) || a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            }

            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (silent)
            {
                Environment.ExitCode = DoUninstall(dir, false) ? 0 : 1;
                return;
            }

            if (!Confirm(dir)) return;
            Environment.ExitCode = DoUninstall(dir, true) ? 0 : 1;
        }

        /// <summary>向导：先问要不要备份账本，再问一句确定。返回 false = 用户取消。</summary>
        static bool Confirm(string dir)
        {
            string db = Path.Combine(dir, "app", "data", "app.db");
            if (File.Exists(db) && new FileInfo(db).Length > 30000)
            {
                DialogResult r = MessageBox.Show(
                    "这个目录里有账本数据（学生、课时、反馈都在 app\\data\\app.db 里）。\r\n\r\n" +
                    "卸载会把它们一起删掉。要不要先在桌面存一份备份？\r\n\r\n" +
                    "「是」= 先备份再卸载    「否」= 直接卸载    「取消」= 什么都不做",
                    "卸载 " + AppName, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
                if (r == DialogResult.Cancel) return false;
                if (r == DialogResult.Yes) Backup(db);
            }

            DialogResult ok = MessageBox.Show(
                "确定卸载 " + AppName + " 吗？\r\n\r\n" +
                "会删掉：" + dir + "\r\n" +
                "还会删掉桌面和开始菜单的快捷方式。",
                "卸载 " + AppName, MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            return ok == DialogResult.OK;
        }

        static void Backup(string db)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string name = "课后服务管理-账本备份-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".db";
                File.Copy(db, Path.Combine(desktop, name), true);
                MessageBox.Show("备份好了，在桌面上：" + name, "先备份再卸载", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception e)
            {
                MessageBox.Show("备份没成功：" + e.Message + "\r\n\r\n卸载会继续，刚才那份数据就没了。", "备份失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        /// <summary>真的卸载。返回 false = 没卸干净（比如软件还开着）。</summary>
        static bool DoUninstall(string dir, bool showResult)
        {
            string exe = Path.Combine(dir, "AfterSchool.exe");

            // 1) 让它退出（正常关窗会顺手 checkpoint + 备份）
            //    只在真的有一份在跑时才发 --quit：没有进程时起一个 --quit 会白开一个窗口。
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
            {
                if (showResult) MessageBox.Show("软件还开着，先关掉它（托盘图标右键 → 退出）再卸载。", "卸载没做", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }

            // 2) 快捷方式
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"));
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            TryDelete(Path.Combine(programs, AppName + ".lnk"));
            TryDelete(Path.Combine(programs, AppName + " 使用说明.lnk"));

            // 3) 「应用」里的登记
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstKey, false); }
            catch { }

            // 4) 目录：先杀掉可能残留的 node.exe（只杀 app 目录下的），再交给 cmd 延时删
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
                if (showResult) MessageBox.Show("目录删不掉：" + e.Message + "\r\n\r\n可以直接把这个文件夹拖进回收站：" + dir, "卸载没做完", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }

            if (showResult) MessageBox.Show("卸载完了。\r\n\r\n如果刚才选了备份，账本还留在桌面上。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return true;
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
}
