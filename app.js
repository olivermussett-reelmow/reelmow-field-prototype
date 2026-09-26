
let createClient = null;
async function loadSupabaseClient(){
  if(createClient) return createClient;
  const mod = await import("https://esm.sh/@supabase/supabase-js@2.117.1");
  createClient = mod.createClient;
  return createClient;
}

const CONFIG_KEY="reelmow.connection.v1", DEMO_KEY="reelmow.demo.v1", OUTBOX_KEY="reelmow.outbox.v1";
const app=document.querySelector("#app");
const demoCatalogue=[
  {model_id:"830038a1-6367-4beb-87f1-f692c98dc9ef",manufacturer_name:"Jacobsen",model_name:"LF3800",variant_id:"c7834745-3328-4d30-ae8a-bb35f7798848",variant_name:"LF3800 5-Gang",machine_type:"Cylinder Mower",rank:1},
  {model_id:"demo-protea-sc610",manufacturer_name:"Protea",model_name:"SC610 Supercut",variant_id:"demo-protea-sc610-24",variant_name:"SC610 24-inch",machine_type:"Cylinder Mower",rank:.98},
  {model_id:"demo-allett-shaver",manufacturer_name:"Allett",model_name:"Shaver",variant_id:"demo-allett-shaver-24",variant_name:"Shaver 24",machine_type:"Cylinder Mower",rank:.97},
  {model_id:"demo-atco-royale",manufacturer_name:"Atco",model_name:"Royale 24",variant_id:"demo-atco-royale-ic",variant_name:"Royale 24 I/C - F016310542",machine_type:"Cylinder Mower",rank:.96}
];
const state={client:null,user:null,org:null,garage:null,offline:false,syncing:false,outboxCount:0,machines:[],selected:null,specs:[],serviceDue:[],serviceRecords:[],hoursLog:[],catalogueResults:[],dashboardDue:[],openFaults:[],machineFaults:[],activity:[],mow:{active:false,paused:false,sessionId:null,machineId:null,watchId:null,startedAt:null,lastPoint:null,trackPoints:[],distanceM:0,points:0,accuracyM:null,speedMps:null,headingDeg:null,pattern:"stripe",targetSpeedKph:null},loading:false,error:"",pendingPlateFile:null,quickAction:null,view:localStorage.getItem("reelmow.view.v1")||"today",demo:localStorage.getItem(DEMO_KEY)==="true" && !(window.REELMOW_CONFIG?.url && window.REELMOW_CONFIG?.key)};

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=s=>document.querySelector(s)?.value.trim()||"";
const num=s=>{const v=document.querySelector(s)?.value;return v===""||v==null?null:Number(v)};
const slug=v=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);
const initials=v=>(v||"RE").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
const cfg=()=>{try{
  const runtime=window.REELMOW_CONFIG;
  if(runtime?.url&&runtime?.key)return {url:String(runtime.url).replace(/\/$/,""),key:String(runtime.key)};
  return JSON.parse(localStorage.getItem(CONFIG_KEY)||"null");
}catch{return null}};
const connected=()=>{const c=cfg();return !!(c?.url&&c?.key)};
function toast(t){document.querySelector(".toast")?.remove();const e=document.createElement("div");e.className="toast";e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2600)}
function readOutbox(){try{return JSON.parse(localStorage.getItem(OUTBOX_KEY)||"[]")}catch{return[]}}
function writeOutbox(items){localStorage.setItem(OUTBOX_KEY,JSON.stringify(items));state.outboxCount=items.length}
function queueMutation(type,payload){
  const items=readOutbox();
  items.push({id:crypto.randomUUID(),type,payload,createdAt:new Date().toISOString()});
  writeOutbox(items);state.offline=true;toast("Saved on this device. It will sync when you're back online.");render();
}
async function syncOutbox(){
  if(state.demo||!state.client||!state.user||!navigator.onLine||state.syncing)return;
  const items=readOutbox();state.outboxCount=items.length;if(!items.length){state.offline=false;return}
  state.syncing=true;
  const remaining=[...items];
  for(const item of items){
    try{
      let result;
      if(item.type==="hours"){
        result=await state.client.schema("garage").rpc("sync_record_machine_hours",{operation_id:item.id,target_machine:item.payload.machineId,new_engine_hours:item.payload.engineHours,new_reel_hours:item.payload.reelHours,reading_source:item.payload.source||"manual",reading_notes:item.payload.notes||null});
      }else if(item.type==="service"){
        result=await state.client.schema("garage").rpc("sync_record_machine_service",{operation_id:item.id,target_machine:item.payload.machineId,target_service_task:item.payload.taskId||null,service_date:item.payload.serviceDate,service_engine_hours:item.payload.engineHours,service_reel_hours:item.payload.reelHours,performed_by_name:item.payload.performedBy||null,service_cost:item.payload.cost,service_notes:item.payload.notes||null,evidence_json:item.payload.evidence||{}});
      }else if(item.type==="fault"){
        result=await state.client.schema("garage").rpc("sync_report_machine_fault",{operation_id:item.id,target_machine:item.payload.machineId,target_severity:item.payload.severity,target_description:item.payload.description});
      }
      if(result?.error)throw result.error;
      remaining.shift();
    }catch(err){
      if(!navigator.onLine)break;
      console.warn("REELMOW sync deferred",err);
      break;
    }
  }
  writeOutbox(remaining);state.syncing=false;state.offline=remaining.length>0;
  if(remaining.length!==items.length){toast(remaining.length?"Some saved changes are still waiting to sync.":"Saved changes synced.");try{await loadMachines()}catch{}}
}
function modal(h){document.querySelector(".modal-backdrop")?.remove();document.body.insertAdjacentHTML("beforeend",h)}
function closeModal(){document.querySelector(".modal-backdrop")?.remove();state.pendingPlateFile=null}
async function imageDataUrl(file,maxSize=1600,quality=.82){
  if(!file||!file.type.startsWith("image/")) throw new Error("Please choose an image");
  if(file.size>12_000_000) throw new Error("Image is too large. Please choose a photo under 12 MB.");
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  return canvas.toDataURL("image/jpeg",quality);
}

