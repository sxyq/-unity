using System;
using System.Collections;
using System.Linq;
using System.Text;
using UnityEngine;

namespace TractionCare
{
    public sealed class HospitalSimulation : MonoBehaviour
    {
        public Content Content { get; private set; }
        public Task[] Tasks { get; private set; }
        public Session Session { get; private set; }
        public WardScene Ward { get; private set; }
        public TrainingUI UI { get; private set; }
        public ClinicalAssistant Assistant { get; private set; }
        public NativeGateway Gateway { get; private set; }
        public RuntimeUsage Usage { get; private set; }
        public Task CurrentTask => Tasks[Session.task];
        public Criterion Current => CurrentTask.criteria[criterionIndex];
        public Attempt CurrentAttempt => Session.Find(Current, CurrentTask.Daily ? Session.day : 0);
        public DayState Today => Session.days.Find(d => d.day == Session.day);
        public int criterionIndex, scenarioIndex;
        public bool manualScenario, busy, inSession;
        public string selected = "", notice = "点击三维对象，查看当前可执行的护理操作。";
        public float progress;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap() => new GameObject("TractionCare").AddComponent<HospitalSimulation>();
        void Awake()
        {
            Application.targetFrameRate = 45;
            QualitySettings.vSyncCount = 0;
            Content = TractionCare.Content.Load(); Tasks = Course.Create(); Session = TractionCare.Session.New(false);
            Ward = gameObject.AddComponent<WardScene>(); Ward.Create(this);
            Assistant = gameObject.AddComponent<ClinicalAssistant>(); Assistant.Initialize(this);
            UI = gameObject.AddComponent<TrainingUI>(); UI.Create(this);
            Gateway = gameObject.AddComponent<NativeGateway>(); Gateway.Initialize(this);
            Usage = gameObject.AddComponent<RuntimeUsage>(); Usage.Initialize(this);
            UI.Welcome();
        }
        public void StartSession(bool exam, bool resume = false)
        {
            if(busy) return;
            Assistant.NewSession();
            Session = resume ? TractionCare.Session.Load(PlayerPrefs.GetString("lastSession")) : TractionCare.Session.New(exam);
            inSession = true; criterionIndex = 0; selected = ""; busy = false;
            if (Session.submitted) { UI.Report(); return; }
            SelectTask(Session.task); Session.Save();
        }
        public void SelectModule(int module)
        {
            if (busy) return;
            Session.module = module;
            if (module == 3) { Assistant.Cancel(); UI.Lessons(); return; }
            SelectTask(Array.FindIndex(Tasks, t => t.module == module));
        }
        public void SelectTask(int index)
        {
            if (busy || Session.submitted) return;
            Assistant.Cancel(); Session.task = index; Session.module = CurrentTask.module;
            criterionIndex = 0; selected = ""; manualScenario = false; scenarioIndex = CurrentTask.scenario;
            notice = CurrentTask.purpose;
            Ward.Sync(); Ward.Focus(Current.target); UI.Workspace();
        }
        public void SelectCriterion(int index)
        {
            if (busy) return;
            criterionIndex = index; selected = "";
            notice = "选择「"+Ward.NameOf(Current.target)+"」执行操作后获得观察结果。"; Ward.Focus(Current.target); UI.Workspace();
        }
        public void SelectDate(int date)
        {
            if (busy) return;
            if (Session.exam && date > Session.day && !Tasks.Where(t => t.Daily).All(t => Session.TaskDone(t,Session.day)))
            { notice = "完成当前日期的护理任务及患者心理护理后进入下一日期。"; UI.RefreshOperation(); return; }
            Session.day = date; SelectTask(Session.task); Session.Save();
        }
        public void SelectScenario(int index, bool manual)
        {
            Assistant.Cancel(); scenarioIndex = index; manualScenario = manual; UI.ShowAssistant();
        }
        public void Pick(string id)
        {
            if (!inSession || busy || Session.submitted) return;
            PickDirect(id);
            if (id == "patient") UI.PatientMenu();
        }
        public void PickDirect(string id)
        {
            selected = id;
            notice = id == Current.target ? "已选中 " + Ward.NameOf(id) + "。完成下方操作后记录判断。" : "已选中 " + Ward.NameOf(id) + "；当前任务需要 " + Ward.NameOf(Current.target) + "。";
            Ward.Select(id); UI.RefreshOperation();
        }
        public string Requirement()
        {
            var s = Session;
            if (selected != Current.target) return "请在三维场景中选择「" + Ward.NameOf(Current.target) + "」。";
            switch (Current.operation)
            {
                case "gloves": if (!s.sterilePack) return "先打开并确认无菌包。"; break;
                case "disinfect": if (!s.gloves) return "先完成无菌手套操作。"; break;
                case "drape": if (!s.disinfected) return "先完成皮肤消毒。"; break;
                case "anesthesia": if (!s.draped) return "先完成消毒、铺巾。"; break;
                case "pin": if (!s.anesthetized) return "先完成麻醉配合与观察。"; break;
                case "rope": if (!s.pinPlaced) return "先完成牵引针就位。"; break;
                case "height": if (s.limbHeight < .20f || s.limbHeight > .35f) return "当前支托不符合本课程 0.20～0.35 m 的方案。"; break;
                case "weight": if (Mathf.Abs(s.weight - 5f) > .1f) return "当前砝码重量与本课程 5 kg 教学医嘱不符。"; break;
                case "alignment": if (Mathf.Abs(s.alignment) > 4) return "调整力线至接近患肢纵轴。"; break;
                case "device-review":
                    if (!s.ropeAttached || Mathf.Abs(s.weight - 5f) > .1f || Mathf.Abs(s.alignment) > 4)
                        return "装置存在待处理项：查看绳索、医嘱重量和力线。";
                    break;
            }
            return "";
        }
        public void Adjust(string parameter, float value)
        {
            if (busy || Session.submitted) return;
            if (parameter == "weight") Session.weight = Mathf.Round(value * 2) / 2;
            if (parameter == "height") Session.limbHeight = value;
            if (parameter == "alignment") Session.alignment = value;
            Ward.Sync();
        }
        public void Operate()
        {
            if (busy || Session.submitted || (Session.exam && CurrentAttempt?.answered == true)) return;
            var a = Session.Begin(Current, CurrentTask.Daily ? Session.day : 0); a.attempts++;
            var required = Requirement();
            if (required.Length > 0) { notice = required; a.errors++; Session.Save(); UI.RefreshOperation(); return; }
            StartCoroutine(Perform(a, Current));
        }
        IEnumerator Perform(Attempt a, Criterion c)
        {
            busy = true; progress = 0; notice = "正在进行：" + c.label; UI.RefreshOperation();
            Ward.Animate(c.operation);
            while (progress < 1) { progress += Time.deltaTime / 2.6f; UI.SetProgress(progress); yield return null; }
            switch (c.operation)
            {
                case "consent": Session.consent = true; break;
                case "pack": Session.sterilePack = true; break;
                case "gloves": Session.gloves = true; break;
                case "disinfect": Session.disinfected = true; break;
                case "drape": Session.draped = true; break;
                case "anesthesia": Session.anesthetized = true; break;
                case "pin": Session.pinPlaced = true; break;
                case "rope": Session.ropeAttached = true; break;
                case "turn": Today.skinSupported = true; break;
                case "pin-care": Today.pinClean = true; break;
                case "exercise": Today.exercised = true; break;
                case "pain-care": Today.pain = Mathf.Max(1, Today.pain - 1); break;
            }
            a.performed = true; a.operation = c.operation; a.observation = Observation(c);
            notice = a.observation; busy = false; Ward.Sync(); Session.Save(); UI.RefreshOperation();
        }
        public string Observation(Criterion c)
        {
            if(c.operation=="weight") return "已设置牵引重量 "+Session.weight.ToString("0.0")+" kg，与本课程 5 kg 医嘱相符。";
            if(c.operation=="height") return "已将支托调整至 "+Session.limbHeight.ToString("0.00")+" m；保持患肢稳定并观察受压部位。";
            if(c.operation=="alignment") return "当前牵引力线偏角 "+Session.alignment.ToString("0.0")+"°，砝码自由下垂。";
            if (!CurrentTask.Daily) return c.observation;
            var day = Content.days.First(d => d.day == Session.day);
            switch (c.operation)
            {
                case "pain": return "第 " + Session.day + " 天教学情境：患者报告 NRS " + Today.pain.ToString("0") + " 分。" + day.pain;
                case "psych": return "第 " + Session.day + " 天教学情境：" + day.psych;
                case "device-review": return "装置当前读数：" + Session.weight.ToString("0.0") + " kg；力线偏角 " + Session.alignment.ToString("0") + "°；绳索" + (Session.ropeAttached ? "已连接" : "未连接") + "。";
                case "pain-care": return "已提供舒适支持；本课程患者再次报告 NRS " + Today.pain.ToString("0") + " 分，已记录复评。";
                default: return "第 " + Session.day + " 天教学情境：" + c.observation;
            }
        }
        public void Answer(int index)
        {
            var a = CurrentAttempt;
            if (a == null || !a.performed || busy || Session.submitted || (Session.exam && a.answered)) return;
            a.answered = true; a.correct = index == Current.answer; a.selectedAnswer = Current.choices[index];
            a.responses.Add(new ResponseRecord { answer=a.selectedAnswer,correct=a.correct,at=DateTime.UtcNow.ToString("o") });
            a.endedAt = DateTime.UtcNow.ToString("o");
            notice = Session.exam ? "判断已记录。考核提交后显示解析。" : (a.correct ? "判断正确。" : "本次判断需重新思考。") + Current.explanation;
            Session.Save(); UI.Workspace();
        }
        public void Next()
        {
            if (!Session.TaskDone(CurrentTask, Session.day)) { notice = "完成当前任务所有操作与判断后进入下一步。"; UI.RefreshOperation(); return; }
            if (Session.task < Tasks.Length - 1) SelectTask(Session.task + 1);
            else if (Session.day != 7)
            {
                if (!Tasks.Where(t=>t.Daily).All(t=>Session.TaskDone(t,Session.day))) { notice="还有本日护理任务未完成。"; UI.RefreshOperation(); return; }
                Session.day = Course.Dates[Array.IndexOf(Course.Dates, Session.day) + 1]; SelectTask(16);
            }
            else UI.Report();
        }
        public void BeginPostopPractice()
        {
            if (Session.exam) { notice = "考核中请通过术中操作建立牵引装置。"; UI.RefreshOperation(); return; }
            Session.weight = 5; Session.alignment = 0; Session.limbHeight = .26f;
            Session.pinPlaced = true; Session.ropeAttached = true;
            notice = "已载入术后练习起始装置；各项得分由后续实际操作产生。";
            Ward.Sync(); Session.Save(); UI.RefreshOperation();
        }
        public void Submit()
        {
            Session.submitted = true; Session.finishedAt = DateTime.UtcNow.ToString("o"); Session.Save();
            Assistant.Cancel(); scenarioIndex = 8; manualScenario = false; UI.Report();
        }
        public void Practice(int task, int date)
        {
            string previous=Session.id;
            StartSession(false); Session.reviewOf=previous; Session.day=date==0?1:date;
            SelectTask(task);
            if(CurrentTask.Daily) BeginPostopPractice();
            Session.Save();
        }
        public string ReportText()
        {
            var b = new StringBuilder("独立重建应用 · 本次实验 " + Session.id + "\n");
            b.AppendLine("总分 " + Session.Score(Tasks).ToString("0.0") + "/100；39 项按实际完成情况计算，术后项目按四个日期平均。");
            foreach (var t in Tasks) foreach (var c in t.criteria)
            {
                var dates = t.Daily ? Course.Dates : new[] { 0 };
                foreach (int date in dates)
                {
                    var a = Session.Find(c, date);
                    b.Append(t.id + "/" + c.id + " " + c.label + (date > 0 ? " 第" + date + "天" : "") + "：");
                    b.AppendLine(a?.answered != true ? "未完成" : (a.correct && a.performed ? "正确" : "判断错误") + "；" + a.seconds.ToString("0") + "秒；操作错误" + a.errors + "次；作答"+a.responses.Count+"次");
                }
            }
            return b.ToString();
        }
        public string ReviewComparison()
        {
            if(string.IsNullOrEmpty(Session.reviewOf)) return "";
            var previous=TractionCare.Session.Load(Session.reviewOf);
            return string.Join("\n",Session.attempts.Where(a=>a.answered).Select(a=>
            {
                var old=previous.attempts.Find(p=>p.criterion==a.criterion&&p.day==a.day);
                string before=old?.answered!=true?"未完成":old.correct?"正确":"错误";
                return a.criterion+(a.day>0?" 第"+a.day+"天":"")+"："+before+" → "+(a.correct?"正确":"错误");
            }));
        }
        public string Context()
        {
            var b = new StringBuilder("当前为独立重建 Unity 应用；以下为应用真实交互记录。\n");
            b.AppendLine("模式：" + (Session.exam && !Session.submitted ? "考核中，任何场景均不得提供答案或选项" : "学习/已提交，可提供解析"));
            b.AppendLine("模块：" + Course.Modules[Session.module] + "；任务：" + CurrentTask.id + " " + CurrentTask.title);
            b.AppendLine("当前操作：" + Current.label + "；已选对象：" + Ward.NameOf(selected));
            b.AppendLine("应用装置：重量" + Session.weight + "kg；偏角" + Session.alignment + "°；支托" + Session.limbHeight + "m；绳索" + Session.ropeAttached + "；牵引针" + Session.pinPlaced);
            if (CurrentTask.Daily) b.AppendLine("当前术后第" + Session.day + "天，教学情境：" + Content.days.First(d => d.day == Session.day).psych);
            foreach (var a in Session.attempts.Where(a => a.performed && (a.day == 0 || a.day == Session.day))) b.AppendLine(a.criterion + "观察：" + a.observation);
            if (Session.submitted) b.Append(ReportText());
            b.AppendLine(Course.DesignNotice); return b.ToString();
        }
        void Update()
        {
            if(!inSession || Session.submitted || Session.module==3 || UI.Page!="workspace") return;
            var a=Session.Begin(Current,CurrentTask.Daily?Session.day:0);
            if(!a.answered) a.seconds+=Time.unscaledDeltaTime;
        }
        void OnApplicationPause(bool paused) { if (paused && inSession) Session.Save(); }
        void OnApplicationQuit() { if (inSession) Session.Save(); }
    }
}
