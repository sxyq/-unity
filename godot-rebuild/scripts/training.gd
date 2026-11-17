extends Node

signal changed
const MODULES = ["操作前准备", "操作方法及原理", "术后病情观察", "知识点学习"]
const DATES = [1, 2, 3, 7]
const ACTIONS = {
	"identity":["姓名陈述","腕带姓名","腕带年龄"], "history":["受伤经过","受伤时间","疼痛"],
	"allergy":["既往病史","过敏史"], "record":["入院专科资料"], "image":["影像与术侧"],
	"prepare":["核对医嘱","手卫生","隐私保护","护理用品"],
	"consent":["说明治疗目的","回应疼痛疑问","确认患者理解"],
	"communicate":["说明当前步骤","告知配合方法","询问当前不适"],
	"inspect":["查看患肢外观","比较双侧摆位"], "palpate":["比较肢端皮温","轻触足背动脉"],
	"movement":["告知活动范围","观察足趾活动"], "measure":["选择一致骨性标志","比较双侧长度"],
	"site":["核对医嘱与术侧","核对牵引部位"], "pack":["查看包装与有效期","展开无菌区域"],
	"gloves":["手卫生","确认手套完整"], "disinfect":["核对消毒区域","由中心向周围消毒","等待干燥"],
	"drape":["核对干燥与无菌区","暴露预定操作区域"],
	"anesthesia":["核对医嘱与过敏史","告知并观察患者反应"], "pin":["确认无菌条件","配合置针并保护针端"],
	"height":["稳定支托患肢","查看局部受压"], "rope":["将绳索放入滑轮槽","查看绳索通畅"],
	"weight":["核对牵引医嘱","查看砝码自由下垂"], "alignment":["比较力线与患肢长轴","查看反牵引"],
	"device-review":["查看绳索与滑轮","核对重量与悬垂"], "effect":["比较患肢外观","结合疼痛与血运记录"],
	"pain":["询问疼痛评分","询问性质与诱因"], "pain-care":["舒适支持与遵医嘱护理","复评疼痛"],
	"neuro":["询问麻木与感觉","观察足趾活动"], "circulation":["比较颜色与皮温","触摸足背动脉"],
	"dvt":["询问新发小腿肿痛","比较双侧小腿"], "exercise":["确认允许活动范围","指导踝泵与足趾活动"],
	"bleeding":["查看敷料渗血","比较渗血范围变化"], "pin-care":["观察针道红肿渗液","无菌清洁针道"],
	"skin":["观察骶尾与足跟","评估受压与皮肤完整性"], "turn":["稳定患肢与牵引","协助体位调整与减压"],
	"lung":["询问呼吸症状","观察呼吸并听诊","指导深呼吸与有效咳嗽"],
	"elimination":["询问排泄与生活需求","保护隐私并支托患肢","协助使用便器"],
	"psych":["倾听当日担忧","回应具体情绪"], "support-plan":["商定当日护理与活动","确认理解与求助方式"]}
const DESIGN = "独立课程设计：R01–R27 / C01–C39 的映射、题目与评分为自主实现；原实验病例和已确认的任务类别沿用既有记录。5 kg、支托高度及逐日症状为教学情境。"
var content: Dictionary
var tasks: Array
var session: Dictionary
var criterion_index := 0
var storage: String
var selected := ""
var busy := false
var progress := 0.0
var notice := "请选择患者或护理设备。"
var page := "welcome"
var scenario := 0
var manual_scenario := false
var active := false
var record_section := "入院记录"

func operation_duration() -> float: return 7.416667 if criterion().operation=="gloves" else 2.6

func operation_stage() -> String:
	if not busy: return ""
	if criterion().operation=="gloves":
		if progress<.15: return "一手已戴好，撑开另一只手套袖口"
		if progress<.58: return "手掌套入，展开手指"
		if progress<.82: return "拉整袖口"
		return "双手放松，完成穿戴"
	return "正在执行："+criterion().label