async function connect(){
  if(state.demo)return;
  const c=cfg();if(!c?.url||!c?.key)return;
  const makeClient=await loadSupabaseClient();
  state.client=makeClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data,error}=await state.client.auth.getSession();if(error)throw error;
  state.user=data.session?.user||null;
  state.outboxCount=readOutbox().length;state.offline=!navigator.onLine;
  state.client.auth.onAuthStateChange((_e,s)=>{state.user=s?.user||null;render()});
}
async function boot(){
  try{await connect();if(state.demo){loadDemo();return render()}if(!connected()||!state.user)return render();await loadWorkspace();render();syncOutbox()}
  catch(e){state.error=e.message||"Unable to connect";render()}
}
async function loadWorkspace(){
  const {data:m,error:me}=await state.client.schema("garage").from("memberships").select("organization_id,role").eq("user_id",state.user.id);if(me)throw me;
  if(!m?.length){state.org=null;state.garage=null;state.machines=[];return}
  const ids=m.map(x=>x.organization_id);
  const {data:o,error:oe}=await state.client.schema("garage").from("organizations").select("id,name,slug,created_at").in("id",ids).order("created_at",{ascending:true});if(oe)throw oe;
  state.org=o?.[0]||null;if(!state.org)return;
  const {data:g,error:ge}=await state.client.schema("garage").from("garages").select("id,name,location_name").eq("organization_id",state.org.id).order("created_at");if(ge)throw ge;
  state.garage=g?.[0]||null;if(state.garage)await loadMachines();
}
async function loadMachines(){
  const {data,error}=await state.client.schema("garage").from("machines").select("id,garage_id,machine_variant_id,serial_number,asset_number,nickname,purchase_date,purchase_price,warranty_start_date,warranty_end_date,warranty_provider,ownership_type,ownership_name,current_engine_hours,current_reel_hours,status,notes,created_at").eq("garage_id",state.garage.id).order("created_at",{ascending:false});if(error)throw error;
  const rows=data||[];if(!rows.length){state.machines=[];return}
  const vids=rows.map(x=>x.machine_variant_id).filter(Boolean);
  const {data:v,error:ve}=await state.client.schema("catalogue").from("machine_variants").select("id,variant_name,machine_model_id").in("id",vids);if(ve)throw ve;
  const mids=(v||[]).map(x=>x.machine_model_id);
  const {data:mo,error:me}=mids.length?await state.client.schema("catalogue").from("machine_models").select("id,model_name,model_code,manufacturer_id").in("id",mids):{data:[]};if(me)throw me;
  const fids=(mo||[]).map(x=>x.manufacturer_id);
  const {data:f,error:fe}=fids.length?await state.client.schema("catalogue").from("manufacturers").select("id,name").in("id",fids):{data:[]};if(fe)throw fe;
  const vm=new Map((v||[]).map(x=>[x.id,x])),mm=new Map((mo||[]).map(x=>[x.id,x])),fm=new Map((f||[]).map(x=>[x.id,x]));
  state.machines=rows.map(x=>{const vv=vm.get(x.machine_variant_id),model=vv&&mm.get(vv.machine_model_id),man=model&&fm.get(model.manufacturer_id);return {...x,variant:vv,model,manufacturer:man}});
  const ids=state.machines.map(x=>x.id);
  if(!ids.length){state.dashboardDue=[];return}
  const {data:due,error:de}=await state.client.schema("garage").from("machine_service_due").select("machine_id,service_status,hours_remaining,task_name").in("machine_id",ids);
  if(de)throw de;
  state.dashboardDue=due||[];
  if(state.demo){state.openFaults=[]}
  else{
    const {data:fo,error:fe}=await state.client.schema("garage").from("machine_faults").select("id,machine_id,severity,status,description,reported_at,reported_by,resolved_at").in("machine_id",ids).neq("status","resolved").order("reported_at",{ascending:false}).limit(30);
    if(fe)throw fe;
    state.openFaults=fo||[];
  }
}
async function search(q){
  const box=document.querySelector("#results");if(!q.trim()){box.innerHTML="<p class='tiny'>Try <b>LF3800</b>.</p>";return}
  state.loading=true;box.innerHTML="<div class='loading'><div class='spinner'></div>Searching catalogue…</div>";
  try{
    if(state.demo)state.catalogueResults=demoCatalogue.filter(x=>[x.manufacturer_name,x.model_name,x.variant_name].some(v=>v.toLowerCase().includes(q.toLowerCase())));
    else{const {data,error}=await state.client.schema("catalogue").rpc("search_machines",{search_text:q.trim(),result_limit:12});if(error)throw error;state.catalogueResults=data||[]}
    box.innerHTML=state.catalogueResults.length
      ?state.catalogueResults.map(r=>"<button class='result' data-action='select' data-id='"+esc(r.variant_id)+"'><div><div class='result-name'>"+esc(r.manufacturer_name)+" "+esc(r.model_name)+"</div><div class='result-meta'>"+esc(r.variant_name||"Model")+" · "+esc(r.machine_type||"Machine")+"</div></div><span class='arrow'>›</span></button>").join("")
      :"<div class='empty-mini'><div class='tiny'><b>Nothing found in the catalogue.</b></div><div class='tiny' style='margin-top:5px'>If the machine is sitting in front of you, scan its model plate and REELMOW will identify the text so we can search again.</div><button class='btn secondary small' style='margin-top:12px' data-action='unknown-machine'>Scan model plate</button></div>";
  }catch(e){box.innerHTML="<div class='error'>"+esc(e.message||"Search failed")+"</div>"}finally{state.loading=false}
}
function shell(c){
  const connectionLabel=state.demo?"Demo mode":state.offline?(state.outboxCount?"Offline · "+state.outboxCount+" saved":"Offline"):connected()?"Connected":"Connect";
  const connectionClass=state.demo?"demo":state.offline?"offline":connected()?"ok":"";
  const active=state.view||"today";
  const nav=(key,label)=>"<button class='nav-link "+(active===key?"active":"")+"' data-action='"+key+"'>"+label+"</button>";
  return "<div class='shell'><header class='topbar'><div class='brand'><span class='mark'></span>REEL<span>MOW</span></div><nav class='top-nav'>"+nav("today","Today")+nav("garage","Garage")+nav("catalogue","Catalogue")+"</nav><div class='top-actions'><button class='btn ghost small' data-action='connection'><span class='dot "+connectionClass+"'></span>"+connectionLabel+"</button>"+(state.user?"<div class='avatar'>"+esc(initials(state.user.email))+"</div>":"")+"</div></header><main class='page'>"+c+"</main><nav class='mobile-nav'>"+nav("today","Today")+nav("garage","Garage")+nav("activity","Activity")+nav("profile","Profile")+"</nav><div class='footer'>REELMOW · Field operations, under control.</div></div>"
}
function mount(c){app.innerHTML="<div class='app'>"+shell(c)+"</div>"}
function setView(view){
  state.view=view;
  localStorage.setItem("reelmow.view.v1",view);
  state.selected=null;
  state.specs=[];
  render();
}
function render(){
  if(!state.demo&&!connected())return renderConnect();
  if(!state.demo&&!state.user)return renderAuth();
  if(!state.demo&&!state.org)return renderOrg();
  if(!state.demo&&!state.garage)return renderGarageSetup();
  if(state.mow.active)return renderMowScreen();
  if(state.selected)return renderDetail();
  if(state.view==="today")return renderToday();
  if(state.view==="garage")return renderGarage();
  if(state.view==="catalogue")return renderCataloguePage();
  if(state.view==="activity")return renderActivity();
  if(state.view==="profile")return renderProfile();
  return renderToday();
}
function renderConnect(){
  mount("<section class='hero'><div class='hero-card'><div class='hero-copy'><div class='eyebrow'>Digital machinery management</div><h1>Your machinery, under control.</h1><p class='lede' style='color:#d2e1d8'>Machines, manuals, specifications and service history in one digital Garage.</p><div class='actions' style='margin-top:24px'><button class='btn' data-action='connection'>Connect Supabase</button><button class='btn secondary' data-action='demo'>Preview Garage</button></div></div></div><div class='hero-stat'><div><div class='stat-num'>0</div><div class='stat-label'>Machines in your Garage</div></div><div class='tiny'>Connect the live project to use real data.</div></div></section><div class='grid'><div class='card'><div class='eyebrow'>Catalogue</div><h3>Verified machine knowledge</h3><p class='tiny'>Search manufacturer, model and variant records before adding an asset.</p></div><div class='card'><div class='eyebrow'>Service</div><h3>One machine record</h3><p class='tiny'>Hours, service records and documents stay attached to the physical asset.</p></div><div class='card'><div class='eyebrow'>Grounds teams</div><h3>Built around the work</h3><p class='tiny'>Calm, practical machinery management for clubs, estates, education and contractors.</p></div></div>")
}
function renderAuth(){
  mount("<div style='max-width:520px;margin:8vh auto'><div class='card'><div class='eyebrow'>Welcome to REELMOW</div><h1 style='font-size:38px'>Sign in.</h1><p class='lede'>Access your digital Garage and machinery records.</p>"+(state.error?"<div class='error' style='margin:18px 0'>"+esc(state.error)+"</div>":"")+"<form id='auth' style='margin-top:24px'><div class='field'><label>Email</label><input class='input' id='email' type='email' required></div><div class='field'><label>Password</label><input class='input' id='password' type='password' minlength='8' required></div><div class='actions'><button class='btn'>Sign in</button><button class='btn secondary' type='button' data-action='signup'>Create account</button></div></form><button class='back' style='margin-top:20px' data-action='connection'>Connection settings</button></div></div>");
  document.querySelector("#auth").addEventListener("submit",signIn)
}
function renderOrg(){
  mount("<div style='max-width:620px;margin:7vh auto'><div class='card'><div class='eyebrow'>First setup</div><h1 style='font-size:40px'>Build your Garage.</h1><p class='lede'>Start with your organisation and primary machinery location.</p><form id='org' style='margin-top:25px'><div class='field'><label>Organisation name</label><input class='input' id='org-name' placeholder='Barton Town Cricket Club' required></div><div class='field'><label>Garage name</label><input class='input' id='garage-name' value='Main Garage' required></div><div class='field'><label>Location</label><input class='input' id='garage-location' placeholder='Clubhouse / Grounds'></div><button class='btn'>Create Garage</button></form></div></div>");
  document.querySelector("#org").addEventListener("submit",createOrg)
}
function renderGarageSetup(){
  mount("<div style='max-width:620px;margin:7vh auto'><div class='card'><div class='eyebrow'>Garage</div><h1 style='font-size:40px'>Create your first Garage.</h1><p class='lede'>A Garage is a physical machinery location within your organisation.</p><form id='garage' style='margin-top:25px'><div class='field'><label>Garage name</label><input class='input' id='garage-name' value='Main Garage' required></div><div class='field'><label>Location</label><input class='input' id='garage-location'></div><button class='btn'>Create Garage</button></form></div></div>");
  document.querySelector("#garage").addEventListener("submit",createGarage)
}
function card(m){
  const n=m.model?.model_name||"Machine",v=m.variant?.variant_name||"Catalogue variant";
  return "<article class='card machine-card' data-action='open' data-id='"+esc(m.id)+"'><div class='machine-visual'><div class='glyph'>⚙︎</div></div><div class='machine-name'>"+esc(m.nickname||n)+"</div><div class='machine-sub'>"+esc(m.manufacturer?.name||"Manufacturer")+" · "+esc(v)+"</div><div class='machine-meta'><span class='badge "+(m.status==="service_due"?"service":"ready")+"'>"+esc((m.status||"ready").replaceAll("_"," "))+"</span><span class='tiny'>"+(m.current_engine_hours!=null?esc(m.current_engine_hours)+" h":"No hours")+"</span></div></article>"
}
function renderToday(){
  const due=(state.dashboardDue||[]).filter(x=>x.service_status==="due"||x.service_status==="upcoming");
  const urgent=due.filter(x=>x.service_status==="due");
  const faults=(state.openFaults||[]).filter(x=>x.status!=="resolved");
  const machineCount=state.machines.length;
  const totalHours=state.machines.reduce((sum,m)=>sum+(Number(m.current_engine_hours)||0),0);
  const attention=urgent.slice(0,4).map(x=>{
    const m=state.machines.find(v=>v.id===x.machine_id);
    return "<button class='today-task' data-action='open' data-id='"+esc(x.machine_id)+"'><span><strong>"+esc(m?.nickname||m?.model?.model_name||"Machine")+"</strong><small>"+esc(x.task_name||"Service task")+(x.hours_remaining!=null?" · "+esc(x.hours_remaining)+" h remaining":"")+"</small></span><span class='badge "+(x.service_status==="due"?"service":"ready")+"'>"+esc(x.service_status==="due"?"DUE":"SOON")+"</span></button>";
  }).join("");
  const faultAttention=faults.slice(0,4).map(x=>{
    const m=state.machines.find(v=>v.id===x.machine_id);
    return "<button class='today-task fault-task' data-action='open' data-id='"+esc(x.machine_id)+"'><span><strong>"+esc(m?.nickname||m?.model?.model_name||"Machine")+"</strong><small>"+esc(x.description)+"</small></span><span class='badge fault-"+esc(x.severity)+"'>"+esc(x.severity.toUpperCase())+"</span></button>";
  }).join("");
  const combinedAttention=attention+faultAttention;
  const attentionBlock=combinedAttention
    ? "<section class='today-section'><div class='section-head'><div><div class='eyebrow'>Needs attention</div><h2>What matters now?</h2></div></div><div class='today-tasks'>"+combinedAttention+"</div></section>"
    : "<section class='today-section'><div class='calm-card card'><div class='calm-mark'>✓</div><div><strong>You're up to date.</strong><div class='tiny'>No service tasks or reported faults currently require action.</div></div></div></section>";
  mount("<section class='today-hero'><div><div class='eyebrow'>"+esc(state.demo?"Demo workspace":state.org?.name||"Your workspace")+"</div><h1>Good morning.<br>Let's get to work.</h1><p class='lede' style='color:#d2e1d8'>The important things are here. Everything else can stay out of the way.</p></div><div class='today-status'><span class='status-dot'></span><div><strong>Fleet operational</strong><small>"+machineCount+" machine"+(machineCount===1?"":"s")+" · "+(totalHours?Math.round(totalHours)+" recorded hours":"No hours recorded")+"</small></div></div></section>"+quickActions()+attentionBlock+"<section class='today-section'><div class='section-head'><div><div class='eyebrow'>Your Garage</div><h2>Machinery at a glance</h2></div><button class='btn secondary small' data-action='garage'>View Garage</button></div><div class='today-machine-strip'>"+(state.machines.length?state.machines.slice(0,4).map(card).join(""):"<div class='card empty'><h2>Start with your first machine.</h2><p class='lede'>Build the operational memory of your Garage.</p><button class='btn' data-action='quick-add'>Add machine</button></div>")+"</div></section>");
}
function quickActions(){
  return "<div class='quick-actions'><button class='quick-action quick-mow' data-action='mow'><span class='quick-icon'>▰</span><strong>Start Mow Mode</strong><small>GPS track + speed</small></button><button class='quick-action' data-action='quick-add'><span class='quick-icon'>＋</span><strong>Add machine</strong><small>Catalogue + plate</small></button><button class='quick-action' data-action='quick-hours'><span class='quick-icon'>◷</span><strong>Update hours</strong><small>Fast field entry</small></button><button class='quick-action' data-action='quick-service'><span class='quick-icon'>✓</span><strong>Record service</strong><small>Complete a task</small></button><button class='quick-action' data-action='quick-fault'><span class='quick-icon'>!</span><strong>Report problem</strong><small>Capture an issue</small></button></div>";
}
function haversineM(a,b){
  if(!a||!b)return 0;
  const R=6371000,rad=Math.PI/180,dLat=(b.latitude-a.latitude)*rad,dLon=(b.longitude-a.longitude)*rad;
  const q=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function formatElapsed(start){
  const s=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000));
  return String(Math.floor(s/3600)).padStart(2,"0")+":"+String(Math.floor((s%3600)/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
}
function trackSvg(){
  const pts=state.mow.trackPoints||[];
  if(pts.length<2)return "";
  const lats=pts.map(p=>p.latitude),lons=pts.map(p=>p.longitude);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);
  const latSpan=Math.max(maxLat-minLat,0.00001),lonSpan=Math.max(maxLon-minLon,0.00001);
  const xy=pts.map(p=>[20+((p.longitude-minLon)/lonSpan)*360,220-((p.latitude-minLat)/latSpan)*200]);
  return "<svg class='mow-track' viewBox='0 0 400 240' preserveAspectRatio='none' aria-label='Recorded mowing track'><polyline points='"+xy.map(p=>p.join(",")).join(" ")+"' /></svg>";
}
function renderMowScreen(){
  const m=state.machines.find(x=>x.id===state.mow.machineId);
  const elapsed=state.mow.startedAt?formatElapsed(state.mow.startedAt):"00:00:00";
  const speed=state.mow.speedMps!=null?(state.mow.speedMps*3.6).toFixed(1):"—";
  const distance=(state.mow.distanceM/1000).toFixed(2);
  mount("<section class='mow-screen'><div class='mow-top'><div><div class='eyebrow'>Mow Mode</div><h1>"+esc(m?.nickname||m?.model?.model_name||"Machine")+"</h1><div class='tiny'>"+esc(m?.manufacturer?.name||"")+" · "+esc(m?.variant?.variant_name||"")+"</div></div><button class='btn ghost small' data-action='exit-mow'>Exit</button></div><div class='mow-live-card'><div class='mow-live-state'><span class='mow-live-dot "+(state.mow.paused?"paused":"")+"'></span><strong>"+(state.mow.paused?"PAUSED":"TRACKING")+"</strong><small>"+(state.mow.accuracyM!=null?"GPS ±"+Math.round(state.mow.accuracyM)+" m":"Waiting for GPS…")+"</small></div><div class='mow-metrics'><div><span>"+elapsed+"</span><small>Time</small></div><div><span>"+distance+" km</span><small>Distance</small></div><div><span>"+speed+"</span><small>Speed km/h</small></div></div><div class='mow-target'><span>Pattern</span><strong>"+esc(state.mow.pattern.replace("_"," "))+"</strong><span>Target "+(state.mow.targetSpeedKph!=null?esc(state.mow.targetSpeedKph)+" km/h":"not set")+"</span></div></div><div class='mow-map'>"+trackSvg()+"<div class='mow-crosshair'>⌖</div><div class='mow-map-copy'><strong>"+(state.mow.points?"Track recording":"Waiting for first position")+"</strong><small>"+state.mow.points+" GPS point"+(state.mow.points===1?"":"s")+" recorded</small></div></div><div class='mow-controls'><button class='btn secondary' data-action='mow-pause'>"+(state.mow.paused?"Resume":"Pause")+"</button><button class='btn mow-stop' data-action='mow-stop'>Finish mow</button></div></section>");
}
function machinePicker(action){
  if(!state.machines.length)return setView("catalogue");
  if(state.machines.length===1){state.selected=state.machines[0];return action==="hours"?hoursModal():action==="service"?serviceModal():action==="fault"?faultModal():startMow(state.machines[0].id)}
  state.quickAction=action;
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Choose machine</div><h2>Which machine?</h2><p class='tiny'>Start the field action against the correct asset.</p></div><button class='close' data-action='close'>×</button></div><div class='picker-list'>"+state.machines.map(m=>"<button class='picker-row' data-action='quick-machine' data-id='"+esc(m.id)+"'><span><strong>"+esc(m.nickname||m.model?.model_name||"Machine")+"</strong><small>"+esc(m.manufacturer?.name||"")+" · "+esc(m.variant?.variant_name||"")+"</small></span><span class='picker-hours'>"+(m.current_engine_hours!=null?esc(m.current_engine_hours)+" h":"No hours")+" ›</span></button>").join("")+"</div></div></div>");
}
function activityIcon(type){return type==="fault"?"!":type==="service"?"✓":type==="hours"?"◷":"•"}
function activityHtml(){
  if(!state.activity.length)return "<div class='card empty' style='margin-top:20px'><div class='empty-icon'>◷</div><h2>No activity yet.</h2><p class='lede' style='margin:0 auto'>Hours, service and machine issues will appear here as your team works.</p></div>";
  return "<div class='activity-list'>"+state.activity.map(x=>{
    const m=state.machines.find(v=>v.id===x.machine_id);
    const date=new Date(x.at).toLocaleString([], {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    const detail=x.type==="fault"?x.description:(x.type==="hours"?(x.engine_hours!=null?x.engine_hours+" engine hours":"Hours reading"):(x.task_name||"Service completed"));
    return "<article class='activity-row'><div class='activity-icon "+esc(x.type)+"'>"+activityIcon(x.type)+"</div><div class='activity-body'><div class='activity-title'>"+esc(x.title)+"</div><div class='activity-machine'>"+esc(m?.nickname||m?.model?.model_name||"Machine")+" · "+esc(date)+"</div><div class='activity-detail'>"+esc(detail)+"</div></div><span class='badge "+(x.type==="fault"?"service":"ready")+"'>"+esc(x.type)+"</span></article>";
  }).join("")+"</div>";
}
function pendingActivityFor(machineId){
  return readOutbox().filter(x=>x.payload?.machineId===machineId).map(x=>({
    type:x.type==="fault"?"fault":x.type,
    machine_id:machineId,
    at:x.createdAt,
    title:x.type==="hours"?"Hours update pending sync":x.type==="service"?"Service record pending sync":"Problem report pending sync",
    detail:x.type==="hours"?(x.payload.engineHours!=null?"Engine "+x.payload.engineHours+" h":"Hours reading saved on device"):x.type==="service"?(x.payload.notes||"Service record saved on device"):(x.payload.description||"Problem report saved on device"),
    severity:x.payload.severity,
    pending:true
  }));
}
async function loadActivity(){
  if(state.demo){
    state.activity=[
      {type:"service",machine_id:"demo-lf3800",at:"2026-08-14T10:00:00Z",title:"Service completed",task_name:"Engine oil change",engine_hours:1180},
      {type:"hours",machine_id:"demo-lf3800",at:"2026-09-20T09:00:00Z",title:"Hours updated",engine_hours:1284.5}
    ];
    return;
  }
  const ids=state.machines.map(m=>m.id);
  if(!ids.length){state.activity=[];return}
  const [h,s,faults]=await Promise.all([
    state.client.schema("garage").from("machine_hours_log").select("id,machine_id,recorded_at,engine_hours,reel_hours,source,notes").in("machine_id",ids).order("recorded_at",{ascending:false}).limit(40),
    state.client.schema("garage").from("machine_service_records").select("id,machine_id,serviced_at,engine_hours,reel_hours,cost,notes,service_task_id").in("machine_id",ids).order("serviced_at",{ascending:false}).limit(40),
    state.client.schema("garage").from("machine_faults").select("id,machine_id,status,severity,description,reported_at,resolved_at").in("machine_id",ids).order("reported_at",{ascending:false}).limit(40)
  ]);
  if(h.error)throw h.error;if(s.error)throw s.error;if(faults.error)throw faults.error;
  const taskIds=(s.data||[]).map(x=>x.service_task_id).filter(Boolean);
  let tasks=[];
  if(taskIds.length){const t=await state.client.schema("catalogue").from("service_tasks").select("id,task_name").in("id",[...new Set(taskIds)]);if(t.error)throw t.error;tasks=t.data||[]}
  const tm=new Map(tasks.map(x=>[x.id,x.task_name]));
  state.activity=[
    ...(h.data||[]).map(x=>({type:"hours",machine_id:x.machine_id,at:x.recorded_at,title:"Hours updated",engine_hours:x.engine_hours,detail:x.notes})),
    ...(s.data||[]).map(x=>({type:"service",machine_id:x.machine_id,at:x.serviced_at,title:"Service completed",task_name:tm.get(x.service_task_id)||"Unscheduled service",engine_hours:x.engine_hours,detail:x.notes})),
    ...(faults.data||[]).map(x=>({type:"fault",machine_id:x.machine_id,at:x.reported_at,title:x.status==="resolved"?"Problem resolved":"Problem reported",severity:x.severity,description:x.description}))
  ].concat(state.machines.flatMap(m=>pendingActivityFor(m.id))).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,80);
}
function renderActivity(){
  loadActivity().then(()=>{const box=document.querySelector("#activity-content");if(box)box.innerHTML=activityHtml()}).catch(x=>{const box=document.querySelector("#activity-content");if(box)box.innerHTML="<div class='error'>"+esc(x.message||"Could not load activity")+"</div>"});
  const pending=readOutbox().length;
  mount("<section class='page-intro'><div class='eyebrow'>Activity</div><h1>What happened?</h1><p class='lede'>A single operational history for services, hours and machine issues.</p>"+(pending?"<div class='note' style='margin-top:14px'><b>"+pending+" saved change"+(pending===1?"":"s")+" waiting to sync.</b> REELMOW will retry automatically when a connection is available.</div>":"")+"</section><div id='activity-content'></div>");
}
function renderProfile(){
  mount("<section class='page-intro'><div class='eyebrow'>Profile</div><h1>Your workspace.</h1><p class='lede'>Organisation, account and operating preferences.</p></section><div class='grid two' style='margin-top:20px'><div class='card'><div class='eyebrow'>Organisation</div><h2>"+esc(state.org?.name||"REELMOW Demo")+"</h2><p class='tiny'>"+esc(state.garage?.name||"Main Garage")+" · "+esc(state.garage?.location_name||"Field workspace")+"</p></div><div class='card'><div class='eyebrow'>Account</div><h2>"+esc(state.user?.email||"Demo user")+"</h2><p class='tiny'>Your REELMOW field workspace.</p></div></div>");
}
function renderCataloguePage(){
  mount("<section class='page-intro'><div class='eyebrow'>Catalogue</div><h1>Find a machine.</h1><p class='lede'>Start with verified manufacturer, model and variant data.</p></section><div class='card' style='margin-top:20px'><button class='btn' data-action='add'>Search catalogue</button><button class='btn secondary' style='margin-left:8px' data-action='unknown-machine'>Scan model plate</button></div>");
}
function renderGarage(){
  const list=state.machines;
  const due=state.dashboardDue||[];
  const attention=due.filter(x=>x.service_status==="due").length;
  const upcoming=due.filter(x=>x.service_status==="upcoming").length;
  const totalHours=list.reduce((sum,m)=>sum+(Number(m.current_engine_hours)||0),0);
  const attentionRows=due.filter(x=>x.service_status==="due").slice(0,5).map(x=>{
    const m=list.find(v=>v.id===x.machine_id);
    return `<button class="attention-row" data-action="open" data-id="${esc(x.machine_id)}"><span><strong>${esc(m?.nickname||m?.model?.model_name||"Machine")}</strong><small>${esc(x.task_name||"Service task")}</small></span><span class="badge service">DUE</span></button>`;
  }).join("");
  const operations=attention
    ? `<div class="attention-list">${attentionRows}</div>`
    : `<div class="card calm-card"><div class="calm-mark">✓</div><div><strong>Fleet is up to date.</strong><div class="tiny">No published service tasks are currently due.</div></div></div>`;
  const fleet=list.length
    ? `<div class="grid">${list.map(card).join("")}</div>`
    : `<div class="card empty"><div class="empty-icon">⚙︎</div><h2>Your Garage is empty.</h2><p class="lede" style="margin:0 auto 18px">Start by adding a machine from the REELMOW catalogue.</p><button class="btn" data-action="add">Add your first machine</button></div>`;
  mount(`
    <section class="command-hero">
      <div>
        <div class="eyebrow">${esc(state.demo?"Demo Garage":state.org?.name||"Garage")}</div>
        <h1>Machinery,<br>under control.</h1>
        <p class="lede" style="color:#d2e1d8">A single operational view of your fleet, service position and machine records.</p>
        <div class="actions" style="margin-top:23px"><button class="btn" data-action="add">＋ Add machine</button></div>
      </div>
      <div class="command-hero-side"><div class="hero-side-label">Fleet status</div><div class="hero-side-number">${list.length}</div><div class="hero-side-copy">machines in ${esc(state.garage?.name||"your Garage")}</div></div>
    </section>
    <section class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Fleet</div><div class="kpi-value">${list.length}</div><div class="kpi-meta">Total machines</div></div>
      <div class="kpi-card ${attention?"alert":""}"><div class="kpi-label">Attention</div><div class="kpi-value">${attention}</div><div class="kpi-meta">Service items due</div></div>
      <div class="kpi-card"><div class="kpi-label">Upcoming</div><div class="kpi-value">${upcoming}</div><div class="kpi-meta">Published service items</div></div>
      <div class="kpi-card"><div class="kpi-label">Engine time</div><div class="kpi-value">${totalHours?Math.round(totalHours):"—"}</div><div class="kpi-meta">Recorded fleet hours</div></div>
    </section>
    <div class="section-head"><div><div class="eyebrow">Operations</div><h2>What needs attention?</h2></div><button class="btn secondary small" data-action="add">Add machine</button></div>
    ${operations}
    <div class="section-head"><div><div class="eyebrow">Garage</div><h2>Your machinery</h2></div></div>
    ${fleet}
  `);
}

function renderDetail(){
  const m=state.selected;
  const pending=readOutbox().filter(x=>x.payload?.machineId===m.id).length;
  mount("<div class='breadcrumb'><button class='back' data-action='back'>← Garage</button><span>/</span><span>Machine profile</span></div><section class='detail-head'><div class='machine-title'><div class='machine-title-icon'>⚙︎</div><div><div class='eyebrow'>"+esc(m.manufacturer?.name||"Manufacturer")+"</div><h1 style='font-size:38px;margin-bottom:5px'>"+esc(m.nickname||m.model?.model_name||"Machine")+"</h1><p class='muted'>"+esc(m.variant?.variant_name||"Variant")+"</p></div></div><div class='actions'><span class='badge "+(m.status==="service_due"?"service":"ready")+"'>"+esc((m.status||"ready").replaceAll("_"," "))+"</span></div></section><div class='detail-grid'><div><div class='card'><div class='section-head' style='margin:0 0 12px'><div><div class='eyebrow'>Machine health</div><h2>At a glance</h2></div><button class='btn secondary small' data-action='edit'>Edit</button></div><div class='metric-row'><div class='metric'><div class='num'>"+(m.current_engine_hours??"—")+"</div><div class='label'>Engine hours</div></div><div class='metric'><div class='num'>"+(m.current_reel_hours??"—")+"</div><div class='label'>Reel hours</div></div></div><div class='actions' style='margin-top:14px'><button class='btn small' data-action='hours'>Update hours</button><button class='btn secondary small' data-action='service'>Record service</button></div><div class='list'><div class='list-row'><div><div class='list-title'>Serial number</div><div class='list-meta'>"+esc(m.serial_number||"Not recorded")+"</div></div></div><div class='list-row'><div><div class='list-title'>Asset number</div><div class='list-meta'>"+esc(m.asset_number||"Not recorded")+"</div></div></div><div class='list-row'><div><div class='list-title'>Purchase date</div><div class='list-meta'>"+esc(m.purchase_date||"Not recorded")+"</div></div></div></div></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Service status</div><h2>What needs doing?</h2><div id='service-due'><div class='loading'><div class='spinner'></div>Checking service schedule…</div></div></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Catalogue specifications</div><h2>Known machine data</h2><div id='specs'><div class='loading'><div class='spinner'></div>Loading verified specifications…</div></div></div></div><div><div class='card'><div class='eyebrow'>Service history</div><h2>Recent work</h2><div id='service-history'><div class='loading'><div class='spinner'></div>Loading service history…</div></div></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Faults & repairs</div><h2>Problems and resolution</h2><div class='actions' style='margin:10px 0'><button class='btn secondary small' data-action='fault'>Report problem</button></div><div id='machine-faults'><div class='loading'><div class='spinner'></div>Loading fault history…</div></div></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Documents</div><h2>Machine knowledge</h2><div class='actions' style='margin:10px 0'><button class='btn secondary small' data-action='document-upload'>Add document</button></div><div id='machine-documents'><div class='loading'><div class='spinner'></div>Loading documents…</div></div></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Photos</div><h2>Machine evidence</h2><div class='actions' style='margin:10px 0'><button class='btn secondary small' data-action='photo-upload'>Take / add photo</button></div><div id='machine-photos'><div class='loading'><div class='spinner'></div>Loading photos…</div></div></div></div></div>"+(pending?"<div class='note' style='margin:0 0 15px'><b>"+pending+" change"+(pending===1?"":"s")+" saved on this device.</b> It will sync automatically when online.</div>":"");
  loadSpecs(m);loadServiceData(m);loadEvidence(m);loadMachineFaults(m)
}
function faultHtml(){
  if(!state.machineFaults.length)return "<div class='empty-mini'><div class='tiny'>No reported problems.</div></div>";
  return "<div class='list'>"+state.machineFaults.map(x=>"<div class='list-row fault-row'><div><div class='list-title'>"+esc(x.severity.toUpperCase())+" · "+esc(x.status.replace("_"," "))+"</div><div class='list-meta'>"+esc(new Date(x.reported_at).toLocaleDateString())+" · "+esc(x.description)+"</div>"+(x.resolution_notes?"<div class='list-meta' style='margin-top:4px'>"+esc(x.resolution_notes)+"</div>":"")+"</div>"+(x.status!=="resolved"?"<button class='btn ghost small' data-action='resolve-fault' data-id='"+esc(x.id)+"'>Resolve</button>":"<span class='badge ready'>RESOLVED</span>")+"</div>").join("")+"</div>";
}
async function loadMachineFaults(m){
  if(state.demo){state.machineFaults=[]}
  else{
    const {data,error}=await state.client.schema("garage").from("machine_faults").select("id,severity,status,description,reported_at,resolved_at,resolution_notes").eq("machine_id",m.id).order("reported_at",{ascending:false}).limit(20);
    if(error)return toast(error.message);
    state.machineFaults=data||[];
  }
  const box=document.querySelector("#machine-faults");if(box)box.innerHTML=faultHtml();
}
function resolveFaultModal(id){
  const fault=state.machineFaults.find(x=>x.id===id);if(!fault)return;
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Resolve issue</div><h2>Close the loop.</h2><p class='tiny'>Record what was done so the issue becomes part of the machine history.</p></div><button class='close' data-action='close'>×</button></div><form id='resolve-form'><div class='field'><label>Resolution notes</label><textarea class='input' id='resolution-notes' rows='4' required placeholder='What was repaired, adjusted or checked?'></textarea></div><button class='btn' style='width:100%'>Mark resolved</button></form></div></div>");
  document.querySelector("#resolve-form").addEventListener("submit",async e=>{
    e.preventDefault();
    if(state.demo){fault.status="resolved";fault.resolution_notes=val("#resolution-notes");fault.resolved_at=new Date().toISOString();closeModal();toast("Problem resolved");return renderDetail()}
    try{
      const {error}=await state.client.schema("garage").from("machine_faults").update({status:"resolved",resolved_at:new Date().toISOString(),resolution_notes:val("#resolution-notes"),updated_at:new Date().toISOString()}).eq("id",id);
      if(error)throw error;
      closeModal();await loadMachines();await loadMachineFaults(state.selected);toast("Problem resolved");renderDetail();
    }catch(x){toast(x.message||"Could not resolve problem")}
  });
}
function specsHtml(){
  return "<div class='spec-grid'>"+state.specs.map(s=>"<div class='spec'><div class='v'>"+esc(s.value_text??s.value_number??"—")+(s.unit?" "+esc(s.unit):"")+"</div><div class='k'>"+esc(s.label)+"</div></div>").join("")+"</div>"
}
async function loadSpecs(m){
  if(state.demo){state.specs=[{label:"Cutting width",value_number:2.54,unit:"m"},{label:"Number of reels",value_number:5,unit:"count"},{label:"Reel diameter",value_number:178,unit:"mm"},{label:"Reel width",value_number:559,unit:"mm"},{label:"Minimum height of cut",value_number:9.5,unit:"mm"},{label:"Maximum height of cut",value_number:29,unit:"mm"},{label:"Reel blades",value_text:"9 or 11"},{label:"Fuel",value_text:"Diesel"},{label:"Engine",value_text:"Kubota"}]}
  else{const {data,error}=await state.client.schema("catalogue").from("facts").select("value_text,value_number,unit,spec_definition_id").eq("machine_model_id",m.model.id).eq("status","active");if(error)return toast(error.message);const ids=(data||[]).map(x=>x.spec_definition_id);const {data:d,error:de}=ids.length?await state.client.schema("catalogue").from("spec_definitions").select("id,label").in("id",ids):{data:[]};if(de)return toast(de.message);const map=new Map((d||[]).map(x=>[x.id,x.label]));state.specs=(data||[]).map(x=>({...x,label:map.get(x.spec_definition_id)||"Specification"}))}
  const box=document.querySelector("#specs");if(box)box.innerHTML=state.specs.length?specsHtml():"<p class='tiny'>No verified specifications available.</p>"
}
function documentsHtml(){
  if(!state.machineDocuments?.length)return "<div class='empty-mini'><div class='tiny'>No documents attached to this machine yet.</div></div>";
  return "<div class='list'>"+state.machineDocuments.map(x=>"<div class='list-row'><div><div class='list-title'>"+esc(x.title)+"</div><div class='list-meta'>"+esc(x.document_type)+" · "+esc(x.source||"upload")+"</div></div><button class='btn ghost small' data-action='open-document' data-id='"+esc(x.id)+"'>Open</button></div>").join("")+"</div>"
}
function photosHtml(){
  if(!state.machinePhotos?.length)return "<div class='empty-mini'><div class='tiny'>Add a photo of the machine, model plate or service evidence.</div></div>";
  return "<div class='photo-grid'>"+state.machinePhotos.map(x=>"<div class='photo-card'><img src='"+esc(x.url)+"' alt='"+esc(x.caption||"Machine photo")+"' loading='lazy'><div class='tiny'>"+esc(x.caption||"Machine photo")+"</div></div>").join("")+"</div>"
}
async function loadEvidence(m){
  state.machineDocuments=[];state.machinePhotos=[];
  if(state.demo){
    state.machineDocuments=[{id:"demo-manual",title:"Jacobsen LF3800 Operator Manual",document_type:"operator_manual",source:"manufacturer"}];
    state.machinePhotos=[];
  }else{
    const [d,p]=await Promise.all([
      state.client.schema("garage").from("machine_documents").select("id,title,document_type,storage_bucket,storage_path,source,created_at").eq("machine_id",m.id).order("created_at",{ascending:false}),
      state.client.schema("garage").from("machine_photos").select("id,storage_bucket,storage_path,caption,photo_type,captured_at,created_at").eq("machine_id",m.id).order("created_at",{ascending:false})
    ]);
    if(d.error)return toast(d.error.message);if(p.error)return toast(p.error.message);
    state.machineDocuments=d.data||[];
    state.machinePhotos=[];
    for(const x of p.data||[]){
      const u=await state.client.storage.from(x.storage_bucket).createSignedUrl(x.storage_path,3600);
      if(!u.error)state.machinePhotos.push({...x,url:u.data.signedUrl});
    }
  }
  const db=document.querySelector("#machine-documents");if(db)db.innerHTML=documentsHtml();
  const pb=document.querySelector("#machine-photos");if(pb)pb.innerHTML=photosHtml();
}
function evidenceUploadModal(kind){
  const m=state.selected;
  const isPhoto=kind==="photo";
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>"+(isPhoto?"Machine photo":"Machine document")+"</div><h2>"+(isPhoto?"Capture evidence.":"Attach a document.")+"</h2><p class='tiny'>Files are stored privately against this physical machine.</p></div><button class='close' data-action='close'>×</button></div><form id='evidence-form'><div class='field'><label>File</label><input class='input' id='evidence-file' type='file' "+(isPhoto?"accept='image/*' capture='environment'":"accept='.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx'")+" required></div><div class='field'><label>"+(isPhoto?"Caption":"Title")+"</label><input class='input' id='evidence-title' placeholder='"+(isPhoto?"e.g. Serial plate":"e.g. Service invoice")+"' required></div>"+(isPhoto?"<div class='field'><label>Photo type</label><select class='input' id='photo-type'><option value='machine'>Machine</option><option value='serial_plate'>Serial / model plate</option><option value='service_evidence'>Service evidence</option><option value='damage'>Damage / issue</option></select></div>":"<div class='field'><label>Document type</label><select class='input' id='document-type'><option value='service_record'>Service record</option><option value='invoice'>Invoice</option><option value='manual'>Manual</option><option value='other'>Other</option></select></div>")+"<button class='btn' style='width:100%'>Upload</button></form></div></div>");
  document.querySelector("#evidence-form").addEventListener("submit",e=>saveEvidence(e,kind))
}
async function saveEvidence(e,kind){
  e.preventDefault();
  const m=state.selected,file=document.querySelector("#evidence-file")?.files?.[0],title=val("#evidence-title");
  if(!file)return;
  if(state.demo){closeModal();toast("Demo mode: upload preview only");return}
  try{
    const org=state.org.id, ext=(file.name.split(".").pop()||"bin").toLowerCase();
    const path="org/"+org+"/machines/"+m.id+"/"+Date.now()+"-"+crypto.randomUUID()+"."+ext;
    const bucket="reelmow-garage-private";
    const up=await state.client.storage.from(bucket).upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
    if(up.error)throw up.error;
    if(kind==="photo"){
      const {error}=await state.client.schema("garage").from("machine_photos").insert({machine_id:m.id,storage_bucket:bucket,storage_path:path,caption:title,photo_type:val("#photo-type"),mime_type:file.type||null,file_size_bytes:file.size,captured_at:new Date().toISOString(),created_by:state.user.id});
      if(error)throw error;
    }else{
      const {error}=await state.client.schema("garage").from("machine_documents").insert({machine_id:m.id,title,document_type:val("#document-type"),storage_bucket:bucket,storage_path:path,mime_type:file.type||null,file_size_bytes:file.size,source:"upload",created_by:state.user.id});
      if(error)throw error;
    }
    closeModal();await loadEvidence(m);toast(isPhotoText(kind)+" added");
  }catch(x){toast(x.message||"Upload failed")}
}
function isPhotoText(kind){return kind==="photo"?"Photo":"Document"}
async function openServiceEvidence(id){
  const r=state.serviceRecords.find(x=>x.id===id);const e=r?.evidence;if(!e?.storage_path)return toast("No evidence attached");
  if(state.demo)return toast("Demo evidence preview");
  const {data,error}=await state.client.storage.from(e.storage_bucket||"reelmow-garage-private").createSignedUrl(e.storage_path,3600);
  if(error)return toast(error.message);window.open(data.signedUrl,"_blank","noopener,noreferrer")
}
async function openDocument(id){
  const d=state.machineDocuments?.find(x=>x.id===id);if(!d)return;
  if(state.demo)return toast("Demo document preview");
  const {data,error}=await state.client.storage.from(d.storage_bucket).createSignedUrl(d.storage_path,3600);
  if(error)return toast(error.message);
  window.open(data.signedUrl,"_blank","noopener,noreferrer")
}
function serviceDueHtml(){
  if(!state.serviceDue.length)return "<div class='empty-mini'><div class='tiny'>No published service schedule for this machine yet.</div><div class='tiny' style='margin-top:5px'>REELMOW will only show maintenance rules that have been sourced and validated.</div></div>";
  return "<div class='list'>"+state.serviceDue.map(x=>{
    const due=x.service_status==="due";
    const remaining=x.hours_remaining!=null?Math.round(Number(x.hours_remaining)*10)/10:null;
    const date=x.calendar_due_date;
    const detail=remaining!=null?(remaining<=0?"Due now":remaining+" engine hours remaining"):(date?("Due "+date):"Schedule published");
    return "<div class='list-row'><div><div class='list-title'>"+esc(x.task_name)+"</div><div class='list-meta'>"+esc(detail)+(x.source_page?" · Manual p."+esc(x.source_page):"")+"</div></div><span class='badge "+(due?"service":"ready")+"'>"+(due?"DUE":"UPCOMING")+"</span></div>"
  }).join("")+"</div>"
}
function serviceHistoryHtml(){
  if(!state.serviceRecords.length)return "<div class='empty-mini'><div class='tiny'>No service records yet.</div><button class='btn secondary small' style='margin-top:10px' data-action='service'>Record the first service</button></div>";
  return "<div class='list'>"+state.serviceRecords.map(x=>"<div class='list-row'><div><div class='list-title'>"+esc(x.task_name||"Service record")+"</div><div class='list-meta'>"+esc(new Date(x.serviced_at).toLocaleDateString())+" · "+(x.engine_hours!=null?esc(x.engine_hours)+" h":"hours not recorded")+(x.cost!=null?" · £"+Number(x.cost).toFixed(2):"")+"</div>"+(x.performed_by?"<div class='list-meta'>By "+esc(x.performed_by)+"</div>":"")+(x.notes?"<div class='list-meta' style='margin-top:4px'>"+esc(x.notes)+"</div>":"")+(x.evidence?.storage_path?"<button class='btn ghost small' style='margin-top:7px' data-action='open-service-evidence' data-id='"+esc(x.id)+"'>Open evidence</button>":"")+"</div></div>").join("")+"</div>"
}
async function loadServiceData(m){
  if(state.demo){
    state.serviceDue=[
      {task_name:"Engine oil change",service_status:"due",hours_remaining:-4.5,source_page:16},
      {task_name:"Lubricate F1 grease points",service_status:"upcoming",hours_remaining:15.5,source_page:28},
      {task_name:"Lubricate F2 grease points",service_status:"upcoming",hours_remaining:115.5,source_page:28},
      {task_name:"Lubricate F3 grease points",service_status:"upcoming",hours_remaining:215.5,source_page:28},
      {task_name:"Inspect fuel lines and clamps",service_status:"upcoming",hours_remaining:15.5,source_page:17}
    ];
    state.serviceRecords=[{task_name:"Engine oil change",serviced_at:"2026-08-14T10:00:00Z",engine_hours:1180,cost:94.5,notes:"Oil and filter replaced."}];
  }else{
    const [due,rec]=await Promise.all([
      state.client.schema("garage").from("machine_service_due").select("*").eq("machine_id",m.id).order("service_status").order("task_name"),
      state.client.schema("garage").from("machine_service_records").select("id,serviced_at,engine_hours,reel_hours,performed_by,cost,notes,service_task_id,evidence").eq("machine_id",m.id).order("serviced_at",{ascending:false}).limit(20)
    ]);
    if(due.error)return toast(due.error.message);
    if(rec.error)return toast(rec.error.message);
    const taskIds=[...(due.data||[]).map(x=>x.service_task_id),...(rec.data||[]).map(x=>x.service_task_id)].filter(Boolean);
    let tasks=[];
    if(taskIds.length){const t=await state.client.schema("catalogue").from("service_tasks").select("id,task_name").in("id",[...new Set(taskIds)]);if(t.error)return toast(t.error.message);tasks=t.data||[]}
    const tm=new Map(tasks.map(x=>[x.id,x.task_name]));
    state.serviceDue=due.data||[];
    state.serviceRecords=(rec.data||[]).map(x=>({...x,task_name:tm.get(x.service_task_id)||"Service record"}));
  }
  const dueBox=document.querySelector("#service-due");if(dueBox)dueBox.innerHTML=serviceDueHtml();
  const hist=document.querySelector("#service-history");if(hist)hist.innerHTML=serviceHistoryHtml();
}
function hoursModal(){
  const m=state.selected;
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Machine hours</div><h2>Update the meter.</h2><p class='tiny'>Hours readings drive the service schedule.</p></div><button class='close' data-action='close'>×</button></div><form id='hours-form'><div class='grid two'><div class='field'><label>Engine hours</label><input class='input' id='new-engine-hours' type='number' min='"+esc(m.current_engine_hours??0)+"' step='.1' value='"+esc(m.current_engine_hours??"")+"'></div><div class='field'><label>Reel hours</label><input class='input' id='new-reel-hours' type='number' min='"+esc(m.current_reel_hours??0)+"' step='.1' value='"+esc(m.current_reel_hours??"")+"'></div></div><div class='field'><label>Notes</label><textarea class='input' id='hours-notes' rows='3' placeholder='Optional reading note'></textarea></div><button class='btn' style='width:100%'>Save hours</button></form></div></div>");
  document.querySelector("#hours-form").addEventListener("submit",saveHours)
}
async function saveHours(e){
  e.preventDefault();const m=state.selected;
  const eh=num("#new-engine-hours"),rh=num("#new-reel-hours"),notes=val("#hours-notes");
  if(state.demo){m.current_engine_hours=eh;m.current_reel_hours=rh;closeModal();toast("Hours updated");return renderDetail()}
  if(!navigator.onLine){m.current_engine_hours=eh;m.current_reel_hours=rh;queueMutation("hours",{machineId:m.id,engineHours:eh,reelHours:rh,notes,source:"manual"});return renderDetail()}
  try{
    const {error}=await state.client.schema("garage").rpc("sync_record_machine_hours",{operation_id:crypto.randomUUID(),target_machine:m.id,new_engine_hours:eh,new_reel_hours:rh,reading_source:"manual",reading_notes:notes||null});
    if(error)throw error;
    closeModal();await loadMachines();state.selected=state.machines.find(x=>x.id===m.id)||m;toast("Hours updated");render();
  }catch(x){if(!navigator.onLine){m.current_engine_hours=eh;m.current_reel_hours=rh;queueMutation("hours",{machineId:m.id,engineHours:eh,reelHours:rh,notes,source:"manual"});return renderDetail()}toast(x.message||"Could not save hours")}
}
function serviceModal(){
  const m=state.selected;
  const options=state.serviceDue.map(x=>"<option value='"+esc(x.service_task_id)+"'>"+esc(x.task_name)+"</option>").join("");
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Record service</div><h2>Log maintenance.</h2><p class='tiny'>Keep the work attached to this physical machine.</p></div><button class='close' data-action='close'>×</button></div><form id='service-form'><div class='field'><label>Service task</label><select class='input' id='service-task'>"+options+"<option value=''>Other / unscheduled service</option></select></div><div class='grid two'><div class='field'><label>Date</label><input class='input' id='service-date' type='date' value='"+new Date().toISOString().slice(0,10)+"' required></div><div class='field'><label>Cost</label><input class='input' id='service-cost' type='number' min='0' step='.01' placeholder='0.00'></div></div><div class='grid two'><div class='field'><label>Engine hours</label><input class='input' id='service-engine' type='number' min='0' step='.1' value='"+esc(m.current_engine_hours??"")+"'></div><div class='field'><label>Reel hours</label><input class='input' id='service-reel' type='number' min='0' step='.1' value='"+esc(m.current_reel_hours??"")+"'></div></div><div class='field'><label>Performed by</label><input class='input' id='performed-by' placeholder='Person or company'></div><div class='field'><label>Work completed / notes</label><textarea class='input' id='service-notes' rows='4' placeholder='Oil, filters, reels, belts, inspection notes…'></textarea></div><div class='field'><label>Evidence</label><input class='input' id='service-evidence' type='file' accept='.pdf,.jpg,.jpeg,.png,.webp'><div class='tiny' style='margin-top:5px'>Attach an invoice, service sheet or photo. Evidence uploads require an internet connection.</div></div><button class='btn' style='width:100%'>Save service record</button></form></div></div>");
  document.querySelector("#service-form").addEventListener("submit",saveService)
}
async function saveService(e){
  e.preventDefault();const m=state.selected,file=document.querySelector("#service-evidence")?.files?.[0];
  const task=val("#service-task")||null,date=val("#service-date"),eh=num("#service-engine"),rh=num("#service-reel"),cost=num("#service-cost"),performed=val("#performed-by"),notes=val("#service-notes");
  if(eh!=null&&eh<0||rh!=null&&rh<0)return toast("Hours cannot be negative");
  if(file&&!navigator.onLine)return toast("Connect to the internet to attach service evidence, then save the record.");
  if(state.demo){
    state.serviceRecords.unshift({task_name:state.serviceDue.find(x=>x.service_task_id===task)?.task_name||"Other / unscheduled service",serviced_at:date,engine_hours:eh,reel_hours:rh,cost,notes,evidence:file?.name||null});
    m.current_engine_hours=Math.max(Number(m.current_engine_hours||0),Number(eh||0));m.current_reel_hours=Math.max(Number(m.current_reel_hours||0),Number(rh||0));
    closeModal();toast("Service recorded");return renderDetail()
  }
  if(!navigator.onLine){
    state.serviceRecords.unshift({task_name:state.serviceDue.find(x=>x.service_task_id===task)?.task_name||"Other / unscheduled service",serviced_at:date,engine_hours:eh,reel_hours:rh,cost,notes});
    m.current_engine_hours=Math.max(Number(m.current_engine_hours||0),Number(eh||0));m.current_reel_hours=Math.max(Number(m.current_reel_hours||0),Number(rh||0));
    queueMutation("service",{machineId:m.id,taskId:task,serviceDate:new Date(date+"T12:00:00").toISOString(),engineHours:eh,reelHours:rh,performedBy:performed,cost,notes,evidence:{}});closeModal();return renderDetail();
  }
  try{
    let evidence={};
    if(file){
      const org=state.org.id,ext=(file.name.split(".").pop()||"bin").toLowerCase(),path="org/"+org+"/machines/"+m.id+"/service-"+Date.now()+"-"+crypto.randomUUID()+"."+ext,bucket="reelmow-garage-private";
      const up=await state.client.storage.from(bucket).upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});if(up.error)throw up.error;
      evidence={storage_bucket:bucket,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size_bytes:file.size};
    }
    const {error}=await state.client.schema("garage").rpc("sync_record_machine_service",{operation_id:crypto.randomUUID(),target_machine:m.id,target_service_task:task,service_date:new Date(date+"T12:00:00").toISOString(),service_engine_hours:eh,service_reel_hours:rh,performed_by_name:performed||null,service_cost:cost,service_notes:notes||null,evidence_json:evidence});
    if(error)throw error;
    closeModal();await loadMachines();state.selected=state.machines.find(x=>x.id===m.id)||m;toast("Service recorded");render();
  }catch(x){toast(x.message||"Could not save service record")}
}
function addModal(){
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Add machine</div><h2>Find it in the catalogue.</h2><p class='tiny'>Search manufacturer, model or variant.</p></div><button class='close' data-action='close'>×</button></div><div class='search-wrap'><span class='search-icon'>⌕</span><input id='q' class='search' placeholder='Search manufacturer or model…'></div><div class='quick-searches'><button class='chip' data-search='LF3800'>Jacobsen LF3800</button><button class='chip' data-search='SC610'>Protea SC610</button><button class='chip' data-search='Shaver 24'>Allett Shaver 24</button><button class='chip' data-search='Royale 24'>ATCO Royale 24</button></div><div id='results' class='result-list'><p class='tiny'>Start typing, or choose a machine above.</p></div><div class='catalogue-help'><b>Can’t find your machine?</b><span>Scan the model plate and use the result to search the catalogue.</span><button class='btn secondary small' data-action='unknown-machine'>Scan plate</button></div></div></div>");
  const q=document.querySelector("#q");let t;q.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(()=>search(q.value),220)});
  document.querySelectorAll("[data-search]").forEach(b=>b.addEventListener("click",()=>{q.value=b.dataset.search;search(q.value)}));
  q.focus()
}
function unknownMachineModal(){
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Catalogue assistant</div><h2>Scan the model plate.</h2><p class='tiny'>REELMOW reads visible manufacturer, model and serial text. You remain in control before a machine is added.</p></div><button class='close' data-action='close'>×</button></div><div class='field'><label>Model / rating plate photo</label><input class='input' id='unknown-plate' type='file' accept='image/*' capture='environment'></div><div id='unknown-result' class='empty-mini'><div class='tiny'>Take a clear, close photo of the plate in good light.</div></div><div class='catalogue-help' style='margin-top:14px'><b>Nothing readable?</b><span>You can return to search and enter the manufacturer or model manually.</span><button class='btn secondary small' data-action='close'>Back to search</button></div></div></div>");
  document.querySelector("#unknown-plate").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    const box=document.querySelector("#unknown-result");box.innerHTML="<div class='loading' style='padding:22px 5px'><div class='spinner'></div>Reading the plate…</div>";
    if(state.demo){box.innerHTML="<div class='note'><b>Demo scan:</b> Try searching Protea SC610, Allett Shaver 24 or ATCO Royale 24 in the catalogue.</div>";return}
    try{
      const data=await imageDataUrl(file);
      const {data:result,error}=await state.client.functions.invoke("identify-machine",{body:{image_data_url:data}});
      if(error)throw error;if(result?.error)throw new Error(result.error);
      const query=[result.manufacturer,result.model,result.variant].filter(Boolean).join(" ").trim();
      const confidence=Math.round(Number(result.confidence||0)*100);
      box.innerHTML="<div class='note'><b>Plate read:</b> "+esc(query||"No model identified")+"<br>Confidence "+confidence+"%"+(result.serial_number?" · Serial "+esc(result.serial_number):"")+"</div>"+(query?"<button class='btn' style='width:100%;margin-top:10px' data-action='search-identified' data-query='"+esc(query)+"'>Search catalogue</button>":"");
    }catch(x){box.innerHTML="<div class='error'>"+esc(x.message||"Plate scan failed")+"</div>"}
  })
}

