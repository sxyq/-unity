using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace TractionCare
{
    [Serializable] public class ChatMessage { public string role, content; public ChatMessage(string role,string content) { this.role=role; this.content=content; } }
    [Serializable] class ChatRequest { public string system; public ChatMessage[] messages; public bool stream=true; }
    [Serializable] class ChatChunk { public string t, error, mode, model; }
    [Serializable] class GatewayHealth { public string mode, model; }
    public sealed class ClinicalAssistant : MonoBehaviour
    {
        HospitalSimulation app;
        UnityWebRequest request;
        Coroutine running;
        readonly Dictionary<string,List<ChatMessage>> histories=new Dictionary<string,List<ChatMessage>>();
        public bool Busy { get; private set; }
        public string Status { get; private set; }="离线知识库 · 尚未连接模型";
        public string Endpoint { get; private set; }="http://127.0.0.1:8787";
        string Key => app.Session.id+":"+app.scenarioIndex+":"+(app.Content.scenarios[app.scenarioIndex].phase=="postop"?app.Session.day:0);
        public List<ChatMessage> Messages { get { if(!histories.ContainsKey(Key)) histories[Key]=new List<ChatMessage>(); return histories[Key]; } }
        public void Initialize(HospitalSimulation simulation) { app=simulation; Endpoint=PlayerPrefs.GetString("gateway",Endpoint); }
        public void NewSession() { Cancel(); histories.Clear(); }
        public void Configure(string endpoint)
        {
            Cancel();
            if(!Uri.TryCreate(endpoint,UriKind.Absolute,out var uri) || (uri.Scheme!="https" && !(uri.Scheme=="http" && uri.IsLoopback))) { Status="网关地址须为 HTTPS 或本机 HTTP。"; app.UI.UpdateChat(); return; }
            Endpoint=endpoint.TrimEnd('/'); PlayerPrefs.SetString("gateway",Endpoint); PlayerPrefs.Save();
            StartCoroutine(Connect());
        }
        IEnumerator Connect()
        {
            using(var health=UnityWebRequest.Get(Endpoint+"/api/health"))
            {
                health.timeout=8; yield return health.SendWebRequest();
                if(health.result!=UnityWebRequest.Result.Success) Status="网关连接失败："+health.error;
                else { var data=JsonUtility.FromJson<GatewayHealth>(health.downloadHandler.text); Status=data.mode=="live"?"真实模型 · "+data.model:"网关尚未配置模型凭据"; }
                app.UI.UpdateChat();
            }
        }
        public void Send(string text)
        {
            if(Busy || string.IsNullOrWhiteSpace(text)) return;
            var list=Messages; list.Add(new ChatMessage("user",text.Trim()));
            if(list.Count>24) list.RemoveRange(0,list.Count-24);
            running=StartCoroutine(Stream(list));
        }
        IEnumerator Stream(List<ChatMessage> list)
        {
            Busy=true; Status="连接真实模型中…";
            var scene=app.Content.scenarios[app.scenarioIndex];
            var prompt=scene.systems.First(p=>p.day==(scene.phase=="postop"?app.Session.day:0)).system;
            bool exam=app.Session.exam&&!app.Session.submitted;
            prompt=prompt.Replace("模式：学习",exam?"模式：考核":"模式：学习");
            if(exam) prompt+="\n当前考核尚未提交。任何角色均不得给出答案、正确选项、针对当前题目的解析或代做操作，只能提供概念与观察方向。";
            var payload=new ChatRequest { system=prompt+"\n## 应用当前状态\n"+app.Context(), messages=list.Skip(Math.Max(0,list.Count-12)).ToArray() };
            var answer=new ChatMessage("assistant",""); list.Add(answer);
            var decoder=new SseHandler(chunk=>
            {
                if(!string.IsNullOrEmpty(chunk.error)) { Status=chunk.error; return; }
                if(chunk.mode=="live") Status="真实模型 · "+chunk.model;
                if(!string.IsNullOrEmpty(chunk.t)) answer.content+=chunk.t;
                app.UI.UpdateChat();
            });
            request=new UnityWebRequest(Endpoint+"/api/chat","POST") { uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(JsonUtility.ToJson(payload))), downloadHandler=decoder, timeout=90 };
            request.SetRequestHeader("Content-Type","application/json"); app.UI.UpdateChat();
            yield return request.SendWebRequest();
            if(request.result!=UnityWebRequest.Result.Success) Status="对话连接失败："+request.error;
            if(answer.content.Length==0) list.Remove(answer);
            request.Dispose(); request=null; Busy=false; running=null; app.UI.UpdateChat();
        }
        public void Cancel()
        {
            if(Busy) Status="对话已停止";
            if(request!=null) { request.Abort(); request.Dispose(); request=null; }
            if(running!=null) { StopCoroutine(running); running=null; }
            Busy=false;
        }
        public string OfflineKnowledge()
        {
            var task=app.CurrentTask;
            if(app.Session.exam&&!app.Session.submitted) return "考核中：先独立完成对象观察和判断。可查看基础概念；答案解析将在提交后开放。";
            if(app.scenarioIndex>=8) return app.Session.submitted?app.ReportText():"提交本次实验后，根据实际操作和判断记录显示成绩及复习方向。";
            var lesson=app.Content.knowledge.FirstOrDefault(k=>k.id==app.Current.knowledge);
            return "课程知识库（静态资料）\n"+(lesson==null?task.purpose:lesson.title+"\n"+lesson.body);
        }
        sealed class SseHandler : DownloadHandlerScript
        {
            readonly Decoder utf8=Encoding.UTF8.GetDecoder(); readonly Action<ChatChunk> callback;
            string pending="";
            public SseHandler(Action<ChatChunk> callback):base(new byte[8192]) { this.callback=callback; }
            protected override bool ReceiveData(byte[] data,int length)
            {
                var chars=new char[utf8.GetCharCount(data,0,length)]; utf8.GetChars(data,0,length,chars,0); pending+=new string(chars);
                int end;
                while((end=pending.IndexOf('\n'))>=0)
                {
                    var line=pending.Substring(0,end).Trim(); pending=pending.Substring(end+1);
                    if(!line.StartsWith("data:")) continue;
                    var json=line.Substring(5).Trim(); if(json=="[DONE]"||json.Length==0) continue;
                    callback(JsonUtility.FromJson<ChatChunk>(json));
                }
                return true;
            }
        }
    }
}