func _ready() -> void:
	content = JSON.parse_string(FileAccess.get_file_as_string("res://data/CourseContent.json"))
	tasks = JSON.parse_string(FileAccess.get_file_as_string("res://data/Tasks.json"))
	storage = "/Volumes/HospitalTools/Runtime" if OS.get_name() == "macOS" else OS.get_executable_path().get_base_dir().path_join("runtime")
	DirAccess.make_dir_recursive_absolute(storage.path_join("sessions"))
	new_session(false,true)
	active = false
	page = "welcome"

func new_session(exam: bool, initialize_only:=false) -> void:
	var now := Time.get_datetime_string_from_system(true)
	session = {"id": str(Time.get_unix_time_from_system()).replace(".", "-"), "started": now,
		"exam": exam, "submitted": false, "module": 0, "task": 0, "day": 1,
		"weight": 0.0, "height": 0.26, "alignment": 18.0, "rope": false,
		"pack": false, "gloves": false, "disinfect": false, "drape": false,
		"anesthesia": false, "pin": false, "attempts": {}, "review_of": "", "days": {}}
	for i in DATES.size():
		session.days[str(DATES[i])] = {"pain": [6,4,3,2][i], "pin_clean": false, "exercise": false, "pressure_relief": false}
	active = true
	select_task(0)
	if not initialize_only: save()

func load_last() -> bool:
	var pointer := storage.path_join("last-session.txt")
	if not FileAccess.file_exists(pointer): return false
	var id := FileAccess.get_file_as_string(pointer).strip_edges()
	session = JSON.parse_string(FileAccess.get_file_as_string(storage.path_join("sessions/" + id + ".json")))
	active = true
	var saved_criterion: int=int(session.get("criterion",0))
	select_task(int(session.task))
	select_criterion(saved_criterion)
	if session.submitted: page = "report"
	changed.emit()
	return true

func save() -> void:
	if not active: return
	session.criterion=criterion_index
	FileAccess.open(storage.path_join("sessions/" + session.id + ".json"), FileAccess.WRITE).store_string(JSON.stringify(session, "\t"))
	FileAccess.open(storage.path_join("last-session.txt"), FileAccess.WRITE).store_string(session.id)

func task() -> Dictionary: return tasks[int(session.task)]
func criterion() -> Dictionary:
	var c: Dictionary = task().criteria[criterion_index]
	if c.operation == "circulation" and int(session.day) != 1:
		c = c.duplicate()
		c.question = "术后第%d天教学情境中，患者是否存在左下肢肢端血供问题？" % session.day
		c.answer = 1
		c.explanation = "本日为独立教学情境：肢端颜色正常、皮温温暖、足背动脉可扪及，按该情境判为无血供问题。"
	return c
func date_key(t: Dictionary, date: int = -1) -> int: return int(session.day if date == -1 else date) if int(t.module) == 2 else 0
func key(c: Dictionary, date: int) -> String: return c.id + ":" + str(date)
func attempt(c: Dictionary = {}, date: int = -1) -> Dictionary:
	var item := criterion() if c.is_empty() else c
	var day := date_key(task()) if date == -1 else date
	return session.attempts.get(key(item, day), {})

func begin() -> Dictionary:
	var k := key(criterion(), date_key(task()))
	if not session.attempts.has(k):
		session.attempts[k] = {"criterion": criterion().id, "day": date_key(task()), "started": Time.get_datetime_string_from_system(true),
			"performed": false, "answered": false, "correct": false, "seconds": 0.0, "errors": 0, "operations": 0, "responses": [], "observation": "", "actions": []}
	return session.attempts[k]

func select_task(index: int) -> void:
	if busy: return
	session.task = index; session.module = int(task().module)
	criterion_index = 0; selected = ""; scenario = int(task().scenario); manual_scenario = false
	page = "workspace"; notice = task().purpose
	changed.emit()

func select_module(index: int) -> void:
	if busy: return
	if index == 3:
		session.module = 3; page = "knowledge"; changed.emit(); return
	for i in tasks.size():
		if int(tasks[i].module) == index: select_task(i); return

