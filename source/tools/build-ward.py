"""Author the independent teaching ward in Blender and export editable .blend + GLB."""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

root = Path('/Volumes/Lexar/Project/医院仿真')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials = {}
for name, color, metal in [
    ('wall','e5eeeb',0),('floor','b9cbc9',0),('white','f8f9f3',0),('cabinet','f1eedf',0),('teal','367d83',0),
    ('navy','21454e',0),('metal','a4b7bd',.7),('skin','c79578',0),('hair','332c2b',0),
    ('dark','303e45',0),('cloth','b2d1d9',0),('blue','44749a',0),('paper','e6e3d5',0),
    ('rubber','444f55',0),('red','a66563',0),('gold','d8aa68',.3),('window','d3e8eb',0)]:
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*[(int(color[i:i+2],16)/255)**2.2 for i in (0,2,4)],1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = m.diffuse_color
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = .3 if metal else .6
    materials[name] = m

def finish(obj,name,mat,care='',bevel=0):
    obj.name=name
    obj.data.materials.append(materials[mat])
    if care: obj['care_id']=care
    if bevel:
        b=obj.modifiers.new('Manufactured rounded edges','BEVEL'); b.width=bevel; b.segments=2
        obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return obj

def box(name,p,s,mat,care='',bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p)
    o=bpy.context.object; o.dimensions=s
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,care,bevel)

def ellipsoid(name,p,s,mat,care=''):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=p)
    o=bpy.context.object; o.scale=Vector(s)/2
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for face in o.data.polygons: face.use_smooth=True
    return finish(o,name,mat,care)

def rod(name,a,b,r,mat,care=''):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=r,depth=(b-a).length,location=(a+b)/2)
    o=bpy.context.object; o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    for face in o.data.polygons: face.use_smooth=True
    return finish(o,name,mat,care,.003)

def loft(name,centers,radii,mat,care=''):
    verts=[]; faces=[]; sides=24
    for p,r in zip(centers,radii):
        for j in range(sides):
            a=j*math.tau/sides; verts.append((p[0]+math.cos(a)*r[0],p[1],p[2]+math.sin(a)*r[1]))
    for row in range(1,len(centers)):
        for j in range(sides):
            n=(j+1)%sides
            faces.append(((row-1)*sides+j,(row-1)*sides+n,row*sides+n,row*sides+j))
    faces.extend([tuple(reversed(range(sides))),tuple((len(centers)-1)*sides+j for j in range(sides))])
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj)
    for f in mesh.polygons: f.use_smooth=True
    return finish(obj,name,mat,care)

# Coordinates: X across the bed, Y head-to-foot, Z vertical.
box('Hospital floor',(0,0,-.05),(7,7,.1),'floor',bevel=0)
for i in range(-3,4):
    box('Floor joint X',(i,0,.001),(.004,7,.002),'wall',bevel=0)
    box('Floor joint Y',(0,i,.001),(7,.004,.002),'wall',bevel=0)
box('Head wall',(0,2.65,1.55),(7,.12,3.1),'wall')
box('Wall handrail',(0,2.55,.85),(7,.05,.16),'teal')
box('Medical services rail',(0,2.49,1.35),(2.8,.14,.18),'white')
for i in range(6): ellipsoid('Medical outlet',(-.7+i*.27,2.40,1.35),(.055,.02,.055),'teal' if i%2 else 'gold')
box('Window frame',(-2.25,2.52,1.9),(1.55,.12,1.45),'white')
box('Window glass',(-2.25,2.44,1.9),(1.4,.03,1.3),'window')
box('Window mullion',(-2.25,2.40,1.9),(.04,.04,1.3),'white')
rod('Privacy curtain rail',(2.0,-1.4,2.85),(2,2.5,2.85),.02,'metal')
for i in range(15):
    box('Curtain pleat',(2.08+i*.035,.6,1.55),(.07,.07,2.5),'cloth' if i%2 else 'teal',bevel=.01)
# Visible proportions from docs/evidence-real-experiment.png; physical dimensions unknown.
box('Bedside cabinet',(-1.05,1.1,.40),(.58,.55,.8),'white','cabinet')
box('Cabinet top',(-1.05,1.1,.82),(.65,.61,.05),'cabinet','cabinet',bevel=.025)
box('Cabinet drawer seam',(-1.05,.810,.665),(.53,.008,.212),'dark')
box('Cabinet upper drawer',(-1.05,.798,.665),(.516,.02,.196),'cabinet','cabinet')
pull=[(-1.17,.776,.640),(-1.13,.759,.653),(-1.08,.753,.658),(-1.02,.753,.658),(-.97,.759,.653),(-.93,.776,.640)]
for a,b in zip(pull,pull[1:]): rod('Cabinet curved drawer pull',a,b,.008,'dark','cabinet')
box('Cabinet door seam',(-1.05,.810,.325),(.53,.008,.472),'dark')
door=box('Cabinet lower door',(-1.05,.798,.325),(.516,.02,.458),'cabinet','cabinet')
cut=ellipsoid('Door pull recess cutter',(-1.267,.776,.325),(.039,.060,.088),'dark')
modifier=door.modifiers.new('Inset finger pull','BOOLEAN'); modifier.operation='DIFFERENCE'; modifier.object=cut
bpy.context.view_layer.objects.active=door
bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.data.objects.remove(cut,do_unlink=True)
ellipsoid('Cabinet recessed door pull',(-1.267,.809,.325),(.036,.014,.083),'wall','cabinet')
rod('IV pole',(-.83,.35,.1),(-.83,.35,2.3),.018,'metal')
for i in range(4):
    a=i*math.pi/2; rod('IV stand base',(-.83,.35,.13),(-.83+math.cos(a)*.25,.35+math.sin(a)*.25,.08),.018,'metal')
