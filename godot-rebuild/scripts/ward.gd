extends Node3D

signal picked(id: String)
const NAMES = {"patient":"患者李波", "chart":"病历与影像", "cart":"护理车", "limb":"左侧患肢", "foot":"左足血运与活动", "site":"牵引部位与针道", "pack":"无菌穿刺包", "gloves":"无菌手套", "swab":"消毒棉签", "drape":"无菌巾", "syringe":"麻醉配合用品", "pin":"牵引针", "support":"患肢支托", "pulley":"滑轮与牵引绳", "weight":"牵引砝码", "frame":"牵引架与力线", "measure":"量诊软尺", "skin":"足跟皮肤", "stethoscope":"听诊与呼吸评估", "bedpan":"便器"}
var training: Node
var camera: Camera3D
var objects := {}
var object_index: Dictionary
var ward: Node3D
var rope: MeshInstance3D
var force_line: MeshInstance3D
var pin: MeshInstance3D
var target := Vector3(0,1,0)
var focus := Vector3(0,1,0)
var yaw := -0.65
var elevation := .42
var distance := 4.5
var limb: Node3D
var original_limb := Transform3D.IDENTITY
var foot: Node3D
var original_foot := Transform3D.IDENTITY
var action := ""
var moving := false
var hands: Node3D
var hand_parts: Array[Node3D] = []
var instrument: MeshInstance3D
var operation_origin:=Vector3.ZERO
var sterile_drape: Node3D
var cleaned_site: MeshInstance3D
var opened_pack: Node3D
var hand_materials: Array[StandardMaterial3D] = []
var glove_cuffs: Array[Node3D] = []
var loose_glove: Node3D
var focused_task: String=""

