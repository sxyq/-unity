extends CanvasLayer

var training: Node
var ward: Node3D
var assistant: Node
var root: Control
var right: PanelContainer
var chat_box: VBoxContainer
var chat_status: Label
var chat_text: RichTextLabel
var input: TextEdit
var operation_progress: ProgressBar
var assistant_tab:=false
var theme: Theme
var window_size:=Vector2.ZERO
var operation_scroll: ScrollContainer
var scroll_key: String=""
var record_tab:=0
var operation_caption: Label
const INK=Color("19333c")
const MUTED=Color("647c81")
const TEAL=Color("207d7e")
const PALE=Color("edf4f1")

func setup(model: Node, world: Node3D, ai: Node) -> void:
	training=model; ward=world; assistant=ai
	theme=Theme.new(); theme.default_font=load("res://assets/NotoSansCJKsc-Regular.otf"); theme.default_font_size=16
	theme.set_color("font_color","Label",INK)
	for state in ["normal","hover","pressed","focus"]:
		var style=StyleBoxFlat.new(); style.bg_color=PALE if state=="normal" else Color("d6e9e3")
		style.content_margin_left=15; style.content_margin_right=15; style.content_margin_top=12; style.content_margin_bottom=12
		style.corner_radius_top_left=6; style.corner_radius_top_right=6; style.corner_radius_bottom_left=6; style.corner_radius_bottom_right=6
		theme.set_stylebox(state,"Button",style)
	theme.set_color("font_color","Button",INK)
	training.changed.connect(render)
	assistant.updated.connect(update_chat)
	render()

func label(parent: Node, text: String, size:=16, color:=INK) -> Label:
	var item=Label.new(); item.text=text; item.add_theme_font_size_override("font_size",size); item.add_theme_color_override("font_color",color)
	item.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART; item.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	parent.add_child(item); return item

func button(parent: Node,text: String,action: Callable,primary:=false) -> Button:
	var item=Button.new(); item.text=text; item.alignment=HORIZONTAL_ALIGNMENT_LEFT
	item.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART; item.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	if primary:
		var style=theme.get_stylebox("normal","Button").duplicate(); style.bg_color=TEAL
		item.add_theme_stylebox_override("normal",style); item.add_theme_color_override("font_color",Color.WHITE)
	item.pressed.connect(action); parent.add_child(item); return item

func panel(parent: Node,area: Rect2,color:=Color("fcfdfb")) -> PanelContainer:
	var node=PanelContainer.new(); node.position=area.position; node.size=area.size
	var style=StyleBoxFlat.new(); style.bg_color=color
	node.add_theme_stylebox_override("panel",style); parent.add_child(node); return node

func column(parent: Node, margins:=20) -> VBoxContainer:
	var margin=MarginContainer.new(); margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for edge in ["left","right","top","bottom"]: margin.add_theme_constant_override("margin_"+edge,margins)
	parent.add_child(margin)
	var box=VBoxContainer.new(); box.add_theme_constant_override("separation",12); margin.add_child(box); return box

func scroll_column(parent: Node) -> VBoxContainer:
	var scroll=ScrollContainer.new(); scroll.size_flags_vertical=Control.SIZE_EXPAND_FILL; scroll.size_flags_horizontal=Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED; parent.add_child(scroll)
	var box=VBoxContainer.new(); box.size_flags_horizontal=Control.SIZE_EXPAND_FILL; box.add_theme_constant_override("separation",12); scroll.add_child(box); return box

func clear_children(node: Node) -> void:
	for child in node.get_children(): node.remove_child(child); child.queue_free()

func render() -> void:
	var key: String="%s:%s:%d:%d" % [training.page,training.task().id,training.criterion_index,training.scenario]
	var offset: int=operation_scroll.scroll_vertical if is_instance_valid(operation_scroll) and key==scroll_key else 0
	scroll_key=key; operation_scroll=null
	if root: root.queue_free()
	chat_box=null; chat_text=null; chat_status=null; input=null; operation_progress=null; operation_caption=null
	root=Control.new(); root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT); root.mouse_filter=Control.MOUSE_FILTER_IGNORE; root.theme=theme; add_child(root)
	window_size=get_viewport().get_visible_rect().size
	if training.page=="welcome": welcome(); return
	header()
	match training.page:
		"workspace": workspace()
		"medical_record": medical_record()
		"modules": module_menu()
		"knowledge": knowledge()
		"report": report()
	if is_instance_valid(operation_scroll): operation_scroll.set_deferred("scroll_vertical",offset)

