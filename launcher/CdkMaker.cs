// 激活码生成器：桌面小工具，作者自己用。
//
// 生成的东西必须和 src/lib/license.ts 的 verifyCdk()、scripts/make-cdk.mjs 完全一致：
//   payload = "v1|机器码1[,机器码2]|有效天数(0=永久)|签发日(YYYY-MM-DD)"
//   sig     = RSA-SHA256(payload) 的 base64url（PKCS#1 v1.5，和 node 的 crypto.createSign 一致）
//   cdk     = "AS1." + base64url(payload) + "." + base64url(sig)
//
// 私钥从哪来（优先级）：
//   1. exe 同目录的 cdk-private.pem（想换掉内置那份就放一个在这儿）
//   2. 编译时嵌进来的资源 CdkKey.pem（csc /resource:...）
// 这个 exe 等于「你的签发权」，别发给别人、别传网盘或仓库。
//
// 命令行（给自动化测试用）：
//   激活码生成器.exe --cli <机器码1> [机器码2] [--days N] [--date YYYY-MM-DD] [--out 文件]
//   --cli 模式把码打到标准输出，给了 --out 就同时写文件（winexe 没控制台时靠它取结果）。

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace AfterSchoolCdk
{
    static class Program
    {
        internal const string Brand = "#2563EB";

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length > 0 && string.Equals(args[0], "--cli", StringComparison.OrdinalIgnoreCase))
            {
                Cli.Run(args);
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MakerForm());
        }
    }

    /// <summary>命令行走一遍：验证「这个 exe 签出来的码，服务端认不认」。</summary>
    static class Cli
    {
        public static void Run(string[] args)
        {
            List<string> machines = new List<string>();
            int days = 0;
            string issuedAt = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            string outPath = null;
            for (int i = 1; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--days" && i + 1 < args.Length) { days = Int32.Parse(args[++i], CultureInfo.InvariantCulture); }
                else if (a == "--date" && i + 1 < args.Length) { issuedAt = args[++i]; }
                else if (a == "--out" && i + 1 < args.Length) { outPath = args[++i]; }
                else machines.Add(a);
            }
            string result;
            int exitCode = 0;
            try
            {
                result = Signer.Make(machines, days, issuedAt);
                Console.WriteLine(result);
            }
            catch (Exception ex)
            {
                result = "ERROR: " + ex.Message;
                Console.Error.WriteLine("生成失败：" + ex.Message);
                exitCode = 2;
            }
            if (!string.IsNullOrEmpty(outPath)) File.WriteAllText(outPath, result, new UTF8Encoding(false));
            Environment.ExitCode = exitCode;
        }
    }

    /// <summary>把私钥读出来、签一个码。</summary>
    static class Signer
    {
        public static string Make(List<string> rawMachines, int days, string issuedAt)
        {
            List<string> machines = Normalize(rawMachines);
            if (machines.Count == 0) throw new ArgumentException("至少要有一个机器码（16 位十六进制，例如 9c4e1a7b33d0f215）。");
            if (machines.Count > 2) throw new ArgumentException("一个激活码最多绑两台设备，这次给了 " + machines.Count + " 个。要发给三个人的话，分开签三个码。");
            if (days < 0) throw new ArgumentException("有效天数不能是负数（0 = 永久）。");
            String issued = CheckDate(issuedAt);
            string payload = "v1|" + string.Join(",", machines.ToArray()) + "|" + days.ToString(CultureInfo.InvariantCulture) + "|" + issued;
            byte[] data = Encoding.UTF8.GetBytes(payload);
            RSAParameters par = Pem.ToParameters(LoadPem());
            // 默认的 CSP 是 PROV_RSA_FULL，不认 SHA-256（SignData 会抛「参数不正确」）；
            // 换成 PROV_RSA_AES（24）并且只在内存里放一份，别在系统里留密钥容器。
            CspParameters csp = new CspParameters(24);
            csp.Flags = CspProviderFlags.CreateEphemeralKey;
            using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider(csp))
            {
                rsa.ImportParameters(par);
                byte[] sig = rsa.SignData(data, "SHA256");
                return "AS1." + Convert.ToBase64String(data).Replace("+", "-").Replace("/", "_").Replace("=", "") + "." +
                    Convert.ToBase64String(sig).Replace("+", "-").Replace("/", "_").Replace("=", "");
            }
        }

        public static List<string> Normalize(List<string> raw)
        {
            List<string> outl = new List<string>();
            if (raw == null) return outl;
            for (int i = 0; i < raw.Count; i++)
            {
                string s = (raw[i] ?? "").Trim().ToLowerInvariant();
                if (s.Length == 0) continue;
                if (!IsMachine(s)) throw new ArgumentException("这个不像机器码：" + s + "（要 16 位十六进制，比如 9c4e1a7b33d0f215）");
                if (!outl.Contains(s)) outl.Add(s);
            }
            return outl;
        }

        public static bool IsMachine(string s)
        {
            if (s == null || s.Length != 16) return false;
            for (int i = 0; i < 16; i++)
            {
                char c = s[i];
                bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
                if (!hex) return false;
            }
            return true;
        }

        static string CheckDate(string s)
        {
            DateTime d;
            if (!DateTime.TryParseExact((s ?? "").Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
                throw new ArgumentException("签发日要写成 2026-11-13 这样。");
            return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        static string LoadPem()
        {
            string beside = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "cdk-private.pem");
            if (File.Exists(beside)) return File.ReadAllText(beside);
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream("CdkKey.pem"))
            {
                if (s == null) throw new InvalidOperationException("这个程序里没有带私钥，同目录下也没有 cdk-private.pem。");
                using (StreamReader r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
            }
        }
    }

    /// <summary>PEM(私钥) → RSAParameters。只认 PKCS#8 和 PKCS#1 两种，2048 位。</summary>
    static class Pem
    {
        public static RSAParameters ToParameters(string pem)
        {
            byte[] der = FromPem(pem);
            int p = 0;
            int tag;
            byte[] outer = Der.Read(der, ref p, out tag);       // SEQUENCE
            if (tag != 0x30) throw new InvalidOperationException("私钥不是 DER SEQUENCE（不是个 PEM 私钥？）");
            int q = 0;
            byte[] version = Der.Read(outer, ref q, out tag);    // INTEGER 0
            if (tag != 0x02) throw new InvalidOperationException("私钥开头不是 INTEGER。");
            // PKCS#8：SEQUENCE { INTEGER 0, SEQUENCE alg, OCTET STRING pkcs1 }
            // PKCS#1：SEQUENCE { INTEGER 0, INTEGER n, INTEGER e, ... }  → 第二个元素还是 INTEGER
            int peek = q;
            int nextTag;
            Der.Read(outer, ref peek, out nextTag);
            if (nextTag == 0x30)
            {
                byte[] alg = Der.Read(outer, ref q, out tag);     // SEQUENCE 算法标识
                byte[] oct = Der.Read(outer, ref q, out tag);     // OCTET STRING → PKCS#1
                if (tag != 0x04) throw new InvalidOperationException("PKCS#8 私钥里没找到 OCTET STRING。");
                return FromPkcs1(oct);
            }
            return FromPkcs1(outer);
        }

        static RSAParameters FromPkcs1(byte[] der)
        {
            int p = 0;
            int tag;
            byte[] seq = Der.Read(der, ref p, out tag);
            if (tag != 0x30) throw new InvalidOperationException("PKCS#1 私钥格式不对。");
            int q = 0;
            List<byte[]> ints = new List<byte[]>();
            while (q < seq.Length && ints.Count < 9)
            {
                byte[] v = Der.Read(seq, ref q, out tag);
                if (tag != 0x02) break;
                ints.Add(Der.Trim(v));
            }
            if (ints.Count < 9) throw new InvalidOperationException("私钥里只有 " + ints.Count + " 段，应该是 9 段。");
            RSAParameters par = new RSAParameters();
            // DER 里的 INTEGER 会去掉前导 0（D、P、Q 常见少一两个字节），
            // 但 ImportParameters 要求各段长度和 modulus 对得上，所以这里左补零。
            int modLen = ints[1].Length;
            int half = (modLen + 1) / 2;
            par.Modulus = Pad(ints[1], modLen);
            par.Exponent = ints[2];
            par.D = Pad(ints[3], modLen);
            par.P = Pad(ints[4], half);
            par.Q = Pad(ints[5], half);
            par.DP = Pad(ints[6], half);
            par.DQ = Pad(ints[7], half);
            par.InverseQ = Pad(ints[8], half);
            return par;
        }

        static byte[] Pad(byte[] v, int len)
        {
            if (v.Length == len) return v;
            if (v.Length > len) throw new InvalidOperationException("私钥某一段比该有的长度还长（不是 2048 位的 RSAPrivateKey？）。");
            byte[] o = new byte[len];
            Array.Copy(v, 0, o, len - v.Length, v.Length);
            return o;
        }

        static byte[] FromPem(string pem)
        {
            StringBuilder sb = new StringBuilder();
            string[] lines = (pem ?? "").Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string t = lines[i].Trim();
                if (t.Length == 0) continue;
                if (t.StartsWith("-----")) continue;
                sb.Append(t);
            }
            return Convert.FromBase64String(sb.ToString());
        }
    }

    /// <summary>最小的 DER 读取器：够解析 RSA 私钥就行。</summary>
    static class Der
    {
        public static byte[] Read(byte[] buf, ref int pos, out int tag)
        {
            if (pos + 2 > buf.Length) throw new InvalidOperationException("DER 数据不完整。");
            tag = buf[pos++];
            int len = buf[pos++];
            if ((len & 0x80) != 0)
            {
                int n = len & 0x7F;
                if (n <= 0 || n > 3) throw new InvalidOperationException("DER 长度字段不支持（" + n + " 字节）。");
                len = 0;
                for (int i = 0; i < n; i++) len = (len << 8) | buf[pos++];
            }
            if (pos + len > buf.Length) throw new InvalidOperationException("DER 数据被截断。");
            byte[] v = new byte[len];
            Array.Copy(buf, pos, v, 0, len);
            pos += len;
            return v;
        }

        public static byte[] Trim(byte[] v)
        {
            int i = 0;
            while (i < v.Length - 1 && v[i] == 0) i++;
            byte[] o = new byte[v.Length - i];
            Array.Copy(v, i, o, 0, o.Length);
            return o;
        }
    }

    sealed class MakerForm : Form
    {
        TextBox tb1;
        TextBox tb2;
        TextBox tbDays;
        DateTimePicker dp;
        TextBox tbOut;
        Label lblInfo;
        Button btnCopy;

        public MakerForm()
        {
            Text = "激活码生成器 · 课后服务管理";
            ClientSize = new Size(660, 520);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            Font = UiFont(9F);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        }

        internal static Font UiFont(float size)
        {
            try { return new Font("Microsoft YaHei UI", size); } catch { return new Font(FontFamily.GenericSansSerif, size); }
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            int left = 24;
            int width = 612;

            Panel bar = new Panel();
            bar.Bounds = new Rectangle(0, 0, ClientSize.Width, 56);
            bar.BackColor = ColorTranslator.FromHtml(Program.Brand);
            Controls.Add(bar);
            Label title = new Label();
            title.Text = "激活码生成器";
            title.ForeColor = Color.White;
            title.Font = UiFont(14F);
            title.AutoSize = false;
            title.Bounds = new Rectangle(left, 14, 300, 28);
            bar.Controls.Add(title);
            Label sub = new Label();
            sub.Text = "一个码最多两台电脑 · 0 天 = 永久";
            sub.ForeColor = Color.FromArgb(224, 235, 255);
            sub.AutoSize = false;
            sub.TextAlign = ContentAlignment.MiddleRight;
            sub.Bounds = new Rectangle(ClientSize.Width - 300 - 24, 18, 300, 22);
            bar.Controls.Add(sub);

            int y = 76;

            Label l1 = Hint("机器码 1（16 位十六进制，买家发来的那串）", left, y, width);
            Controls.Add(l1);
            y += 22;
            tb1 = new TextBox();
            tb1.Bounds = new Rectangle(left, y, width, 26);
            tb1.Font = Mono(10.5F);
            tb1.CharacterCasing = CharacterCasing.Lower;
            tb1.MaxLength = 24;
            Controls.Add(tb1);
            y += 40;

            Label l2 = Hint("机器码 2（可留空；两台一起用同一个码）", left, y, width);
            Controls.Add(l2);
            y += 22;
            tb2 = new TextBox();
            tb2.Bounds = new Rectangle(left, y, width, 26);
            tb2.Font = Mono(10.5F);
            tb2.CharacterCasing = CharacterCasing.Lower;
            tb2.MaxLength = 24;
            Controls.Add(tb2);
            y += 40;

            Label l3 = Hint("有效天数", left, y, 60);
            Controls.Add(l3);
            tbDays = new TextBox();
            tbDays.Text = "0";
            tbDays.Bounds = new Rectangle(left + 60, y - 4, 70, 26);
            tbDays.Font = Mono(10.5F);
            tbDays.TextAlign = HorizontalAlignment.Right;
            Controls.Add(tbDays);
            Label l3b = Hint("0 = 永久（买断）；以后做续费就填 365", left + 140, y, 300);
            Controls.Add(l3b);
            y += 34;

            Label l4 = Hint("签发日", left, y, 60);
            Controls.Add(l4);
            dp = new DateTimePicker();
            dp.Format = DateTimePickerFormat.Custom;
            dp.CustomFormat = "yyyy-MM-dd";
            dp.Bounds = new Rectangle(left + 60, y - 4, 130, 26);
            dp.Value = DateTime.Today;
            Controls.Add(dp);
            Label l4b = Hint("按这一天往后算天数", left + 200, y, 260);
            Controls.Add(l4b);
            y += 40;

            Button btnMake = new Button();
            btnMake.Text = "生成激活码";
            btnMake.Font = UiFont(10F);
            btnMake.Bounds = new Rectangle(left, y, 150, 36);
            btnMake.BackColor = ColorTranslator.FromHtml(Program.Brand);
            btnMake.ForeColor = Color.White;
            btnMake.FlatStyle = FlatStyle.Flat;
            btnMake.FlatAppearance.BorderSize = 0;
            btnMake.Click += delegate { DoMake(); };
            Controls.Add(btnMake);

            btnCopy = new Button();
            btnCopy.Text = "复制";
            btnCopy.Bounds = new Rectangle(left + 162, y, 90, 36);
            btnCopy.Enabled = false;
            btnCopy.Click += delegate { DoCopy(); };
            Controls.Add(btnCopy);

            Button btnClear = new Button();
            btnClear.Text = "清空";
            btnClear.Bounds = new Rectangle(left + 264, y, 90, 36);
            btnClear.Click += delegate
            {
                tb1.Text = ""; tb2.Text = ""; tbOut.Text = ""; lblInfo.Text = "填机器码，点「生成激活码」。";
                btnCopy.Enabled = false; tb1.Focus();
            };
            Controls.Add(btnClear);
            y += 48;

            tbOut = new TextBox();
            tbOut.Bounds = new Rectangle(left, y, width, 96);
            tbOut.Multiline = true;
            tbOut.ReadOnly = true;
            tbOut.ScrollBars = ScrollBars.Vertical;
            tbOut.Font = Mono(9.5F);
            tbOut.BackColor = Color.FromArgb(248, 250, 252);
            tbOut.WordWrap = true;
            Controls.Add(tbOut);
            y += 104;

            lblInfo = new Label();
            lblInfo.Bounds = new Rectangle(left, y, width, 40);
            lblInfo.Text = "填机器码，点「生成激活码」。";
            lblInfo.ForeColor = Color.FromArgb(90, 98, 112);
            Controls.Add(lblInfo);
            y += 48;

            Label warn = new Label();
            warn.Bounds = new Rectangle(left, y, width, 34);
            warn.Text = "这个程序里带着签发私钥：等于你的「盖章权」，别发给别人、别传网盘或仓库。";
            warn.ForeColor = Color.FromArgb(154, 52, 18);
            Controls.Add(warn);
        }

        static Label Hint(string text, int x, int y, int w)
        {
            Label l = new Label();
            l.Text = text;
            l.AutoSize = false;
            l.Bounds = new Rectangle(x, y, w, 18);
            l.ForeColor = Color.FromArgb(90, 98, 112);
            return l;
        }

        static Font Mono(float size)
        {
            try { return new Font("Consolas", size); } catch { return new Font(FontFamily.GenericMonospace, size); }
        }

        void DoMake()
        {
            List<string> raw = new List<string>();
            if (tb1.Text.Trim().Length > 0) raw.Add(tb1.Text);
            if (tb2.Text.Trim().Length > 0) raw.Add(tb2.Text);
            int days = 0;
            string daysText = tbDays.Text.Trim();
            if (daysText.Length > 0 && !Int32.TryParse(daysText, NumberStyles.Integer, CultureInfo.InvariantCulture, out days) || days < 0)
            {
                MessageBox.Show(this, "有效天数要填 0 或正整数（0 = 永久）。", "天数不对", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try
            {
                string issued = dp.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                string code = Signer.Make(raw, days, issued);
                List<string> machines = Signer.Normalize(raw);
                tbOut.Text = code;
                btnCopy.Enabled = true;
                string life = days > 0
                    ? days.ToString(CultureInfo.InvariantCulture) + " 天（自 " + issued + " 起）"
                    : "永久（买断）";
                lblInfo.Text = "绑定设备：" + machines.Count + " 台 · 有效期：" + life + " · 签发日：" + issued;
                lblInfo.ForeColor = Color.FromArgb(21, 128, 61);
            }
            catch (Exception ex)
            {
                tbOut.Text = "";
                btnCopy.Enabled = false;
                lblInfo.Text = ex.Message;
                lblInfo.ForeColor = Color.FromArgb(185, 28, 28);
            }
        }

        void DoCopy()
        {
            if (tbOut.Text.Length == 0) return;
            try
            {
                Clipboard.SetText(tbOut.Text);
                lblInfo.Text = "已复制。整行发过去就行，别加空格和换行。";
                lblInfo.ForeColor = Color.FromArgb(21, 128, 61);
            }
            catch (Exception ex)
            {
                lblInfo.Text = "复制失败：" + ex.Message;
                lblInfo.ForeColor = Color.FromArgb(185, 28, 28);
            }
        }
    }
}
