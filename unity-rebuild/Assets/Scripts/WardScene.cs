using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace TractionCare
{
    public sealed class CareObject : MonoBehaviour { public string id, title; }

    public sealed class WardScene : MonoBehaviour
    {
        HospitalSimulation app;
        public Camera View { get; private set; }
        readonly Dictionary<string, CareObject> objects = new Dictionary<string, CareObject>();
        readonly Dictionary<string, Material> materials = new Dictionary<string, Material>();
        Transform limb, foot, weight, support, pin, drape, tool, head, chest, pulley;
        Transform hands, leftHand, rightHand, packLid;
        readonly List<Renderer> handSurfaces=new List<Renderer>();
        LineRenderer measuringTape;
        LineRenderer rope, force;
        Vector3 focus = new Vector3(0, .85f, 0), destination = new Vector3(0, .85f, 0);
        float yaw = -40, elevation = 28, distance = 4.2f, animationTime;
        string action = "";
        Renderer selectedRenderer;
        Color selectedColor;
        public string NameOf(string id) => objects.TryGetValue(id, out var item) ? item.title : "未选中";
        public Vector3 PositionOf(string id) => objects.TryGetValue(id, out var item) ? item.transform.position : focus;
        public IEnumerable<CareObject> Objects => objects.Values;

        public void Create(HospitalSimulation simulation)
        {
            app = simulation;
            Mat("wall", "E5EDEB"); Mat("floor", "B9CBC9"); Mat("white", "F8F9F3");
            Mat("teal", "367D83"); Mat("navy", "21454E"); Mat("metal", "A4B7BD", .7f);
            Mat("skin", "C79578"); Mat("hair", "332C2B"); Mat("dark", "303E45");
            Mat("cloth", "B2D1D9"); Mat("blue", "44749A"); Mat("paper", "E6E3D5");
            Mat("rubber", "444F55"); Mat("red", "A66563"); Mat("gold", "D8AA68");
            Mat("rope", "E1D6AD"); Mat("window", "D3E8EB");
            Mat("glove", "B6DADE");
            var stripe = new Texture2D(16, 16);
            for (int x = 0; x < 16; x++) for (int y = 0; y < 16; y++) stripe.SetPixel(x,y, x % 8 < 2 ? new Color(.75f,.86f,.91f) : new Color(.89f,.94f,.95f));
            stripe.Apply(); stripe.wrapMode = TextureWrapMode.Repeat; materials["cloth"].mainTexture = stripe;
            Room(); Bed(); Patient(); Equipment(); Cart(); NurseHands();
            View = new GameObject("Clinical camera").AddComponent<Camera>();
            View.tag = "MainCamera"; View.fieldOfView = 43; View.nearClipPlane = .05f; View.farClipPlane = 30;
            View.backgroundColor = new Color(.85f,.91f,.92f); View.clearFlags = CameraClearFlags.SolidColor;
            View.rect = new Rect(.17f, .09f, .56f, .80f);
            View.gameObject.AddComponent<AudioListener>();
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(.80f,.86f,.87f);
            RenderSettings.ambientEquatorColor = new Color(.55f,.63f,.64f);
            RenderSettings.ambientGroundColor = new Color(.32f,.40f,.42f);
            var light = new GameObject("Window daylight").AddComponent<Light>();
            light.type = LightType.Directional; light.intensity = 1.1f; light.color = new Color(1,.96f,.90f);
            light.transform.rotation = Quaternion.Euler(48, -35, 0); light.shadows = LightShadows.Soft;
            light.shadowStrength = .45f; QualitySettings.shadowDistance = 12;
            Sync();
        }
        Material Mat(string name, string hex, float metallic = 0)
        {
            ColorUtility.TryParseHtmlString("#" + hex, out var color);
            var m = new Material(Shader.Find("Standard")) { name = name, color = color };
            m.SetFloat("_Metallic", metallic); m.SetFloat("_Glossiness", metallic > 0 ? .65f : .22f);
            materials[name] = m; return m;
        }
        Transform Shape(string name, PrimitiveType type, Vector3 p, Vector3 size, string material, Transform parent = null)
        {
            var o = GameObject.CreatePrimitive(type); o.name = name; o.transform.SetParent(parent, false);
            o.transform.localPosition = p; o.transform.localScale = size; o.GetComponent<Renderer>().sharedMaterial = materials[material];
            return o.transform;
        }
        Transform Box(string name, Vector3 p, Vector3 size, string mat, Transform parent = null) => Shape(name, PrimitiveType.Cube, p, size, mat, parent);
        Transform Ball(string name, Vector3 p, Vector3 size, string mat, Transform parent = null) => Shape(name, PrimitiveType.Sphere, p, size, mat, parent);
        Transform Rod(string name, Vector3 a, Vector3 b, float radius, string material, Transform parent = null)
        {
            var t = Shape(name, PrimitiveType.Cylinder, (a+b)/2, new Vector3(radius*2, (b-a).magnitude/2, radius*2), material, parent);
            t.localRotation = Quaternion.FromToRotation(Vector3.up, b-a); return t;
        }
        void Interactive(Transform t, string id, string title)
        {
            var c = t.gameObject.AddComponent<CareObject>(); c.id = id; c.title = title; objects[id] = c;
        }
        Transform Loft(string name, Vector3[] centers, Vector2[] radii, string material, Transform parent = null, int sides = 24)
        {
            var vertices = new Vector3[centers.Length*sides]; var uv = new Vector2[vertices.Length];
            var indices = new List<int>();
            for (int row = 0; row < centers.Length; row++) for (int j = 0; j < sides; j++)
            {
                float a = j*Mathf.PI*2/sides; int index = row*sides+j;
                vertices[index] = centers[row] + new Vector3(Mathf.Cos(a)*radii[row].x, Mathf.Sin(a)*radii[row].y, 0);
                uv[index] = new Vector2(j/(float)sides*3,row/(float)(centers.Length-1)*2);
                if (row == 0) continue;
                int prev = index-sides, next = row*sides+(j+1)%sides, pn = next-sides;
                indices.AddRange(new[]{prev,next,index,prev,pn,next});
            }
            var mesh = new Mesh { name = name }; mesh.vertices = vertices; mesh.uv = uv; mesh.triangles = indices.ToArray(); mesh.RecalculateNormals(); mesh.RecalculateBounds();
            if(centers[centers.Length-1].z<centers[0].z) { indices.Reverse(); mesh.triangles=indices.ToArray(); mesh.RecalculateNormals(); }
            var obj = new GameObject(name); obj.transform.SetParent(parent,false); obj.AddComponent<MeshFilter>().sharedMesh = mesh;
            obj.AddComponent<MeshRenderer>().sharedMaterial = materials[material]; obj.AddComponent<MeshCollider>().sharedMesh = mesh;
            return obj.transform;
        }
        void Room()
        {
            Box("Hospital floor",new Vector3(0,-.04f,0),new Vector3(8,.08f,8),"floor");
            for(int i=-4;i<=4;i++) { Box("Floor joint",new Vector3(i,0,0),new Vector3(.005f,.002f,8),"wall"); Box("Floor joint",new Vector3(0,0,i),new Vector3(8,.002f,.005f),"wall"); }
            Box("Back wall",new Vector3(0,1.7f,2.8f),new Vector3(8,3.4f,.14f),"wall");
            Box("Wall guard",new Vector3(0,.82f,2.69f),new Vector3(8,.16f,.04f),"teal");
            Box("Clinical service rail",new Vector3(0,1.35f,2.62f),new Vector3(3,.16f,.15f),"white");
            for(int i=0;i<5;i++) Ball("Outlet",new Vector3(-.65f+i*.3f,1.35f,2.52f),new Vector3(.055f,.055f,.018f), i%2==0?"teal":"gold");
            Box("Window frame",new Vector3(-2.75f,1.85f,2.64f),new Vector3(1.6f,1.6f,.12f),"white");
            Box("Window glass",new Vector3(-2.75f,1.85f,2.56f),new Vector3(1.46f,1.46f,.04f),"window");
            Box("Window divider",new Vector3(-2.75f,1.85f,2.51f),new Vector3(.04f,1.5f,.04f),"white");
            for(int i=0;i<12;i++) Box("Privacy curtain fold",new Vector3(2.65f+i*.055f,1.7f,.35f),new Vector3(.08f,2.6f,.08f),i%2==0?"cloth":"teal");
            Rod("Curtain track",new Vector3(2.5f,3.05f,-1.8f),new Vector3(2.5f,3.05f,2.7f),.025f,"metal");
            Box("Bedside cabinet",new Vector3(-1.1f,.4f,1.2f),new Vector3(.6f,.8f,.55f),"white");
            Box("Cabinet top",new Vector3(-1.1f,.83f,1.2f),new Vector3(.65f,.06f,.6f),"teal");
            for(int i=0;i<3;i++) { Box("Drawer",new Vector3(-1.1f,.22f+i*.22f,.915f),new Vector3(.53f,.18f,.03f),"wall"); Rod("Handle",new Vector3(-1.22f,.22f+i*.22f,.88f),new Vector3(-.98f,.22f+i*.22f,.88f),.012f,"metal"); }
            Rod("IV stand",new Vector3(-.9f,.08f,.1f),new Vector3(-.9f,2.3f,.1f),.018f,"metal");
            for(int i=0;i<4;i++) { float a=i*Mathf.PI/2; Rod("IV base",new Vector3(-.9f,.15f,.1f),new Vector3(-.9f+.26f*Mathf.Cos(a),.08f,.1f+.26f*Mathf.Sin(a)),.017f,"metal"); }
            Rod("IV hook",new Vector3(-1.05f,2.22f,.1f),new Vector3(-.75f,2.22f,.1f),.012f,"metal");
            Ball("IV bag",new Vector3(-1.04f,2.04f,.1f),new Vector3(.12f,.25f,.06f),"window");
        }
        void Bed()
        {
            Box("Bed chassis",new Vector3(0,.48f,0),new Vector3(1.1f,.12f,2.8f),"metal");
            Box("Mattress",new Vector3(0,.69f,0),new Vector3(1.04f,.22f,2.65f),"white");
            Box("Cotton fitted sheet",new Vector3(0,.807f,0),new Vector3(1.06f,.025f,2.66f),"white");
            Ball("Pillow",new Vector3(0,.86f,1.00f),new Vector3(.63f,.17f,.47f),"white");
            for(int side=-1;side<=1;side+=2)
            {
                for(int end=-1;end<=1;end+=2)
                {
                    Rod("Bed leg",new Vector3(side*.43f,.18f,end*1.08f),new Vector3(side*.43f,.52f,end*1.08f),.035f,"metal");
                    var wheel=Shape("Caster",PrimitiveType.Cylinder,new Vector3(side*.43f,.12f,end*1.08f),new Vector3(.16f,.045f,.16f),"rubber"); wheel.rotation=Quaternion.Euler(0,0,90);
                }
                Rod("Side rail",new Vector3(side*.58f,.97f,-.65f),new Vector3(side*.58f,.97f,.5f),.022f,"metal");
                for(int j=0;j<4;j++) Rod("Rail upright",new Vector3(side*.58f,.6f,-.65f+j*.38f),new Vector3(side*.58f,.97f,-.65f+j*.38f),.014f,"metal");
            }
            Box("Headboard",new Vector3(0,.91f,1.43f),new Vector3(1.18f,.8f,.08f),"teal");
            Box("Headboard inset",new Vector3(0,1.04f,1.38f),new Vector3(.94f,.29f,.02f),"wall");
            Box("Footboard",new Vector3(0,.72f,-1.45f),new Vector3(1.18f,.45f,.08f),"teal");
            var chart=Box("Patient record",new Vector3(-.26f,.82f,-1.52f),new Vector3(.27f,.34f,.03f),"paper"); Interactive(chart,"chart","电子病历与影像资料");
            for(int i=0;i<6;i++) Box("Record line",new Vector3(-.26f,.91f-i*.035f,-1.54f),new Vector3(.19f,.006f,.005f),"blue");
        }
        void Patient()
        {
            var torso=Loft("Patient gown",new[]{new Vector3(0,.96f,.05f),new Vector3(0,.97f,.15f),new Vector3(0,.99f,.43f),new Vector3(0,1,.62f),new Vector3(0,1,.71f)},new[]{new Vector2(.18f,.10f),new Vector2(.22f,.14f),new Vector2(.25f,.15f),new Vector2(.26f,.13f),new Vector2(.08f,.07f)},"cloth");
            chest=torso; Interactive(torso,"patient","患者李波");
            head=new GameObject("Patient head").transform; head.position=new Vector3(0,1.01f,.91f);
            Interactive(head,"patient","患者李波");
            Loft("Face anatomy",new[]{new Vector3(0,0,-.14f),new Vector3(0,.01f,-.10f),new Vector3(0,.02f,0),new Vector3(0,.01f,.11f),new Vector3(0,0,.17f)},new[]{new Vector2(.04f,.045f),new Vector2(.075f,.07f),new Vector2(.10f,.10f),new Vector2(.09f,.08f),new Vector2(.015f,.01f)},"skin",head);
            Ball("Hair crown",new Vector3(0,.008f,.09f),new Vector3(.205f,.17f,.19f),"hair",head);
            Ball("Nose",new Vector3(0,.12f,-.01f),new Vector3(.035f,.045f,.065f),"skin",head);
            for(int sign=-1;sign<=1;sign+=2)
            {
                Ball("Ear",new Vector3(sign*.1f,.01f,.005f),new Vector3(.027f,.065f,.052f),"skin",head);
                Ball("Eye",new Vector3(sign*.043f,.104f,.029f),new Vector3(.035f,.012f,.017f),"white",head);
                Ball("Iris",new Vector3(sign*.043f,.111f,.028f),new Vector3(.013f,.004f,.012f),"hair",head);
                Rod("Eyebrow",new Vector3(sign*.026f,.105f,.052f),new Vector3(sign*.06f,.10f,.055f),.004f,"hair",head);
                var sleeve=Rod("Gown sleeve",new Vector3(sign*.23f,.99f,.56f),new Vector3(sign*.31f,.92f,.32f),.08f,"cloth");
                Rod("Forearm",new Vector3(sign*.32f,.92f,.32f),new Vector3(sign*.35f,.89f,.02f),.045f,"skin");
                Ball("Palm",new Vector3(sign*.35f,.88f,-.04f),new Vector3(.085f,.045f,.12f),"skin");
                for(int f=0;f<4;f++) Rod("Finger",new Vector3(sign*.35f+(f-1.5f)*.018f,.88f,-.08f),new Vector3(sign*.35f+(f-1.5f)*.018f,.875f,-.16f+(f==0?.025f:0)),.009f,"skin");
                Ball("Thumb",new Vector3(sign*.40f,.885f,-.055f),new Vector3(.025f,.025f,.065f),"skin");
            }
            Rod("Lips",new Vector3(-.026f,.08f,-.077f),new Vector3(.026f,.08f,-.077f),.007f,"red",head);
            Ball("Gown pelvis",new Vector3(0,.92f,-.06f),new Vector3(.44f,.24f,.38f),"cloth");
            Loft("Right leg gown",new[]{new Vector3(-.14f,.90f,-.12f),new Vector3(-.17f,.88f,-.5f),new Vector3(-.17f,.88f,-.84f)},new[]{new Vector2(.12f,.10f),new Vector2(.09f,.08f),new Vector2(.065f,.065f)},"cloth");
            Rod("Right ankle",new Vector3(-.17f,.88f,-.83f),new Vector3(-.17f,.88f,-1.05f),.05f,"skin");
            Ball("Right foot",new Vector3(-.17f,.94f,-1.11f),new Vector3(.13f,.25f,.18f),"skin");
            limb=new GameObject("Left limb").transform; limb.position=new Vector3(.18f,.91f,-.14f);
            var thigh=Loft("Affected thigh",new[]{Vector3.zero,new Vector3(.035f,.02f,-.19f),new Vector3(.04f,.015f,-.39f),new Vector3(.035f,.01f,-.46f)},new[]{new Vector2(.12f,.10f),new Vector2(.145f,.115f),new Vector2(.10f,.09f),new Vector2(.085f,.08f)},"skin",limb); Interactive(thigh,"limb","左侧患肢");
            Ball("Knee",new Vector3(.035f,.03f,-.45f),new Vector3(.17f,.17f,.18f),"skin",limb);
            Loft("Left shin",new[]{new Vector3(.035f,.005f,-.46f),new Vector3(.035f,-.015f,-.62f),new Vector3(.035f,-.035f,-.87f)},new[]{new Vector2(.085f,.075f),new Vector2(.08f,.075f),new Vector2(.045f,.045f)},"skin",limb);
            foot=new GameObject("Left foot joint").transform; foot.SetParent(limb,false); foot.localPosition=new Vector3(.035f,0,-.92f);
            var footMesh=Ball("Left foot anatomy",new Vector3(0,.055f,-.025f),new Vector3(.14f,.25f,.19f),"skin",foot); Interactive(footMesh,"foot","左足：血运、感觉与活动");
            for(int f=0;f<5;f++) Ball("Toe",new Vector3(-.05f+f*.025f,.165f,-.07f),new Vector3(.027f,.06f,.04f),"skin",foot);
            var site=Ball("Pin site",new Vector3(.117f,.025f,-.49f),new Vector3(.012f,.045f,.05f),"red",limb); Interactive(site,"site","左侧牵引针道与敷料");
            var skin=Ball("Heel observation point",new Vector3(0,-.025f,.025f),new Vector3(.10f,.07f,.08f),"skin",foot); Interactive(skin,"skin","足跟受压部位");
        }
        void Equipment()
        {
            support=Box("Limb support",new Vector3(.25f,.92f,-.65f),new Vector3(.33f,.08f,.65f),"cloth"); Interactive(support,"support","患肢支托与体位");
            for(int s=-1;s<=1;s+=2) Rod("Support bar",new Vector3(.25f+s*.2f,.80f,-.9f),new Vector3(.25f+s*.2f,1.08f,-.45f),.017f,"metal");
            var frame=Rod("Traction frame",new Vector3(.27f,.45f,-1.70f),new Vector3(.27f,1.65f,-1.70f),.028f,"metal"); Interactive(frame,"frame","牵引架与力线");
            Rod("Frame foot",new Vector3(-.3f,.46f,-1.7f),new Vector3(.6f,.46f,-1.7f),.025f,"metal");
            Rod("Pulley adjustment rail",new Vector3(-.4f,1.35f,-1.7f),new Vector3(.85f,1.35f,-1.7f),.018f,"metal");
            pulley=Shape("Grooved pulley",PrimitiveType.Cylinder,new Vector3(.27f,1.35f,-1.7f),new Vector3(.14f,.025f,.14f),"gold"); pulley.rotation=Quaternion.Euler(0,0,90); Interactive(pulley,"pulley","滑轮和牵引绳");
            weight=new GameObject("Calibrated weight").transform; weight.position=new Vector3(.27f,.55f,-1.94f);
            var disk=Shape("Weight disk",PrimitiveType.Cylinder,Vector3.zero,new Vector3(.23f,.035f,.23f),"dark",weight); Interactive(disk,"weight","牵引砝码");
            for(int i=1;i<5;i++) Shape("Weight layer",PrimitiveType.Cylinder,new Vector3(0,i*.035f,0),new Vector3(.22f,.012f,.22f),"metal",weight);
            Rod("Weight hook",new Vector3(0,.14f,0),new Vector3(0,.25f,0),.012f,"metal",weight);
            pin=new GameObject("Traction pin assembly").transform; pin.SetParent(limb,false); pin.localPosition=new Vector3(.035f,.03f,-.49f);
            Rod("Traction pin",new Vector3(-.16f,0,0),new Vector3(.16f,0,0),.009f,"metal",pin);
            for(int side=-1;side<=1;side+=2) Ball("Pin cap",new Vector3(side*.16f,0,0),new Vector3(.035f,.035f,.035f),"teal",pin);
            drape=Box("Sterile drape",new Vector3(.18f,1.075f,-.34f),new Vector3(.53f,.012f,.43f),"teal");
            rope=Line("Traction rope","rope",.012f); force=Line("Force vector","gold",.006f);
            tool=Rod("Nursing instrument",Vector3.zero,new Vector3(0,.18f,0),.009f,"metal"); tool.gameObject.SetActive(false);
        }
        void Cart()
        {
            var cart=Box("Nursing trolley",new Vector3(1.25f,.72f,.35f),new Vector3(.65f,.06f,.86f),"metal"); Interactive(cart,"cart","护理车与准备用品");
            Box("Lower trolley tray",new Vector3(1.25f,.28f,.35f),new Vector3(.65f,.045f,.86f),"metal");
            for(int x=-1;x<=1;x+=2) for(int z=-1;z<=1;z+=2) Rod("Trolley leg",new Vector3(1.25f+x*.29f,.08f,.35f+z*.39f),new Vector3(1.25f+x*.29f,.85f,.35f+z*.39f),.018f,"metal");
            var pack=Box("Wrapped sterile kit",new Vector3(1.1f,.78f,.55f),new Vector3(.24f,.065f,.26f),"teal"); Interactive(pack,"pack","无菌穿刺包");
            packLid=Box("Sterile kit cover",new Vector3(1.1f,.818f,.55f),new Vector3(.24f,.012f,.26f),"cloth");
            var gloves=Box("Sterile gloves pouch",new Vector3(1.38f,.77f,.57f),new Vector3(.19f,.025f,.23f),"paper"); Interactive(gloves,"gloves","无菌手套");
            var sterilePin=Rod("Sterile traction pin",new Vector3(1.0f,.84f,.43f),new Vector3(1.29f,.84f,.43f),.012f,"metal"); Interactive(sterilePin,"pin","牵引针与针端保护");
            var swab=Rod("Antiseptic swab",new Vector3(1.05f,.78f,.2f),new Vector3(1.20f,.78f,.2f),.008f,"paper"); Interactive(swab,"swab","消毒棉签与针道护理");
            Ball("Swab cotton",new Vector3(1.04f,.78f,.2f),new Vector3(.035f,.022f,.022f),"white");
            var syringe=Rod("Syringe",new Vector3(1.3f,.78f,.22f),new Vector3(1.48f,.78f,.22f),.015f,"window"); Interactive(syringe,"syringe","麻醉配合用品");
            Rod("Syringe needle",new Vector3(1.48f,.78f,.22f),new Vector3(1.54f,.78f,.22f),.002f,"metal");
            var drapePack=Box("Sterile drape pack",new Vector3(1.08f,.78f,.04f),new Vector3(.22f,.035f,.13f),"cloth"); Interactive(drapePack,"drape","无菌巾");
            var tape=Shape("Measuring tape",PrimitiveType.Cylinder,new Vector3(1.43f,.78f,.02f),new Vector3(.10f,.02f,.10f),"gold"); Interactive(tape,"measure","量诊软尺");
            var steth=Ball("Stethoscope diaphragm",new Vector3(1.36f,.80f,.36f),new Vector3(.07f,.018f,.07f),"metal"); Interactive(steth,"stethoscope","听诊与呼吸评估");
            Rod("Stethoscope tube",new Vector3(1.36f,.80f,.36f),new Vector3(1.50f,.80f,.46f),.007f,"navy");
            var pan=Ball("Bedpan",new Vector3(1.26f,.32f,.31f),new Vector3(.38f,.14f,.45f),"white"); Interactive(pan,"bedpan","便器与排泄护理");
        }
        void NurseHands()
        {
            hands=new GameObject("Nursing hands").transform;
            for(int side=-1;side<=1;side+=2)
            {
                var hand=new GameObject(side<0?"Left nursing hand":"Right nursing hand").transform; hand.SetParent(hands,false);
                if(side<0) leftHand=hand; else rightHand=hand;
                Ball("Palm",Vector3.zero,new Vector3(.085f,.035f,.11f),"skin",hand);
                for(int f=0;f<4;f++)
                {
                    var origin=new Vector3((f-1.5f)*.018f,0,-.045f);
                    Rod("Finger segment",origin,origin+new Vector3(0,-.01f,-.045f),.009f,"skin",hand);
                    Rod("Finger tip",origin+new Vector3(0,-.01f,-.045f),origin+new Vector3(0,-.025f,-.07f),.008f,"skin",hand);
                }
                Rod("Thumb",new Vector3(side*.04f,0,-.015f),new Vector3(side*.065f,-.015f,-.055f),.013f,"skin",hand);
                Rod("Sleeve",new Vector3(0,0,.065f),new Vector3(0,.055f,.25f),.045f,"white",hand);
                foreach(var surface in hand.GetComponentsInChildren<Renderer>()) if(surface.sharedMaterial==materials["skin"]) handSurfaces.Add(surface);
                foreach(var collider in hand.GetComponentsInChildren<Collider>()) Destroy(collider);
            }
            hands.gameObject.SetActive(false);
            measuringTape=Line("Clinical measuring tape","gold",.015f); measuringTape.enabled=false;
        }
        LineRenderer Line(string name,string mat,float width)
        {
            var l=new GameObject(name).AddComponent<LineRenderer>(); l.sharedMaterial=materials[mat]; l.startWidth=width; l.endWidth=width; l.positionCount=3; l.numCornerVertices=4; return l;
        }
        public void Sync()
        {
            var s=app.Session;
            limb.localRotation=Quaternion.Euler(Mathf.Lerp(0,18,(s.limbHeight-.08f)/.35f),0,0);
            support.position=new Vector3(.25f,.73f+s.limbHeight,-.65f);
            weight.localScale=new Vector3(1,Mathf.Max(.12f,s.weight/5),1);
            pin.gameObject.SetActive(s.pinPlaced); drape.gameObject.SetActive(s.draped);
            packLid.rotation=Quaternion.Euler(s.sterilePack?75:0,0,0);
            foreach(var surface in handSurfaces) surface.sharedMaterial=materials[s.gloves?"glove":"skin"];
            rope.enabled=s.ropeAttached;
            var start=limb.TransformPoint(new Vector3(.035f,.03f,-.49f));
            var end=new Vector3(start.x+Mathf.Tan(s.alignment*Mathf.Deg2Rad)*(1.7f+start.z),1.35f,-1.7f);
            pulley.position=end;
            weight.position=new Vector3(end.x,.55f,-1.94f);
            rope.SetPositions(new[]{start,end,weight.position+Vector3.up*.25f});
            force.enabled=app.inSession && app.Session.module==1;
            force.SetPositions(new[]{limb.TransformPoint(new Vector3(.035f,.03f,-.49f)),end,end+new Vector3(0,-.1f,.12f)});
        }
        public void Focus(string id) { destination=PositionOf(id); distance=id=="patient"?3.3f:2.5f; }
        public void ResetView() { destination=new Vector3(0,.85f,0); distance=4.2f; yaw=-40; elevation=28; }
        public void Select(string id)
        {
            if(selectedRenderer!=null) { selectedRenderer.material.color=selectedColor; selectedRenderer.material.SetColor("_EmissionColor",Color.black); }
            selectedRenderer=objects.TryGetValue(id,out var obj)?obj.GetComponentInChildren<Renderer>():null;
            if(selectedRenderer!=null) { selectedColor=selectedRenderer.material.color; selectedRenderer.material.EnableKeyword("_EMISSION"); selectedRenderer.material.SetColor("_EmissionColor",new Color(.05f,.32f,.28f)); }
        }
        public void Animate(string operation)
        {
            action=operation; animationTime=2.6f;
            tool.gameObject.SetActive(operation=="pin" || operation=="anesthesia" || operation=="disinfect" || operation=="pin-care");
            hands.gameObject.SetActive(app.Current.target!="patient" && operation!="record" && operation!="image");
            measuringTape.enabled=operation=="measure" || operation=="dvt";
        }
        void Update()
        {
            if(View==null) return;
            bool overUI=EventSystem.current!=null && EventSystem.current.IsPointerOverGameObject();
            if(!overUI && View.pixelRect.Contains(Input.mousePosition))
            {
                if(Input.GetMouseButton(1)) { yaw+=Input.GetAxis("Mouse X")*3; elevation=Mathf.Clamp(elevation-Input.GetAxis("Mouse Y")*2,8,72); }
                distance=Mathf.Clamp(distance-Input.mouseScrollDelta.y*.25f,1.3f,6);
                if(Input.GetMouseButtonDown(0) && Physics.Raycast(View.ScreenPointToRay(Input.mousePosition),out var hit,20))
                { var c=hit.collider.GetComponentInParent<CareObject>(); if(c!=null) app.Pick(c.id); }
                var movement=new Vector3(Input.GetAxisRaw("Horizontal"),0,Input.GetAxisRaw("Vertical"));
                destination+=Quaternion.Euler(0,yaw,0)*movement*Time.deltaTime*.7f;
            }
            focus=Vector3.Lerp(focus,destination,Time.deltaTime*5);
            var angle=Quaternion.Euler(elevation,yaw,0);
            View.transform.position=focus+angle*new Vector3(0,0,-distance); View.transform.LookAt(focus);
            chest.localScale=new Vector3(1,1+Mathf.Sin(Time.time*1.4f)*.006f,1);
            if(animationTime>0)
            {
                animationTime-=Time.deltaTime; float phase=(2.6f-animationTime)/2.6f;
                if(action=="exercise" || action=="movement") foot.localRotation=Quaternion.Euler(Mathf.Sin(phase*Mathf.PI*4)*16,0,0);
                if(action=="psych" || action=="consent" || action=="history") head.localRotation=Quaternion.Euler(0,0,Mathf.Sin(phase*Mathf.PI*2)*7);
                if(action=="turn") chest.localRotation=Quaternion.Euler(0,0,Mathf.Sin(phase*Mathf.PI)*9);
                Vector3 target=PositionOf(app.Current.target);
                if(action=="disinfect" || action=="pin-care" || action=="anesthesia" || action=="pin") target=limb.TransformPoint(new Vector3(.13f,.1f,-.49f));
                if(action=="measure" || action=="dvt") target=limb.TransformPoint(new Vector3(.035f,.1f,-.65f));
                float reach=Mathf.Sin(phase*Mathf.PI)*.15f;
                leftHand.position=target+new Vector3(-.11f,.22f-reach,.12f);
                rightHand.position=target+new Vector3(.11f,.22f-reach,.12f);
                if(action=="disinfect" || action=="pin-care") rightHand.position+=new Vector3(Mathf.Sin(phase*12)*.04f,0,Mathf.Cos(phase*12)*.04f);
                if(action=="pack") packLid.rotation=Quaternion.Euler(phase*75,0,0);
                if(measuringTape.enabled) measuringTape.SetPositions(new[]{leftHand.position,target,rightHand.position});
                tool.position=limb.TransformPoint(new Vector3(.13f,.12f,-.49f))+new Vector3(Mathf.Sin(phase*12)*.035f,Mathf.Sin(phase*Mathf.PI)*.10f,0);
                if(animationTime<=0) { tool.gameObject.SetActive(false); hands.gameObject.SetActive(false); measuringTape.enabled=false; foot.localRotation=Quaternion.identity; head.localRotation=Quaternion.identity; chest.localRotation=Quaternion.identity; }
            }
        }
    }
}
