using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

namespace TractionCare
{
    public sealed class TrainingUI : MonoBehaviour
    {
        HospitalSimulation app;
        Font font;
        RectTransform root, right, operations, chat;
        Text progressText, statusText, chatTitle;
        InputField message;
        ScrollRect chatScroll;
        readonly Dictionary<ChatMessage,Text> messageViews=new Dictionary<ChatMessage,Text>();
        bool assistantTab;
        bool memoryNotice;
        public string Page { get; private set; }
        static readonly Color Ink=new Color(.10f,.19f,.23f), Muted=new Color(.38f,.46f,.49f), Teal=new Color(.08f,.43f,.45f), Pale=new Color(.92f,.96f,.95f), White=new Color(.99f,.995f,.99f), Line=new Color(.83f,.89f,.89f);
        public void Create(HospitalSimulation simulation)
        {
            app=simulation; font=Resources.Load<Font>("Fonts/NotoSansCJKsc-Regular");
            var canvas=new GameObject("Nursing interface").AddComponent<Canvas>(); canvas.renderMode=RenderMode.ScreenSpaceOverlay;
            var scaler=canvas.gameObject.AddComponent<CanvasScaler>(); scaler.uiScaleMode=CanvasScaler.ScaleMode.ScaleWithScreenSize; scaler.referenceResolution=new Vector2(1600,900); scaler.matchWidthOrHeight=.5f;
            canvas.gameObject.AddComponent<GraphicRaycaster>();
            root=Element(canvas.transform,"Application",new Vector2(1600,900)); root.anchorMin=root.anchorMax=root.pivot=new Vector2(.5f,.5f);
            if(EventSystem.current==null) new GameObject("UI input",typeof(EventSystem),typeof(StandaloneInputModule));
        }
        RectTransform Element(Transform parent,string name,Vector2 size)
        {
            var o=new GameObject(name,typeof(RectTransform)); var r=o.GetComponent<RectTransform>(); r.SetParent(parent,false); r.anchorMin=r.anchorMax=new Vector2(0,1); r.pivot=new Vector2(0,1); r.sizeDelta=size; return r;
        }
        RectTransform Panel(Transform parent,string name,float x,float y,float w,float h,Color color)
        {
            var r=Element(parent,name,new Vector2(w,h)); r.anchoredPosition=new Vector2(x,-y); r.gameObject.AddComponent<Image>().color=color; return r;
        }
        Text TextAt(Transform parent,string text,float x,float y,float w,float h,int size=16,Color? color=null,FontStyle style=FontStyle.Normal)
        {
            var r=Element(parent,"Text",new Vector2(w,h)); r.anchoredPosition=new Vector2(x,-y);
            var t=r.gameObject.AddComponent<Text>(); t.font=font; t.text=text; t.fontSize=size; t.color=color??Ink; t.fontStyle=style; t.supportRichText=false; t.raycastTarget=false; t.verticalOverflow=VerticalWrapMode.Overflow; t.lineSpacing=1.2f; return t;
        }
        Button ButtonAt(Transform parent,string text,float x,float y,float w,float h,Action clicked,bool primary=false)
        {
            var r=Panel(parent,text,x,y,w,h,primary?Teal:Pale); var b=r.gameObject.AddComponent<Button>();
            var colors=b.colors; colors.highlightedColor=new Color(.81f,.92f,.89f); colors.pressedColor=new Color(.65f,.83f,.79f); b.colors=colors;
            var label=TextAt(r,text,12,0,w-24,h,15,primary?Color.white:Ink); label.alignment=TextAnchor.MiddleLeft;
            b.onClick.AddListener(()=>clicked()); return b;
        }
        RectTransform Scroll(Transform parent,string name,float x,float y,float w,float h,out ScrollRect scroll)
        {
            var viewport=Panel(parent,name,x,y,w,h,new Color(1,1,1,0)); viewport.gameObject.AddComponent<RectMask2D>();
            scroll=viewport.gameObject.AddComponent<ScrollRect>(); scroll.horizontal=false; scroll.viewport=viewport; scroll.scrollSensitivity=25;
            var content=Element(viewport,"Content",new Vector2(w-8,0));
            var stack=content.gameObject.AddComponent<VerticalLayoutGroup>(); stack.spacing=10; stack.childControlWidth=true; stack.childControlHeight=true; stack.childForceExpandWidth=true; stack.childForceExpandHeight=false;
            var fit=content.gameObject.AddComponent<ContentSizeFitter>(); fit.verticalFit=ContentSizeFitter.FitMode.PreferredSize;
            scroll.content=content; return content;
        }
        Text Paragraph(Transform parent,string text,int size=16,Color? color=null)
        {
            var t=TextAt(parent,text,0,0,350,32,size,color); var fit=t.gameObject.AddComponent<ContentSizeFitter>(); fit.verticalFit=ContentSizeFitter.FitMode.PreferredSize; return t;
        }
        Button Choice(Transform parent,string text,Action clicked,bool primary=false,float height=46)
        {
            var b=ButtonAt(parent,text,0,0,350,height,clicked,primary); b.gameObject.AddComponent<LayoutElement>().preferredHeight=height; return b;
        }
        void Empty(Transform parent)
        {
            foreach(Transform child in parent) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
        }
        void Clear() { Empty(root); right=null; operations=null; chat=null; message=null; statusText=null; messageViews.Clear(); }
        void Header()
        {
            Panel(root,"Top navigation",0,0,1600,86,Ink);
            TextAt(root,"骨牵引护理",24,19,205,30,24,Color.white,FontStyle.Bold);
            TextAt(root,"TRACTION CARE · 独立教学课程",25,53,245,18,10,new Color(.63f,.79f,.78f));
            for(int i=0;i<4;i++) { int n=i; var b=ButtonAt(root,(i+1).ToString("00")+"  "+Course.Modules[i],300+i*205,20,195,46,()=>app.SelectModule(n),app.Session.module==i); }
            TextAt(root,app.Session.exam?"考核模式":"学习模式",1150,32,100,25,15,Color.white);
            ButtonAt(root,"学习报告",1280,22,125,42,Report);
            ButtonAt(root,"设置 / 返回",1422,22,150,42,Settings);
        }
        void Footer()
        {
            Panel(root,"Bottom status",0,841,1600,59,White);
            TextAt(root,"右键拖动环视 · 滚轮缩放 · WASD 漫游 · 点击对象开始护理",280,857,730,24,13,Muted);
            ButtonAt(root,"恢复视角",1052,850,110,36,()=>app.Ward.ResetView());
            TextAt(root,"27 步骤 / 39 评分项 · 自主重建映射",20,861,260,22,11,Muted);
        }
        public void Welcome()
        {
            if(app.busy) { ModalText("护理动作进行中","当前动作完成后可返回首页。"); return; }
            Page="welcome";
            Clear(); var p=Panel(root,"Welcome",0,0,1600,900,new Color(.94f,.97f,.96f,.97f));
            TextAt(p,"ORTHOPAEDIC NURSING",90,88,600,35,17,Teal);
            TextAt(p,"从观察，到护理判断。",90,160,1000,90,48,Ink,FontStyle.Bold);
            TextAt(p,"下肢骨折骨牵引护理技术虚拟仿真实验",94,267,1100,50,25,Muted);
            TextAt(p,"李波  /  男 · 33 岁  /  左侧股骨中下段骨折",95,346,1200,40,19,Ink);
            TextAt(p,"进入三维病房，评估患者、配置牵引装置，完成术前、术中与术后四个日期的护理。\n每次操作和判断都会形成可回顾的学习记录。",95,411,1200,100,20,Muted);
            ButtonAt(p,"开始学习  →",95,558,260,64,()=>{assistantTab=false; app.StartSession(false);},true);
            ButtonAt(p,"开始独立考核",378,558,260,64,()=>{assistantTab=false; app.StartSession(true);});
            if(PlayerPrefs.HasKey("lastSession")) ButtonAt(p,"继续上次记录",661,558,260,64,()=>app.StartSession(false,true));
            TextAt(p,Course.DesignNotice,95,708,1360,92,15,Muted);
            TextAt(p,"4 大模块     27 项护理任务     39 项评分标准     10 个智能教学场景",95,807,1200,30,16,Teal);
        }
        public void Workspace()
        {
            Page="workspace";
            Clear(); Header(); Footer();
            var nav=Panel(root,"Tasks",0,86,270,755,White);
            TextAt(nav,Course.Modules[app.Session.module],22,22,230,32,22,Ink,FontStyle.Bold);
            int done=app.Tasks.Count(t=>app.Session.TaskDone(t,t.Daily?app.Session.day:0));
            TextAt(nav,"当前日期已完成 "+done+" / 27",22,66,230,24,13,Muted);
            float offset=110;
            if(app.Session.module==2)
            {
                for(int i=0;i<4;i++) { int d=Course.Dates[i]; ButtonAt(nav,d+" 天",16+i*61,104,56,38,()=>app.SelectDate(d),app.Session.day==d); }
                offset=162;
            }
            var tasks=Scroll(nav,"Task navigation",16,offset,242,735-offset,out _);
            foreach(var t in app.Tasks.Where(t=>t.module==app.Session.module && t.id!="R27"))
            {
                int index=Array.IndexOf(app.Tasks,t); string state=app.Session.TaskDone(t,app.Session.day)?"✓ ":"";
                Choice(tasks,state+t.id+"  "+t.title,()=>app.SelectTask(index),index==app.Session.task,58);
            }
            TextAt(root,app.CurrentTask.id+"  /  "+app.CurrentTask.title,298,110,850,40,26,Ink,FontStyle.Bold);
            TextAt(root,app.CurrentTask.purpose,298,156,850,60,15,Muted);
            ButtonAt(root,"聚焦操作对象",298,776,160,40,()=>app.Ward.Focus(app.Current.target));
            ButtonAt(root,"定位患者",475,776,160,40,()=>app.Ward.Focus("patient"));
            right=Panel(root,"Clinical workspace",1180,86,420,755,White);
            ButtonAt(right,"操作与判断",20,16,180,42,()=>{assistantTab=false; RefreshOperation();},!assistantTab);
            ButtonAt(right,"智能助教",210,16,190,42,ShowAssistant,assistantTab);
            if(assistantTab) ShowAssistant(); else RefreshOperation();
        }
        public void PatientMenu()
        {
            var p=Modal("患者交互 · 李波");
            TextAt(p,"男 · 33 岁 · 创伤骨科 2 床\n左侧股骨中下段骨折",32,95,1000,80,22,Ink);
            int[] entries=app.Session.module==0?new[]{0,1,4}:app.Session.module==1?new[]{5,6,7}:new[]{17,26};
            ButtonAt(p,"继续当前护理操作："+app.Current.label,32,192,1050,50,()=>{p.parent.gameObject.SetActive(false); Destroy(p.parent.gameObject);});
            for(int i=0;i<entries.Length;i++)
            {
                int index=entries[i]; ButtonAt(p,app.Tasks[index].title,32,267+i*76,1050,56,()=>{Destroy(p.parent.gameObject); assistantTab=false; app.SelectTask(index); app.PickDirect("patient");},index==26);
            }
        }
        public void RefreshOperation()
        {
            if(right==null || assistantTab) return;
            foreach(Transform item in right) if(item.name=="Assistant content") { item.gameObject.SetActive(false); Destroy(item.gameObject); }
            chat=null;
            if(operations!=null) { operations.gameObject.SetActive(false); Destroy(operations.gameObject); }
            operations=Scroll(right,"Operation",20,78,382,650,out _);
            Paragraph(operations,"当前任务分项",13,Muted);
            for(int i=0;i<app.CurrentTask.criteria.Length;i++)
            {
                int n=i; var c=app.CurrentTask.criteria[i]; var a=app.Session.Find(c,app.CurrentTask.Daily?app.Session.day:0);
                Choice(operations,(a?.answered==true?"✓  ":"")+c.id+"  "+c.label,()=>app.SelectCriterion(n),i==app.criterionIndex,40);
            }
            Paragraph(operations,"01  选择并操作对象",19,Ink);
            Paragraph(operations,"操作对象："+app.Ward.NameOf(app.Current.target)+"\n已选中："+app.Ward.NameOf(app.selected),15,Muted);
            string op=app.Current.operation;
            if(op=="height") AddSlider(operations,"支托高度（m）",.08f,.45f,app.Session.limbHeight,v=>app.Adjust("height",v),"0.00");
            if(op=="weight" || op=="device-review") AddSlider(operations,"牵引重量（kg）",0,10,app.Session.weight,v=>app.Adjust("weight",v),"0.0");
            if(op=="alignment" || op=="device-review") AddSlider(operations,"力线偏角（°）",-25,25,app.Session.alignment,v=>app.Adjust("alignment",v),"0");
            if(app.CurrentTask.Daily && !app.Session.ropeAttached && !app.Session.exam) Choice(operations,"载入术后练习起始装置",app.BeginPostopPractice);
            Choice(operations,app.busy?"操作进行中…":"执行「"+app.Current.label+"」",app.Operate,true).interactable=!app.busy && !app.Session.submitted;
            progressText=Paragraph(operations,app.notice,15,app.busy?Teal:Muted);
            if(app.busy) Paragraph(operations,"保持观察，等待操作完成。",13,Teal);
            var attempt=app.CurrentAttempt;
            if(attempt?.performed==true)
            {
                Paragraph(operations,"02  根据观察作出判断",19,Ink);
                Paragraph(operations,attempt.observation,15,Muted);
                Paragraph(operations,app.Current.question,17,Ink);
                for(int i=0;i<app.Current.choices.Length;i++)
                {
                    int n=i;
                    var button=Choice(operations,((char)('A'+i))+". "+app.Current.choices[i],()=>app.Answer(n),false,60);
                    button.interactable=!(app.Session.exam&&attempt.answered);
                }
                if(attempt.answered) Paragraph(operations,app.Session.exam?"已记录选择："+attempt.selectedAnswer:"已记录选择："+attempt.selectedAnswer+"\n"+app.Current.explanation,14,Teal);
            }
            if(app.Session.TaskDone(app.CurrentTask,app.Session.day)) Choice(operations,"任务已完成 · 下一项  →",app.Next,true);
        }
        void AddSlider(Transform parent,string title,float min,float max,float value,Action<float> changed,string format)
        {
            var label=Paragraph(parent,title+"  "+value.ToString(format),15,Ink);
            var r=Panel(parent,"Adjustment",0,0,350,36,Pale); r.gameObject.AddComponent<LayoutElement>().preferredHeight=36;
            var s=r.gameObject.AddComponent<Slider>(); s.minValue=min; s.maxValue=max;
            var fill=Panel(r,"Fill",0,14,330,8,Teal); var handle=Panel(r,"Handle",0,8,20,22,Ink);
            s.fillRect=fill; s.handleRect=handle; s.targetGraphic=handle.GetComponent<Image>(); s.value=value;
            s.onValueChanged.AddListener(v=>{changed(v); label.text=title+"  "+v.ToString(format);});
        }
        public void SetProgress(float value)
        {
            if(progressText!=null) progressText.text=app.notice+"  "+Mathf.RoundToInt(value*100)+"%";
        }
        public void ShowAssistant()
        {
            assistantTab=true;
            if(right==null) { Workspace(); return; }
            if(operations!=null) { operations.gameObject.SetActive(false); Destroy(operations.gameObject); }
            if(chat!=null) { chat.gameObject.SetActive(false); Destroy(chat.gameObject); }
            foreach(Transform item in right) if(item.name=="Assistant content") { item.gameObject.SetActive(false); Destroy(item.gameObject); }
            var area=Element(right,"Assistant content",new Vector2(380,650)); area.anchoredPosition=new Vector2(20,-78);
            var scene=app.Content.scenarios[app.scenarioIndex];
            chatTitle=TextAt(area,scene.no+"  "+scene.taskName,0,0,380,34,20,Ink,FontStyle.Bold);
            TextAt(area,scene.functionName+"  /  "+Role(scene.role),0,40,380,30,14,Teal);
            TextAt(area,app.manualScenario?"手动选择 · 考核状态保持同步":"自动关联 · 依据当前任务 ID · 可信度 100%",0,73,380,28,12,Muted);
            ButtonAt(area,"切换教学场景",0,108,180,36,ScenarioPicker);
            ButtonAt(area,"查看课程知识",190,108,190,36,()=>ModalText("课程知识库",app.Assistant.OfflineKnowledge()));
            statusText=TextAt(area,app.Assistant.Status,0,157,380,45,12,Muted);
            chat=Scroll(area,"Conversation",0,207,380,282,out chatScroll);
            messageViews.Clear();
            message=Input(area,"输入护理问题或对患者说的话…",0,503,380,69,true);
            ButtonAt(area,"发送",0,585,180,44,()=>{var q=message.text; message.text=""; app.Assistant.Send(q);},true);
            ButtonAt(area,"停止",190,585,190,44,()=>{app.Assistant.Cancel(); UpdateChat();});
            UpdateChat();
        }
        public void UpdateChat()
        {
            if(chat==null) return;
            if(statusText!=null) statusText.text=app.Assistant.Status;
            var scene=app.Content.scenarios[app.scenarioIndex];
            var messages=app.Assistant.Messages;
            if(messages.Count>0 && messageViews.Count==messages.Count && messages.All(m=>messageViews.ContainsKey(m)))
            {
                foreach(var m in messages) messageViews[m].text=m.content;
                Canvas.ForceUpdateCanvases(); chatScroll.verticalNormalizedPosition=0; return;
            }
            Empty(chat); messageViews.Clear();
            if(app.Assistant.Messages.Count==0)
            {
                Paragraph(chat,scene.goal,16,Muted);
                foreach(var chip in scene.chips) { string q=chip; Choice(chat,q,()=>app.Assistant.Send(q),false,50); }
            }
            else foreach(var m in messages)
            { Paragraph(chat,m.role=="user"?"你":Role(scene.role),12,Teal); messageViews[m]=Paragraph(chat,m.content,16,Ink); }
            Canvas.ForceUpdateCanvases(); chatScroll.verticalNormalizedPosition=0;
        }
        string Role(string key) => key=="patient"?"虚拟患者":key=="nurse"?"责任护士":key=="tutor"?"护理带教老师":"学习反馈老师";
        InputField Input(Transform parent,string placeholder,float x,float y,float w,float h,bool multiline=false)
        {
            var r=Panel(parent,"Input",x,y,w,h,Pale); var input=r.gameObject.AddComponent<InputField>();
            input.textComponent=TextAt(r,"",12,9,w-24,h-18,16,Ink); input.placeholder=TextAt(r,placeholder,12,9,w-24,h-18,15,Muted);
            input.lineType=multiline?InputField.LineType.MultiLineNewline:InputField.LineType.SingleLine; input.characterLimit=4000; return input;
        }
        RectTransform Modal(string title)
        {
            var shade=Panel(root,"Dialog",0,0,1600,900,new Color(.05f,.12f,.15f,.65f));
            var panel=Panel(shade,"Dialog content",220,105,1160,690,White);
            TextAt(panel,title,32,24,1010,45,27,Ink,FontStyle.Bold);
            ButtonAt(panel,"关闭",1030,22,100,40,()=>{shade.gameObject.SetActive(false); Destroy(shade.gameObject);}); return panel;
        }
        void ModalText(string title,string body)
        {
            var p=Modal(title); var content=Scroll(p,"Detail",32,93,1096,560,out _); Paragraph(content,body,18,Ink);
        }
        void ScenarioPicker()
        {
            var p=Modal("按教学模块选择助教场景");
            string[] titles={"操作前准备","操作方法及原理","术后病情观察","知识与学习反馈"};
            int[][] groups={new[]{0,1},new[]{2,3,4},new[]{5,6,7},new[]{8,9}};
            for(int group=0;group<4;group++)
            {
                float x=28+group*282; TextAt(p,titles[group],x,94,260,30,19,Teal);
                for(int row=0;row<groups[group].Length;row++)
                {
                    int index=groups[group][row]; var scene=app.Content.scenarios[index];
                    ButtonAt(p,scene.no+"  "+scene.taskName,x,146+row*135,262,58,()=>{Destroy(p.parent.gameObject); app.SelectScenario(index,true);},index==app.scenarioIndex);
                    TextAt(p,scene.goal,x+6,209+row*135,250,66,12,Muted);
                }
            }
            TextAt(p,"当前任务："+app.CurrentTask.title+"  ·  "+(app.Session.module==2?"术后第 "+app.Session.day+" 天":"术前 / 术中")+"\n手动选择仅改变助教角色，操作记录和考核状态继续保留。",32,577,1090,72,16,Muted);
        }
        public void Lessons()
        {
            Page="knowledge";
            Clear(); Header(); Footer();
            var p=Panel(root,"Knowledge",0,86,1600,755,White);
            TextAt(p,"理解原理，回到操作。",42,26,1200,48,32,Ink,FontStyle.Bold);
            TextAt(p,"从课程知识进入相关护理练习；已提交的错项会形成个人复习顺序。",44,84,1400,36,17,Muted);
            var list=Scroll(p,"Lessons",42,149,1490,540,out _);
            foreach(var lesson in app.Content.knowledge)
            {
                var k=lesson;
                Choice(list,k.title+"  →",()=>LessonDetail(k),false,56);
            }
            ButtonAt(p,"查看本次学习记录",1165,688,340,44,Report,true);
        }
        void LessonDetail(Lesson lesson)
        {
            var p=Modal(lesson.title); var content=Scroll(p,"Knowledge reading",32,90,1090,555,out _);
            Paragraph(content,lesson.body,20,Ink);
            var task=app.Tasks.First(t=>t.criteria.Any(c=>c.knowledge==lesson.id));
            Paragraph(content,"关联任务："+task.id+"  "+task.title,17,Teal);
            Choice(content,"进入对应三维护理任务",()=>{if(app.Session.submitted) app.StartSession(false); app.SelectTask(Array.IndexOf(app.Tasks,task));},true);
            if(app.Session.exam&&!app.Session.submitted) return;
            var criterion=task.criteria.First(c=>c.knowledge==lesson.id);
            Paragraph(content,"知识巩固",22,Ink); Paragraph(content,criterion.question,18,Ink);
            var feedback=Paragraph(content,"选择你的判断。",16,Muted);
            for(int i=0;i<criterion.choices.Length;i++)
            {
                int index=i; Choice(content,criterion.choices[i],()=>feedback.text=(index==criterion.answer?"判断正确。":"请再次联系观察结果思考。")+criterion.explanation,false,52);
            }
        }
        public void Report()
        {
            if(app.busy) { ModalText("护理动作进行中","当前动作完成后可查看学习记录。"); return; }
            Page="report";
            app.Assistant.Cancel(); Clear(); Header(); Footer();
            var p=Panel(root,"Learning report",0,86,1600,755,White);
            TextAt(p,app.Session.submitted?"本次实验 · 学习报告":"本次实验 · 进度回顾",36,24,1200,48,31,Ink,FontStyle.Bold);
            var all=app.Tasks.SelectMany(t=>t.criteria.SelectMany(c=>(t.Daily?Course.Dates:new[]{0}).Select(d=>new { task=t,criterion=c,day=d,attempt=app.Session.Find(c,d) }))).ToArray();
            int answered=all.Count(r=>r.attempt?.answered==true), performed=all.Count(r=>r.attempt?.performed==true), correct=all.Count(r=>r.attempt?.correct==true);
            if(!app.Session.submitted)
            {
                TextAt(p,"已操作 "+performed+" / "+all.Length+" 次  ·  已作答 "+answered+" 次",40,104,1400,50,25,Teal);
                TextAt(p,"术后项目分别记录第 1、2、3、7 天。提交后生成总分、分项结果和复习建议。\n未完成项目保留为未完成，已作答错误单独列出。",40,186,1400,95,19,Muted);
                TextAt(p,"本课程评分：39 项等权；每项须完成操作且判断正确。考核中操作错误每次扣该项 10%，正确完成后该项最低 50%。",40,282,1400,45,15,Muted);
                ButtonAt(p,"返回当前任务",40,338,300,56,Workspace);
                ButtonAt(p,"提交本次实验并生成报告",365,338,430,56,app.Submit,true);
                return;
            }
            TextAt(p,app.Session.Score(app.Tasks).ToString("0.0"),40,90,220,85,60,Teal,FontStyle.Bold);
            TextAt(p,"总分 / 100",43,176,220,30,17,Muted);
            TextAt(p,"理论判断  "+correct+" / "+answered+" 正确\n技能操作  "+performed+" / "+all.Length+" 已完成",300,107,390,90,21,Ink);
            float seconds=app.Session.attempts.Sum(a=>a.seconds);
            TextAt(p,"完成用时  "+Mathf.RoundToInt(seconds/60)+" 分 "+Mathf.RoundToInt(seconds%60)+" 秒\n综合完成  "+app.Tasks.Count(t=>(t.Daily?Course.Dates:new[]{0}).All(d=>app.Session.TaskDone(t,d)))+" / 27 步骤",765,107,650,90,21,Ink);
            var list=Scroll(p,"Scores",38,239,985,440,out _);
            foreach(var t in app.Tasks)
            {
                Paragraph(list,t.id+"  "+t.title,20,Teal);
                foreach(var c in t.criteria)
                {
                    var rows=all.Where(a=>a.criterion==c).ToArray();
                    string states=string.Join("  /  ",rows.Select(r=>(r.day>0?"第"+r.day+"天：":"")+(r.attempt?.answered!=true?"未完成":r.attempt.correct?"正确":"错误")));
                    Paragraph(list,c.id+"  "+c.label+"  ·  "+Mathf.RoundToInt(app.Session.CriterionScore(t,c)*100)+"%\n"+states,16,Ink);
                }
            }
            var review=Scroll(p,"Review plan",1060,239,500,440,out _);
            Paragraph(review,"你的下一次练习",23,Ink);
            var priorities=all.Where(r=>r.attempt?.answered==true&&!r.attempt.correct).Select(r=>r.task).Concat(all.Where(r=>r.attempt?.answered!=true).Select(r=>r.task)).Distinct().Take(6).ToArray();
            if(priorities.Length==0) Paragraph(review,"所有记录均已完成。可开始新考核巩固连续护理能力。",17,Teal);
            foreach(var t in priorities)
            {
                int index=Array.IndexOf(app.Tasks,t);
                int date=all.First(r=>r.task==t && r.attempt?.correct!=true).day;
                Choice(review,t.id+"  "+t.title,()=>{assistantTab=false; app.Practice(index,date);},false,54);
                Paragraph(review,string.Join("、",t.criteria.Select(c=>app.Content.knowledge.First(k=>k.id==c.knowledge).title).Distinct()),13,Muted);
            }
            if(!string.IsNullOrEmpty(app.Session.reviewOf)) { Paragraph(review,"本次复习变化",20,Teal); Paragraph(review,app.ReviewComparison(),15,Ink); }
            ButtonAt(p,"AI 成绩分析",40,695,235,42,()=>{assistantTab=true; app.SelectScenario(8,false);});
            ButtonAt(p,"AI 个性化复习",291,695,235,42,()=>{assistantTab=true; app.SelectScenario(9,false);});
            ButtonAt(p,"导出报告",544,695,235,42,ExportReport);
            ButtonAt(p,"新一轮学习",795,695,235,42,()=>{assistantTab=false; app.StartSession(false);},true);
            if(!string.IsNullOrEmpty(app.Session.reviewOf)) TextAt(p,"复习来源："+app.Session.reviewOf,1090,704,470,24,12,Muted);
        }
        void ExportReport()
        {
            var path=Path.Combine(app.Session.Folder,app.Session.id+"-report.txt"); File.WriteAllText(path,app.ReportText());
            ModalText("报告已保存",path); Application.OpenURL(new Uri(app.Session.Folder).AbsoluteUri);
        }
        void Settings()
        {
            var p=Modal("实验设置");
            ButtonAt(p,"配置内置 AI 模型",720,420,320,48,ModelConfiguration,true);
            ButtonAt(p,"运行资源用量",376,420,320,48,()=>ModalText("运行资源用量","应用与网关当前常驻内存："+(app.Usage.TotalBytes/1048576)+" MiB\n本次峰值："+(app.Usage.PeakBytes/1048576)+" MiB\n当前帧率："+app.Usage.Fps.ToString("0.0")+" FPS\n记录："+app.Usage.Save()));
            TextAt(p,"模型网关地址",32,100,1000,32,20,Ink);
            var endpoint=Input(p,app.Assistant.Endpoint,32,150,800,50); endpoint.text=app.Assistant.Endpoint;
            ButtonAt(p,"连接网关",855,150,240,50,()=>{app.Assistant.Configure(endpoint.text);},true);
            TextAt(p,"模型凭据由现有本地网关管理。应用支持流式对话；无模型连接时可阅读课程知识库。",32,225,1060,80,18,Muted);
            ButtonAt(p,Screen.fullScreen?"切换为窗口":"切换为全屏",32,340,320,52,()=>Screen.fullScreen=!Screen.fullScreen);
            ButtonAt(p,"保存并返回首页",376,340,320,52,()=>{app.Session.Save(); app.Assistant.Cancel(); Welcome();});
            ButtonAt(p,"保存并退出",720,340,320,52,()=>{app.Session.Save(); Application.Quit();});
            TextAt(p,Course.DesignNotice,32,467,1060,130,16,Muted);
        }
        public void ShowMemoryLimit(long bytes)
        {
            if(memoryNotice) return;
            memoryNotice=true; ModalText("运行内存超出课程预算","应用与网关占用 "+(bytes/1048576)+" MiB，已超过 2 GB。请保存记录并关闭应用。");
        }
        void ModelConfiguration()
        {
            var p=Modal("内置 AI 模型"); var settings=app.Gateway.Settings;
            TextAt(p,"模型服务地址",32,92,250,30,17,Ink);
            var url=Input(p,"https://…/v1",290,84,800,48); url.text=settings.baseUrl;
            TextAt(p,"模型名称",32,158,250,30,17,Ink);
            var model=Input(p,"填写服务商提供的模型名",290,150,800,48); model.text=settings.model;
            TextAt(p,"接口协议",32,224,250,30,17,Ink);
            string protocol=settings.protocol;
            var protocolLabel=TextAt(p,protocol=="responses"?"Responses":"Chat Completions",290,224,480,30,17,Teal);
            ButtonAt(p,"切换协议",810,216,280,44,()=>{protocol=protocol=="responses"?"chat":"responses"; protocolLabel.text=protocol=="responses"?"Responses":"Chat Completions";});
            TextAt(p,"API Key",32,292,250,30,17,Ink);
            var key=Input(p,"仅保存在本机应用数据目录",290,282,800,48); key.contentType=InputField.ContentType.Password; key.text=settings.apiKey;
            var status=TextAt(p,app.Gateway.State,32,355,1050,55,15,Muted);
            ButtonAt(p,"保存并连接",32,426,320,54,()=>{app.Gateway.SaveSettings(url.text,model.text,protocol,key.text); status.text=app.Gateway.State;},true);
            TextAt(p,"在线对话会把当前病例教学资料、操作状态和对话发送到上方模型服务。\n离线知识库可直接阅读课程资料。凭据保存在本机应用数据目录。",32,510,1050,108,17,Muted);
        }
        void Update()
        {
            if(UnityEngine.Input.GetKeyDown(KeyCode.Escape)&&app.inSession) Settings();
        }
    }
}