func select_criterion(index: int) -> void:
	if busy: return
	var previous_target: String=criterion().target
	criterion_index = index
	if criterion().target!=previous_target: selected=""
	notice = "选择对应三维对象，执行护理操作。"
	changed.emit()

func select_day(day: int) -> void:
	if busy: return
	if session.exam and day > int(session.day):
		if DATES.find(day)>DATES.find(int(session.day))+1:
			notice="按第1、2、3、7天顺序完成连续护理。"; changed.emit(); return
		for t in tasks:
			if int(t.module) == 2 and not task_done(t):
				notice = "完成本日护理与患者心理护理后，进入下一日期。"; changed.emit(); return
	session.day = day; select_task(16); save()

func task_done(t: Dictionary, date: int = -1) -> bool:
	for c in t.criteria:
		var a := attempt(c, date_key(t, date))
		if not a.get("performed", false) or not a.get("answered", false): return false
	return true

func pick(id: String) -> void:
	if busy or session.submitted: return
	selected = id; notice = "已选择护理对象。"; changed.emit()

func requirement() -> String:
	if selected != criterion().target: return "请先选择「" + criterion().target + "」对应的三维对象。"
	var prerequisites := {"gloves":"pack", "disinfect":"gloves", "drape":"disinfect", "anesthesia":"drape", "pin":"anesthesia", "rope":"pin"}
	var op: String = criterion().operation
	var actions: Array=begin().get("actions",[])
	for item in ACTIONS[op]:
		if not item in actions: return "当前还需完成："+item+"。"
	if prerequisites.has(op) and not session[prerequisites[op]]: return "操作顺序未完成：先进行 " + prerequisites[op] + "。"
	if op == "height" and (session.height < 0.2 or session.height > 0.35): return "支托高度尚未符合本课程 0.20～0.35 m 方案。"
	if op == "weight" and absf(session.weight - 5) > 0.1: return "砝码与本课程 5 kg 医嘱不符。"
	if op == "alignment" and absf(session.alignment) > 4: return "调整力线，使其接近患肢纵轴。"
	if op == "device-review" and (not session.rope or absf(session.weight-5)>0.1 or absf(session.alignment)>4): return "装置存在待处理项：绳索、重量或力线。"
	return ""

func record_action(id: String, observation_text: String) -> void:
	if busy or session.submitted or (session.exam and attempt().get("answered",false)): return
	var a:=begin()
	if not a.has("actions"): a.actions=[]
	if not id in a.actions: a.actions.append(id)
	if not a.has("action_records"): a.action_records=[]
	a.action_records.append({"action":id,"observation":observation_text,"at":Time.get_datetime_string_from_system(true)})
	notice=observation_text; save(); changed.emit()