func setup(model: Node) -> void:
	training = model
	ward = load("res://assets/Ward.glb").instantiate()
	add_child(ward)
	object_index=JSON.parse_string(FileAccess.get_file_as_string("res://assets/WardObjects.json"))
	register_objects(ward)
	limb = ward.find_child("LeftLimb",true,false)
	if limb: original_limb = limb.transform
	foot = ward.find_child("Left foot",true,false)
	if foot: original_foot = foot.transform
	var environment := WorldEnvironment.new(); var env := Environment.new()
	env.background_mode = Environment.BG_COLOR; env.background_color = Color("d5e5e4")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; env.ambient_light_color = Color("c5d4d1"); env.ambient_light_energy = .25
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR; environment.environment = env; add_child(environment)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-46,-35,0); sun.light_energy = .55; sun.shadow_enabled = true; sun.directional_shadow_max_distance = 15; add_child(sun)
	var fill := OmniLight3D.new(); fill.position = Vector3(1.5,2.5,1); fill.light_energy = .15; fill.omni_range = 5; add_child(fill)
	camera = Camera3D.new(); camera.fov = 43; camera.near = .05; camera.far = 40; add_child(camera); camera.current = true
	rope = MeshInstance3D.new(); add_child(rope)
	force_line = MeshInstance3D.new(); add_child(force_line)
	pin = MeshInstance3D.new(); var mesh := CylinderMesh.new(); mesh.top_radius = .008; mesh.bottom_radius = .008; mesh.height = .36; pin.mesh = mesh; pin.rotation.z = PI/2; add_child(pin)
	var metal := StandardMaterial3D.new(); metal.albedo_color = Color("b5c6cc"); metal.metallic = .8; pin.material_override = metal
	hands = Node3D.new(); add_child(hands)
	for side in [-1,1]:
		var hand := Node3D.new(); hand.position.x = side*.12
		hands.add_child(hand); hand_parts.append(hand)
		var material := StandardMaterial3D.new()
		material.albedo_color = Color("eee4b9"); material.roughness = .78
		hand_materials.append(material)
		var palm := MeshInstance3D.new(); var handmesh := SphereMesh.new()
		handmesh.radius = .04; handmesh.height = .10
		palm.mesh = handmesh; palm.scale = Vector3(1,.4,1.3)
		palm.material_override = material; hand.add_child(palm)
		var wrist := MeshInstance3D.new(); var wristmesh := CapsuleMesh.new()
		wristmesh.radius = .023; wristmesh.height = .065
		wrist.mesh = wristmesh; wrist.rotation.x = PI/2; wrist.scale.z = .65
		wrist.position = Vector3(0,0,.06)
		wrist.material_override = material; hand.add_child(wrist)
		for digit in range(4):
			var finger := MeshInstance3D.new(); var fm := CapsuleMesh.new()
			var length: float = [.068,.078,.072,.054][digit]
			fm.radius = [.0085,.009,.008,.007][digit]; fm.height = length
			finger.mesh = fm; finger.rotation = Vector3(PI/2,side*(digit-1.5)*.035,0)
			finger.position = Vector3(side*(digit-1.5)*.017,-.004,-.03-length/2)
			finger.material_override = material; hand.add_child(finger)
		var thumb := MeshInstance3D.new(); var thumbmesh := CapsuleMesh.new()
		thumbmesh.radius = .011; thumbmesh.height = .052
		thumb.mesh = thumbmesh; thumb.rotation = Vector3(PI/2,side*.7,0)
		thumb.position = Vector3(-side*.042,-.003,-.026)
		thumb.material_override = material; hand.add_child(thumb)
		var cuff := Node3D.new(); cuff.name="GloveCuff"; cuff.position = Vector3(0,0,.073)
		hand.add_child(cuff); glove_cuffs.append(cuff); cuff.visible = false
		var turned_cuff := MeshInstance3D.new(); var sleeve := CylinderMesh.new()
		sleeve.top_radius = .029; sleeve.bottom_radius = .025; sleeve.height = .025
		sleeve.cap_top = false; sleeve.cap_bottom = false
		turned_cuff.mesh = sleeve; turned_cuff.rotation.x = PI/2; turned_cuff.scale.z = .65
		turned_cuff.material_override = material; cuff.add_child(turned_cuff)
		for edge in [-1,1]:
			var rim := MeshInstance3D.new(); var roll := TorusMesh.new()
			var radius: float = .029 if edge==1 else .025
			roll.inner_radius = radius-.002; roll.outer_radius = radius+.002
			rim.mesh = roll; rim.rotation.x = PI/2; rim.scale.z = .65; rim.position.z = edge*.0125
			rim.material_override = material; cuff.add_child(rim)
		for crease in range(2):
			var wrinkle := MeshInstance3D.new(); var fold := TorusMesh.new()
			fold.inner_radius = .022; fold.outer_radius = .0235
			wrinkle.mesh = fold; wrinkle.scale.z = .65
			wrinkle.rotation = Vector3(PI/2,0,side*(.08+crease*.06))
			wrinkle.position.z = -.022-crease*.007
			wrinkle.material_override = material; cuff.add_child(wrinkle)
	loose_glove=hand_parts[1].duplicate(); hands.add_child(loose_glove)
	var glove_material:=StandardMaterial3D.new(); glove_material.albedo_color=Color("eee4b9"); glove_material.roughness=.78
	for mesh_part in loose_glove.find_children("*","MeshInstance3D",true,false): mesh_part.material_override=glove_material
	loose_glove.find_child("GloveCuff",true,false).visible=true
	loose_glove.visible=false
	hands.visible = false
	instrument = MeshInstance3D.new(); var toolmesh := CylinderMesh.new(); toolmesh.top_radius=.006; toolmesh.bottom_radius=.006; toolmesh.height=.18; instrument.mesh=toolmesh; instrument.material_override=metal; hands.add_child(instrument)
	sterile_drape=Node3D.new(); add_child(sterile_drape)
	for side in [-1,1]:
		for axis in [0,1]:
			var cloth:=MeshInstance3D.new(); var plane:=BoxMesh.new()
			plane.size=Vector3(.14,.006,.36) if axis==0 else Vector3(.10,.006,.12)
			cloth.mesh=plane; cloth.position=Vector3(side*.12,0,0) if axis==0 else Vector3(0,0,side*.12)
			var fabric:=StandardMaterial3D.new(); fabric.albedo_color=Color("348486"); fabric.roughness=.85
			cloth.material_override=fabric; sterile_drape.add_child(cloth)
	cleaned_site=MeshInstance3D.new(); var area:=SphereMesh.new(); area.radius=.075; area.height=.006; cleaned_site.mesh=area
	var antiseptic:=StandardMaterial3D.new(); antiseptic.albedo_color=Color(.65,.35,.12,.55); antiseptic.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
	cleaned_site.material_override=antiseptic; add_child(cleaned_site)
	opened_pack=Node3D.new(); add_child(opened_pack)
	for side in [-1,1]:
		var flap:=MeshInstance3D.new(); var surface:=BoxMesh.new(); surface.size=Vector3(.17,.004,.24)
		flap.mesh=surface; flap.position.x=side*.16
		var paper:=StandardMaterial3D.new(); paper.albedo_color=Color("d5e7de"); flap.material_override=paper; opened_pack.add_child(flap)
	training.changed.connect(sync)
	sync()

