/* GqyStateObserver —— Unity 2021.3 (Mono) 只读状态观察器
 * -------------------------------------------------------------
 * 1. 不修改厂商任何 DLL、资源、评分、认证逻辑；新增程序集 + 在测试副本的
 *    RuntimeInitializeOnLoads.json 注册入口。
 * 2. 磁盘上的 Assembly-CSharp.dll 被厂商加密，但运行时是普通 .NET 类型，反射可读。
 * 3. 侦察结果写临时文件；状态变化写 GQY_STATE: 到 Player.log。
 * 4. 不依赖 MonoBehaviour.Start/Update（早期初始化阶段创建的组件会被 Unity 清掉），
 *    改用主线程 SynchronizationContext + Timer，保证采样总在 Unity 主线程执行。
 * 5. 全部 try/catch，任何异常都不允许影响原实验。
 */
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Gqy
{
    public static class Bootstrap
    {
        private static Timer _timer;
        private static SynchronizationContext _main;
        private static bool _ilDumpStarted;

        // 由 RuntimeInitializeOnLoads.json 注册（所有 loadTypes 各一条），必须幂等。
        public static void Init()
        {
            Debug.Log("GQY_PROBE: bootstrap entered");
            try
            {
                _main = SynchronizationContext.Current;   // Unity 主线程上下文
                if (_timer == null)
                    _timer = new Timer(_ => SafePost(), null, 800, 1500);
                // 常驻驱动（Update 每帧采样，不依赖已失效的同步上下文）
                Runner.Ensure();
                // 5 秒后把 Assembly-CSharp 的 IL 摘要导出一次（只读，不影响游戏）
                if (!_ilDumpStarted)
                {
                    _ilDumpStarted = true;
                    new Timer(_ => { try { _main.Post(__ => IlDump.RunAsync(), null); } catch { } }, null, 8000, Timeout.Infinite);
                }
                Debug.Log("GQY_PROBE: timer started, mainCtx=" + (_main != null));
            }
            catch (Exception e) { Debug.Log("GQY_PROBE: init failed " + e.Message); }
        }

        private static void SafePost()
        {
            try
            {
                if (_main != null) _main.Post(_ => Observer.StaticTick(), null);
                else Observer.StaticTick();   // 兜底：仅纯 .NET 反射时可用
            }
            catch (Exception e) { Debug.Log("GQY_PROBE: tick " + e.Message); }
        }
    }

    public class Observer : MonoBehaviour
    {
        private static bool _cmdHooked;
        private const string PREFIX = "GQY_STATE:";
        private const BindingFlags ALL = BindingFlags.Public | BindingFlags.NonPublic |
                                         BindingFlags.Static | BindingFlags.Instance |
                                         BindingFlags.DeclaredOnly;

        private static readonly string DumpPath =
            Path.Combine(Path.GetTempPath(), "gqy-runtime-dump.txt");

        private static bool _dumped;
        private static string _lastSnapshot = "";
        private static Assembly _game;

        // MonoBehaviour 生命周期仍保留作双保险，但不作为唯一入口
        private void Start() { StaticTick(); }

        public static void StaticTick()
        {
            try { CmdChannel.Poll(); } catch { }
            StaticTickOld();
        }

        private static void StaticTickOld()
        {
            try
            {
                if (_game == null)
                    _game = AppDomain.CurrentDomain.GetAssemblies()
                        .FirstOrDefault(a => a.GetName().Name == "Assembly-CSharp");
            }
            catch { }

            try { if (!_dumped) { _dumped = true; DumpRuntime(); } }
            catch (Exception e) { Debug.Log("GQY_PROBE: dump " + e.Message); }
            try { EmitState(); }
            catch (Exception e) { Debug.Log("GQY_PROBE: state " + e.Message); }
        }

        /* ---------- 一次性侦察 ---------- */
        private static void DumpRuntime()
        {
            var sb = new StringBuilder();
            sb.AppendLine("// runtime reflection dump " + DateTime.Now.ToString("s"));
            sb.AppendLine("scene=" + Safe(() => SceneManager.GetActiveScene().name));
            sb.AppendLine("gameAssembly=" + (_game != null ? _game.FullName : "MISSING"));
            sb.AppendLine("assemblies=" + string.Join(", ",
                AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetName().Name).OrderBy(x => x).Take(200)));

            var types = SafeTypes(_game);
            sb.AppendLine("Assembly-CSharp types=" + types.Count);
            foreach (var t in types.OrderBy(t => t.FullName))
                sb.AppendLine("TYPE " + t.FullName + " : " + (t.BaseType != null ? t.BaseType.FullName : "-"));

            string[] keys = { "Case", "Task", "Panel", "Model", "Manager", "Controller", "Progress",
                              "Score", "Step", "Question", "Day", "State", "Data", "Patient", "Exam",
                              "Study", "Section", "Nurse", "Traction", "Observe", "Psych", "Main" };
            foreach (var t in types.Where(t => keys.Any(k => t.Name.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0)))
            {
                sb.AppendLine("===== " + t.FullName + " =====");
                try
                {
                    foreach (var f in t.GetFields(ALL)) sb.AppendLine("  FIELD " + (f.IsStatic ? "static " : "") + f.FieldType.Name + " " + f.Name);
                    foreach (var p in t.GetProperties(ALL)) sb.AppendLine("  PROP  " + p.PropertyType.Name + " " + p.Name);
                    foreach (var m in t.GetMethods(ALL)) sb.AppendLine("  METHOD " + m.ReturnType.Name + " " + m.Name);
                }
                catch (Exception e) { sb.AppendLine("  detail err " + e.Message); }
            }

            sb.AppendLine("===== live MonoBehaviours =====");
            try
            {
                foreach (var b in UnityEngine.Object.FindObjectsOfType<MonoBehaviour>().Take(250))
                    if (b != null) sb.AppendLine("  LIVE " + b.GetType().FullName);
            }
            catch (Exception e) { sb.AppendLine("  live err " + e.Message); }

            File.WriteAllText(DumpPath, sb.ToString(), Encoding.UTF8);
            Debug.Log("GQY_PROBE: dump written " + sb.Length + " chars -> " + DumpPath);
        }

        /* ---------- 状态事件 ----------
         * 只输出原程序真实字段值，不写死任何演示数据、不推断业务场景。
         * 原任务 ID → 智能场景 ID 的映射放在 client-agent/agent.mjs（可校准）。
         */
        private static void EmitState()
        {
            var d = new Dictionary<string, object>();
            d["scene"] = Safe(() => SceneManager.GetActiveScene().name);

            // 当前活动 UI 面板（真实 GameObject 名）
            try
            {
                /* 只报「真的看得见」的面板：
                   实测发现关闭后的面板 GameObject 仍 activeInHierarchy，
                   残留名字会把已结束的任务一直报成当前任务。
                   用 CanvasGroup.alpha 过滤 alpha=0（淡出隐藏）的面板。 */
                var cgType = Type.GetType("UnityEngine.CanvasGroup, UnityEngine.CoreModule");
                var alphaProp = cgType != null ? cgType.GetProperty("alpha") : null;
                var panels = UnityEngine.Object.FindObjectsOfType<Transform>()
                    .Where(t => t != null && t.gameObject.activeInHierarchy &&
                                t.name.IndexOf("Panel", StringComparison.OrdinalIgnoreCase) >= 0)
                    .Where(t =>
                    {
                        if (cgType == null || alphaProp == null) return true;
                        try
                        {
                            var cg = t.GetComponent(cgType);
                            if (cg == null) return true;
                            var a = Convert.ToSingle(alphaProp.GetValue(cg, null));
                            return a > 0.01f;
                        }
                        catch { return true; }
                    })
                    .Select(t => t.name).Distinct().Take(16).ToArray();
                d["panels"] = panels;
            }
            catch { }

            // 原界面真实显示的文本（任务列表项、按钮标题）——比枚举值更有业务语义
            try { d["uiTexts"] = CollectUiTexts(); }
            catch { }
            // 当前选中的任务项（Toggle.isOn），用来区分「任务列表里列着」和「正在做」
            try { d["selectedTasks"] = CollectSelectedTasks(); }
            catch { }

            MonoBehaviour[] live;
            try { live = UnityEngine.Object.FindObjectsOfType<MonoBehaviour>(); }
            catch { live = new MonoBehaviour[0]; }

            foreach (var b in live)
            {
                if (b == null) continue;
                var t = b.GetType();
                var tn = t.FullName ?? "";
                try
                {
                    if (tn == "Nurse.Logic.GameManager")
                    {
                        Add(d, "senceState", Field(t, b, "currentSenceState"));
                        Add(d, "isStudyModel", Field(t, b, "isStudyModel"));
                        Add(d, "isGetProgressSuccess", Field(t, b, "isGetProgressSuccess"));
                        Add(d, "isFirstDay", Field(t, null, "isFirstDay"));
                        Add(d, "isFirstProgress", Field(t, null, "isFirstProgress"));
                        Add(d, "openPanelList", Field(t, null, "openPanelList"));
                    }
                    else if (tn == "Nurse.Logic.ScoreMgr")
                    {
                        Add(d, "scoreDatas", Field(t, null, "ScoreDatas"));
                        Add(d, "typeScores", Field(t, null, "TypeScores"));
                        Add(d, "totalScore", Field(t, b, "<TotalScore>k__BackingField"));
                        Add(d, "alreadyAnswer", Field(t, b, "alreadAnswer"));
                    }
                    else if (tn == "Nurse.Logic.UITaskOptPanel")
                    {
                        Add(d, "dayTime", Field(t, b, "dayTime"));
                        Add(d, "taskOpt01", Field(t, b, "uITaskOpts"));
                        Add(d, "taskOpt02", Field(t, b, "uITaskOpts02"));
                        Add(d, "taskOpt03", Field(t, b, "uITaskOpts03"));
                        Add(d, "taskOpt07", Field(t, b, "uITaskOpts07"));
                        Add(d, "taskListActive", Field(t, b, "taskList"));
                        /* 每日任务清单的真实名称（按钮子文本），比题干更直接 */
                        try
                        {
                            var arrT = Field(t, b, "uITaskOpts") as Array;
                            var namesT = new List<string>();
                            if (arrT != null)
                            {
                                foreach (var o in arrT)
                                {
                                    var btnT = o as Component;
                                    if (btnT == null) continue;
                                    var txT = TextUnderTransform(btnT.transform);
                                    if (!string.IsNullOrEmpty(txT)) namesT.Add(txT);
                                }
                            }
                            if (namesT.Count > 0) d["dayTaskNames"] = string.Join("|", namesT.ToArray());
                        }
                        catch { }
                        /* 2026-11-15：术后「当前选中任务项」——任务级识别缺的就是这一项 */
                        var cur = Field(t, b, "currentTarget");
                        Add(d, "taskCurrent", cur);
                        var curText = TextUnderTransform(cur);
                        if (!string.IsNullOrEmpty(curText)) d["taskCurrentText"] = curText;
                    }
                    else if (tn == "Nurse.Logic.UIThirdSenceOptPanel")
                    {
                        /* 术后观察评估面板：dayTime=第几天，orderIndex=当前第几项任务 */
                        Add(d, "sence3Day", Field(t, b, "dayTime"));
                        Add(d, "sence3Order", Field(t, b, "orderIndex"));
                    }
                    else if (tn == "Nurse.Logic.UISelectionOtherExamPanel")
                    {
                        /* 术后任务项的考核面板：三个 ToggleList 分别是第1/2/3天的任务清单，
                           选中项 isOn=true → 学生当前在做的并发症观察项 */
                        Add(d, "examDay", Field(t, b, "dayTime"));
                        Add(d, "examList1", ToggleListInfo(Field(t, b, "panel01ToggleList")));
                        Add(d, "examList2", ToggleListInfo(Field(t, b, "panel02ToggleList")));
                        Add(d, "examList3", ToggleListInfo(Field(t, b, "panel03ToggleList")));
                    }
                    else if (tn == "Nurse.Logic.UITipOptPanel")
                    {
                        /* 3D 模型菜单的真实按钮：点病人后这里会出现「心理护理」等条目 */
                        try
                        {
                            var btns = Field(t, b, "m_btnContainer") as Array;
                            if (btns != null)
                            {
                                var labels = new List<string>();
                                foreach (var bo in btns)
                                {
                                    var btn = bo as Component;
                                    if (btn == null) continue;
                                    if (!btn.gameObject.activeInHierarchy) continue;
                                    var tx = TextUnderTransform(btn.transform);
                                    if (!string.IsNullOrEmpty(tx)) labels.Add(tx);
                                }
                                if (labels.Count > 0) d["tipOptButtons"] = string.Join("|", labels.ToArray());
                            }
                            Add(d, "huLiDone", Field(t, b, "IsHuLiDone"));
                        }
                        catch { }
                    }
                    else if (tn == "Nurse.Logic.RayModelManager")
                    {
                        /* 逆向结论：RayModelManager 用 Physics.Raycast 命中名为 Player/nurse/drive 的模型，
                           命中后打开 UITipOptPanel（心理护理等按钮就在里面）。
                           这里把 Player 模型投影到屏幕坐标，外部就能精确点中它，不用猜像素。 */
                        try
                        {
                            var go = GameObject.Find("Player");
                            if (go != null)
                            {
                                var cam = Camera.main;
                                if (cam != null)
                                {
                                    var sp = cam.WorldToScreenPoint(go.transform.position);
                                    if (sp.z > 0)
                                        d["playerScreen"] = Mathf.RoundToInt(sp.x) + "," + Mathf.RoundToInt(Screen.height - sp.y);
                                }
                            }
                        }
                        catch { }
                    }
                    else if (tn == "Nurse.Logic.UISelectionExamPanel")
                    {
                        /* 是/否选择题：题干本身能直接定位任务主题 */
                        Add(d, "examIndex", Field(t, b, "currIndex"));
                        var qTip = TextOf(Field(t, b, "questionTip"));
                        if (!string.IsNullOrEmpty(qTip)) d["examQuestion"] = qTip.Length > 160 ? qTip.Substring(0, 160) : qTip;
                    }
                    else if (tn == "Nurse.Logic.UISkeletaTractionOptPanel")
                    {
                        Add(d, "tractionWeight", Field(t, b, "weightValue"));
                    }
                    else if (tn == "Nurse.Logic.UISelectPanel")
                    {
                        Add(d, "selectSenceState", Field(t, b, "m_currnetSenceState"));
                    }
                    else if (tn == "Nurse.Logic.UICasePanel")
                    {
                        Add(d, "caseToggleIndex", Field(t, b, "currentToggleIndex"));
                    }
                    else if (tn == "Nurse.QUIPanelStack")
                    {
                        Add(d, "uiStack", Field(t, b, "mAllStack"));
                    }
                    else if (tn == "MengooCx")
                    {
                        // 厂商平台层自己的进度/任务模型（反编译实证：ExperimentTask{No,Name}）
                        Add(d, "mengooPass", Field(t, b, "pass"));
                        Add(d, "hasProgress", Field(t, b, "hasProgress"));
                        Add(d, "mengooTotalScore", Field(t, b, "totalScore"));
                        var uploadData = Field(t, b, "uploadData");
                        if (uploadData != null)
                        {
                            var et = uploadData.GetType();
                            Add(d, "taskList", Field(et, uploadData, "ExperimentTaskList"));
                            Add(d, "uploadScore", Field(et, uploadData, "Score"));
                        }
                        Add(d, "iLabSteps", Field(t, b, "iLabSteps"));
                        Add(d, "stepTimes", Field(t, b, "stepTimes"));
                    }
                }
                catch { }
            }

            var json = Json(d);
            if (json == _lastSnapshot) return;   // 只在状态变化时打印
            _lastSnapshot = json;
            Debug.Log(PREFIX + json);
        }

        /* 反射读取 UnityEngine.UI.Text，避免 observer 编译期依赖 UnityEngine.UI.dll */
        private static string[] CollectUiTexts()
        {
            var tt = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
            if (tt == null) return new string[0];
            var prop = tt.GetProperty("text");
            if (prop == null) return new string[0];
            var arr = UnityEngine.Object.FindObjectsOfType(tt);
            var outp = new List<string>();
            foreach (var c in arr)
            {
                if (outp.Count >= 48) break;
                if (c == null) continue;
                try
                {
                    var go = (c as UnityEngine.Component);
                    if (go != null && !go.gameObject.activeInHierarchy) continue;
                    var s = prop.GetValue(c, null) as string;
                    if (string.IsNullOrWhiteSpace(s)) continue;
                    s = s.Replace("\n", " ").Replace("\r", " ").Trim();
                    if (s.Length > 40) s = s.Substring(0, 40);
                    if (!outp.Contains(s)) outp.Add(s);
                }
                catch { }
            }
            return outp.ToArray();
        }

        /* 当前勾选/激活的任务项：任务列表会同时列出 9 个任务，
         * 仅凭文本无法判断「正在做哪一个」，必须看 Toggle / Button 的选中状态。 */
        private static string[] CollectSelectedTasks()
        {
            var outp = new List<string>();
            var toggleType = Type.GetType("UnityEngine.UI.Toggle, UnityEngine.UI");
            var textType = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
            if (toggleType == null || textType == null) return outp.ToArray();
            var isOn = toggleType.GetProperty("isOn");
            var textProp = textType.GetProperty("text");
            if (isOn == null || textProp == null) return outp.ToArray();

            foreach (var c in UnityEngine.Object.FindObjectsOfType(toggleType))
            {
                if (c == null || outp.Count >= 12) continue;
                try
                {
                    var comp = c as UnityEngine.Component;
                    if (comp == null || !comp.gameObject.activeInHierarchy) continue;
                    if (!(bool)isOn.GetValue(c, null)) continue;
                    foreach (var tc in comp.GetComponentsInChildren(textType, true))
                    {
                        var s = textProp.GetValue(tc, null) as string;
                        if (string.IsNullOrWhiteSpace(s)) continue;
                        s = s.Replace("\n", " ").Trim();
                        if (s.Length > 40) s = s.Substring(0, 40);
                        if (!outp.Contains(s)) { outp.Add(s); break; }
                    }
                }
                catch { }
            }
            return outp.ToArray();
        }

        /* 读取 UnityEngine.UI.Text 组件的文本（反射） */
        private static string TextOf(object comp)
        {
            if (comp == null) return null;
            try
            {
                var t = comp.GetType();
                var p = t.GetProperty("text");
                return p != null ? p.GetValue(comp, null) as string : null;
            }
            catch { return null; }
        }

        /* 术后勾选列表：把每一项读成 "序号:名称:是否选中"
         * UISelectionOtherExamPanel.panel01/02/03ToggleList 就是第一天/第二天/第三天的任务清单，
           选中态 = 学生当前正在做的并发症观察项。 */
        private static string ToggleListInfo(object tr)
        {
            var t = tr as UnityEngine.Transform;
            if (t == null) return null;
            var toggleType = Type.GetType("UnityEngine.UI.Toggle, UnityEngine.UI");
            var onProp = toggleType != null ? toggleType.GetProperty("isOn") : null;
            var sb = new System.Text.StringBuilder();
            for (int i = 0; i < t.childCount; i++)
            {
                var child = t.GetChild(i);
                if (child == null) continue;
                var name = TextUnderTransform(child);
                if (string.IsNullOrEmpty(name)) name = child.name;
                int on = 0;
                if (toggleType != null && onProp != null)
                {
                    try
                    {
                        var tg = child.GetComponent(toggleType);
                        if (tg != null && Convert.ToBoolean(onProp.GetValue(tg, null))) on = 1;
                    }
                    catch { }
                }
                if (sb.Length > 0) sb.Append('|');
                sb.Append(i).Append(':').Append(name).Append(':').Append(on);
                if (sb.Length > 400) break;
            }
            return sb.Length > 0 ? sb.ToString() : null;
        }

        private static void Add(Dictionary<string, object> d, string key, object v)
        {
            var s = Describe(v);
            if (s != null) d[key] = s;
        }

        /* 读取某个 Transform 子树下的 UnityEngine.UI.Text 文本（反射，避免编译期依赖）
         * 用途：UITaskOptPanel.currentTarget 指向当前选中的任务按钮，其子 Text 就是任务名 */
        private static string TextUnderTransform(object tr)
        {
            var t = tr as UnityEngine.Transform;
            if (t == null) return null;
            var tt = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
            if (tt == null) return null;
            try
            {
                var arr = t.GetComponentsInChildren(tt, true);
                if (arr == null || arr.Length == 0) return null;
                var prop = tt.GetProperty("text");
                if (prop == null) return null;
                var sb = new System.Text.StringBuilder();
                foreach (var c in arr)
                {
                    var v = prop.GetValue(c, null) as string;
                    if (string.IsNullOrEmpty(v)) continue;
                    if (sb.Length > 0) sb.Append('/');
                    sb.Append(v);
                    if (sb.Length > 80) break;
                }
                return sb.Length > 0 ? sb.ToString() : null;
            }
            catch { return null; }
        }

        /* 读实例或静态字段；枚举转成名字，集合转成 count + 前几项 */
        private static object Field(Type t, object instance, string name)
        {
            var flags = BindingFlags.Public | BindingFlags.NonPublic |
                        (instance == null ? BindingFlags.Static : BindingFlags.Instance | BindingFlags.Static);
            var f = t.GetField(name, flags);
            if (f == null) return null;
            try { return f.GetValue(instance); } catch { return null; }
        }

        private static object GetMember(object item, string name)
        {
            if (item == null || name == null) return null;
            var t = item.GetType();
            var f = t.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (f != null) return f.GetValue(item);
            var p = t.GetProperty(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            return p != null ? p.GetValue(item, null) : null;
        }

        /* ExperimentTask{No,Name}：原程序 27 个计分步骤的真实名称与序号 */
        private static string Describe(object v)
        {
            if (v == null) return null;
            if (v is bool b) return b ? "true" : "false";
            if (v is string s) return s.Length > 120 ? s.Substring(0, 120) : s;
            var t = v.GetType();
            if (t.IsEnum) return v.ToString();
            if (t.IsPrimitive) return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
            if (v is UnityEngine.Object u) return u != null ? u.name : null;

            if (t.Name == "ExperimentTask")
            {
                var no = GetMember(v, "No");
                var nm = GetMember(v, "Name");
                return Convert.ToString(no) + ":" + Convert.ToString(nm);
            }
            if (t.Name == "iLabStep")
            {
                var parts = new[] { "seq", "title", "done", "score", "timeUsed" };
                var vals = parts.Select(p2 => { var x = GetMember(v, p2); return x == null ? "-" : Convert.ToString(x); });
                return string.Join("|", vals);
            }
            if (v is IDictionary dict)
            {
                var keys = new List<string>();
                foreach (var k in dict.Keys) { if (keys.Count >= 16) break; keys.Add(Convert.ToString(k)); }
                return "count=" + dict.Count + " keys=[" + string.Join(",", keys) + "]";
            }
            if (v is IEnumerable en)
            {
                var vals = new List<string>();
                foreach (var x in en) { if (vals.Count >= 40) break; vals.Add(x == null ? "null" : (Describe(x) ?? Convert.ToString(x))); }
                return "count=" + vals.Count + " [" + string.Join(",", vals).Replace("\"", "'") + "]";
            }
            return null;
        }

        /* ---------- 工具 ---------- */
        private static List<Type> SafeTypes(Assembly a)
        {
            if (a == null) return new List<Type>();
            try { return a.GetTypes().Where(t => t != null).ToList(); }
            catch (ReflectionTypeLoadException ex) { return ex.Types.Where(t => t != null).ToList(); }
            catch { return new List<Type>(); }
        }

        private static string Safe(Func<string> f) { try { return f(); } catch { return ""; } }

        private static object ReadScalar(object v)
        {
            if (v == null) return null;
            var t = v.GetType();
            if (t.IsPrimitive || v is string || t.IsEnum) return v.ToString();
            if (v is UnityEngine.Object u) return u != null ? u.name : null;
            if (v is ICollection c) return "count=" + c.Count;
            return null;
        }

        private static string Json(Dictionary<string, object> d)
        {
            var sb = new StringBuilder("{");
            var first = true;
            foreach (var kv in d)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append('"').Append(kv.Key.Replace("\"", "'")).Append("\":");
                if (kv.Value is string[] arr)
                    sb.Append('[').Append(string.Join(",", arr.Select(x => "\"" + x.Replace("\"", "'") + "\""))).Append(']');
                else if (kv.Value is bool b) sb.Append(b ? "true" : "false");
                else sb.Append('"').Append(Convert.ToString(kv.Value).Replace("\"", "'").Replace("\n", " ")).Append('"');
            }
            return sb.Append('}').ToString();
        }
    }
}