func action_text(id: String) -> String:
	var descriptions := {
		"说明当前步骤":"目前准备进行牵引护理，后续关键操作前再次告知。",
		"告知配合方法":"保持患肢稳定，出现麻木、发凉或疼痛加重及时告诉护士。",
		"询问当前不适":"患者：左大腿还是疼，操作前请告诉我，我会配合。",
		"查看患肢外观":"入院病例：左大腿肿胀、外旋，膝关节屈曲。",
		"比较双侧摆位":"对照双侧摆位与入院资料，不强行纠正骨折端。",
		"比较肢端皮温":"教学情境：双侧肢端温暖；入院病例记载皮温正常。",
		"轻触足背动脉":"教学情境：足背动脉可扪及，避免反复按压骨折端。",
		"告知活动范围":"仅观察允许范围内的足趾和踝关节活动，保持骨折处稳定。",
		"观察足趾活动":"教学情境：患者按要求轻动足趾。",
		"选择一致骨性标志":"采用双侧一致骨性标志及体位，避免凭目测填写。",
		"比较双侧长度":"入院病例：左下肢较右侧短缩约2 cm，作为治疗前参照。",
		"核对医嘱与术侧":"课程方案、病例、患者陈述及术侧标识共同对应左侧患肢。",
		"核对牵引部位":"独立课程方案：左侧胫骨结节区域。",
		"查看包装与有效期":"教学物品包装完整、干燥，处于有效期内。",
		"展开无菌区域":"按无菌原则展开穿刺包，避免越过或触碰无菌区域。",
		"手卫生":"已执行手卫生，保持双手及操作区清洁。",
		"确认手套完整":"教学物品手套完整；污染或破损时更换。",
		"核对消毒区域":"已核对左侧预定区域，准备无菌消毒。",
		"由中心向周围消毒":"从中心向周围消毒，不以用过棉签返回中心。",
		"等待干燥":"教学时间已压缩；按所用消毒剂规定作用时间等待干燥。",
		"核对干燥与无菌区":"消毒干燥后保持无菌，准备铺巾。",
		"暴露预定操作区域":"预定区域保持可见，避免随意移动已铺无菌巾。",
		"核对医嘱与过敏史":"复核教学医嘱与否认药物过敏的记录，不自行决定药物或剂量。",
		"告知并观察患者反应":"说明麻醉配合目的，持续观察疼痛、意识和不适反应。",
		"确认无菌条件":"无菌包、手套、消毒、铺巾和麻醉配合状态由前面操作记录提供。",
		"配合置针并保护针端":"配合医生置针并保护针端，不自行穿刺或旋转钢针。",
		"稳定支托患肢":"调整支托前稳定患肢，保持治疗方向。",
		"查看局部受压":"观察支托接触点及腘窝，避免局部压迫。",
		"将绳索放入滑轮槽":"连接时让绳索经过滑轮槽，避免床栏压住绳索。",
		"查看绳索通畅":"沿绳索查看滑轮与结节，保持牵引传递通畅。",
		"核对牵引医嘱":"本课程方案为5 kg，请用重量滑块设置实际值。",
		"查看砝码自由下垂":"观察砝码与床沿、地面的间隙，保持自由下垂。",
		"比较力线与患肢长轴":"比较实际偏角，用滑块调整至接近患肢纵轴。",
		"查看反牵引":"观察患者摆位、支托与牵引方向，维持反牵引。",
		"查看绳索与滑轮":"当前实际绳索状态："+("已连接。" if session.rope else "尚未连接。"),
		"核对重量与悬垂":"装置实际值：%.1f kg，偏角%.1f°。" % [session.weight,session.alignment],
		"比较患肢外观":"对照当日教学外观与入院记录，疗效需结合临床与影像。",
		"结合疼痛与血运记录":"结合当日已执行的疼痛、感觉、活动与血运记录。",
		"询问疼痛评分":"第%d天教学情境：患者报告 NRS %.0f 分。" % [session.day,session.days[str(int(session.day))].pain],
		"询问性质与诱因":content.days[DATES.find(int(session.day))].pain,
		"舒适支持与遵医嘱护理":"稳定支托，提供舒适支持，遵医嘱执行镇痛护理。",
		"复评疼痛":"护理前 NRS %.0f 分，完成后记录教学复评结果。" % session.days[str(int(session.day))].pain,
		"询问麻木与感觉":"本日教学情境：未诉新发麻木，轻触感觉存在。",
		"比较颜色与皮温":"术后第1天：肢端颜色、皮温具体状态未取得。" if int(session.day) == 1 else "本日教学情境：肢端颜色正常、皮温温暖。",
		"触摸足背动脉":"术后第1天：足背动脉具体状态未取得。" if int(session.day) == 1 else "本日教学情境：足背动脉可扪及，持续观察变化。",
		"询问新发小腿肿痛":"本日教学情境：无突发单侧小腿肿痛；卧床仍有血栓风险。",
		"比较双侧小腿":"观察双侧小腿外观；课程未提供围度数值。",
		"确认允许活动范围":"按教学方案、患者耐受和医嘱允许范围安排活动。",
		"指导踝泵与足趾活动":"指导缓慢踝泵与足趾活动，不牵动骨折处。",
		"查看敷料渗血":"本日教学情境：敷料无持续扩大的渗血。",
		"比较渗血范围变化":"记录外观变化，避免反复掀开造成污染。",
		"观察针道红肿渗液":"本日教学情境：针道未见红肿或脓性分泌物。",
		"无菌清洁针道":"按无菌原则清洁针道，不旋转钢针。",
		"观察骶尾与足跟":"本日教学情境：皮肤完整，无持续不褪色红斑。",
		"评估受压与皮肤完整性":"观察骨突部位，结合活动能力及接触点安排减压。",
		"稳定患肢与牵引":"保持患肢支托，护理时不卸除砝码。",
		"协助体位调整与减压":"协助小幅体位调整及足跟减压，维持牵引连续。",
		"询问呼吸症状":"本日教学情境：无新发气促、胸痛。",
		"观察呼吸并听诊":"完成呼吸观察及听诊演示；课程未提供呼吸频率或音频。",
		"指导深呼吸与有效咳嗽":"按耐受示范深呼吸、有效咳嗽，保持患肢稳定。",
		"询问排泄与生活需求":"本日教学情境：患者需要协助使用便器。",
		"保护隐私并支托患肢":"说明协助方法，维护隐私并稳定支托患肢。",
		"协助使用便器":"保持牵引，协助使用便器并整理床单位。",
		"倾听当日担忧":content.days[DATES.find(int(session.day))].psych,
		"回应具体情绪":"承认当日感受，提供具体支持，避免保证康复日期。",
		"商定当日护理与活动":"当日重点："+"、".join(content.days[DATES.find(int(session.day))].focus),
		"确认理解与求助方式":"请患者复述计划，出现异常或需要帮助时呼叫护士。"}
	return descriptions[id]