rod('IV top',(-.98,.35,2.27),(-.68,.35,2.27),.012,'metal')
ellipsoid('IV fluid bag',(-.96,.35,2.05),(.13,.055,.26),'window')

# Bed with casters, rails, molded boards, pillow and cotton sheet.
box('Bed chassis',(0,0,.47),(1.1,2.8,.12),'metal')
box('Mattress',(0,0,.68),(1.05,2.64,.23),'white',bevel=.06)
box('Fitted sheet',(0,0,.804),(1.055,2.65,.025),'white',bevel=.01)
ellipsoid('Pillow',(0,1.02,.88),(.68,.47,.16),'white')
for side in (-1,1):
    for end in (-1,1):
        rod('Bed leg',(side*.43,end*1.08,.14),(side*.43,end*1.08,.5),.035,'metal')
        rod('Caster',(side*.43-.045,end*1.08,.11),(side*.43+.045,end*1.08,.11),.08,'rubber')
    rod('Bed side rail',(side*.58,-.65,.98),(side*.58,.55,.98),.022,'metal')
    for j in range(4): rod('Rail support',(side*.58,-.65+j*.4,.61),(side*.58,-.65+j*.4,.98),.013,'metal')
box('Headboard',(0,1.45,.92),(1.18,.10,.8),'teal',bevel=.065)
box('Headboard inset',(0,1.39,1.03),(.94,.02,.3),'wall',bevel=.035)
box('Footboard',(0,-1.45,.7),(1.18,.09,.45),'teal',bevel=.05)
box('Medical chart',(-.25,-1.52,.81),(.29,.04,.35),'paper','chart')
for i in range(6): box('Chart writing',(-.25,-1.546,.91-i*.035),(.20,.005,.006),'blue',bevel=0)

# Individually shaped anatomy and gown, with separate movable left limb.
loft('Patient torso',[(0,.05,.98),(0,.18,.99),(0,.46,1.0),(0,.63,1.01),(0,.72,1.01)],[(.18,.10),(.22,.14),(.25,.15),(.26,.13),(.08,.07)],'cloth','patient')
ellipsoid('Gown pelvis',(0,-.06,.94),(.44,.39,.23),'cloth','patient')
loft('Patient face',[(0,.77,1.01),(0,.82,1.02),(0,.91,1.035),(0,1.03,1.025),(0,1.08,1.01)],[(.04,.045),(.075,.07),(.10,.10),(.09,.08),(.015,.01)],'skin','patient')
ellipsoid('Hair crown',(0,1.005,1.01),(.205,.20,.16),'hair','patient')
ellipsoid('Nose',(0,.90,1.15),(.036,.065,.04),'skin','patient')
for side in (-1,1):
    ellipsoid('Ear',(side*.10,.91,1.03),(.028,.056,.064),'skin','patient')
    ellipsoid('Eye white',(side*.043,.945,1.137),(.035,.017,.009),'white','patient')
    ellipsoid('Iris',(side*.043,.943,1.142),(.013,.011,.003),'hair','patient')
    rod('Eyebrow',(side*.025,.965,1.13),(side*.061,.968,1.125),.004,'hair')
    rod('Gown sleeve',(side*.23,.57,1.0),(side*.31,.32,.94),.075,'cloth')
    rod('Forearm',(side*.32,.32,.94),(side*.35,.02,.90),.043,'skin')
    ellipsoid('Hand',(side*.35,-.045,.90),(.085,.13,.045),'skin')
    for f in range(4):
        x=side*.35+(f-1.5)*.018
        rod('Finger',(x,-.08,.9),(x,-.16+(0.025 if f==0 else 0),.895),.009,'skin')