func welcome() -> void:
	var page=panel(root,Rect2(Vector2.ZERO,window_size),Color("eef5f1"))
	var box=column(page,70)
	label(box,"ORTHOPAEDIC NURSING",17,TEAL)
	label(box,"从观察，到护理判断。",46)
	label(box,training.content.title,25,MUTED)
	label(box,"李波  /  男 · 33 岁  /  左侧股骨中下段骨折",20)
	label(box,"进入病房、与患者沟通、执行护理操作，再根据观察作出判断。\n四大模块和十个助教场景跟随实际任务同步。",20,MUTED)
	button(box,"进入病房 · 1.入院记录 →",func(): assistant_tab=false; training.new_session(false); training.select_task(2); ward.focus_object("chart"),true)
	button(box,"开始独立考核",func(): assistant_tab=false; training.new_session(true))
	if FileAccess.file_exists(training.storage.path_join("last-session.txt")): button(box,"继续上次记录",func(): training.load_last())
	label(box,training.DESIGN,14,MUTED)
	label(box,"Godot 4.7.2 + Blender  /  全部项目资料位于外置盘",14,TEAL)

func header() -> void:
	var top=panel(root,Rect2(0,0,window_size.x,90),INK)
	var row=HBoxContainer.new(); row.position=Vector2(20,20); row.size=Vector2(window_size.x-40,50); row.add_theme_constant_override("separation",12); top.add_child(row)
	var title=label(row,"骨牵引护理",23,Color.WHITE); title.custom_minimum_size.x=195
	for i in range(4):
		var index=i
		button(row,"%02d  %s" % [i+1,training.MODULES[i]],func(): training.select_module(index),int(training.session.module)==i)
	button(row,"考核模式" if training.session.exam else "学习模式",func(): popup_text("当前模式","考核提交前不会显示正确答案。手动切换助教保持考核状态。"))
	button(row,"学习报告",func(): if not training.busy: training.page="report"; render())
	button(row,"设置",settings)

func workspace() -> void:
	var h=window_size.y-90
	var left=column(panel(root,Rect2(0,90,260,h)))
	label(left,training.MODULES[int(training.session.module)],23)
	label(left,"当前任务："+training.task().id,13,MUTED)
	if int(training.session.module)==2:
		var dates=HBoxContainer.new(); left.add_child(dates)
		for d in training.DATES:
			var date=d
			button(dates,str(d)+" 天",func(): training.select_day(date),d==int(training.session.day))
	var tasks_box=scroll_column(left)
	if int(training.session.module)==0:
		for entry in [[2,"1.入院记录"],[3,"2.术前准备"],[4,"3.术前谈话"]]:
			var index: int=entry[0]
			button(tasks_box,entry[1],func():
				training.select_task(index)
				if index==2: open_medical_record()
			,index==int(training.session.task))
	if int(training.session.module)==1:
		for entry in [[5,"1.医患沟通"],[6,"2.体格检查"],[7,"4.手术治疗"]]:
			var index: int=entry[0]
			if index==7: button(tasks_box,"3.辅助检查",func(): training.select_task(6); open_medical_record())
			button(tasks_box,entry[1],func(): training.select_task(index),index==int(training.session.task) or (index==7 and int(training.session.task)>7))
		if int(training.session.task)>=7:
			label(tasks_box,"手术治疗 · 操作顺序",14,MUTED)
			for i in range(7,16):
				var index=i
				var names=["确认穿刺部位","打开穿刺包","戴无菌手套","消毒","铺巾","麻醉","穿刺","调节肢体高度","牵引"]
				button(tasks_box,("✓ " if training.task_done(training.tasks[i]) else "")+str(i-6)+". "+names[i-7],func(): training.select_task(index),i==int(training.session.task))
	for i in training.tasks.size():
		var task: Dictionary=training.tasks[i]
		if int(task.module)!=int(training.session.module) or int(task.module) in [0,1] or task.id=="R27": continue
		var index=i
		button(tasks_box,("✓  " if training.task_done(task) else "")+task.id+"  "+task.title,func(): training.select_task(index),i==int(training.session.task))
	var info=panel(root,Rect2(280,106,window_size.x-750,88),Color(1,1,1,.93))
	var is_record: bool=int(training.session.module)==0 and int(training.session.task)==2
	var title_box=column(info,12)
	label(title_box,"1.入院记录" if is_record else training.task().id+"  "+training.task().title,23)
	label(title_box,"查阅入院记录、辅助检查和专科检查资料。" if is_record else training.task().purpose,14,MUTED)
	var footer=panel(root,Rect2(280,window_size.y-90,window_size.x-750,75),Color(1,1,1,.93))
	var row=HBoxContainer.new(); column(footer,10).add_child(row)
	button(row,"聚焦操作对象",func(): ward.focus_object(training.criterion().target))
	button(row,"定位患者",func(): ward.focus_object("patient"))
	label(row,"右键环视 / 滚轮缩放 / 右键+WASD漫游",12,MUTED)
	right=panel(root,Rect2(window_size.x-440,90,440,h))
	var right_box=column(right,18)
	var tabs=HBoxContainer.new(); right_box.add_child(tabs)
	button(tabs,"操作与判断",func(): assistant_tab=false; render(),not assistant_tab)
	button(tabs,"智能助教",func(): assistant_tab=true; render(),assistant_tab)
	if assistant_tab: show_assistant(right_box)
	else:
		var operations=scroll_column(right_box)
		operation_scroll=operations.get_parent()
		operation_panel(operations)

