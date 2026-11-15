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
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int idx, int val);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOACTIVATE = 0x0010;

        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TRANSPARENT = 0x20;
        public const int WS_EX_NOACTIVATE = 0x08000000;
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
        private SubtitleForm subtitle;

        /* 三态尺寸：Ctrl+Alt+M 循环切换。
           展开 420x820 / 窄条 360x104 / 小球 78x78 —— 窗口真的变小，不是只藏内容。 */
        private static readonly Size[] FORMS = { new Size(420, 820), new Size(360, 104), new Size(78, 78) };
        private static readonly string[] FORM_NAMES = { "展开", "窄条", "小球" };
        private int formIndex = 0;
        private readonly Forms.Timer formTimer = new Forms.Timer { Interval = 600 };
        private string formMode = "panel";

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
            FormClosing += (_, __) => { follow.Stop(); retry.Stop(); formTimer.Stop(); subtitle?.Close(); };

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

            formTimer.Tick += async (_, __) =>
            {
                try
                {
                    if (web.CoreWebView2 == null) return;
                    var raw = await web.CoreWebView2.ExecuteScriptAsync("window.__BT_FORM||'panel'");
                    var m = (raw ?? "").Trim('"');
                    if (m != formMode && (m == "panel" || m == "mini" || m == "launcher"))
                    {
                        formMode = m;
                        ApplyMode(m);
                    }
                }
                catch { }
            };
            formTimer.Start();

            // 字幕条（SubtitleForm 自己轮询 /state 并跟随窗口）
            subtitle = new SubtitleForm();
            subtitle.Show();
        }

        private void LoadPanel()
        {
            var url = Environment.GetEnvironmentVariable("GQY_PANEL_URL");
            if (string.IsNullOrWhiteSpace(url)) url = DefaultPanelUrl;
            try { web.CoreWebView2.Navigate(url); } catch { /* 环境未就绪 */ }
        }

        private void ApplyMode(string m)
        {
            Size f;
            if (m == "launcher") f = new Size(78, 78);
            else if (m == "mini") f = new Size(360, 104);
            else f = FORMS[0];
            if (MinimumSize.Width > f.Width || MinimumSize.Height > f.Height)
                MinimumSize = new Size(60, 60);
            Size = f;
            FollowTarget();
        }

        private void ApplyForm()
        {
            var f = FORMS[formIndex];
            if (MinimumSize.Width > f.Width || MinimumSize.Height > f.Height)
                MinimumSize = new Size(60, 60);
            Size = f;
            FollowTarget();
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
            else if (e.KeyCode == Forms.Keys.M)
            {
                formIndex = (formIndex + 1) % FORMS.Length;
                ApplyForm();
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

        /// <summary>实验客户端的进程名（真实客户端窗口标题是 HLF10631030，不含任何中文关键词）</summary>
        private static readonly string[] ProcessNames = { "HLF10631030", "MCLocalLauncher" };

        /// <summary>按进程名找实验窗口；找不到就返回 0（此时面板应当隐藏，不做独立悬浮窗）</summary>
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

                uint pid;
                Native.GetWindowThreadProcessId(h, out pid);
                string pname = string.Empty;
                try { pname = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
                bool byProc = false;
                foreach (var pn in ProcessNames)
                    if (string.Equals(pname, pn, StringComparison.OrdinalIgnoreCase)) { byProc = true; break; }
                // 只认实验本体进程：按标题关键词找会把「骨牵引…」的浏览器页也当成实验
                if (!byProc) return true;

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
            var h = FindTarget();
            if (h == IntPtr.Zero)
            {
                /* 没有实验窗口就不应该存在：隐藏自己，等实验启动后再出现。
                   以前的实现会退到屏幕右缘当独立悬浮窗，那是“单独的存在”。 */
                target = IntPtr.Zero;
                if (Visible) Visible = false;
                return;
            }
            if (!Visible) Visible = true;
            target = h;

            Native.RECT r;
            if (!Native.GetWindowRect(h, out r)) return;

            var targetRect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);

            /* 实验已窗口化：优先贴在窗口**外侧右边**，完全不遮挡实验 UI；
               屏幕放不下时才回退到窗口内部右下角。 */
            const int inset = 16;
            var screen = Screen.FromRectangle(targetRect).WorkingArea;
            int w = Math.Min(Width, 480);
            int h2 = Math.Min(820, Math.Max(420, targetRect.Height));
            int x = targetRect.Right + inset;
            int y = targetRect.Top;
            if (x + w > screen.Right)
            {
                // 右边放不下 → 贴窗口内部右下（此时才可能遮挡，用 Ctrl+Alt+T 穿透）
                x = targetRect.Right - w - inset;
                y = targetRect.Bottom - h2 - inset;
            }

            if (Size.Width != w) Width = w;
            if (Height != h2) Height = h2;
            if (Location.X != x || Location.Y != y) Location = new Point(x, y);

            /* Unity 会在获得焦点时把自己重新置顶，把面板压到后面。
               每次跟随都把自己重新压回最上层，保证面板始终可见。 */
            Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);

            Text = "骨牵引智能交互 · 绑定实验窗口"
                 + (pinned ? "" : " · 位置已固定");
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Forms.Application.EnableVisualStyles();
            Forms.Application.SetCompatibleTextRenderingDefault(false);

            // 字幕条：GQY_SUBTITLE=0 可关闭
            var sub = Environment.GetEnvironmentVariable("GQY_SUBTITLE");
            if (!string.Equals(sub, "0", StringComparison.Ordinal))
            {
                try { new SubtitleForm().Show(); } catch { }
            }

            Forms.Application.Run(new OverlayForm());
        }
    }
}
