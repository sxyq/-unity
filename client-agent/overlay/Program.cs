// 骨牵引智能交互 · Windows 悬浮窗（贴在实验客户端窗口旁边）
// -----------------------------------------------------------------------------
// 作用：在 Unity 实验窗口**旁边**放一个独立的置顶窗口，里面加载本机的智能面板。
//       它不注入客户端、不改客户端、不读内存，视觉上贴在一起，实质是两个窗口。
//
// 前置：
//   1. node apps/model-gateway/server.mjs      （127.0.0.1:8787，面板与模型）
//   2. node client-agent/agent.mjs             （127.0.0.1:8790，客户端状态）
//   3. 启动本程序（GQY_PANEL_URL 可覆盖面板地址）
//
// 快捷键：
//   Ctrl+Alt+A  显示 / 隐藏
//   Ctrl+Alt+T  鼠标穿透（面板挡住 3D 场景时用，穿透后点击直接落到 Unity）
//   Ctrl+Alt+P  固定 / 取消跟随实验窗口
//
// 构建：dotnet build client-agent/overlay/Overlay.csproj -c Release
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Forms = System.Windows.Forms;

namespace GouQianYinOverlay
{
    internal static class Native
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
        [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int idx, int val);

        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TRANSPARENT = 0x20;
        public const int WS_EX_LAYERED = 0x80000;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        public static string TitleOf(IntPtr h)
        {
            int n = GetWindowTextLength(h);
            if (n <= 0) return string.Empty;
            var sb = new StringBuilder(n + 1);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }
    }

    internal class OverlayForm : Forms.Form
    {
        private readonly WebView2 web = new WebView2();
        // 注意：必须写全 System.Windows.Forms.Timer。
        // ImplicitUsings 会引入 System.Threading，直接写 Timer 会与 Threading.Timer 冲突（CS0104）。
        private readonly Forms.Timer follow = new Forms.Timer { Interval = 900 };
        private readonly Forms.Timer retry = new Forms.Timer { Interval = 3000 };

        private bool pinned = true;
        private bool clickThrough = false;
        private int retries = 0;
        private IntPtr target = IntPtr.Zero;

        private const string DefaultPanelUrl = "http://127.0.0.1:8787/demo/panel.html";

        private static readonly string[] Keywords =
            { "骨牵引", "虚拟仿真", "Mengoo", "MLauncher", "牵引" };

        public OverlayForm()
        {
            Text = "骨牵引智能交互 · 外部组件";
            FormBorderStyle = Forms.FormBorderStyle.SizableToolWindow;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = Forms.FormStartPosition.Manual;
            MinimumSize = new Size(320, 420);
            Size = new Size(420, 720);
            BackColor = Color.FromArgb(238, 242, 247);

            web.Dock = Forms.DockStyle.Fill;
            Controls.Add(web);

            Load += OnLoaded;
            FormClosing += (_, __) => { follow.Stop(); retry.Stop(); };

            follow.Tick += (_, __) => { if (pinned) FollowTarget(); };
            retry.Tick += (_, __) => { retry.Stop(); if (retries-- > 0) LoadPanel(); };

            KeyPreview = true;
            KeyDown += OnKeyDown;
        }

        private async void OnLoaded(object sender, EventArgs e)
        {
            try
            {
                // 用户数据放 LocalAppData，避免程序目录不可写
                var dataDir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "GouQianYinOverlay", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir, null);
                await web.EnsureCoreWebView2Async(env);
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.NavigationCompleted += (_, args) =>
                {
                    if (args.IsSuccess) { retries = 0; return; }
                    if (retries-- > 0) retry.Start();
                };
            }
            catch (Exception ex)
            {
                Forms.MessageBox.Show(
                    "WebView2 初始化失败：" + ex.Message +
                    "\n\n请先安装 Microsoft Edge WebView2 Runtime。",
                    "骨牵引智能交互", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Warning);
                return;
            }

            LoadPanel();
            FollowTarget();
            follow.Start();
        }

        private void LoadPanel()
        {
            var url = Environment.GetEnvironmentVariable("GQY_PANEL_URL");
            if (string.IsNullOrWhiteSpace(url)) url = DefaultPanelUrl;
            try { web.CoreWebView2.Navigate(url); } catch { /* 环境未就绪 */ }
        }

        private void OnKeyDown(object sender, Forms.KeyEventArgs e)
        {
            if (!e.Control || !e.Alt) return;
            if (e.KeyCode == Forms.Keys.A)
            {
                Visible = !Visible;
                if (Visible) FollowTarget();
                e.Handled = true;
            }
            else if (e.KeyCode == Forms.Keys.T)
            {
                SetClickThrough(!clickThrough);
                e.Handled = true;
            }
            else if (e.KeyCode == Forms.Keys.P)
            {
                pinned = !pinned;
                Text = "骨牵引智能交互 · " + (pinned ? "跟随实验窗口" : "位置已固定");
                e.Handled = true;
            }
        }

        private void SetClickThrough(bool on)
        {
            clickThrough = on;
            int ex = Native.GetWindowLong(Handle, Native.GWL_EXSTYLE);
            if (on) ex |= Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED;
            else ex &= ~Native.WS_EX_TRANSPARENT;
            Native.SetWindowLong(Handle, Native.GWL_EXSTYLE, ex);
            Text = "骨牵引智能交互 · " + (on ? "鼠标穿透中（Ctrl+Alt+T 取消）" : "可交互");
        }

        private static bool LooksLikeTarget(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            foreach (var k in Keywords)
                if (title.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        /// <summary>找出面积最大的、标题像实验的可见窗口（不再只认前台窗口）</summary>
        private IntPtr FindTarget()
        {
            IntPtr best = IntPtr.Zero;
            long bestArea = 0;
            IntPtr self = Handle;

            Native.EnumWindows((h, _) =>
            {
                if (h == self) return true;
                if (!Native.IsWindowVisible(h)) return true;
                if (Native.IsIconic(h)) return true;

                var title = Native.TitleOf(h);
                if (!LooksLikeTarget(title)) return true;

                Native.RECT r;
                if (!Native.GetWindowRect(h, out r)) return true;
                long w = r.Right - r.Left, hh = r.Bottom - r.Top;
                if (w < 640 || hh < 420) return true;          // 排除小提示框

                var area = w * hh;
                if (area > bestArea) { bestArea = area; best = h; }
                return true;
            }, IntPtr.Zero);

            return best;
        }

        private void FollowTarget()
        {
            if (!Visible) return;

            var h = FindTarget();
            if (h == IntPtr.Zero)
            {
                if (target == IntPtr.Zero && Screen.PrimaryScreen != null)
                {
                    var wa0 = Screen.PrimaryScreen.WorkingArea;
                    Location = new Point(wa0.Right - Width - 32, wa0.Top + 80);
                }
                return;
            }
            target = h;

            Native.RECT r;
            if (!Native.GetWindowRect(h, out r)) return;

            var targetRect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
            var screen = Screen.FromRectangle(targetRect).WorkingArea;

            const int gap = 12;
            int x = targetRect.Right + gap;                 // 优先贴右侧外面
            if (x + Width > screen.Right) x = targetRect.Left - gap - Width;  // 再试左侧外面

            bool outside = x >= screen.Left && x + Width <= screen.Right;
            if (!outside)
            {
                // 屏幕放不下（实验全屏）→ 贴屏幕右缘，允许覆盖，可用 Ctrl+Alt+T 穿透
                x = Math.Max(screen.Left + 4, screen.Right - Width - 8);
            }

            int h2 = Math.Min(760, Math.Max(420, targetRect.Height - 96));
            int y = Math.Max(screen.Top + 8, Math.Min(targetRect.Top + 48, screen.Bottom - h2 - 8));

            if (Location.X != x || Location.Y != y) Location = new Point(x, y);
            if (Height != h2) Height = h2;

            Text = "骨牵引智能交互 · " + (pinned ? "跟随实验窗口" : "位置已固定")
                 + (outside ? "" : " · 已覆盖场景，Ctrl+Alt+T 穿透");
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Forms.Application.EnableVisualStyles();
            Forms.Application.SetCompatibleTextRenderingDefault(false);
            Forms.Application.Run(new OverlayForm());
        }
    }
}