func operation_panel(box: VBoxContainer) -> void:
	if int(training.session.module)==0 and int(training.session.task)==2:
		label(box,"1.入院记录",24)
		label(box,"点击床尾病历对象，或打开电子病历。",18,MUTED)
		button(box,"打开电子病历",open_medical_record,true)
		return
	label(box,"当前任务分项",13,MUTED)
	for i in training.task().criteria.size():
		var index=i
		button(box,training.task().criteria[i].id+"  "+training.task().criteria[i].label,func(): training.select_criterion(index),i==training.criterion_index)
	label(box,"01  选择并操作对象",20)
	label(box,"需要："+ward.name_of(training.criterion().target)+"\n已选："+ward.name_of(training.selected),15,MUTED)
	var op: String=training.criterion().operation
	if training.selected==training.criterion().target: preparation_actions(box,op)
	if op=="weight" or op=="device-review": slider(box,"牵引重量 / kg","weight",0,10,.5)
	if op=="height": slider(box,"支托高度 / m","height",.08,.45,.01)
	if op=="alignment" or op=="device-review": slider(box,"力线偏角 / °","alignment",-25,25,1)
	if int(training.task().module)==2 and not training.session.rope and not training.session.exam: button(box,"载入术后练习起始装置",func(): training.postop_practice())
	var execute=button(box,"正在操作…" if training.busy else "执行「"+training.criterion().label+"」",func(): training.operate(),true)
	execute.disabled=training.busy or training.session.submitted
	if training.busy:
		operation_progress=ProgressBar.new(); operation_progress.max_value=1; box.add_child(operation_progress)
		operation_caption=label(box,training.operation_stage(),16,TEAL)
	label(box,training.notice,15,MUTED)
	var attempt: Dictionary=training.attempt()
	if attempt.get("performed",false):
		label(box,"02  依据观察作出判断",20)
		if training.notice!=attempt.observation: label(box,attempt.observation,15,MUTED)
		label(box,training.criterion().question,17)
		for i in training.criterion().choices.size():
			var index=i
			var option=button(box,char(65+i)+". "+training.criterion().choices[i],func(): training.answer(index))
			option.disabled=training.session.submitted or (training.session.exam and attempt.answered)
		if attempt.get("answered",false): label(box,"已选择："+attempt.answer,14,TEAL)
	button(box,"下一分项 / 下一任务 →",func(): training.next(),true)

