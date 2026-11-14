// 骨牵引智能交互 · Windows 悬浮窗（跟随实验客户端窗口）
// -----------------------------------------------------------------------------
// 作用：在实验客户端（Unity 独立窗口）右侧叠一个**独立**的置顶窗口，
//       里面加载本机的智能面板页面。它不注入客户端、不改客户端、不读内存。
//
// 与"嵌进客户端窗口内"的区别：视觉上贴在一起，实质是两个窗口。
// 因此不违反"不改原客户端二进制"的约束。
//
// 用法：
//   1. 先跑 server-hook 服务：node server-hook/service.mjs   （127.0.0.1:8788）
//   2. 编译运行本程序
//   3. Ctrl+Alt+A 显示/隐藏；拖动标题栏可移动；右下角可拉伸
//
// 注意：本文件在 macOS 上无法编译验证，需要在 Windows + .NET 8 SDK 上构建。
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace GouQianYinOverlay
{
    internal static class Native
    {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }
    }

    internal class OverlayForm : Form
    {
        private readonly WebView2 web = new WebView2();
        private readonly Timer follow = new Timer { Interval = 800 };
        private bool pinned = true;

        private const string PanelUrl =
            Environment.GetEnvironmentVariable("GQY_PANEL_URL") ?? "http://127.0.0.1:8788/panel.html";

        // 只跟随标题包含这些词的窗口；避免跟到浏览器/桌面
        private static readonly string[] Keywords =
            { "骨牵引", "虚拟仿真", "Mengoo", "MLauncher", "实验" };

        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.SizableToolWindow;
            ShowInTaskbar = false;
            TopMost = true;
            Text = "骨牵引智能交互";
            StartPosition = FormStartPosition.Manual;
            Size = new Size(420, 720);

            web.Dock = DockStyle.Fill;
            Controls.Add(web);

            Load += async (_, __) =>
            {
                await web.EnsureCoreWebView2Async(null);
                web.CoreWebView2.Navigate(PanelUrl);
                PlaceAtRightOfTarget();
            };

            follow.Tick += (_, __) => { if (pinned) PlaceAtRightOfTarget(); };
            follow.Start();

            KeyPreview = true;
            KeyDown += (_, e) =>
            {
                if (e.Control && e.Alt && e.KeyCode == Keys.A)
                {
                    Visible = !Visible;
                    e.Handled = true;
                }
            };
        }

        private static string TitleOf(IntPtr h)
        {
            var sb = new StringBuilder(512);
            Native.GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static bool LooksLikeTarget(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            foreach (var k in Keywords)
                if (title.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        private void PlaceAtRightOfTarget()
        {
            var h = Native.GetForegroundWindow();
            if (h == Handle) return;                       // 前台是自己，别跟
            if (!Native.IsWindowVisible(h)) return;
            if (!LooksLikeTarget(TitleOf(h))) return;      // 不是实验窗口就不动
            if (!Native.GetWindowRect(h, out var r)) return;

            var target = new Rectangle(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
            if (target.Width < 600) return;

            // 贴在实验窗口右侧；空间不够就贴左侧
            int x = target.Right - Width - 16;
            int y = target.Top + 80;
            if (x < target.Left + 100) x = target.Left + 16;

            Location = new Point(x, y);
            Height = Math.Min(720, target.Height - 120);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new OverlayForm());
        }
    }
}
