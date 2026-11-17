/* 文件指令通道：把「按实现驱动游戏」从截图点击改成方法调用。
 * 指令文件：%TEMP%\gqy-cmd.txt
 *   首行格式：verb|arg1|arg2|...
 *     find|<GameObject名>               → 输出该物体世界坐标与屏幕坐标
 *     call|<类型全名>|<方法名>|a|b|c     → 找该类型的实例（或静态）并调用
 *     stat|<类型全名>|<字段名>           → 读静态字段
 * 结果写：%TEMP%\gqy-cmd-result.txt
 * 只在测试副本里用；不修改任何游戏数据。
 */
using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEngine;

namespace Gqy
{
    public static class CmdChannel
    {
        private static string _last = "";
        private const BindingFlags ALL = BindingFlags.Public | BindingFlags.NonPublic |
                                         BindingFlags.Static | BindingFlags.Instance;

        public static void Poll()
        {
            try
            {
                var dir = Path.GetTempPath();
                var cmd = Path.Combine(dir, "gqy-cmd.txt");
                if (!File.Exists(cmd)) return;
                var text = File.ReadAllText(cmd).Trim();
                if (string.IsNullOrEmpty(text) || text == _last) return;
                _last = text;
                var res = Run(text);
                File.WriteAllText(Path.Combine(dir, "gqy-cmd-result.txt"),
                    DateTime.Now.ToString("HH:mm:ss") + "\n" + res);
                File.Delete(cmd);
            }
            catch (Exception e)
            {
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "gqy-cmd-result.txt"), "ERR " + e); } catch { }
            }
        }

        private static string Run(string text)
        {
            var parts = text.Split('|');
            var verb = parts[0].Trim().ToLowerInvariant();
            if (verb == "find")
            {
                var name = parts.Length > 1 ? parts[1].Trim() : "";
                var go = GameObject.Find(name);
                if (go == null)
                {
                    var all = Resources.FindObjectsOfTypeAll<Transform>()
                        .FirstOrDefault(t => t != null && t.gameObject.scene.IsValid() && t.name == name);
                    if (all != null) go = all.gameObject;
                }
                if (go == null) return "null";
                var cam = Camera.main;
                var sp = cam != null ? cam.WorldToScreenPoint(go.transform.position) : Vector3.zero;
                int sx = Mathf.RoundToInt(sp.x), sy = Mathf.RoundToInt(Screen.height - sp.y);
                return string.Format(CultureInfo.InvariantCulture, "world={0:F2},{1:F2},{2:F2} screen={3},{4}",
                    go.transform.position.x, go.transform.position.y, go.transform.position.z, sx, sy);
            }

            if (verb == "text")
            {
                // 把界面上包含 old 的文本换成 new —— 证明可以运行时改 UI
                var oldT = parts.Length > 1 ? parts[1] : "";
                var newT = parts.Length > 2 ? parts[2] : "";
                var txtType = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
                if (txtType == null) return "no UI";
                var prop = txtType.GetProperty("text");
                int n = 0;
                foreach (var o in Resources.FindObjectsOfTypeAll(txtType))
                {
                    var c = o as Component;
                    if (c == null || !c.gameObject.activeInHierarchy) continue;
                    if (!c.gameObject.scene.IsValid()) continue;
                    var cur = prop.GetValue(c, null) as string;
                    if (string.IsNullOrEmpty(cur) || cur.IndexOf(oldT, StringComparison.Ordinal) < 0) continue;
                    prop.SetValue(c, newT);
                    n++;
                    if (n >= 8) break;
                }
                return "replaced " + n;
            }

            if (verb == "btnclick")
            {
                /* 按索引触发某面板上的第 N 个可见 Button：
                   有些按钮没有文字（图片按钮），只能按索引点。 */
                var tn = parts.Length > 1 ? parts[1].Trim() : "";
                var ty = Type.GetType(tn + ", Assembly-CSharp") ?? Type.GetType(tn);
                if (ty == null) return "no type " + tn;
                var host = UnityEngine.Object.FindObjectOfType(ty) as Component;
                if (host == null) return "no instance";
                var btnType = Type.GetType("UnityEngine.UI.Button, UnityEngine.UI");
                if (btnType == null) return "no UI";
                var list = host.GetComponentsInChildren(btnType, true)
                    .Where(x => x != null && x.gameObject.activeInHierarchy)
                    .ToArray();
                var idx = parts.Length > 2 ? int.Parse(parts[2]) : 0;
                if (idx < 0 || idx >= list.Length) return "index out of range " + list.Length;
                var b = list[idx];
                var nm = b.name;
                var ev = btnType.GetProperty("onClick").GetValue(b, null);
                if (ev == null) return "button without onClick: " + nm;
                ev.GetType().GetMethod("Invoke").Invoke(ev, null);
                return "clicked button #" + idx + "/" + list.Length + " name=" + nm;
            }

            if (verb == "uiclick")
            {
                /* 按界面文字找最近的 Button/Toggle，直接触发 onClick。
                   用途：模式选择、弹窗确定等没有稳定坐标的按钮；绕开 DPI 换算。 */
                var want = parts.Length > 1 ? parts[1].Trim() : "";
                var txtType = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
                if (txtType == null) return "no UI";
                var tp = txtType.GetProperty("text");
                var btnType = Type.GetType("UnityEngine.UI.Button, UnityEngine.UI");
                var toggleType = Type.GetType("UnityEngine.UI.Toggle, UnityEngine.UI");
                foreach (var o in Resources.FindObjectsOfTypeAll(txtType))
                {
                    var c = o as Component;
                    if (c == null || !c.gameObject.activeInHierarchy) continue;
                    if (!c.gameObject.scene.IsValid()) continue;
                    var s0 = tp.GetValue(c, null) as string;
                    if (string.IsNullOrEmpty(s0) || s0.IndexOf(want, StringComparison.Ordinal) < 0) continue;
                    var t = c.transform;
                    for (int i = 0; i < 10 && t != null; i++)
                    {
                        if (btnType != null)
                        {
                            var b = t.GetComponent(btnType);
                            if (b != null)
                            {
                                var nm = t.name;              // 点击可能销毁面板，先取名字
                                var label = s0.Trim();
                                var ev = btnType.GetProperty("onClick").GetValue(b, null);
                                if (ev == null) return "button without onClick: " + nm;
                                ev.GetType().GetMethod("Invoke").Invoke(ev, null);
                                return "clicked button [" + label + "] on " + nm;
                            }
                        }
                        if (toggleType != null)
                        {
                            var tg = t.GetComponent(toggleType);
                            if (tg != null)
                            {
                                var nm = t.name;
                                var label = s0.Trim();
                                toggleType.GetProperty("isOn").SetValue(tg, true, null);
                                var ev = toggleType.GetProperty("onValueChanged").GetValue(tg, null);
                                if (ev != null)
                                    ev.GetType().GetMethod("Invoke", new[] { typeof(bool) }).Invoke(ev, new object[] { true });
                                return "toggled [" + label + "] on " + nm;
                            }
                        }
                        t = t.parent;
                    }
                    return "text without button: [" + s0.Trim() + "] on " + c.gameObject.name;
                }
                return "no text " + want;
            }

            if (verb == "scan")
            {
                // 扫描所有 *Panel 类实例上可见按钮，按文字过滤，返回「类型|文字@x,y」
                var want = parts.Length > 1 ? parts[1].Trim() : "";
                var asm = Type.GetType("Nurse.Logic.GameManager, Assembly-CSharp")?.Assembly;
                if (asm == null) return "no asm";
                var btnType = Type.GetType("UnityEngine.UI.Button, UnityEngine.UI");
                var txtType = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
                if (btnType == null || txtType == null) return "no UI";
                var tp = txtType.GetProperty("text");
                var sb = new System.Text.StringBuilder();
                foreach (var t in asm.GetTypes())
                {
                    if (t == null || t.IsAbstract || !typeof(Component).IsAssignableFrom(t)) continue;
                    if (t.Name.IndexOf("Panel", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    UnityEngine.Object[] objs;
                    try { objs = Resources.FindObjectsOfTypeAll(t); } catch { continue; }
                    foreach (var o in objs)
                    {
                        var c = o as Component;
                        if (c == null || !c.gameObject.activeInHierarchy) continue;
                        if (!c.gameObject.scene.IsValid()) continue;
                        foreach (var bo in c.GetComponentsInChildren(btnType, true))
                        {
                            var b = bo as Component;
                            if (b == null || !b.gameObject.activeInHierarchy) continue;
                            var tx = b.GetComponentInChildren(txtType, true);
                            var label = (tx != null && tp != null) ? (tp.GetValue(tx, null) as string) : null;
                            if (string.IsNullOrEmpty(label)) continue;
                            if (want.Length > 0 && label.IndexOf(want, StringComparison.Ordinal) < 0) continue;
                            var pos = b.transform.position;
                            sb.Append(t.Name).Append('|').Append(label).Append('@')
                              .Append(Mathf.RoundToInt(pos.x)).Append(',').Append(Mathf.RoundToInt(Screen.height - pos.y)).Append("; ");
                            if (sb.Length > 900) return sb.ToString();
                        }
                    }
                }
                return sb.Length > 0 ? sb.ToString() : "no match";
            }

            if (verb == "methods")
            {
                var tn3 = parts.Length > 1 ? parts[1].Trim() : "";
                var ty3 = Type.GetType(tn3 + ", Assembly-CSharp") ?? Type.GetType(tn3);
                if (ty3 == null) return "no type " + tn3;
                var sb3 = new System.Text.StringBuilder();
                foreach (var m in ty3.GetMethods(ALL))
                {
                    if (m.DeclaringType != ty3) continue;
                    var ps3 = m.GetParameters().Select(x => x.ParameterType.Name).ToArray();
                    sb3.Append(m.Name).Append('(').Append(string.Join(",", ps3)).Append("); ");
                    if (sb3.Length > 1500) break;
                }
                return sb3.ToString();
            }

            if (verb == "hide" || verb == "show")
            {
                var nm = parts.Length > 1 ? parts[1].Trim() : "";
                var go = GameObject.Find(nm);
                if (go == null)
                {
                    var all = Resources.FindObjectsOfTypeAll<Transform>()
                        .FirstOrDefault(t => t != null && t.gameObject.scene.IsValid() && t.name == nm);
                    if (all != null) go = all.gameObject;
                }
                if (go == null) return "null";
                go.SetActive(verb == "show");
                return "ok " + verb + " " + nm;
            }

            if (verb == "buttons")
            {
                var tn2 = parts.Length > 1 ? parts[1].Trim() : "";
                var ty2 = Type.GetType(tn2 + ", Assembly-CSharp") ?? Type.GetType(tn2);
                if (ty2 == null) return "no type " + tn2;
                var host2 = typeof(Component).IsAssignableFrom(ty2)
                    ? (object)UnityEngine.Object.FindObjectOfType(ty2) : null;
                var comp2 = host2 as Component;
                if (comp2 == null) return "no instance";

                var btnType = Type.GetType("UnityEngine.UI.Button, UnityEngine.UI");
                var txtType = Type.GetType("UnityEngine.UI.Text, UnityEngine.UI");
                if (btnType == null) return "no UI";
                var sb2 = new System.Text.StringBuilder();
                foreach (var bo in comp2.GetComponentsInChildren(btnType, true))
                {
                    var btn = bo as Component;
                    if (btn == null || !btn.gameObject.activeInHierarchy) continue;
                    string label = "";
                    if (txtType != null)
                    {
                        var t2 = btn.GetComponentInChildren(txtType, true);
                        if (t2 != null)
                        {
                            var tp = txtType.GetProperty("text");
                            if (tp != null) label = (tp.GetValue(t2, null) as string) ?? "";
                        }
                    }
                    var p2 = btn.transform.position;
                    sb2.Append(label).Append('@').Append(Mathf.RoundToInt(p2.x)).Append(',')
                       .Append(Mathf.RoundToInt(Screen.height - p2.y)).Append("; ");
                }
                return sb2.Length > 0 ? sb2.ToString() : "no buttons";
            }

            var typeName = parts.Length > 1 ? parts[1].Trim() : "";
            var type = Type.GetType(typeName + ", Assembly-CSharp") ?? Type.GetType(typeName);
            if (type == null) return "no type " + typeName;

            if (verb == "stat")
            {
                var fn = parts.Length > 2 ? parts[2].Trim() : "";
                var f = type.GetField(fn, ALL);
                if (f == null) return "no field " + fn;
                return Convert.ToString(f.GetValue(null));
            }

            if (verb == "call")
            {
                var mn = parts.Length > 2 ? parts[2].Trim() : "";
                var args = parts.Skip(3).ToArray();
                object inst = typeof(Component).IsAssignableFrom(type)
                    ? (object)UnityEngine.Object.FindObjectOfType(type) : null;
                var mi = type.GetMethods(ALL).FirstOrDefault(m => m.Name == mn && m.GetParameters().Length == args.Length)
                         ?? type.GetMethods(ALL).FirstOrDefault(m => m.Name == mn);
                if (mi == null) return "no method " + mn;
                var ps = mi.GetParameters();
                var objs = new object[ps.Length];
                for (int i = 0; i < ps.Length; i++)
                {
                    string raw = i < args.Length ? args[i] : null;
                    objs[i] = ConvertArg(raw, ps[i].ParameterType);
                }
                try
                {
                    var r = mi.Invoke(mi.IsStatic ? null : inst, objs);
                    return "ok " + Describe(r);
                }
                catch (Exception e)
                {
                    return "throw " + (e.InnerException ?? e).Message;
                }
            }
            if (verb == "inst")
            {
                var fn = parts.Length > 2 ? parts[2].Trim() : "";
                var inst = typeof(Component).IsAssignableFrom(type)
                    ? (object)UnityEngine.Object.FindObjectOfType(type) : null;
                if (inst == null) return "no instance";
                var f = type.GetField(fn, ALL);
                if (f == null) return "no field " + fn;
                var v = f.GetValue(inst);
                var arr = v as Array;
                if (arr == null) return Describe(v);
                var sb = new System.Text.StringBuilder();
                for (int i = 0; i < arr.Length && i < 12; i++)
                    sb.Append(i).Append(':').Append(Describe(arr.GetValue(i))).Append("\n");
                return sb.ToString();
            }

            return "unknown verb " + verb;
        }

        private static string Describe(object r)
        {
            if (r == null) return "void";
            var go = r as GameObject;
            if (go == null && r is Component c) go = c.gameObject;
            if (go != null)
            {
                var cam = Camera.main;
                var sp = cam != null ? cam.WorldToScreenPoint(go.transform.position) : Vector3.zero;
                return string.Format(CultureInfo.InvariantCulture, "{0} world={1:F1},{2:F1} screen={3},{4}",
                    go.name, go.transform.position.x, go.transform.position.z,
                    Mathf.RoundToInt(sp.x), Mathf.RoundToInt(Screen.height - sp.y));
            }
            if (r is Transform tr) return tr.name + " screen?";
            return Convert.ToString(r);
        }

        private static object ConvertArg(string s, Type t)
        {
            if (t == typeof(string)) return s ?? "";
            if (t == typeof(int)) return int.Parse(s ?? "0");
            if (t == typeof(float)) return float.Parse(s ?? "0", CultureInfo.InvariantCulture);
            if (t == typeof(bool)) return (s ?? "false").ToLowerInvariant() == "true";
            if (t.IsEnum) return Enum.Parse(t, s ?? "0");
            if (s == null) return null;
            try { return Convert.ChangeType(s, t, CultureInfo.InvariantCulture); } catch { return null; }
        }
    }
}