func preparation_actions(box: VBoxContainer,op: String) -> void:
	var actions: Array=[]
	match op:
		"identity": actions=[["姓名陈述","患者：我叫李波。"],["腕带姓名","腕带姓名：李波；与患者陈述一致。"],["腕带年龄","腕带年龄：33岁；病历记录男、33岁。"]]
		"history": actions=[["受伤经过",fact("受伤经过")],["受伤时间",fact("受伤时间")],["疼痛",fact("疼痛")+"\n"+fact("疼痛评分")],["伴随症状",fact("伴随症状")]]
		"allergy": actions=[["既往病史",fact("既往病史")],["过敏史",fact("过敏史")],["个人史",fact("个人史")]]
		"record": actions=[["入院专科资料",fact("专科检查")],["辅助检查资料",fact("辅助检查")]]
		"image": actions=[["影像与术侧",fact("辅助检查")+"\n病例术侧：左侧。"]]
		"prepare": actions=[["核对医嘱","已阅读本课程骨牵引方案，实际医疗须遵循明确医嘱。"],["手卫生","已完成操作前手卫生。"],["隐私保护","已整理床单位并拉起隐私帘。"],["护理用品","已核对无菌包、手套、消毒用品、量诊工具及牵引装置。"]]
		"consent": actions=[["说明治疗目的","护士说明牵引目的及持续配合要求。患者：我明白要保持腿的位置，不能自己动砝码。"],["回应疼痛疑问","护士说明疼痛评估和遵医嘱镇痛。患者：疼的时候我会告诉您，不自己忍着。"],["确认患者理解","患者复述：配合摆位，不自行增减砝码，出现麻木、发凉或疼痛加重及时报告。"]]
	if actions.is_empty():
		for id in training.ACTIONS[op]: actions.append([id,training.action_text(id)])
	for item in actions:
		var id: String=item[0]; var observation_text: String=item[1]
		var done: bool=id in training.attempt().get("actions",[])
		var control=button(box,("✓ " if done else "")+id,func(): training.record_action(id,observation_text))
		control.disabled=training.busy or training.session.submitted or (training.session.exam and training.attempt().get("answered",false))

func fact(key: String) -> String:
	for item in training.content.facts:
		if item.k==key: return item.v+"\n来源："+item.source
	return ""

func open_medical_record() -> void:
	if training.busy: return
	assistant.cancel(); record_tab=0; training.selected="chart"
	training.record_section="入院记录"
	training.page="medical_record"; render()

func medical_record() -> void:
	var box=column(panel(root,Rect2(70,112,window_size.x-140,window_size.y-140)),26)
	var heading=HBoxContainer.new(); box.add_child(heading)
	label(heading,"电子病历",30)
	button(heading,"返回",func(): training.page="modules"; render())
	button(heading,"退出病历",func():
		var prompt=popup("提示",false)
		label(prompt,"有考核点未做完，请完成后退出。",22)
		button(prompt,"确定",func(): render(),true)
	)
	var tabs=HBoxContainer.new(); box.add_child(tabs)
	for i in range(3):
		var index=i
		button(tabs,["入院记录","辅助检查","专科检查"][i],func():
			record_tab=index; training.record_section=["入院记录","辅助检查","专科检查"][index]; render()
		,record_tab==i)
	var details=scroll_column(box)
	var patient: Dictionary=training.content.patient
	if record_tab==0:
		label(details,"姓名：%s    性别：%s    年龄：%d岁    床位：%s" % [patient.name,patient.sex,patient.age,patient.bed],21)
		label(details,"入院："+patient.admit+"\n诊断："+patient.diagnose,19)
		label(details,"主诉：外伤致全身多处损伤6小时",20,TEAL)
		for key in ["受伤经过","伴随症状","既往病史","过敏史","个人史","婚育史","家族史"]:
			label(details,key,20,TEAL); label(details,fact(key).get_slice("\n来源：",0),19)
	elif record_tab==1:
		label(details,"辅助检查",25,TEAL)
		label(details,fact("辅助检查").get_slice("\n来源：",0),21)
	else:
		label(details,"专科检查",25,TEAL)
		label(details,fact("专科检查").get_slice("\n来源：",0),21)

func module_menu() -> void:
	var box=column(panel(root,Rect2(70,112,window_size.x-140,window_size.y-140)),30)
	label(box,"教学模块",30)
	for i in range(4):
		var index=i
		button(box,"%d. %s" % [i+1,training.MODULES[i]],func():
			training.select_module(index)
			if index==0: training.select_task(2)
		,true)

func slider(box: VBoxContainer,title: String,key: String,minimum: float,maximum: float,step: float) -> void:
	var caption=label(box,title+"  "+str(training.session[key]),15)
	var control=HSlider.new(); control.min_value=minimum; control.max_value=maximum; control.step=step; control.value=training.session[key]; control.custom_minimum_size.y=30; box.add_child(control)
	control.value_changed.connect(func(value): training.session[key]=value; caption.text=title+"  "+str(value); ward.sync())

