// 字幕条：贴在实验窗口底部的半透明文字条，用于「劫持字幕」。
// 数据来自本地 agent 的 /state（uiTexts 里最长的一条 = 当前字幕/对话），
// 也可由 panel 通过 POST 覆盖文本。窗口点击穿透，不干扰实验操作。
using System;
using System.Drawing;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Forms = System.Windows.Forms;

namespace GouQianYinOverlay
{
    internal class SubtitleForm : Forms.Form
    {
        private readonly Forms.Label lab = new Forms.Label();
        private readonly Forms.Timer tick = new Forms.Timer { Interval = 1600 };
        private static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        private IntPtr target = IntPtr.Zero;

        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TRANSPARENT = 0x20;
        private const int WS_EX_LAYERED = 0x80000;

        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr h, int idx);
        [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr h, int idx, int val);

        public SubtitleForm()
        {
            FormBorderStyle = Forms.FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.FromArgb(8, 12, 20);
            Opacity = 0.66;
            StartPosition = Forms.FormStartPosition.Manual;
            Size = new Size(900, 78);

            lab.Dock = Forms.DockStyle.Fill;
            lab.ForeColor = Color.White;
            lab.BackColor = Color.Transparent;
            lab.Font = new Font("Microsoft YaHei UI", 17f, FontStyle.Bold);
            lab.TextAlign = ContentAlignment.MiddleCenter;
            lab.Padding = new Forms.Padding(16, 0, 16, 0);
            Controls.Add(lab);

            tick.Tick += async (_, __) => await Refresh();
            Load += (_, __) => { MakeClickThrough(); tick.Start(); };
            FormClosing += (_, __) => tick.Stop();
        }

        private void MakeClickThrough()
        {
            int ex = GetWindowLong(Handle, GWL_EXSTYLE);
            SetWindowLong(Handle, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_LAYERED);
        }

        private async Task Refresh()
        {
            try
            {
                var json = await http.GetStringAsync("http://127.0.0.1:8790/state");
                using var doc = JsonDocument.Parse(json);
                string text = null;
                if (doc.RootElement.TryGetProperty("unity", out var u) &&
                    u.TryGetProperty("uiTexts", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var it in arr.EnumerateArray())
                    {
                        var s = it.GetString();
                        if (string.IsNullOrWhiteSpace(s)) continue;
                        if (s.Length < 8) continue;                 // 过滤「确定/是/否」这类按钮词
                        if (s.Length > 120) s = s.Substring(0, 118) + "…";
                        if (text == null || s.Length > text.Length) text = s;
                    }
                }
                if (text != null && text != lab.Text) lab.Text = text;
                FollowGame();
            }
            catch { /* agent 没开就静默 */ }
        }

        private void FollowGame()
        {
            // 找实验窗口（按进程名），贴在其底部居中
            if (target == IntPtr.Zero || !IsWindow(target))
            {
                target = IntPtr.Zero;
                foreach (var p in System.Diagnostics.Process.GetProcessesByName("HLF10631030"))
                {
                    if (p.MainWindowHandle != IntPtr.Zero) { target = p.MainWindowHandle; break; }
                }
                if (target == IntPtr.Zero) { if (Visible) Visible = false; return; }
                if (!Visible) Visible = true;
            }

            Native.RECT r;
            if (!Native.GetWindowRect(target, out r)) return;
            int w = Math.Max(600, (r.Right - r.Left) * 7 / 10);
            int h = 78;
            int x = r.Left + ((r.Right - r.Left) - w) / 2;
            int y = r.Bottom - h - 46;
            if (Width != w) Width = w;
            if (Height != h) Height = h;
            if (Location.X != x || Location.Y != y) Location = new Point(x, y);
        }

        [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
    }
}
