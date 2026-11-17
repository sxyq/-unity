using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace TractionCare.Editor
{
    public static class BuildProduct
    {
        [MenuItem("护理实验/构建 macOS")]
        public static void Mac() => Build(BuildTarget.StandaloneOSX, "macOS/TractionCare.app");
        [MenuItem("护理实验/构建 Windows")]
        public static void Windows() => Build(BuildTarget.StandaloneWindows64, "Windows/TractionCare.exe");
        public static void Prepare()
        {
            Directory.CreateDirectory("Assets/Scenes");
            if(!File.Exists("Assets/Resources/ClinicalSurface.mat"))
                AssetDatabase.CreateAsset(new Material(Shader.Find("Standard")),"Assets/Resources/ClinicalSurface.mat");
            if (!File.Exists("Assets/Scenes/Main.unity"))
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
            }
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Main.unity", true) };
            PlayerSettings.companyName = "Hospital Simulation";
            PlayerSettings.productName = "骨牵引护理实验";
            PlayerSettings.fullScreenMode = FullScreenMode.FullScreenWindow;
            PlayerSettings.defaultIsNativeResolution = true;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.runInBackground = false;
            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Standalone, ScriptingImplementation.Mono2x);
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
            QualitySettings.vSyncCount = 0;
            QualitySettings.antiAliasing = 2;
            AssetDatabase.SaveAssets();
        }
        static void Build(BuildTarget target, string name)
        {
            Prepare();
            if(target==BuildTarget.StandaloneOSX) PlayerSettings.SetArchitecture(UnityEditor.Build.NamedBuildTarget.Standalone,1);
            var destination = Path.GetFullPath(Path.Combine(Application.dataPath, "../../builds", name));
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                scenes = new[] { "Assets/Scenes/Main.unity" }, locationPathName = destination,
                target = target, options = BuildOptions.None
            });
            Debug.Log("PRODUCT_BUILD " + report.summary.result + " bytes=" + report.summary.totalSize + " path=" + destination);
            if (report.summary.result != BuildResult.Succeeded) throw new Exception("Unity build failed: " + report.summary.result);
            var gateway = target == BuildTarget.StandaloneOSX ? Path.Combine(destination,"Contents/Resources/Gateway") : Path.Combine(Path.GetDirectoryName(destination),"Gateway");
            Directory.CreateDirectory(gateway);
            string root=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
            File.Copy(Path.Combine(root,"source/apps/model-gateway/server.mjs"),Path.Combine(gateway,"server.mjs"),true);
            string platform=target==BuildTarget.StandaloneOSX?"macOS":"Windows";
            string binary=target==BuildTarget.StandaloneOSX?"node":"node.exe";
            File.Copy(Path.Combine(root,"work/gateway",platform,binary),Path.Combine(gateway,binary),true);
            File.Copy(Path.Combine(root,"work/gateway",platform,"LICENSE"),Path.Combine(gateway,"LICENSE"),true);
            if(target==BuildTarget.StandaloneOSX)
            {
                using(var chmod=System.Diagnostics.Process.Start("/bin/chmod","755 \""+Path.Combine(gateway,binary)+"\"")) chmod.WaitForExit();
                using(var sign=System.Diagnostics.Process.Start("/usr/bin/codesign","--force --deep --sign - \""+destination+"\"")) { sign.WaitForExit(); if(sign.ExitCode!=0) throw new Exception("Application signing failed"); }
            }
        }
    }
}