func popup(title: String,closable:=true) -> VBoxContainer:
	var shade=ColorRect.new(); shade.color=Color(0.04,.1,.12,.65); shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT); root.add_child(shade)
	var area=Rect2(window_size*.1,window_size*.8)
	var box=column(panel(shade,area),28)
	var row=HBoxContainer.new(); box.add_child(row); label(row,title,26)
	if closable: button(row,"关闭",func(): shade.queue_free())
	return scroll_column(box)

func popup_text(title: String,text: String) -> void: label(popup(title),text,19)

func patient_menu() -> void:
	if training.busy or training.session.submitted: return
	var box=popup("患者交互 · 李波")
	label(box,"男 · 33 岁 · 创伤骨科 2 床\n左侧股骨中下段骨折",21)
	button(box,"继续当前操作："+training.criterion().label,func(): render())
	if int(training.session.module)==0:
		button(box,"1.入院记录",open_medical_record,true)
		button(box,"2.术前准备",func(): assistant_tab=false; training.select_task(3))
		button(box,"3.术前谈话",func(): assistant_tab=false; training.select_task(4))
		return
	if int(training.session.module)==1:
		for entry in [[5,"1.医患沟通"],[6,"2.体格检查"],[6,"3.辅助检查"],[7,"4.手术治疗"]]:
			var index: int=entry[0]; var name: String=entry[1]
			button(box,name,func():
				assistant_tab=false; training.select_task(index)
				if name=="3.辅助检查": open_medical_record()
			)
		return
	var entries: Array=[17,26]
	for index in entries:
		var id: int=index
		button(box,training.tasks[id].title,func(): assistant_tab=false; training.select_task(id); training.pick("patient"),id==26)

func show_assistant(box: VBoxContainer) -> void:
	var scene: Dictionary=training.content.scenarios[training.scenario]
	label(box,scene.no+"  "+scene.taskName,21)
	label(box,scene.functionName,15,TEAL)
	label(box,"手动选择 · 考核状态同步" if training.manual_scenario else "自动关联当前任务 ID · 可信度 100%",12,MUTED)
	button(box,"按教学模块切换场景",scenario_picker)
	button(box,"课程知识库",func():
		if training.session.exam and not training.session.submitted: popup_text("考核中","请独立完成观察与判断，提交后开放解析。"); return
		for lesson in training.content.knowledge:
			if lesson.id==training.criterion().knowledge: popup_text(lesson.title,lesson.body); return
	)
	chat_status=label(box,assistant.status,12,MUTED)
	chat_box=scroll_column(box)
	chat_text=RichTextLabel.new(); chat_text.fit_content=true; chat_text.scroll_active=false; chat_text.selection_enabled=true
	chat_text.add_theme_color_override("default_color",INK); chat_box.add_child(chat_text)
	if assistant.messages().is_empty():
		label(chat_box,scene.goal,15,MUTED)
		for question in scene.chips:
			var text: String=question
			button(chat_box,text,func(): assistant.send(text))
	input=TextEdit.new(); input.custom_minimum_size.y=75; input.placeholder_text="输入护理问题，或对患者说的话…"; input.wrap_mode=TextEdit.LINE_WRAPPING_BOUNDARY; box.add_child(input)
	var row=HBoxContainer.new(); box.add_child(row)
	button(row,"发送",func(): var text=input.text; input.text=""; assistant.send(text),true)
	button(row,"停止",func(): assistant.cancel())
	update_chat()

func update_chat() -> void:
	if not is_instance_valid(chat_text): return
	chat_status.text=assistant.status
	var text: String=""
	for message in assistant.messages(): text+=("你" if message.role=="user" else "助教")+"\n"+message.content+"\n\n"
	chat_text.text=text

func scenario_picker() -> void:
	var box=popup("按教学模块选择场景")
	var groups=[[0,1],[2,3,4],[5,6,7],[8,9]]
	for module in range(4):
		label(box,training.MODULES[module],21,TEAL)
		for i in groups[module]:
			var id: int=i
			var scene: Dictionary=training.content.scenarios[id]
			button(box,scene.no+"  "+scene.taskName,func(): assistant.cancel(); training.scenario=id; training.manual_scenario=true; assistant_tab=true; training.page="workspace"; render(),id==training.scenario)
			label(box,scene.goal,14,MUTED)

