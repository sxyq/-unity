extends Node3D

const Model = preload("res://scripts/training.gd")
const Ward = preload("res://scripts/ward.gd")
const Interface = preload("res://scripts/interface.gd")
const Assistant = preload("res://scripts/assistant.gd")
var training: Node
var ward: Node3D
var interface: CanvasLayer
var assistant: Node

func _ready() -> void:
	Engine.max_fps=45
	get_tree().auto_accept_quit=false
	training=Model.new(); add_child(training)
	ward=Ward.new(); add_child(ward); ward.setup(training)
	assistant=Assistant.new(); add_child(assistant); assistant.setup(training)
	interface=Interface.new(); add_child(interface); interface.setup(training,ward,assistant)
	ward.picked.connect(func(id: String):
		training.pick(id)
		if id=="chart": interface.open_medical_record()
		if id=="cabinet": ward.focus_object("cabinet")
		if id=="patient": interface.patient_menu()
	)
	training.changed.connect(func():
		assistant.sync_context()
		if training.busy: ward.animate(training.criterion().operation)
	)
