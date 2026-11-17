extends Node

signal updated
var training: Node
var endpoint := "http://127.0.0.1:8787"
var status := "离线知识库可用，尚未连接真实模型"
var histories := {}
var busy := false
var client := HTTPClient.new()
var pending := PackedByteArray()
var body := ""
var request_sent := false
var current_answer := {}
var elapsed := 0.0
var started_at := 0
var node_pid := -1
var context_key: String=""
var settings := {"baseUrl":"https://api.openai.com/v1", "protocol":"responses", "model":"", "apiKey":"", "mode":"auto", "stream":true}

func setup(model: Node) -> void:
	training=model
	var config: String=training.storage.path_join("model-config.json")
	if FileAccess.file_exists(config): settings=JSON.parse_string(FileAccess.get_file_as_string(config))
	start_gateway()

func history_key() -> String:
	return "%s:%s:%d:%d" % [training.session.id,training.task().id,training.scenario,int(training.session.day)]

func sync_context() -> void:
	var next_key: String="%s:%s:%d:%s:%s" % [history_key(),training.task().id,training.criterion_index,training.session.submitted,training.busy]
	if next_key!=context_key:
		cancel(); context_key=next_key

func messages() -> Array:
	var key:=history_key()
	if not histories.has(key): histories[key]=[]
	return histories[key]

func start_gateway() -> void:
	var project: String=ProjectSettings.globalize_path("res://").trim_suffix("/").get_base_dir()
	var folder:=project.path_join("work/gateway/macOS") if OS.get_name()=="macOS" else OS.get_executable_path().get_base_dir().path_join("Gateway")
	if not OS.has_feature("editor") and OS.get_name()=="macOS": folder=OS.get_executable_path().get_base_dir().path_join("../Resources/Gateway").simplify_path()
	var binary:=folder.path_join("node.exe" if OS.get_name()=="Windows" else "node")
	if not FileAccess.file_exists(binary): return
	var port_server:=TCPServer.new()
	var err:=port_server.listen(0,"127.0.0.1")
	if err!=OK: status="本地网关端口创建失败"; return
	var port:=port_server.get_local_port(); port_server.stop()
	OS.set_environment("LLM_PORT",str(port)); OS.set_environment("LLM_CONFIG_PATH",training.storage.path_join("model-config.json"))
	node_pid=OS.create_process(binary,["--max-old-space-size=128",folder.path_join("server.mjs")],false)
	if node_pid==-1: status="内置网关启动失败"; return
	endpoint="http://127.0.0.1:"+str(port)
	status="内置模型网关已启动；请在设置中配置模型"

func configure(url: String, model: String, protocol: String, key: String) -> void:
	settings={"baseUrl":url.trim_suffix("/"),"model":model,"protocol":protocol,"apiKey":key,"mode":"auto","stream":true}
	var file: String=training.storage.path_join("model-config.json")
	FileAccess.open(file,FileAccess.WRITE).store_string(JSON.stringify(settings,"\t"))
	if OS.get_name()=="macOS": OS.execute("/bin/chmod",["600",file])
	cancel()
	if node_pid>0 and OS.is_process_running(node_pid): OS.kill(node_pid)
	start_gateway(); updated.emit()

func send(text: String) -> void:
	if busy or text.strip_edges().is_empty(): return
	var list:=messages()
	list.append({"role":"user","content":text.strip_edges()})
	if list.size()>24: list.pop_front(); list.pop_front()
	var scene: Dictionary=training.content.scenarios[training.scenario]
	var prompt: String=""
	for p in scene.systems:
		if int(p.day)==(int(training.session.day) if scene.phase=="postop" else 0): prompt=p.system
	prompt=prompt.replace("独立 Unity 应用","独立 Godot 应用")
	if training.session.exam and not training.session.submitted: prompt+="\n最高优先：当前考核未提交，所有角色禁止提供当前题目答案、正确选项或代做；只解释一般概念。"
	body=JSON.stringify({"system":prompt+"\n"+training.context(),"messages":list.slice(maxi(0,list.size()-12)),"stream":true})
	current_answer={"role":"assistant","content":""}; list.append(current_answer)
	var regex:=RegEx.new(); regex.compile("^(https?)://([^/:]+)(?::([0-9]+))?(.*)$")
	var match_url:=regex.search(endpoint)
	if not match_url: status="网关地址格式无效"; updated.emit(); return
	var https:=match_url.get_string(1)=="https"
	var port:=int(match_url.get_string(3)) if not match_url.get_string(3).is_empty() else (443 if https else 80)
	var error:=client.connect_to_host(match_url.get_string(2),port,TLSOptions.client() if https else null)
	if error!=OK: status="连接失败："+error_string(error); updated.emit(); return
	busy=true; request_sent=false; elapsed=0; pending.clear(); status="正在连接模型…"; updated.emit()
	started_at=Time.get_ticks_msec()

func cancel() -> void:
	client.close(); busy=false; pending.clear()
	if not current_answer.is_empty() and current_answer.content.is_empty():
		for list in histories.values(): list.erase(current_answer)
	updated.emit()

func _process(_delta: float) -> void:
	if not busy: return
	elapsed=(Time.get_ticks_msec()-started_at)/1000.0; client.poll()
	if elapsed>90: status="模型请求超时"; cancel(); return
	match client.get_status():
		HTTPClient.STATUS_CONNECTED:
			if not request_sent:
				var error:=client.request(HTTPClient.METHOD_POST,"/api/chat",["Content-Type: application/json"],body)
				if error!=OK: status="请求发送失败："+error_string(error); cancel(); return
				request_sent=true
			else:
				busy=false; client.close(); updated.emit()
		HTTPClient.STATUS_BODY:
			if client.get_response_code()!=200: status="模型网关返回 "+str(client.get_response_code()); cancel(); return
			pending.append_array(client.read_response_body_chunk())
			var newline:=pending.find(10)
			while newline>=0:
				var line:=pending.slice(0,newline).get_string_from_utf8().strip_edges()
				pending=pending.slice(newline+1)
				if line.begins_with("data:"):
					var json:=line.substr(5).strip_edges()
					if json!="[DONE]":
						var chunk=JSON.parse_string(json)
						if chunk is Dictionary:
							if chunk.has("error"): status=chunk.error
							if chunk.get("mode","")=="live": status="真实模型 · "+str(chunk.get("model",""))
							elif chunk.get("mode","")=="mock": status="未配置真实模型；请在设置中填写模型服务"
							current_answer.content+=str(chunk.get("t",""))
				newline=pending.find(10)
			updated.emit()
		HTTPClient.STATUS_CANT_CONNECT,HTTPClient.STATUS_CANT_RESOLVE,HTTPClient.STATUS_CONNECTION_ERROR,HTTPClient.STATUS_TLS_HANDSHAKE_ERROR:
			status="模型连接失败；可继续使用课程知识库"; cancel()

func _exit_tree() -> void:
	cancel()
	if node_pid>0 and OS.is_process_running(node_pid): OS.kill(node_pid)