func knowledge() -> void:
	var box=column(panel(root,Rect2(0,90,window_size.x,window_size.y-90)),35)
	label(box,"理解原理，回到操作。",33)
	label(box,"知识巩固与错题复习使用当前实验记录。",18,MUTED)
	var list=scroll_column(box)
	for lesson in training.content.knowledge:
		var item: Dictionary=lesson
		button(list,lesson.title+" →",func(): lesson_detail(item))
	button(box,"本次学习记录",func(): training.page="report"; render(),true)

func lesson_detail(lesson: Dictionary) -> void:
	var box=popup(lesson.title); label(box,lesson.body,21)
	for i in training.tasks.size():
		var id=i
		for criterion in training.tasks[i].criteria:
			if criterion.knowledge!=lesson.id: continue
			button(box,"进入三维练习："+training.tasks[i].title,func():
				if training.session.submitted: training.new_session(false)
				assistant_tab=false; training.select_task(id)
			,true)
			if training.session.exam and not training.session.submitted: return
			label(box,criterion.question,20)
			var feedback=label(box,"请选择你的判断。",16,MUTED)
			for index in criterion.choices.size():
				var answer=index; var c: Dictionary=criterion
				button(box,criterion.choices[index],func(): feedback.text=("判断正确。" if answer==int(c.answer) else "联系观察结果再次思考。")+c.explanation)
			return

func report() -> void:
	var box=column(panel(root,Rect2(0,90,window_size.x,window_size.y-90)),30)
	label(box,"本次实验 · 学习报告" if training.session.submitted else "本次实验 · 进度回顾",32)
	var count=0; var correct=0; var seconds=0.0
	for a in training.session.attempts.values():
		if a.answered: count+=1
		if a.correct: correct+=1
		seconds+=a.seconds
	label(box,"已作答 %d 次  /  用时 %.1f 分钟" % [count,seconds/60],21,TEAL)
	if not training.session.submitted:
		label(box,"39 项等权；术后项目按第 1、2、3、7 天分别记录后平均。\n完成操作且判断正确才能得分；考核操作错误每次扣该项10%，正确完成后最低保留该项50%。",18,MUTED)
		button(box,"返回任务",func(): training.page="workspace"; render())
		button(box,"提交本次实验并生成报告",func(): training.submit(),true)
		return
	label(box,"%.1f / 100  ·  正确 %d / %d" % [training.total_score(),correct,count],35,TEAL)
	var row=HBoxContainer.new(); row.size_flags_vertical=Control.SIZE_EXPAND_FILL; row.add_theme_constant_override("separation",30); box.add_child(row)
	var list=scroll_column(row); list.custom_minimum_size.x=window_size.x*.56
	for task in training.tasks:
		label(list,task.id+"  "+task.title,21,TEAL)
		for c in task.criteria:
			var states=[]
			for d in (training.DATES if int(task.module)==2 else [0]):
				var a: Dictionary=training.attempt(c,d)
				states.append(("第%d天 " % d if d else "")+("未完成" if not a.get("answered",false) else ("正确" if a.correct else "错误")))
			label(list,"%s %s · %d%%\n%s" % [c.id,c.label,roundi(training.score(c,task)*100)," / ".join(states)],16)
	var review=scroll_column(row); label(review,"按实际记录复习",24)
	var priorities: Array=[]
	for wrong_only in [true,false]:
		for i in training.tasks.size():
			for c in training.tasks[i].criteria:
				for d in (training.DATES if int(training.tasks[i].module)==2 else [0]):
					var a: Dictionary=training.attempt(c,d)
					if (a.get("answered",false) and not a.correct) if wrong_only else not a.get("answered",false):
						if not i in priorities: priorities.append(i)
	for index in priorities.slice(0,6):
		var id: int=index
		button(review,training.tasks[id].id+"  "+training.tasks[id].title,func():
			var previous: String=training.session.id
			training.new_session(false); training.session.review_of=previous
			training.select_task(id)
			if int(training.task().module)==2: training.postop_practice()
		)
	if priorities.is_empty(): label(review,"全部记录已完成，可开展下一轮独立考核。",18)
	var actions=HBoxContainer.new(); box.add_child(actions)
	button(actions,"AI 成绩分析",func(): training.scenario=8; assistant_tab=true; training.page="workspace"; render())
	button(actions,"AI 个性化复习",func(): training.scenario=9; assistant_tab=true; training.page="workspace"; render())
	button(actions,"导出本次报告",func():
		var file: String=training.storage.path_join("sessions/"+training.session.id+"-report.txt")
		FileAccess.open(file,FileAccess.WRITE).store_string(training.report_text()); popup_text("报告已保存",file)
	)
	button(actions,"新一轮学习",func(): assistant_tab=false; training.new_session(false),true)

