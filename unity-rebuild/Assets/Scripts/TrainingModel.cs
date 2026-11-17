using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;

namespace TractionCare
{
    [Serializable] public class Fact { public string k, v, source; }
    [Serializable] public class Patient { public string name, sex, bed, diagnose, allergy, admit; public int age; }
    [Serializable] public class Lesson { public string id, title, body; public string[] tags; }
    [Serializable] public class Day { public int day; public string label, pain, psych; public string[] focus; }
    [Serializable] public class DayPrompt { public int day; public string system; }
    [Serializable] public class Scenario { public string id, no, phase, taskName, functionName, role, goal; public string[] chips; public DayPrompt[] systems; }
    [Serializable] public class Content
    {
        public string title;
        public Patient patient;
        public Fact[] facts;
        public string[] unknowns;
        public Lesson[] knowledge;
        public Day[] days;
        public Scenario[] scenarios;
        public static Content Load() => JsonUtility.FromJson<Content>(Resources.Load<TextAsset>("CourseContent").text);
    }

    public class Criterion
    {
        public string id, label, target, operation, observation, question, explanation, knowledge;
        public string[] choices;
        public int answer;
        public Criterion(string label, string target, string operation, string observation, string question,
            string choices, int answer, string explanation, string knowledge)
        {
            this.label = label; this.target = target; this.operation = operation; this.observation = observation;
            this.question = question; this.choices = choices.Split('|'); this.answer = answer;
            this.explanation = explanation; this.knowledge = knowledge;
        }
    }
    public class Task
    {
        public string id, title, purpose, source;
        public int module, scenario;
        public Criterion[] criteria;
        public bool Daily => module == 2;
        public Task(string title, int module, int scenario, string purpose, params Criterion[] criteria)
        {
            this.title = title; this.module = module; this.scenario = scenario; this.purpose = purpose;
            this.criteria = criteria; source = "依据原程序已知任务重新设计；步骤编号及评分映射为本系统设计";
        }
    }

    [Serializable] public class ResponseRecord
    {
        public string answer, at;
        public bool correct;
    }

    [Serializable] public class Attempt
    {
        public string criterion, operation, observation, selectedAnswer, startedAt, endedAt;
        public int day, attempts, errors;
        public float seconds;
        public bool answered, correct, performed;
        public List<ResponseRecord> responses = new List<ResponseRecord>();
    }
    [Serializable] public class DayState
    {
        public int day;
        public float pain;
        public string psych;
        public bool skinSupported, pinClean, exercised, informedDoctor;
    }
    [Serializable] public class Session
    {
        public string id, startedAt, finishedAt, reviewOf;
        public bool exam, submitted;
        public int module, task, day = 1;
        public float weight, limbHeight = 0.26f, alignment = 18f;
        public bool consent, ropeAttached, sterilePack, gloves, disinfected, draped, anesthetized, pinPlaced;
        public List<Attempt> attempts = new List<Attempt>();
        public List<DayState> days = new List<DayState>();
        public static Session New(bool exam)
        {
            var s = new Session { id = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff"), startedAt = DateTime.UtcNow.ToString("o"), exam = exam, limbHeight = 0.26f, alignment = 18f };
            int[] dates = { 1, 2, 3, 7 }; float[] pain = { 6, 4, 3, 2 };
            for (int i = 0; i < dates.Length; i++) s.days.Add(new DayState { day = dates[i], pain = pain[i] });
            return s;
        }
        public Attempt Find(Criterion c, int date) => attempts.Find(a => a.criterion == c.id && a.day == date);
        public Attempt Begin(Criterion c, int date)
        {
            var a = Find(c, date);
            if (a == null) { a = new Attempt { criterion = c.id, day = date, startedAt = DateTime.UtcNow.ToString("o") }; attempts.Add(a); }
            return a;
        }
        public bool TaskDone(Task t, int date) => t.criteria.All(c => {
            var a = Find(c, t.Daily ? date : 0);
            return a != null && a.performed && a.answered;
        });
        public float CriterionScore(Task t, Criterion c)
        {
            var dates = t.Daily ? new[] { 1, 2, 3, 7 } : new[] { 0 };
            return dates.Sum(d => {
                var a=Find(c,d);
                return a?.performed==true && a.correct ? (exam?Mathf.Max(.5f,1-a.errors*.1f):1f) : 0f;
            }) / dates.Length;
        }
        public float Score(Task[] tasks) => tasks.Sum(t => t.criteria.Sum(c => CriterionScore(t, c))) * 100f / tasks.Sum(t => t.criteria.Length);
        public int RecordCount => attempts.Count(a => a.performed && a.answered);
        public string Folder => Path.Combine(Application.persistentDataPath, "sessions");
        public void Save()
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(Path.Combine(Folder, id + ".json"), JsonUtility.ToJson(this, true));
            PlayerPrefs.SetString("lastSession", id); PlayerPrefs.Save();
        }
        public static Session Load(string id) => JsonUtility.FromJson<Session>(File.ReadAllText(Path.Combine(Application.persistentDataPath, "sessions", id + ".json")));
    }
}