func register_objects(node: Node) -> void:
	if node is MeshInstance3D and object_index.has(str(node.name)):
		var id: String = object_index[str(node.name)]
		if not objects.has(id): objects[id] = node
		var body := StaticBody3D.new(); var collider := CollisionShape3D.new()
		collider.shape = node.mesh.create_convex_shape(); body.add_child(collider); node.add_child(body); body.set_meta("care_id",id)
	for child in node.get_children(): register_objects(child)

func name_of(id: String) -> String: return "床旁柜" if id=="cabinet" else NAMES.get(id,id)
func focus_object(id: String) -> void:
	if objects.has(id): target = objects[id].to_global(objects[id].get_aabb().get_center()); distance = 3.7 if id=="patient" else 2.4

func sync() -> void:
	if not ward: return
	var s: Dictionary = training.session
	if limb: limb.transform = original_limb; limb.rotation.x = lerpf(0,.28,(s.height-.08)/.35)
	if objects.has("support"): objects.support.position.y = .68+s.height
	var start := Vector3(.215,1.05,-.64)
	if objects.has("site"): start = objects.site.to_global(objects.site.get_aabb().get_center())
	var end := Vector3(start.x+tan(deg_to_rad(s.alignment))*.9,1.35,-1.7)
	if objects.has("pulley"): objects.pulley.global_position = end
	if objects.has("weight"):
		objects.weight.position.x = end.x; objects.weight.scale.y = maxf(.12,s.weight/5)
	draw_line(rope,[start,end,Vector3(end.x,.8,-1.94)],Color("d9cda7"),.009)
	rope.visible = s.rope
	draw_line(force_line,[start,end],Color("dcab63"),.004)
	force_line.visible = int(s.module)==1
	pin.position = start; pin.visible = s.pin
	sterile_drape.position=start+Vector3(0,.05,0); sterile_drape.visible=s.drape
	cleaned_site.position=start+Vector3(0,.045,0); cleaned_site.visible=s.disinfect
	opened_pack.position=objects.pack.to_global(objects.pack.get_aabb().get_center())+Vector3(0,.04,0); opened_pack.visible=s.pack
	for i in hand_materials.size():
		hand_materials[i].albedo_color=Color("eee4b9") if s.gloves else Color("d4aa8d")
		glove_cuffs[i].visible=s.gloves
	var task_key: String=training.task().id+":"+str(training.criterion_index)
	if training.page=="workspace" and not training.busy and task_key!=focused_task:
		focused_task=task_key; focus_object(training.criterion().target)

func draw_line(object: MeshInstance3D, points: Array, color: Color, radius: float) -> void:
	var mesh := ImmediateMesh.new()
	var material := StandardMaterial3D.new(); material.albedo_color=color; material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES,material)
	for i in range(points.size()-1):
		var a: Vector3=points[i]; var b: Vector3=points[i+1]
		var tangent: Vector3=(b-a).normalized(); var right: Vector3=tangent.cross(Vector3.UP).normalized()*radius
		if right.length()<.00001: right=Vector3.RIGHT*radius
		var up: Vector3=tangent.cross(right).normalized()*radius
		for j in range(8):
			var r1: Vector3=right*cos(j*TAU/8)+up*sin(j*TAU/8)
			var r2: Vector3=right*cos((j+1)*TAU/8)+up*sin((j+1)*TAU/8)
			for v in [a+r1,b+r2,b+r1,a+r1,a+r2,b+r2]: mesh.surface_add_vertex(v)
	mesh.surface_end(); object.mesh=mesh