func settings() -> void:
	var box=popup("实验设置")
	button(box,"切换全屏 / 窗口",func(): DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_FULLSCREEN else DisplayServer.WINDOW_MODE_FULLSCREEN))
	button(box,"模型服务配置",model_settings)
	button(box,"读取应用与网关内存",show_usage)
	button(box,"关于与资源授权",func(): popup_text("关于与资源授权", "自主重建课程 · Godot 4.7.2 / Blender 4.5.15 LTS\n模型由本项目源码制作。字体为Noto Sans CJK SC。\n\n"+FileAccess.get_file_as_string("res://assets/Godot-LICENSE.txt")+"\n\n"+FileAccess.get_file_as_string("res://assets/OFL.txt")))
	button(box,"保存并返回首页",func():
		if training.busy: return
		training.save(); assistant.cancel(); training.page="welcome"; render()
	)
	button(box,"保存并退出",func(): training.save(); get_tree().quit())
	label(box,"资源目录："+training.storage+"\n引擎帧率：%d FPS" % Engine.get_frames_per_second(),16,MUTED)
	label(box,training.DESIGN,14,MUTED)

func show_usage() -> void:
	var request:=HTTPRequest.new(); add_child(request)
	request.request_completed.connect(func(result,code,_headers,data):
		request.queue_free()
		if result!=HTTPRequest.RESULT_SUCCESS or code!=200: popup_text("运行资源用量","网关未就绪，无法读取应用进程内存。"); return
		var usage: Dictionary=JSON.parse_string(data.get_string_from_utf8())
		usage["fps"]=Engine.get_frames_per_second()
		FileAccess.open(training.storage.path_join("runtime-usage.json"),FileAccess.WRITE).store_string(JSON.stringify(usage,"\t"))
		popup_text("应用与网关实际常驻内存","应用 %.1f MiB\n网关 %.1f MiB\n合计 %.1f MiB\n帧率 %d FPS\n采集时间 %s" % [usage.applicationBytes/1048576.0,usage.gatewayBytes/1048576.0,usage.totalBytes/1048576.0,usage.fps,usage.capturedAt])
	)
	request.request(assistant.endpoint+"/api/runtime-usage")

func field(box: VBoxContainer,title: String,value: String,secret:=false) -> LineEdit:
	label(box,title,17); var input_field=LineEdit.new(); input_field.text=value; input_field.secret=secret; input_field.custom_minimum_size.y=44; box.add_child(input_field); return input_field

func model_settings() -> void:
	var box=popup("内置 AI 模型配置")
	var url=field(box,"模型服务地址",assistant.settings.baseUrl)
	var model=field(box,"模型名称",assistant.settings.model)
	label(box,"接口协议",17)
	var protocol=OptionButton.new(); protocol.add_item("Responses"); protocol.add_item("Chat Completions"); protocol.selected=0 if assistant.settings.protocol=="responses" else 1; box.add_child(protocol)
	var key=field(box,"API Key · 仅保存到外置盘运行数据目录",assistant.settings.apiKey,true)
	label(box,"在线对话将当前病例教学资料、护理操作状态和对话发送到所填模型服务。",16,MUTED)
	button(box,"保存并连接",func(): assistant.configure(url.text,model.text,"responses" if protocol.selected==0 else "chat",key.text); popup_text("模型配置",assistant.status),true)

func _process(_delta: float) -> void:
	if is_instance_valid(operation_progress): operation_progress.value=training.progress
	if is_instance_valid(operation_caption): operation_caption.text=training.operation_stage()
	if root and window_size!=get_viewport().get_visible_rect().size: render()

func _unhandled_key_input(event: InputEvent) -> void:
	if event.is_pressed() and event is InputEventKey and event.keycode==KEY_ESCAPE: settings()