func operate() -> bool:
	if busy or session.submitted or (session.exam and attempt().get("answered",false)): return false
	var a := begin(); a.operations += 1
	var error := requirement()
	if not error.is_empty():
		a.errors += 1; notice = error; save(); changed.emit(); return false
	busy = true; progress = 0.0; notice = "正在执行：" + criterion().label; changed.emit()
	return true

func finish_operation() -> void:
	var op: String = criterion().operation
	if op in ["pack","gloves","disinfect","drape","anesthesia","pin","rope"]: session[op] = true
	var today: Dictionary = session.days[str(int(session.day))]
	if op == "pain-care" and not attempt().get("performed",false): today.pain = maxf(1, today.pain-1)
	if op == "exercise": today.exercise = true
	if op == "pin-care": today.pin_clean = true
	if op == "turn": today.pressure_relief = true
	var a := begin(); a.performed = true; a.observation = observation()
	busy = false; notice = a.observation; save(); changed.emit()

func observation() -> String:
	var c := criterion()
	if c.operation == "weight": return "装置实测：" + str(session.weight) + " kg。"
	if c.operation == "height": return "支托实测：%.2f m。" % session.height
	if c.operation == "alignment": return "力线偏角：%.1f°。" % session.alignment
	if int(task().module) != 2: return c.observation
	var day: Dictionary = content.days[DATES.find(int(session.day))]
	if c.operation == "pain": return "第%d天教学情境：NRS %.0f 分，%s" % [session.day,session.days[str(int(session.day))].pain,day.pain]
	if c.operation == "pain-care": return "第%d天教学情境：舒适支持后复评 NRS %.0f 分；已记录护理前后变化。" % [session.day,session.days[str(int(session.day))].pain]
	if c.operation == "neuro": return "第%d天教学情境：未诉新发麻木，足趾可在允许范围内活动。" % session.day
	if c.operation == "circulation":
		if int(session.day) == 1:
			return "术后第1天：肢端颜色、皮温、足背动脉具体状态未取得。" if session.exam and not session.submitted else c.explanation
		return "第%d天教学情境：肢端颜色正常、皮温温暖、足背动脉可扪及。" % session.day
	if c.operation == "psych": return "第%d天教学情境：%s" % [session.day,day.psych]
	if c.operation == "device-review": return "装置：%.1f kg，偏角 %.1f°，绳索%s。" % [session.weight,session.alignment,"已连接" if session.rope else "未连接"]
	return "第%d天教学情境：%s" % [session.day,c.observation]