func animate(operation: String) -> void:
	action=operation; moving=true; hands.visible=operation not in ["identity","history","allergy","consent","communicate","psych","support-plan","record","image"]
	hands.rotation=Vector3.ZERO; hands.scale=Vector3.ONE; loose_glove.visible=false
	for i in hand_parts.size():
		hand_parts[i].position=Vector3((i*2-1)*.12,0,0); hand_parts[i].rotation=Vector3.ZERO
	instrument.visible=operation in ["pin","disinfect","pin-care","anesthesia"]
	var id: String="site" if operation in ["pin","disinfect","pin-care","anesthesia","drape"] else training.criterion().target
	operation_origin=objects[id].to_global(objects[id].get_aabb().get_center())
	target=operation_origin
	if operation=="gloves":
		target+=Vector3(0,.25,0); distance=1.15
	if operation in ["pin","anesthesia"]: instrument.rotation.z=PI/2
	else: instrument.rotation.z=0

func _unhandled_input(event: InputEvent) -> void:
	if not camera or not training.active: return
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		yaw-=event.relative.x*.005; elevation=clampf(elevation+event.relative.y*.004,.12,1.2)
	if event is InputEventMouseButton and event.pressed:
		if event.button_index==MOUSE_BUTTON_WHEEL_UP: distance=maxf(1.1,distance-.2)
		if event.button_index==MOUSE_BUTTON_WHEEL_DOWN: distance=minf(6,distance+.2)
		if event.button_index==MOUSE_BUTTON_LEFT:
			var origin:=camera.project_ray_origin(event.position)
			var query:=PhysicsRayQueryParameters3D.create(origin,origin+camera.project_ray_normal(event.position)*30)
			var hit:=get_world_3d().direct_space_state.intersect_ray(query)
			if not hit.is_empty(): picked.emit(hit.collider.get_meta("care_id",""))

func _process(delta: float) -> void:
	if not camera: return
	focus=focus.lerp(target,minf(1,delta*5))
	camera.position=focus+Vector3(sin(yaw)*cos(elevation),sin(elevation),cos(yaw)*cos(elevation))*distance
	camera.look_at(focus)
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var direction:=Vector3(float(Input.is_physical_key_pressed(KEY_D))-float(Input.is_physical_key_pressed(KEY_A)),0,float(Input.is_physical_key_pressed(KEY_S))-float(Input.is_physical_key_pressed(KEY_W)))
		target+=Basis(Vector3.UP,yaw)*direction*delta
	if moving:
		var phase: float=training.progress
		hands.position=operation_origin+Vector3(0,.3-sin(phase*PI)*.15,.15)
		if action=="gloves":
			var insertion: float=smoothstep(.15,.58,phase)
			var release: float=smoothstep(.82,1,phase)
			hands.position=operation_origin+Vector3(0,.25,.08); hands.rotation.y=yaw
			hand_parts[0].position=Vector3(lerpf(-.025,-.12,release),.09+sin(smoothstep(.6,.82,phase)*PI)*.025,.025)
			hand_parts[1].position=Vector3(.10,lerpf(.18,0,insertion),0)
			hand_parts[0].rotation=Vector3(-PI/2,0,lerpf(.65,0,release))
			hand_parts[1].rotation=Vector3(-PI/2,0,sin(phase*PI)*.08)
			hand_materials[0].albedo_color=Color("eee4b9"); glove_cuffs[0].visible=true
			hand_materials[1].albedo_color=Color("eee4b9") if phase>=.58 else Color("d4aa8d")
			glove_cuffs[1].visible=phase>=.58
			glove_cuffs[1].scale.z=1+sin(smoothstep(.58,.82,phase)*PI)*.35
			loose_glove.position=Vector3(.10,0,0); loose_glove.rotation=Vector3(-PI/2,0,0)
			loose_glove.scale=Vector3(1.04,1.04,1.04); loose_glove.visible=phase<.58
		if action in ["disinfect","pin-care"]: hands.position+=Vector3(sin(phase*14)*.04,0,cos(phase*14)*.04)
		if action=="pin": hands.position.x+=lerpf(.2,-.1,phase)
		if action=="drape": hands.scale=Vector3(1+sin(phase*PI)*.4,1,1)
		if foot and action in ["movement","exercise","neuro"]: foot.rotation.x=original_foot.basis.get_euler().x+sin(phase*TAU*2)*.2
		if not training.busy:
			hands.visible=false; hands.scale=Vector3.ONE; loose_glove.visible=false; moving=false
			for cuff in glove_cuffs: cuff.scale=Vector3.ONE
			if foot: foot.transform=original_foot
