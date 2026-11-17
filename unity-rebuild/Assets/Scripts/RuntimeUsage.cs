using System;
using System.Diagnostics;
using System.IO;
using UnityEngine;

namespace TractionCare
{
    public sealed class RuntimeUsage : MonoBehaviour
    {
        [Serializable] class Usage
        {
            public string platform, unity, capturedAt;
            public long peakTotalResidentBytes, applicationResidentBytes, gatewayResidentBytes;
            public int samples;
            public float minimumFps=1000, latestFps;
        }
        readonly Usage usage=new Usage();
        readonly Process process=Process.GetCurrentProcess();
        HospitalSimulation app;
        float elapsed;
        int frames;
        public long TotalBytes => usage.applicationResidentBytes+usage.gatewayResidentBytes;
        public long PeakBytes => usage.peakTotalResidentBytes;
        public float Fps => usage.latestFps;
        public void Initialize(HospitalSimulation simulation) { app=simulation; usage.platform=Application.platform.ToString(); usage.unity=Application.unityVersion; }
        void Update()
        {
            elapsed+=Time.unscaledDeltaTime; frames++;
            if(elapsed<2) return;
            process.Refresh(); usage.applicationResidentBytes=process.WorkingSet64; usage.gatewayResidentBytes=app.Gateway.WorkingSet;
            usage.peakTotalResidentBytes=Math.Max(usage.peakTotalResidentBytes,TotalBytes);
            usage.latestFps=frames/elapsed; usage.minimumFps=Mathf.Min(usage.minimumFps,usage.latestFps); usage.samples++;
            frames=0; elapsed=0;
            if(TotalBytes>2_000_000_000) app.UI.ShowMemoryLimit(TotalBytes);
        }
        public string Save()
        {
            usage.capturedAt=DateTime.UtcNow.ToString("o");
            Directory.CreateDirectory(Application.persistentDataPath);
            string path=Path.Combine(Application.persistentDataPath,"runtime-usage.json");
            File.WriteAllText(path,JsonUtility.ToJson(usage,true)); return path;
        }
        void OnApplicationQuit() { Save(); process.Dispose(); }
    }
}