rod('Lips',(-.026,.84,1.11),(.026,.84,1.11),.006,'red')
loft('Right leg',[( -.14,-.14,.92),(-.17,-.5,.90),(-.17,-.84,.90)],[(.12,.10),(.09,.08),(.06,.055)],'cloth')
rod('Right ankle',(-.17,-.82,.9),(-.17,-1.04,.9),.05,'skin')
ellipsoid('Right foot',(-.17,-1.10,.98),(.13,.19,.26),'skin')
before=set(bpy.data.objects)
loft('Affected left thigh',[(.18,-.14,.94),(.215,-.32,.96),(.22,-.52,.95),(.215,-.60,.94)],[(.12,.10),(.14,.115),(.10,.09),(.085,.08)],'skin','limb')
ellipsoid('Left knee',(.215,-.60,.95),(.17,.18,.17),'skin','limb')
loft('Left calf',[(.215,-.60,.94),(.215,-.78,.92),(.215,-1.02,.90)],[(.085,.075),(.08,.075),(.045,.045)],'skin','limb')
ellipsoid('Left foot',(.215,-1.09,.99),(.14,.19,.26),'skin','foot')
for f in range(5): ellipsoid('Left toe',(.165+f*.025,-1.12,1.10),(.027,.042,.065),'skin','foot')
ellipsoid('Pin site',(.298,-.64,.955),(.014,.05,.045),'red','site')
ellipsoid('Left heel',(.215,-1.04,.90),(.10,.09,.07),'skin','skin')
limb_group=bpy.data.objects.new('LeftLimb',None); bpy.context.collection.objects.link(limb_group)
limb_group.location=(.18,-.14,.94)
bpy.context.view_layer.update()
for obj in set(bpy.data.objects)-before-{limb_group}:
    matrix=obj.matrix_world.copy(); obj.parent=limb_group; obj.matrix_world=matrix

# Adjustable traction apparatus. Dynamic rope is generated by runtime.
box('Support',(.25,-.67,.85),(.34,.65,.085),'cloth','support',bevel=.04)
for side in (-1,1): rod('Support bar',(.25+side*.2,-.9,.8),(.25+side*.2,-.44,1.02),.017,'metal')
rod('Traction frame',(.27,-1.70,.45),(.27,-1.70,1.65),.028,'metal','frame')
rod('Frame brace',(-.3,-1.70,.46),(.6,-1.70,.46),.025,'metal')
rod('Pulley rail',(-.4,-1.70,1.35),(.85,-1.70,1.35),.018,'metal')
rod('Pulley',(.245,-1.70,1.35),(.295,-1.70,1.35),.075,'gold','pulley')
rod('Weight',(.27,-1.94,.49),(.27,-1.94,.65),.115,'dark','weight')
for i in range(4): rod('Weight ring',(.27,-1.94,.51+i*.035),(.27,-1.94,.525+i*.035),.12,'metal')
rod('Weight hook',(.27,-1.94,.65),(.27,-1.94,.82),.012,'metal')

# Nursing trolley with independent selectable instruments.
box('Trolley top',(1.25,.35,.75),(.66,.86,.05),'metal','cart')
box('Trolley lower',(1.25,.35,.29),(.66,.86,.045),'metal')
for x in (-1,1):
    for y in (-1,1): rod('Trolley leg',(1.25+x*.29,.35+y*.39,.08),(1.25+x*.29,.35+y*.39,.86),.018,'metal')
box('Sterile pack',(1.10,.56,.81),(.24,.25,.065),'teal','pack')
box('Gloves',(1.39,.56,.80),(.19,.22,.025),'paper','gloves')
rod('Swab',(1.02,.2,.80),(1.19,.2,.80),.008,'paper','swab')
ellipsoid('Swab cotton',(1.015,.2,.8),(.034,.022,.022),'white','swab')
rod('Syringe',(1.30,.2,.8),(1.47,.2,.8),.014,'window','syringe')
rod('Needle',(1.47,.2,.8),(1.55,.2,.8),.002,'metal','syringe')
box('Sterile drape',(1.09,.04,.81),(.22,.13,.035),'cloth','drape')
rod('Measuring tape',(1.43,.02,.78),(1.43,.02,.82),.05,'gold','measure')
rod('Stethoscope',(1.36,.36,.79),(1.36,.36,.81),.035,'metal','stethoscope')
rod('Stethoscope tube',(1.36,.36,.81),(1.50,.46,.81),.007,'navy')
rod('Sterile traction pin',(1.0,.43,.85),(1.29,.43,.85),.012,'metal','pin')
ellipsoid('Bedpan',(1.25,.32,.34),(.37,.44,.14),'white','bedpan')

# Keep the editable authored source; export only scene geometry to shared glTF.
bpy.context.scene.render.engine='BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x=1600; bpy.context.scene.render.resolution_y=900
output=root/'godot-rebuild/assets'
(root/'work/models').mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(root/'work/models/Ward.blend'))
bpy.ops.export_scene.gltf(filepath=str(output/'Ward.glb'),export_format='GLB',export_extras=True,export_apply=True)
(output/'WardObjects.json').write_text(json.dumps({o.name:o['care_id'] for o in bpy.data.objects if 'care_id' in o},ensure_ascii=False,indent=2))
print('WARD_EXPORTED',len(bpy.data.objects),sum(len(o.data.polygons) for o in bpy.data.objects if o.type=='MESH'))
