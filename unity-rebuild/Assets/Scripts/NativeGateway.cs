using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace TractionCare
{
    [Serializable] public class ModelSettings
    {
        public string baseUrl="https://api.openai.com/v1", protocol="responses", model="", apiKey="", mode="auto";
        public bool stream=true;
        public int timeoutMs=60000, maxTokens=900;
        public float temperature=.6f;
    }
    public sealed class NativeGateway : MonoBehaviour
    {
        Process process;
        HospitalSimulation app;
        volatile string announcedPort;
        public ModelSettings Settings { get; private set; }
        public string State { get; private set; }="本地网关未启动";
        string Configuration => Path.Combine(Application.persistentDataPath,"model-config.json");
        public long WorkingSet => process!=null&&!process.HasExited?process.WorkingSet64:0;
#if UNITY_STANDALONE_OSX || UNITY_EDITOR_OSX
        [DllImport("libc",SetLastError=true)] static extern int chmod(string path,int mode);
#endif
        public void Initialize(HospitalSimulation simulation)
        {
            app=simulation;
            Settings=File.Exists(Configuration)?JsonUtility.FromJson<ModelSettings>(File.ReadAllText(Configuration)):new ModelSettings();
            StartGateway();
        }
        public void SaveSettings(string url,string model,string protocol,string key)
        {
            if(!Uri.TryCreate(url,UriKind.Absolute,out var uri) || (uri.Scheme!="https"&&!uri.IsLoopback)) { State="模型地址须为 HTTPS 或本机地址。"; return; }
            Settings.baseUrl=url.TrimEnd('/'); Settings.model=model; Settings.protocol=protocol; Settings.apiKey=key;
            Directory.CreateDirectory(Application.persistentDataPath);
            File.WriteAllText(Configuration,JsonUtility.ToJson(Settings,true));
#if UNITY_STANDALONE_OSX || UNITY_EDITOR_OSX
            if(chmod(Configuration,384)!=0) { State="模型配置文件权限设置失败。"; return; }
#endif
            StopGateway(); StartGateway();
        }
        void StartGateway()
        {
            string folder=Application.platform==RuntimePlatform.OSXPlayer?Path.Combine(Application.dataPath,"Resources/Gateway"):Path.Combine(Application.dataPath,"../Gateway");
#if UNITY_EDITOR
            folder=Path.GetFullPath(Path.Combine(Application.dataPath,"../../work/gateway/macOS"));
#endif
            string binary=Path.Combine(folder,Application.platform==RuntimePlatform.WindowsPlayer?"node.exe":"node");
            if(!File.Exists(binary)) { State="内置网关运行文件待构建；可连接外部网关。"; return; }
            var info=new ProcessStartInfo(binary,"--max-old-space-size=128 \""+Path.Combine(folder,"server.mjs")+"\"")
            { UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=folder };
            info.EnvironmentVariables["LLM_CONFIG_PATH"]=Configuration; info.EnvironmentVariables["LLM_PORT"]="0";
            process=new Process { StartInfo=info,EnableRaisingEvents=true };
            process.OutputDataReceived+=(sender,args)=>{if(args.Data!=null&&args.Data.StartsWith("UNITY_GATEWAY_PORT=")) announcedPort=args.Data.Substring("UNITY_GATEWAY_PORT=".Length);};
            process.ErrorDataReceived+=(sender,args)=>{if(!string.IsNullOrEmpty(args.Data)) State="本地模型网关启动错误。";};
            process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine(); State="正在启动本地网关…";
        }
        void Update()
        {
            if(announcedPort==null) return;
            string port=announcedPort; announcedPort=null; State="本地网关已启动"; app.Assistant.Configure("http://127.0.0.1:"+port);
        }
        void StopGateway()
        {
            if(process==null) return;
            app.Assistant.Cancel();
            if(!process.HasExited) process.Kill();
            process.Dispose(); process=null;
        }
        void OnDestroy() => StopGateway();
    }
}
