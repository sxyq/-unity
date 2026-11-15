/* IL 扫描器：游戏磁盘上的 Assembly-CSharp.dll 被厂商加密，但运行时是普通 .NET 程序集。
 * 这里用反射把每个方法里的「字符串常量 / 调用目标 / 字段访问」导出成可读清单，
 * 用来逆向游戏的业务流程（哪个按钮调哪个方法、哪个面板对应哪个任务），不依赖截图点击。
 *
 * 只读：不调用、不修改任何游戏方法。
 */
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Reflection.Emit;
using System.Text;

namespace Gqy
{
    public static class IlDump
    {
        private static readonly Dictionary<int, OpCode> Ops = new Dictionary<int, OpCode>();
        private static bool _done;

        static IlDump()
        {
            foreach (var f in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                var op = (OpCode)f.GetValue(null);
                Ops[op.Value] = op;
            }
        }

        public static void RunAsync()
        {
            if (_done) return;
            _done = true;
            var dir = Path.Combine(Path.GetTempPath(), "gqy-il");
            try
            {
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "_start.txt"), DateTime.Now.ToString("s"));
                Run();
            }
            catch (Exception e)
            {
                try { File.WriteAllText(Path.Combine(dir, "_error.txt"), e.ToString()); } catch { }
            }
        }

        private static void Run()
        {
            var t = Type.GetType("Nurse.Logic.GameManager, Assembly-CSharp")
                    ?? Type.GetType("Nurse.Logic.UITaskOptPanel, Assembly-CSharp");
            if (t == null) return;
            var asm = t.Assembly;
            var dir = Path.Combine(Path.GetTempPath(), "gqy-il");
            Directory.CreateDirectory(dir);

            var sbAll = new StringBuilder();
            Type[] types;
            try { types = asm.GetTypes(); } catch (ReflectionTypeLoadException e) { types = e.Types; }

            foreach (var ty in types)
            {
                if (ty == null) continue;
                try { DumpType(ty, dir, sbAll); } catch { }
            }
            File.WriteAllText(Path.Combine(dir, "_index.txt"), sbAll.ToString(), Encoding.UTF8);
            File.WriteAllText(Path.Combine(dir, "_done.txt"), DateTime.Now.ToString("s"), Encoding.UTF8);
        }

        private static void DumpType(Type ty, string dir, StringBuilder index)
        {
            var sb = new StringBuilder();
            sb.AppendLine("TYPE " + ty.FullName + " : " + (ty.BaseType != null ? ty.BaseType.Name : "-"));

            foreach (var f in ty.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
                sb.AppendLine("  FIELD " + (f.IsStatic ? "static " : "") + f.FieldType.Name + " " + f.Name);

            var methods = ty.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly);
            foreach (var m in methods)
            {
                var body = m.GetMethodBody();
                if (body == null) continue;
                var il = body.GetILAsByteArray();
                if (il == null || il.Length == 0) continue;
                string calls, strs, fields;
                Decode(ty, m, il, out calls, out strs, out fields);
                if (string.IsNullOrEmpty(calls) && string.IsNullOrEmpty(strs) && string.IsNullOrEmpty(fields)) continue;
                sb.AppendLine("  METHOD " + m.Name);
                if (!string.IsNullOrEmpty(strs)) sb.AppendLine("    STR " + strs);
                if (!string.IsNullOrEmpty(calls)) sb.AppendLine("    CALL " + calls);
                if (!string.IsNullOrEmpty(fields)) sb.AppendLine("    FLD " + fields);
            }

            var name = ty.FullName.Replace('+', '_').Replace('`', '_');
            File.WriteAllText(Path.Combine(dir, name + ".il.txt"), sb.ToString(), Encoding.UTF8);
            index.AppendLine(ty.FullName);
        }

        private static void Decode(Type ty, MethodBase m, byte[] il, out string calls, out string strs, out string fields)
        {
            var c = new List<string>(); var s = new List<string>(); var fl = new List<string>();
            var module = m.Module;
            Type[] typeArgs = ty.IsGenericType ? ty.GetGenericArguments() : null;
            Type[] methodArgs = m.IsGenericMethod ? m.GetGenericArguments() : null;

            int i = 0;
            while (i < il.Length)
            {
                int code = il[i];
                if (code == 0xfe) { code = 0xfe00 | il[i + 1]; i += 2; } else i++;
                if (!Ops.TryGetValue(code, out var op)) break;

                int size = 0;
                switch (op.OperandType)
                {
                    case OperandType.InlineNone: break;
                    case OperandType.ShortInlineI:
                    case OperandType.ShortInlineVar:
                    case OperandType.ShortInlineBrTarget: size = 1; break;
                    case OperandType.InlineVar: size = 2; break;
                    case OperandType.InlineI:
                    case OperandType.InlineBrTarget:
                    case OperandType.ShortInlineR:
                    case OperandType.InlineString:
                    case OperandType.InlineSig:
                        size = 4; break;
                    case OperandType.InlineI8:
                    case OperandType.InlineR: size = 8; break;
                    case OperandType.InlineSwitch:
                        {
                            int n = BitConverter.ToInt32(il, i);
                            size = 4 + n * 4;
                            break;
                        }
                    case OperandType.InlineField:
                    case OperandType.InlineMethod:
                    case OperandType.InlineType:
                    case OperandType.InlineTok:
                        {
                            int tok = BitConverter.ToInt32(il, i);
                            try
                            {
                                if (op.OperandType == OperandType.InlineString)
                                    s.Add(module.ResolveString(tok));
                            }
                            catch { }
                            try
                            {
                                var member = module.ResolveMember(tok, typeArgs, methodArgs);
                                if (member is MethodBase mb)
                                {
                                    var dt = mb.DeclaringType != null ? mb.DeclaringType.Name : "?";
                                    c.Add(dt + "." + mb.Name);
                                }
                                else if (member is FieldInfo fi)
                                {
                                    var dt = fi.DeclaringType != null ? fi.DeclaringType.Name : "?";
                                    fl.Add(dt + "." + fi.Name);
                                }
                            }
                            catch { }
                            size = 4;
                            break;
                        }
                }
                if (op.OperandType == OperandType.InlineString)
                {
                    int tok = BitConverter.ToInt32(il, i);
                    try { s.Add(module.ResolveString(tok)); } catch { }
                }
                i += size;
                if (i > il.Length) break;
            }

            calls = Join(c);
            strs = Join(s);
            fields = Join(fl);
        }

        private static string Join(List<string> xs)
        {
            var seen = new HashSet<string>();
            var sb = new StringBuilder();
            foreach (var x in xs)
            {
                if (string.IsNullOrEmpty(x) || !seen.Add(x)) continue;
                if (sb.Length > 0) sb.Append(" | ");
                sb.Append(x.Replace("\n", " ").Replace("\r", ""));
                if (sb.Length > 600) break;
            }
            return sb.ToString();
        }
    }
}
