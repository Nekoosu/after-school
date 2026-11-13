using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AfterSchoolUi
{
    /// <summary>
    /// 安装器 / 卸载器共用的一套小 UI 基座（C# 5、.NET 4.0，只用 GDI+ 自绘）。
    ///
    /// 为什么不用 Inno Setup / NSIS：那要换整套打包链（编译脚本、卸载逻辑、自动测试都得重来）。
    /// 这里保持「复制目录 + 自写安装器」的骨架，只把外观换成现代一点的样子。
    /// 设计语言参考 Inno Setup 6 的 modern wizard、Fluent / Win11 安装向导：
    /// 圆角窗口、品牌色块、卡片、大号主按钮、进度平滑。
    ///
    /// 所有尺寸按 96 DPI 设计；窗体 AutoScaleMode = Dpi，系统缩放时整窗等比放大。
    /// </summary>
    public enum ButtonKind { Primary, Ghost, Danger, DangerGhost }

    public static class Theme
    {
        public static readonly Color Brand = Color.FromArgb(37, 99, 235);
        public static readonly Color BrandHover = Color.FromArgb(59, 130, 246);
        public static readonly Color BrandDown = Color.FromArgb(29, 78, 216);
        public static readonly Color BrandSoft = Color.FromArgb(239, 246, 255);
        public static readonly Color Page = Color.FromArgb(246, 248, 252);
        public static readonly Color Card = Color.White;
        public static readonly Color CardLine = Color.FromArgb(226, 232, 240);
        public static readonly Color Ink = Color.FromArgb(15, 23, 42);
        public static readonly Color InkSoft = Color.FromArgb(71, 85, 105);
        public static readonly Color InkFaint = Color.FromArgb(148, 163, 184);
        public static readonly Color Danger = Color.FromArgb(220, 38, 38);
        public static readonly Color DangerHover = Color.FromArgb(239, 68, 68);
        public static readonly Color DangerDown = Color.FromArgb(185, 28, 28);
        public static readonly Color DangerSoft = Color.FromArgb(254, 242, 242);
        public static readonly Color Success = Color.FromArgb(22, 163, 74);
        public static readonly Color SuccessSoft = Color.FromArgb(240, 253, 244);
        public static readonly Color Warn = Color.FromArgb(180, 83, 9);
        public static readonly Color WarnSoft = Color.FromArgb(255, 247, 237);

        public static Font F(float size) { return new Font("Microsoft YaHei UI", size); }
        public static Font FB(float size) { return new Font("Microsoft YaHei UI", size, FontStyle.Bold); }

        /// <summary>圆角矩形路径（半径超过一半时自动收成胶囊/圆）。</summary>
        public static GraphicsPath RoundPath(Rectangle r, int radius)
        {
            GraphicsPath p = new GraphicsPath();
            int d = radius * 2;
            if (d > r.Width) d = r.Width;
            if (d > r.Height) d = r.Height;
            if (d <= 0)
            {
                p.AddRectangle(r);
                return p;
            }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void FillRound(Graphics g, Rectangle r, int radius, Color c)
        {
            using (GraphicsPath p = RoundPath(r, radius))
            using (SolidBrush b = new SolidBrush(c))
                g.FillPath(b, p);
        }

        public static void DrawRound(Graphics g, Rectangle r, int radius, Color c, float w)
        {
            using (GraphicsPath p = RoundPath(r, radius))
            using (Pen pen = new Pen(c, w))
                g.DrawPath(pen, p);
        }

        /// <summary>把 GDI+ 画在透明底上时用的文字设置，去掉 ClearType 的彩色毛边。</summary>
        public static void Text(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        }

        /// <summary>UserPaint 控件不会自动画父背景，圆角外的四角要靠它填平。</summary>
        public static void FillParent(Graphics g, Control c)
        {
            Control p = c.Parent;
            while (p != null && p.BackColor.A != 255) p = p.Parent;
            Color bg = p != null ? p.BackColor : Page;
            using (SolidBrush b = new SolidBrush(bg)) g.FillRectangle(b, c.ClientRectangle);
        }
    }

    /// <summary>圆角按钮：Primary（主操作）/ Ghost（次操作）/ Danger（危险操作）。</summary>
    public sealed class RoundedButton : Control, IButtonControl
    {
        ButtonKind kind = ButtonKind.Primary;
        bool hover, down;

        public RoundedButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor | ControlStyles.Selectable, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
            Font = Theme.FB(10f);
            Height = 40;
            Width = 132;
            TabStop = true;
        }

        public DialogResult DialogResult { get; set; }

        public void NotifyDefault(bool value) { }

        public void PerformClick()
        {
            if (Enabled) OnClick(EventArgs.Empty);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space)
            {
                PerformClick();
                e.Handled = true;
            }
            base.OnKeyDown(e);
        }

        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        // 自绘控件不会因为 Text 变了就重画：装在「开始安装 → 覆盖安装」「取消 → 关闭」
        // 这种运行期改文案的地方，少了这一句按钮上就一直是旧字。
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }

        public ButtonKind Kind
        {
            get { return kind; }
            set { kind = value; Invalidate(); }
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Text(g);
            Theme.FillParent(g, this);
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            Color fill, line, ink;

            if (!Enabled)
            {
                fill = Color.FromArgb(229, 231, 235);
                line = Color.Transparent;
                ink = Theme.InkFaint;
            }
            else if (kind == ButtonKind.Primary)
            {
                fill = down ? Theme.BrandDown : (hover ? Theme.BrandHover : Theme.Brand);
                line = Color.Transparent;
                ink = Color.White;
            }
            else if (kind == ButtonKind.Danger)
            {
                fill = down ? Theme.DangerDown : (hover ? Theme.DangerHover : Theme.Danger);
                line = Color.Transparent;
                ink = Color.White;
            }
            else if (kind == ButtonKind.DangerGhost)
            {
                fill = hover ? Theme.DangerSoft : Theme.Card;
                line = Theme.Danger;
                ink = Theme.Danger;
            }
            else
            {
                fill = hover ? Theme.BrandSoft : Theme.Card;
                line = Theme.CardLine;
                ink = Theme.InkSoft;
            }

            Theme.FillRound(g, r, 8, fill);
            if (line != Color.Transparent) Theme.DrawRound(g, r, 8, line, 1f);

            TextRenderer.DrawText(g, Text, Font, r, ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

            if (Focused && Enabled)
            {
                using (GraphicsPath p = Theme.RoundPath(new Rectangle(r.X + 2, r.Y + 2, r.Width - 4, r.Height - 4), 6))
                using (Pen pen = new Pen(Color.FromArgb(120, Color.White), 1f))
                    g.DrawPath(pen, p);
            }
        }
    }

    /// <summary>圆角进度条：Value 平滑追赶目标值；Marquee 模式下胶囊从左到右往返。</summary>
    public sealed class ProgressBarEx : Control
    {
        int target, shown;          // 千分比
        int marqueePos;
        bool marquee;
        readonly Timer timer;

        public ProgressBarEx()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Height = 10;
            timer = new Timer();
            timer.Interval = 16;
            timer.Tick += delegate { Tick(); };
            timer.Start();
        }

        public bool IsMarquee { get { return marquee; } set { marquee = value; Invalidate(); } }

        /// <summary>0-100。</summary>
        public int Value
        {
            get { return target / 10; }
            set
            {
                target = Math.Max(0, Math.Min(1000, value * 10));
                if (!timer.Enabled) timer.Start();
            }
        }

        void Tick()
        {
            bool moving = false;
            if (marquee)
            {
                marqueePos += 12;
                if (marqueePos > 1200) marqueePos = 0;
                moving = true;
            }
            if (shown != target)
            {
                int diff = target - shown;
                int step = Math.Abs(diff) / 8;
                if (step < 8) step = 8;
                shown += diff > 0 ? Math.Min(diff, step) : -Math.Min(-diff, step);
                moving = true;
            }
            if (moving) Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Text(g);
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            int radius = Height / 2;
            Theme.FillRound(g, r, radius, Color.FromArgb(226, 232, 240));

            if (marquee)
            {
                int w = Width / 3;
                int x = (marqueePos % 1200) * Width / 1200 - w / 2;
                x = Math.Max(0, Math.Min(Width - w, x));
                Theme.FillRound(g, new Rectangle(x, 0, w, Height - 1), radius, Theme.Brand);
            }
            else if (shown > 0)
            {
                int w = (Width - 1) * shown / 1000;
                if (w < 2) w = 2;
                Rectangle f = new Rectangle(0, 0, w, Height - 1);
                using (LinearGradientBrush b = new LinearGradientBrush(
                    new Rectangle(0, 0, Math.Max(Width, 2), Math.Max(Height, 2)),
                    Theme.Brand, Color.FromArgb(96, 165, 250), LinearGradientMode.Horizontal))
                {
                    using (GraphicsPath p = Theme.RoundPath(f, radius))
                        g.FillPath(b, p);
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) timer.Dispose();
            base.Dispose(disposing);
        }
    }

    /// <summary>白底圆角卡片。</summary>
    public sealed class CardPanel : Panel
    {
        public int Radius = 12;

        public CardPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Text(g);
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            Theme.FillRound(g, r, Radius, Theme.Card);
            Theme.DrawRound(g, r, Radius, Theme.CardLine, 1f);
        }
    }

    /// <summary>自绘勾选框（圆角方块 + 对勾）。</summary>
    public sealed class CheckBoxEx : Control
    {
        bool isChecked;

        public bool Checked
        {
            get { return isChecked; }
            set { if (isChecked != value) { isChecked = value; Invalidate(); } }
        }

        public CheckBoxEx()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor | ControlStyles.Selectable, true);
            BackColor = Color.Transparent;
            Font = Theme.F(9.5f);
            ForeColor = Theme.Ink;
            Height = 26;
            Cursor = Cursors.Hand;
            TabStop = true;
        }

        protected override void OnClick(EventArgs e)
        {
            if (Enabled) Checked = !Checked;
            base.OnClick(e);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space) { Checked = !Checked; e.Handled = true; }
            base.OnKeyDown(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Text(g);
            Theme.FillParent(g, this);
            Rectangle box = new Rectangle(1, (Height - 22) / 2, 22, 22);
            Color border = Checked ? Theme.Brand : Color.FromArgb(148, 163, 184);
            Theme.FillRound(g, box, 6, Checked ? Theme.Brand : Theme.Card);
            Theme.DrawRound(g, box, 6, border, 1.6f);
            if (Checked)
            {
                using (Pen pen = new Pen(Color.White, 2.4f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawLines(pen, new Point[] {
                        new Point(box.X + 5, box.Y + 11),
                        new Point(box.X + 9, box.Y + 15),
                        new Point(box.X + 17, box.Y + 6)
                    });
                }
            }
            Rectangle tr = new Rectangle(32, 0, Width - 32, Height);
            TextRenderer.DrawText(g, Text, Font, tr, ForeColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }

    /// <summary>右上角关闭按钮（自绘 ✕，悬停变红）。</summary>
    public sealed class CloseButton : Control
    {
        bool hover;

        public CloseButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer, true);
            Size = new Size(38, 30);
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Text(g);
            if (hover) Theme.FillRound(g, new Rectangle(0, 0, Width - 1, Height - 1), 8, Color.FromArgb(239, 68, 68));
            Color ink = hover ? Color.White : Theme.InkFaint;
            using (Pen pen = new Pen(ink, 1.8f))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                int cx = Width / 2, cy = Height / 2, d = 6;
                g.DrawLine(pen, cx - d, cy - d, cx + d, cy + d);
                g.DrawLine(pen, cx - d, cy + d, cx + d, cy - d);
            }
        }
    }

    /// <summary>DPI 感知：让字体在 125% / 150% 缩放下不发虚（不调的话系统会位图拉伸）。</summary>
    public static class Dpi
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        public static void Init()
        {
            try { SetProcessDPIAware(); }
            catch { }
        }
    }

    /// <summary>无边框圆角窗口基座：拖动、关闭按钮、阴影、描边。</summary>
    public class ModernForm : Form
    {
        [DllImport("user32.dll")]
        static extern bool ReleaseCapture();
        [DllImport("user32.dll")]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

        protected CloseButton close;

        public ModernForm()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint, true);
            DoubleBuffered = true;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Page;
            Font = Theme.F(9f);
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96f, 96f);
            MaximizeBox = false;
            MinimizeBox = false;

            close = new CloseButton();
            close.Location = new Point(Width - 46, 10);
            close.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            close.Click += delegate { Close(); };
            Controls.Add(close);
        }

        /// <summary>系统缩放下把窗口圆角描边重画一遍。</summary>
        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            using (GraphicsPath p = Theme.RoundPath(new Rectangle(0, 0, Width, Height), 14))
                Region = new Region(p);
            if (close != null) close.Location = new Point(Width - close.Width - 8, 10);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            using (SolidBrush b = new SolidBrush(Theme.Page)) g.FillRectangle(b, ClientRectangle);
            base.OnPaint(e);
            Theme.Text(g);
            Theme.DrawRound(g, new Rectangle(0, 0, Width - 1, Height - 1), 14,
                Color.FromArgb(214, 222, 234), 1f);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
                return cp;
            }
        }

        /// <summary>把某个区域变成可拖动窗口的「标题栏」。</summary>
        protected void EnableDrag(Control c)
        {
            c.MouseDown += delegate(object s, MouseEventArgs e)
            {
                if (e.Button != MouseButtons.Left) return;
                ReleaseCapture();
                SendMessage(Handle, 0xA1, 0x2, 0);
            };
        }
    }
}
