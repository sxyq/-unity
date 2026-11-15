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
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
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

        /* 窗口状态持久化：
           以前的跟随 tick 每 900ms 强制写回 420x820 和右侧停靠，
           学生手动拖过/拉过的窗口会立刻弹回去，重启也不记得。
           现在只在「用户没有手动调整过」时才套默认布局。 */
        private bool userSized = false;
        private bool userMoved = false;
        private bool applyingLayout = false;
        private DateTime layoutAt = DateTime.MinValue;
        private readonly Forms.Timer saveTimer = new Forms.Timer { Interval = 700 };
        private static string BoundsPath
        {
            get
            {
                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "GouQianYinOverlay");
                return Path.Combine(dir, "bounds.json");
            }
        }

        private class BoundsState
        {
            public int X { get; set; }
            public int Y { get; set; }
            public int W { get; set; }
            public int H { get; set; }
            public bool Pinned { get; set; }
            public bool UserSized { get; set; }
            public bool UserMoved { get; set; }
        }

        private void SaveBounds()
        {
            try
            {
                if (WindowState != Forms.FormWindowState.Normal) return;
                var dir = Path.GetDirectoryName(BoundsPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var st = new BoundsState
                {
                    X = Bounds.X, Y = Bounds.Y, W = Bounds.Width, H = Bounds.Height,
                    Pinned = pinned, UserSized = userSized, UserMoved = userMoved
                };
                File.WriteAllText(BoundsPath, JsonSerializer.Serialize(st));
            }
            catch { /* 持久化失败不影响使用 */ }
        }

        private void RestoreWindowBounds()
        {
            try
            {
                if (!File.Exists(BoundsPath)) return;
                var st = JsonSerializer.Deserialize<BoundsState>(File.ReadAllText(BoundsPath));
                if (st == null || st.W < 200 || st.H < 100) return;
                var screen = Screen.FromPoint(new Point(st.X + 40, st.Y + 40)).WorkingArea;
                var r = new Rectangle(st.X, st.Y, st.W, st.H);
                if (!screen.IntersectsWith(r))
                    r = new Rectangle(screen.Right - st.W - 24, screen.Top + 40, st.W, st.H);
                applyingLayout = true;
                Bounds = r;
                pinned = st.Pinned;
                userSized = st.UserSized;
                userMoved = st.UserMoved;
                applyingLayout = false;
            }
            catch { /* 配置损坏时用默认布局 */ }
        }

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
            FormClosing += (_, __) =>
            {
                SaveBounds();
                follow.Stop(); retry.Stop(); formTimer.Stop(); saveTimer.Stop(); subtitle?.Close();
            };

            /* 用户手动拉伸 → 记住尺寸，不再被跟随逻辑改回默认 420x820 */
            ResizeEnd += (_, __) =>
            {
                if (applyingLayout) return;
                userSized = true;
                saveTimer.Stop(); saveTimer.Start();
            };

            /* 用户拖动窗口 → 自动取消「跟随实验窗口」，并保存位置。
               跟随逻辑自己设置 Location 时会先置 applyingLayout，不会误判。 */
            LocationChanged += (_, __) =>
            {
                if (applyingLayout || !Visible) return;
                /* 程序自己改尺寸/位置时，LocationChanged 可能晚于 applyingLayout 复位，
                   用 400ms 窗口过滤掉，避免把自动布局误判成用户拖动。 */
                if ((DateTime.Now - layoutAt).TotalMilliseconds < 400) return;
                if (pinned)
                {
                    pinned = false;
                    Text = "骨牵引智能交互 · 位置已固定（Ctrl+Alt+P 恢复跟随）";
                }
                userMoved = true;
                saveTimer.Stop(); saveTimer.Start();
            };

            saveTimer.Tick += (_, __) => { saveTimer.Stop(); SaveBounds(); };

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

            RestoreWindowBounds();
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
            var wasPanel = formMode == "panel";
            formMode = m;
            Size f;
            if (m == "launcher") f = new Size(78, 78);
            else if (m == "mini") f = new Size(360, 104);
            else f = FORMS[0];
            /* 从收起态回到面板：恢复默认面板尺寸；面板内部再收放则保留用户拉伸过的尺寸 */
            if (m == "panel" && !wasPanel) userSized = false;
            if (MinimumSize.Width > f.Width || MinimumSize.Height > f.Height)
                MinimumSize = new Size(60, 60);
            applyingLayout = true;
            layoutAt = DateTime.Now;
            Size = f;
            applyingLayout = false;
            FollowTarget();
        }

        private void ApplyForm()
        {
            var f = FORMS[formIndex];
            if (MinimumSize.Width > f.Width || MinimumSize.Height > f.Height)
                MinimumSize = new Size(60, 60);
            applyingLayout = true;
            layoutAt = DateTime.Now;
            Size = f;
            applyingLayout = false;
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
                if (pinned) userMoved = false;   // 重新跟随：放弃手动位置
                Text = "骨牵引智能交互 · " + (pinned ? "跟随实验窗口" : "位置已固定");
                FollowTarget();
                saveTimer.Stop(); saveTimer.Start();
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

            if (formMode == "panel")
            {
                /* 只有用户没手动拉过尺寸时才套默认宽高，否则保留他的手感 */
                if (!userSized)
                {
                    int w = Math.Min(Width, 480);
                    int h2 = Math.Min(820, Math.Max(420, targetRect.Height));
                    applyingLayout = true;
                    layoutAt = DateTime.Now;
                    if (Size.Width != w) Width = w;
                    if (Height != h2) Height = h2;
                    applyingLayout = false;
                }

                if (pinned)
                {
                    int w = Width, h2 = Height;
                    int x = targetRect.Right + inset;
                    int y = targetRect.Top;
                    if (x + w > screen.Right)
                    {
                        // 右边放不下 → 贴窗口内部右下（此时才可能遮挡，用 Ctrl+Alt+T 穿透）
                        x = targetRect.Right - w - inset;
                        y = targetRect.Bottom - h2 - inset;
                    }
                    applyingLayout = true;
                    layoutAt = DateTime.Now;
                    if (Location.X != x || Location.Y != y) Location = new Point(x, y);
                    applyingLayout = false;
                }
                else if (!screen.IntersectsWith(Bounds))
                {
                    applyingLayout = true;
                    Location = new Point(screen.Right - Width - inset, screen.Top + 40);
                    applyingLayout = false;
                }
            }
            else
            {
                /* 收起态（窄条/小球）：保持小尺寸，贴在实验窗口右下角 */
                int w = Width, h2 = Height;
                int x = Math.Max(screen.Left, targetRect.Right - w - inset);
                int y = Math.Max(screen.Top, targetRect.Bottom - h2 - inset);
                applyingLayout = true;
                if (Location.X != x || Location.Y != y) Location = new Point(x, y);
                applyingLayout = false;
            }

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