func answer(index: int) -> void:
	var a := attempt()
	if a.is_empty() or not a.performed or busy or session.submitted or (session.exam and a.answered): return
	a.answered = true; a.correct = index == int(criterion().answer); a.answer = criterion().choices[index]
	a.responses.append({"answer":a.answer,"correct":a.correct,"at":Time.get_datetime_string_from_system(true)})
	a.ended = Time.get_datetime_string_from_system(true)
	notice = "选择已记录，提交考核后显示解析。" if session.exam else ("判断正确。" if a.correct else "请结合观察再次思考。") + criterion().explanation
	save(); changed.emit()

func next() -> void:
	if not attempt().get("answered",false): notice = "完成当前分项操作与判断后继续。"; changed.emit(); return
	if criterion_index < task().criteria.size()-1: select_criterion(criterion_index+1)
	elif not task_done(task()): notice="当前任务还有分项未完成。"; changed.emit()
	elif int(session.task) < tasks.size()-1: select_task(int(session.task)+1)
	elif int(session.day) != 7: select_day(DATES[DATES.find(int(session.day))+1])
	else: page = "report"; changed.emit()

func score(c: Dictionary, t: Dictionary) -> float:
	var dates: Array = DATES if int(t.module)==2 else [0]
	var total := 0.0
	for d in dates:
		var a := attempt(c,d)
		if a.get("performed",false) and a.get("correct",false): total += maxf(.5,1-float(a.errors)*.1) if session.exam else 1.0
	return total/dates.size()

func total_score() -> float:
	var total := 0.0
	for t in tasks:
		for c in t.criteria: total += score(c,t)
	return total*100/39

func submit() -> void:
	if busy: return
	session.submitted = true; session.finished = Time.get_datetime_string_from_system(true)
	page = "report"; scenario = 8; save(); changed.emit()

func postop_practice() -> void:
	if session.exam or session.submitted: return
	session.weight = 5; session.alignment = 0; session.height = .26; session.pin = true; session.rope = true
	notice = "已载入术后练习装置，成绩由后续操作生成。"; save(); changed.emit()

func report_text() -> String:
	var text := "本次独立实验 %s\n总分 %.1f/100\n" % [session.id,total_score()]
	for t in tasks:
		for c in t.criteria:
			var dates: Array = DATES if int(t.module)==2 else [0]
			for d in dates:
				var a := attempt(c,d)
				text += "%s/%s %s %s：%s\n" % [t.id,c.id,c.label,"第%d天"%d if d else "","未完成" if not a.get("answered",false) else ("正确" if a.correct else "错误")]
	return text

func context() -> String:
	var text := "独立Godot应用实际状态：\n模块%s；任务%s %s；分项%s\n" % [MODULES[int(session.module)],task().id,task().title,criterion().label]
	if page=="medical_record": text+="电子病历当前页签："+record_section+"\n"
	text += "装置重量%.1f kg，力线偏角%.1f°，支托%.2f m，绳索%s\n" % [session.weight,session.alignment,session.height,session.rope]
	if int(task().module)==2: text += "术后第%d天：%s\n" % [session.day,content.days[DATES.find(int(session.day))].psych]
	for a in session.attempts.values():
		if a.performed and (int(a.day)==0 or int(a.day)==int(session.day)): text += a.criterion+"："+a.observation+"\n"
	text += "考核未提交，禁止答案和选项解析。" if session.exam and not session.submitted else "学习模式或已提交，可以提供解析。"
	if not session.exam or session.submitted: text += "\n"+report_text()
	return text+"\n"+DESIGN

func _process(delta: float) -> void:
	if not active or session.submitted: return
	if busy:
		progress += delta/operation_duration()
		if progress >= 1: finish_operation()
	if page == "workspace":
		var a := begin()
		if not a.answered: a.seconds += delta

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST: save(); get_tree().quit()
