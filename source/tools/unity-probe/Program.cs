// Unity Mono 程序集只读分析器（不修改任何厂商文件）
//   unity-probe types   <Assembly-CSharp.dll> [--out=file]
//   unity-probe strings <Assembly-CSharp.dll> [--filter=关键词]
//   unity-probe type    <Assembly-CSharp.dll> <类型名关键字> [--il]
//   unity-probe fields  <Assembly-CSharp.dll> <关键词>
//   unity-probe calls   <Assembly-CSharp.dll> <方法名关键字>
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;

class Probe
{
    static ModuleDefinition Load(string path)
    {
        var resolver = new DefaultAssemblyResolver();
        resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var p = new ReaderParameters { AssemblyResolver = resolver, ReadSymbols = false, InMemory = true };
        return ModuleDefinition.ReadModule(path, p).Assembly.MainModule;
    }

    static void Main(string[] args)
    {
        if (args.Length < 2) { Console.WriteLine("usage: unity-probe <cmd> <dll> [arg] [--il] [--filter=] [--out=]"); return; }
        var cmd = args[0];
        var dll = args[1];
        var arg = args.Length > 2 && !args[2].StartsWith("--") ? args[2] : "";
        var showIl = args.Contains("--il");
        var filter = args.FirstOrDefault(a => a.StartsWith("--filter="))?.Substring(9) ?? "";
        var outFile = args.FirstOrDefault(a => a.StartsWith("--out="))?.Substring(6);
        var mod = Load(dll);

        var sb = new System.Text.StringBuilder();
        void W(string s) { if (outFile == null) Console.WriteLine(s); else sb.AppendLine(s); }

        switch (cmd)
        {
            case "types":
                foreach (var t in mod.Types.OrderBy(t => t.FullName))
                    W($"{t.FullName}  base={t.BaseType?.Name ?? "-"}  fields={t.Fields.Count} methods={t.Methods.Count} props={t.Properties.Count}");
                break;

            case "strings":
            {
                var seen = new HashSet<string>();
                foreach (var t in mod.Types)
                foreach (var m in t.Methods)
                {
                    if (!m.HasBody) continue;
                    foreach (var i in m.Body.Instructions)
                    {
                        if (i.OpCode != OpCodes.Ldstr || i.Operand is not string s) continue;
                        if (filter.Length > 0 && !s.Contains(filter, StringComparison.OrdinalIgnoreCase)) continue;
                        if (s.Length > 300) s = s.Substring(0, 300);
                        if (seen.Add(s)) W($"{t.Name}.{m.Name} :: {s.Replace("\n", "\\n").Replace("\r", "")}");
                    }
                }
                break;
            }

            case "fields":
                foreach (var t in mod.Types)
                foreach (var f in t.Fields)
                {
                    var line = $"{t.FullName} :: {f.FieldType.Name} {f.Name} {(f.IsStatic ? "[static]" : "")}{(f.IsPublic ? "[public]" : "")}";
                    if (filter.Length == 0 || line.Contains(filter, StringComparison.OrdinalIgnoreCase)) W(line);
                }
                break;

            case "type":
                foreach (var t in mod.Types.Where(t => t.FullName.Contains(arg, StringComparison.OrdinalIgnoreCase)))
                {
                    W($"===== {t.FullName} : {t.BaseType?.FullName} =====");
                    foreach (var f in t.Fields) W($"  FIELD {(f.IsStatic ? "static " : "")}{f.FieldType.Name} {f.Name}");
                    foreach (var p in t.Properties) W($"  PROP  {p.PropertyType.Name} {p.Name}");
                    foreach (var m in t.Methods)
                    {
                        W($"  METHOD {m.ReturnType.Name} {m.Name}({string.Join(", ", m.Parameters.Select(p => p.ParameterType.Name + " " + p.Name))})");
                        if (!showIl || !m.HasBody) continue;
                        foreach (var i in m.Body.Instructions)
                        {
                            if (i.OpCode == OpCodes.Ldstr || i.OpCode == OpCodes.Call || i.OpCode == OpCodes.Callvirt || i.OpCode == OpCodes.Ldfld || i.OpCode == OpCodes.Ldsfld || i.OpCode == OpCodes.Stfld || i.OpCode == OpCodes.Stsfld)
                                W($"      {i.OpCode.Name,-10} {i.Operand}");
                        }
                    }
                }
                break;

            case "calls":
                foreach (var t in mod.Types)
                foreach (var m in t.Methods)
                {
                    if (!m.HasBody) continue;
                    foreach (var i in m.Body.Instructions)
                    {
                        if (i.OpCode != OpCodes.Call && i.OpCode != OpCodes.Callvirt && i.OpCode != OpCodes.Newobj) continue;
                        var name = i.Operand?.ToString() ?? "";
                        if (!name.Contains(arg, StringComparison.OrdinalIgnoreCase)) continue;
                        W($"{t.FullName}.{m.Name} -> {name}");
                    }
                }
                break;

            default: W("unknown command"); break;
        }

        if (outFile != null)
        {
            File.WriteAllText(outFile, sb.ToString(), System.Text.Encoding.UTF8);
            Console.WriteLine($"written {outFile} ({sb.Length} chars)");
        }
    }
}