async function startMow(machineId){
  if(!navigator.geolocation)return toast("Location is not available on this device.");
  const m=state.machines.find(x=>x.id===machineId);if(!m)return;
  state.mow={active:true,paused:false,sessionId:null,machineId,watchId:null,startedAt:new Date().toISOString(),lastPoint:null,trackPoints:[],distanceM:0,points:0,accuracyM:null,speedMps:null,headingDeg:null,pattern:"stripe",targetSpeedKph:null};
  renderMowScreen();
  if(state.demo){state.mow.sessionId="demo-"+crypto.randomUUID();startMowGps();return}
  try{
    const {data,error}=await state.client.schema("garage").from("mowing_sessions").insert({machine_id:machineId,started_by:state.user.id,pattern_type:state.mow.pattern,target_speed_kph:state.mow.targetSpeedKph}).select("id").single();
    if(error)throw error;
    state.mow.sessionId=data.id;startMowGps();
  }catch(x){state.mow.active=false;toast(x.message||"Could not start Mow Mode");render()}
}
function startMowGps(){
  state.mow.watchId=navigator.geolocation.watchPosition(async pos=>{
    if(!state.mow.active||state.mow.paused)return;
    const p={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
    state.mow.accuracyM=pos.coords.accuracy??null;state.mow.speedMps=pos.coords.speed??null;state.mow.headingDeg=pos.coords.heading??null;
    if(state.mow.lastPoint)state.mow.distanceM+=haversineM(state.mow.lastPoint,p);
    state.mow.lastPoint=p;state.mow.trackPoints.push(p);state.mow.points++;
    if(!state.demo&&state.mow.sessionId){
      const {error}=await state.client.schema("garage").from("mowing_track_points").insert({session_id:state.mow.sessionId,latitude:p.latitude,longitude:p.longitude,accuracy_m:pos.coords.accuracy,speed_mps:pos.coords.speed,heading_deg:pos.coords.heading});
      if(error)toast("GPS point could not be saved.");
    }
    renderMowScreen();
  },err=>toast(err.message||"Unable to read GPS"),{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}
async function finishMow(){
  if(!state.mow.active)return;
  if(state.mow.watchId!=null)navigator.geolocation.clearWatch(state.mow.watchId);
  const m=state.mow;
  state.mow.active=false;
  if(!state.demo&&m.sessionId){
    const started=new Date(m.startedAt).getTime(),elapsedH=(Date.now()-started)/3600000;
    const avg=elapsedH>0?(m.distanceM/1000)/elapsedH:null;
    const {error}=await state.client.schema("garage").from("mowing_sessions").update({ended_at:new Date().toISOString(),status:"completed",distance_m:m.distanceM,average_speed_kph:avg}).eq("id",m.sessionId);
    if(error)toast(error.message||"Mow session saved with warnings");
  }
  state.mow={active:false,paused:false,sessionId:null,machineId:null,watchId:null,startedAt:null,lastPoint:null,trackPoints:[],distanceM:0,points:0,accuracyM:null,speedMps:null,headingDeg:null,pattern:"stripe",targetSpeedKph:null};
  toast("Mow session saved");setView("today");
}
function pauseMow(){
  if(!state.mow.active)return;
  state.mow.paused=!state.mow.paused;
  renderMowScreen();
}
function exitMow(){
  if(!state.mow.active)return setView("today");
  if(confirm("Exit Mow Mode? The active session will be cancelled.")){
    if(state.mow.watchId!=null)navigator.geolocation.clearWatch(state.mow.watchId);
    if(!state.demo&&state.mow.sessionId)state.client.schema("garage").from("mowing_sessions").update({ended_at:new Date().toISOString(),status:"cancelled"}).eq("id",state.mow.sessionId);
    state.mow.active=false;setView("today");
  }
}
function faultModal(){
  const m=state.selected;
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Machine issue</div><h2>Report a problem.</h2><p class='tiny'>Capture it now. The Garage can resolve it later.</p></div><button class='close' data-action='close'>×</button></div><form id='fault-form'><div class='field'><label>Severity</label><select class='input' id='fault-severity'><option value='low'>Low</option><option value='medium' selected>Medium</option><option value='high'>High</option><option value='critical'>Critical</option></select></div><div class='field'><label>What is wrong?</label><textarea class='input' id='fault-description' rows='5' maxlength='4000' required placeholder='Describe what you noticed…'></textarea></div><button class='btn' style='width:100%'>Report problem</button></form></div></div>");
  document.querySelector("#fault-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const description=val("#fault-description"), severity=val("#fault-severity");
    try{
      if(state.demo){closeModal();toast("Problem reported");return}
      if(!description){toast("Please describe the problem");return}
      if(!navigator.onLine){closeModal();queueMutation("fault",{machineId:m.id,severity,description});return}
      const {error}=await state.client.schema("garage").rpc("sync_report_machine_fault",{operation_id:crypto.randomUUID(),target_machine:m.id,target_severity:severity,target_description:description});
      if(error)throw error;
      closeModal();toast("Problem reported");render();
    }catch(x){toast(x.message||"Could not report problem")}
  });
}
function editModal(){
  const m=state.selected;
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Machine profile</div><h2>Edit machine.</h2><p class='tiny'>Keep the physical asset record complete.</p></div><button class='close' data-action='close'>×</button></div><form id='edit-machine'><div class='field'><label>Nickname</label><input class='input' id='edit-nickname' value='"+esc(m.nickname||"")+"' maxlength='80'></div><div class='grid two'><div class='field'><label>Serial number</label><input class='input' id='edit-serial' value='"+esc(m.serial_number||"")+"' maxlength='120'></div><div class='field'><label>Asset number</label><input class='input' id='edit-asset' value='"+esc(m.asset_number||"")+"' maxlength='80'></div></div><div class='grid two'><div class='field'><label>Purchase date</label><input class='input' id='edit-date' type='date' value='"+esc(m.purchase_date||"")+"'></div><div class='field'><label>Purchase price</label><input class='input' id='edit-price' type='number' min='0' step='.01' value='"+esc(m.purchase_price??"")+"'></div></div><div class='field'><label>Status</label><select class='input' id='edit-status'><option value='ready'>Ready</option><option value='service_due'>Service due</option><option value='in_service'>In service</option><option value='out_of_service'>Out of service</option><option value='retired'>Retired</option></select></div><div class='field'><label>Ownership</label><select class='input' id='edit-ownership'><option value=''>Not specified</option><option value='owned'>Owned</option><option value='leased'>Leased</option><option value='hired'>Hired</option><option value='loaned'>Loaned</option><option value='other'>Other</option></select></div><div class='field'><label>Owner / supplier</label><input class='input' id='edit-owner' value='"+esc(m.ownership_name||"")+"'></div><div class='grid two'><div class='field'><label>Warranty start</label><input class='input' id='edit-warranty-start' type='date' value='"+esc(m.warranty_start_date||"")+"'></div><div class='field'><label>Warranty end</label><input class='input' id='edit-warranty-end' type='date' value='"+esc(m.warranty_end_date||"")+"'></div></div><div class='field'><label>Warranty provider</label><input class='input' id='edit-warranty-provider' value='"+esc(m.warranty_provider||"")+"'></div><div class='field'><label>Notes</label><textarea class='input' id='edit-notes' rows='4' maxlength='2000'>"+esc(m.notes||"")+"</textarea></div><button class='btn' style='width:100%'>Save changes</button></form></div></div>");
  document.querySelector("#edit-status").value=m.status||"ready";document.querySelector("#edit-ownership").value=m.ownership_type||"";
  document.querySelector("#edit-machine").addEventListener("submit",async e=>{
    e.preventDefault();const serial=val("#edit-serial"),price=num("#edit-price");
    if(price!=null&&price<0)return toast("Purchase price cannot be negative");
    if(!state.demo&&serial){const {data,error}=await state.client.schema("garage").from("machines").select("id").eq("garage_id",state.garage.id).ilike("serial_number",serial).neq("id",m.id).limit(1);if(error)return toast(error.message);if(data?.length)return toast("A machine with this serial number is already in this Garage.")}
    const patch={serial_number:serial||null,nickname:val("#edit-nickname")||null,asset_number:val("#edit-asset")||null,purchase_date:val("#edit-date")||null,purchase_price:price,status:val("#edit-status"),ownership_type:val("#edit-ownership")||null,ownership_name:val("#edit-owner")||null,warranty_start_date:val("#edit-warranty-start")||null,warranty_end_date:val("#edit-warranty-end")||null,warranty_provider:val("#edit-warranty-provider")||null,notes:val("#edit-notes")||null,updated_at:new Date().toISOString()};
    try{if(state.demo)Object.assign(m,patch);else{const {error}=await state.client.schema("garage").from("machines").update(patch).eq("id",m.id);if(error)throw error;await loadMachines();state.selected=state.machines.find(x=>x.id===m.id)||m}closeModal();toast("Machine profile updated");render()}catch(x){toast(x.message||"Could not update machine")}
  });
}
function machineModal(r){
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Physical machine</div><h2>"+esc(r.manufacturer_name)+" "+esc(r.model_name)+"</h2><p class='tiny'>"+esc(r.variant_name||"Variant")+" · REELMOW catalogue</p></div><button class='close' data-action='close'>×</button></div><form id='machine-form'><div class='note' style='margin-bottom:14px'><b>Scan the machine plate</b><br>Take a clear photo and REELMOW will read the visible model and serial text. You still confirm the result before adding the machine.</div><div class='field'><label>Plate photo</label><input class='input' id='plate-photo' type='file' accept='image/*' capture='environment'></div><div id='plate-result'></div><div class='field'><label>Serial number</label><input class='input' id='serial'></div><div class='field'><label>Asset number</label><input class='input' id='asset'></div><div class='field'><label>Nickname</label><input class='input' id='nickname' placeholder='e.g. Main Outfield Mower'></div><div class='grid two'><div class='field'><label>Purchase date</label><input class='input' id='date' type='date'></div><div class='field'><label>Purchase price</label><input class='input' id='purchase-price' type='number' min='0' step='.01' placeholder='0.00'></div></div><div class='grid two'><div class='field'><label>Engine hours</label><input class='input' id='hours' type='number' min='0' step='.1'></div><div class='field'><label>Reel hours</label><input class='input' id='reel' type='number' min='0' step='.1'></div></div><div class='field'><label>Ownership</label><select class='input' id='ownership-type'><option value=''>Not specified</option><option value='owned'>Owned</option><option value='leased'>Leased</option><option value='hired'>Hired</option><option value='loaned'>Loaned</option><option value='other'>Other</option></select></div><div class='field'><label>Owner / supplier</label><input class='input' id='ownership-name'></div><div class='grid two'><div class='field'><label>Warranty start</label><input class='input' id='warranty-start' type='date'></div><div class='field'><label>Warranty end</label><input class='input' id='warranty-end' type='date'></div></div><div class='field'><label>Warranty provider</label><input class='input' id='warranty-provider' placeholder='Dealer / manufacturer'></div><div class='field'><label>Notes</label><textarea class='input' id='machine-notes' rows='3'></textarea></div><div class='note'>This physical asset will be linked to the verified catalogue variant.</div><button class='btn' style='width:100%;margin-top:14px'>Add to Garage</button></form></div></div>");
  document.querySelector("#machine-form").addEventListener("submit",e=>saveMachine(e,r));
  document.querySelector("#plate-photo").addEventListener("change",e=>identifyPlate(e.target.files?.[0]))
}
async function identifyPlate(file){
  if(!file)return;
  state.pendingPlateFile=file;
  const box=document.querySelector("#plate-result");if(box)box.innerHTML="<div class='note'>Reading plate…</div>";
  if(state.demo){if(box)box.innerHTML="<div class='note'>Demo mode: plate scan preview. In the live build this will use AI/OCR.</div>";return}
  try{
    const data=await imageDataUrl(file);
    const {data:result,error}=await state.client.functions.invoke("identify-machine",{body:{image_data_url:data}});
    if(error)throw error;
    if(result?.error)throw new Error(result.error);
    const set=(id,v)=>{if(v&&document.querySelector(id))document.querySelector(id).value=v};
    set("#serial",result.serial_number);
    const confidence=Math.round(Number(result.confidence||0)*100);
    if(box)box.innerHTML="<div class='note'><b>AI read:</b> "+esc([result.manufacturer,result.model,result.variant].filter(Boolean).join(" · ")||"No model identified")+"<br>Confidence "+confidence+"%"+(result.uncertainty?" · "+esc(result.uncertainty):"")+"</div>";
  }catch(x){if(box)box.innerHTML="<div class='error'>"+esc(x.message||"Plate scan failed")+"</div>"}
}
async function saveMachine(e,r){
  e.preventDefault();
  const serial=val("#serial"),asset=val("#asset"),nickname=val("#nickname"),purchaseDate=val("#date"),purchasePrice=num("#purchase-price"),warrantyStart=val("#warranty-start"),warrantyEnd=val("#warranty-end"),warrantyProvider=val("#warranty-provider"),ownershipType=val("#ownership-type")||null,ownershipName=val("#ownership-name"),notes=val("#machine-notes"),engineHours=num("#hours"),reelHours=num("#reel");
  if(engineHours!=null&&engineHours<0||reelHours!=null&&reelHours<0){toast("Hours cannot be negative");return}
  const p={garage_id:state.garage.id,machine_variant_id:r.variant_id,serial_number:serial||null,asset_number:asset||null,nickname:nickname||null,purchase_date:purchaseDate||null,purchase_price:purchasePrice,warranty_start_date:warrantyStart||null,warranty_end_date:warrantyEnd||null,warranty_provider:warrantyProvider||null,ownership_type:ownershipType,ownership_name:ownershipName||null,notes:notes||null,current_engine_hours:engineHours,current_reel_hours:reelHours,created_by:state.user?.id||null};
  if(state.demo){state.machines.unshift({...p,id:crypto.randomUUID(),status:"ready",variant:{variant_name:r.variant_name},model:{model_name:r.model_name},manufacturer:{name:r.manufacturer_name}});closeModal();toast("Machine added to Garage");return render()}
  try{
    if(serial){
      const {data:duplicate,error:de}=await state.client.schema("garage").from("machines").select("id").eq("garage_id",state.garage.id).ilike("serial_number",serial).limit(1);
      if(de)throw de;
      if(duplicate?.length){throw new Error("A machine with this serial number is already in this Garage.");}
    }
    const {data:created,error}=await state.client.schema("garage").from("machines").insert(p).select("id").single();
    if(error)throw error;
    if(state.pendingPlateFile){
      const file=state.pendingPlateFile,bucket="reelmow-garage-private",path="org/"+state.org.id+"/machines/"+created.id+"/"+Date.now()+"-"+crypto.randomUUID()+".jpg";
      const resized=await imageDataUrl(file,1800,.84);
      const blob=await (await fetch(resized)).blob();
      const up=await state.client.storage.from(bucket).upload(path,blob,{contentType:"image/jpeg",upsert:false});
      if(!up.error){
        const {error:pe}=await state.client.schema("garage").from("machine_photos").insert({
          machine_id:created.id,storage_bucket:bucket,storage_path:path,caption:"Machine model / serial plate",photo_type:"serial_plate",
          mime_type:file.type||"image/jpeg",file_size_bytes:file.size,captured_at:new Date().toISOString(),created_by:state.user?.id||null
        });
        if(pe)toast("Machine added, but plate evidence could not be saved.");
      }else toast("Machine added, but plate photo upload failed.");
    }
    state.pendingPlateFile=null;closeModal();await loadMachines();toast("Machine added to Garage");render()
  }catch(x){toast(x.message||"Could not add machine")}
}
async function createOrg(e){
  e.preventDefault();try{const {data,error}=await state.client.schema("garage").rpc("create_organization",{org_name:val("#org-name"),org_slug:slug(val("#org-name"))+"-"+Math.random().toString(36).slice(2,7)});if(error)throw error;const {error:g}=await state.client.schema("garage").from("garages").insert({organization_id:data,name:val("#garage-name"),location_name:val("#garage-location")});if(g)throw g;await loadWorkspace();render()}catch(x){state.error=x.message;render()}
}
async function createGarage(e){
  e.preventDefault();try{const {error}=await state.client.schema("garage").from("garages").insert({organization_id:state.org.id,name:val("#garage-name"),location_name:val("#garage-location")});if(error)throw error;await loadWorkspace();render()}catch(x){toast(x.message)}
}
async function signIn(e){
  e.preventDefault();try{const {error}=await state.client.auth.signInWithPassword({email:val("#email"),password:document.querySelector("#password").value});if(error)throw error;await boot()}catch(x){state.error=x.message;render()}
}
async function signUp(){
  try{const {data,error}=await state.client.auth.signUp({email:val("#email"),password:document.querySelector("#password").value});if(error)throw error;if(!data.session)toast("Account created. Check your email to confirm.");else await boot()}catch(x){state.error=x.message;render()}
}
function connectionModal(){
  const c=cfg()||{url:"",key:""};
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Supabase connection</div><h2>Connect REELMOW.</h2><p class='tiny'>Use the project URL and publishable public key. Never use a secret/service-role key in the browser.</p></div><button class='close' data-action='close'>×</button></div><form id='connect-form'><div class='field'><label>Project URL</label><input class='input' id='sb-url' value='"+esc(c.url)+"' placeholder='https://your-project.supabase.co' required></div><div class='field'><label>Publishable key</label><input class='input' id='sb-key' value='"+esc(c.key)+"' placeholder='eyJ...' required></div><div class='note'>The publishable key is stored locally by this prototype. RLS remains the database security boundary.</div><div class='actions' style='margin-top:15px'><button class='btn'>Connect</button><button class='btn secondary' type='button' data-action='demo'>Preview demo</button></div></form></div></div>");
  document.querySelector("#connect-form").addEventListener("submit",async e=>{e.preventDefault();localStorage.setItem(CONFIG_KEY,JSON.stringify({url:val("#sb-url").replace(/\/$/,""),key:val("#sb-key")}));state.demo=false;localStorage.removeItem(DEMO_KEY);closeModal();await boot()})
}
function loadDemo(){
  state.org={id:"demo-org",name:"Barton Town Cricket Club",slug:"barton-town-cricket-club"};
  state.garage={id:"demo-garage",name:"Main Garage",location_name:"Club Grounds"};
  if(!state.machines.length)state.machines=[{id:"demo-lf3800",garage_id:"demo-garage",machine_variant_id:demoCatalogue[0].variant_id,serial_number:"DEMO-LF3800",asset_number:"BTCC-001",nickname:"Main Outfield Mower",purchase_date:"2025-03-14",current_engine_hours:1284.5,current_reel_hours:642.2,status:"ready",variant:{variant_name:"LF3800 5-Gang"},model:{model_name:"LF3800"},manufacturer:{name:"Jacobsen"}}]
}
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-action]");if(!a)return;
  const x=a.dataset.action;
  if(["today","garage","catalogue","activity","profile"].includes(x))return setView(x);
  if(x==="quick-add")return setView("catalogue");
  if(x==="quick-hours")return machinePicker("hours");
  if(x==="quick-service")return machinePicker("service");
  if(x==="quick-fault")return machinePicker("fault");
  if(x==="mow"){return machinePicker("mow")}
  if(x==="mow-pause")return pauseMow();
  if(x==="mow-stop")return finishMow();
  if(x==="exit-mow")return exitMow();
  if(x==="quick-machine"){
    state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;
    const action=state.quickAction;state.quickAction=null;closeModal();
    if(action==="hours")return hoursModal();if(action==="service")return serviceModal();if(action==="fault")return faultModal();if(action==="mow")return startMow(state.selected.id);
    return;
  }
  if(x==="quick-machine"){
    state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;
    const action=state.quickAction;state.quickAction=null;closeModal();
    if(action==="hours")return hoursModal();if(action==="service")return serviceModal();return faultModal();
  }
  if(x==="resolve-fault")return resolveFaultModal(a.dataset.id);
  if(x==="connection")return connectionModal();
  if(x==="demo"){state.demo=true;localStorage.setItem(DEMO_KEY,"true");loadDemo();closeModal();return render()}
  if(x==="close")return closeModal();
  if(x==="add"){state.catalogueResults=[];return addModal()}
  if(x==="select"){const r=state.catalogueResults.find(v=>v.variant_id===a.dataset.id);if(r)machineModal(r);return}
  if(x==="open"){state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;state.specs=[];return render()}
  if(x==="back"||x==="home")return setView("garage");
  if(x==="edit")return editModal();
  if(x==="hours")return hoursModal();
  if(x==="document-upload")return evidenceUploadModal("document");
  if(x==="photo-upload")return evidenceUploadModal("photo");
  if(x==="open-document")return openDocument(e.target.closest("[data-id]")?.dataset.id);\n  if(x==="open-service-evidence")return openServiceEvidence(e.target.closest("[data-id]")?.dataset.id);
  if(x==="service")return serviceModal();
  if(x==="unknown-machine")return unknownMachineModal();
  if(x==="search-identified"){const query=a.dataset.query||"";closeModal();addModal();const q=document.querySelector("#q");if(q){q.value=query;search(query);q.focus()}return}
  if(x==="signup")return signUp();
});
boot();

window.addEventListener("online",()=>{state.offline=false;syncOutbox()});
window.addEventListener("offline",()=>{state.offline=true;render()});
setInterval(()=>{if(navigator.onLine)syncOutbox()},15000);
