
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
const state={client:null,user:null,role:null,org:null,garage:null,orgs:[],garages:[],workspaceNeedsSelection:false,offline:false,syncing:false,outboxCount:0,machines:[],selected:null,specs:[],serviceDue:[],serviceRecords:[],hoursLog:[],catalogueResults:[],webResults:[],webCitations:[],webSport:"golf",webResearchCaveat:"",dashboardDue:[],openFaults:[],machineFaults:[],activity:[],mow:{active:false,paused:false,sessionId:null,machineId:null,watchId:null,startedAt:null,lastPoint:null,trackPoints:[],distanceM:0,points:0,accuracyM:null,speedMps:null,headingDeg:null,pattern:"stripe",targetSpeedKph:null},loading:false,webResearching:false,error:"",pendingPlateFile:null,pendingIdentification:null,quickAction:null,view:localStorage.getItem("reelmow.view.v1")||"garage",demo:localStorage.getItem(DEMO_KEY)==="true" && !(window.REELMOW_CONFIG?.url && window.REELMOW_CONFIG?.key)};

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
function closeModal(){document.querySelector(".modal-backdrop")?.remove();state.pendingPlateFile=null;state.pendingIdentification=null}
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
  if(!m?.length){state.org=null;state.garage=null;state.orgs=[];state.garages=[];state.workspaceNeedsSelection=false;state.machines=[];return}
  const ids=m.map(x=>x.organization_id);
  const {data:o,error:oe}=await state.client.schema("garage").from("organizations").select("id,name,slug,created_at").in("id",ids).order("created_at",{ascending:true});if(oe)throw oe;
  state.orgs=o||[];
  const {data:g,error:ge}=await state.client.schema("garage").from("garages").select("id,organization_id,name,location_name,created_at").in("organization_id",ids).order("created_at");if(ge)throw ge;
  state.garages=g||[];
  const savedOrg=localStorage.getItem("reelmow.workspace.org.v1");
  const savedGarage=localStorage.getItem("reelmow.workspace.garage.v1");
  const selectedOrg=state.orgs.find(x=>x.id===savedOrg)||state.orgs[0]||null;
  const orgGarages=state.garages.filter(x=>x.organization_id===selectedOrg?.id);
  const selectedGarage=orgGarages.find(x=>x.id===savedGarage)||orgGarages[0]||null;
  const hasMultipleWorkspaces=state.orgs.length>1||state.garages.length>1;
  const savedWorkspaceValid=!!savedOrg&&!!savedGarage&&!!selectedOrg&&!!selectedGarage;
  state.org=savedWorkspaceValid?selectedOrg:(hasMultipleWorkspaces?null:selectedOrg);
  state.role=m.find(x=>x.organization_id===state.org?.id)?.role||null;
  state.garage=savedWorkspaceValid?selectedGarage:(hasMultipleWorkspaces?null:selectedGarage);
  state.workspaceNeedsSelection=hasMultipleWorkspaces&&!savedWorkspaceValid;
  if(state.org&&state.garage){
    localStorage.setItem("reelmow.workspace.org.v1",state.org.id);
    localStorage.setItem("reelmow.workspace.garage.v1",state.garage.id);
    await loadMachines();
  }else{
    state.machines=[];
  }
}
async function selectWorkspace(orgId,garageId){
  const org=state.orgs.find(x=>x.id===orgId);
  const garage=state.garages.find(x=>x.id===garageId&&x.organization_id===orgId);
  if(!org||!garage)return toast("That workspace is no longer available to you.");
  state.org=org;
  state.role=state.user?((await state.client.schema("garage").from("memberships").select("role").eq("user_id",state.user.id).eq("organization_id",orgId).maybeSingle()).data?.role||null):null;
  state.garage=garage;
  state.workspaceNeedsSelection=false;
  localStorage.setItem("reelmow.workspace.org.v1",org.id);
  localStorage.setItem("reelmow.workspace.garage.v1",garage.id);
  state.selected=null;
  await loadMachines();
  render();
}
function workspacePickerModal(){
  const rows=state.orgs.map(o=>{
    const gs=state.garages.filter(g=>g.organization_id===o.id);
    return "<div class='card' style='margin-top:10px'><div class='eyebrow'>Organisation</div><h3>"+esc(o.name)+"</h3><div class='picker-list'>"+(gs.length?gs.map(g=>"<button class='picker-row' data-action='select-workspace' data-org-id='"+esc(o.id)+"' data-garage-id='"+esc(g.id)+"'><span><strong>"+esc(g.name)+"</strong><small>"+esc(g.location_name||"Garage")+"</small></span><span>›</span></button>").join(""):"<div class='tiny'>No Garage configured for this organisation.</div>")+"</div></div>"
  }).join("");
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Workspace</div><h2>Choose a Garage.</h2><p class='tiny'>REELMOW keeps each organisation and physical Garage separate.</p></div><button class='close' data-action='close'>×</button></div>"+rows+"</div></div>");
}
function renderWorkspacePicker(){
  const rows=state.orgs.map(o=>{
    const gs=state.garages.filter(g=>g.organization_id===o.id);
    return "<div class='card' style='margin-top:10px'><div class='eyebrow'>"+esc(o.name)+"</div><div class='picker-list'>"+(gs.length?gs.map(g=>"<button class='picker-row' data-action='select-workspace' data-org-id='"+esc(o.id)+"' data-garage-id='"+esc(g.id)+"'><span><strong>"+esc(g.name)+"</strong><small>"+esc(g.location_name||"Garage")+"</small></span><span>›</span></button>").join(""):"<div class='tiny'>No Garage configured for this organisation.</div>")+"</div></div>"
  }).join("");
  mount("<div style='max-width:760px;margin:7vh auto'><div class='card'><div class='eyebrow'>Workspace selection</div><h1 style='font-size:40px'>Choose where you're working.</h1><p class='lede'>Select the organisation and physical Garage you want to operate.</p>"+rows+"</div></div>");
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
      :"<div class='empty-mini'><div class='tiny'><b>Nothing found in the catalogue.</b></div><div class='tiny' style='margin-top:5px'>Explore UK web research, or scan the model plate below to check the exact machine.</div></div>";
  }catch(e){box.innerHTML="<div class='error'>"+esc(e.message||"Search failed")+"</div>"}finally{state.loading=false}
}
const researchExamples={
  golf:{caveat:"A reported brand footprint is a signal, not an independent market-share ranking.",sources:[{title:"Golf Monthly · UK golf-course robot mowers",url:"https://www.golfmonthly.com/features/golf-monthly/how-robot-mowers-are-transforming-golf-courses"},{title:"Golf Monthly · AIG Women’s Open",url:"https://www.golfmonthly.com/news/robot-mowers-aig-womens-open-first-time-major"}],machines:[{manufacturer:"Husqvarna",model:"CEORA / Automower",equipment_type:"Robotic course mower",sports:["Golf"],usage_evidence:"club_use_example",evidence:"Golf Monthly reports about 150 UK and Irish golf clubs using Husqvarna robotic mowers. Fifteen CEORA and Automower units were used at the 2025 AIG Women’s Open.",source_urls:["https://www.golfmonthly.com/features/golf-monthly/how-robot-mowers-are-transforming-golf-courses","https://www.golfmonthly.com/news/robot-mowers-aig-womens-open-first-time-major"]}]},
  cricket:{caveat:"These are equipment needs and guidance, not a model-by-model sales or installed-base ranking.",sources:[{title:"GMA / ECB · Pitch mower guidance",url:"https://toolkit.thegma.org.uk/cricket/monthly-maintenance/cricket-in-season/preparing-pitches-for-play/phase-1-initial-phase/define-your-pitch-and-provide-the-initial-cut/"},{title:"GMA · Rolling cricket pitches",url:"https://toolkit.thegma.org.uk/detail/rolling-cricket-pitches/"}],machines:[{manufacturer:"Equipment category",model:"Cricket pitch mower",equipment_type:"Fine-turf cylinder mower",sports:["Cricket"],usage_evidence:"category_guidance",evidence:"GMA and ECB guidance describes close-cut pitch preparation and recommends a mower no wider than 22 inches, ideally with eight or more blades.",source_urls:["https://toolkit.thegma.org.uk/cricket/monthly-maintenance/cricket-in-season/preparing-pitches-for-play/phase-1-initial-phase/define-your-pitch-and-provide-the-initial-cut/"]},{manufacturer:"Equipment category",model:"Motorised tandem roller",equipment_type:"Cricket pitch roller",sports:["Cricket"],usage_evidence:"category_guidance",evidence:"GMA calls the roller an iconic cricket-grounds machine and describes a commonly considered modern specification: twin drum, 3–4 ft wide and 1.5–3 tonnes.",source_urls:["https://toolkit.thegma.org.uk/detail/rolling-cricket-pitches/"]}]},
  football:{caveat:"GMA identifies suitable equipment types; this does not establish which brands or models are most common.",sources:[{title:"GMA · Basic grounds equipment",url:"https://toolkit.thegma.org.uk/detail/what-basic-equipment-is-required/"},{title:"GMA · Football tasks and equipment",url:"https://toolkit.thegma.org.uk/football/football-tasks-equipment/"},{title:"GMA · Line marking equipment",url:"https://toolkit.thegma.org.uk/detail/line-marking-equipment/"}],machines:[{manufacturer:"Equipment category",model:"Ride-on or tractor-mounted mower",equipment_type:"Pitch mower",sports:["Football"],usage_evidence:"category_guidance",evidence:"GMA guidance lists ride-on, trailed, towed or tractor-mounted mowers among desirable additions for football and rugby clubs.",source_urls:["https://toolkit.thegma.org.uk/detail/what-basic-equipment-is-required/","https://toolkit.thegma.org.uk/football/football-tasks-equipment/"]},{manufacturer:"Equipment category",model:"Line marker",equipment_type:"Pitch marking equipment",sports:["Football"],usage_evidence:"category_guidance",evidence:"GMA includes marking machines in basic grounds equipment guidance and publishes dedicated safe-use guidance for line markers.",source_urls:["https://toolkit.thegma.org.uk/detail/what-basic-equipment-is-required/","https://toolkit.thegma.org.uk/detail/line-marking-equipment/"]}]}
};
function webResultCard(r){
  const signal={explicit_prevalence:"Usage evidence",club_use_example:"Club use reported",supplier_claim:"Supplier claim",category_guidance:"Grounds guidance"}[r.usage_evidence]||"Web source";
  const refs=(r.source_urls||[]).map(u=>state.webCitations.find(c=>c.url===u)).filter(Boolean);
  return "<article class='web-result'><div class='web-result-top'><span class='web-result-signal'>"+esc(signal)+"</span><span class='web-result-sport'>"+esc((r.sports||[]).join(" · ")||"UK grounds")+"</span></div><div class='web-result-title'>"+esc(r.manufacturer)+" <strong>"+esc(r.model)+"</strong></div><div class='web-result-type'>"+esc(r.equipment_type)+"</div><p>"+esc(r.evidence)+"</p><div class='web-result-sources'>"+(refs.length?refs.map(c=>"<a href='"+esc(c.url)+"' target='_blank' rel='noopener noreferrer'>"+esc(c.title||new URL(c.url).hostname)+" ↗</a>").join(""):"<span>Open source details unavailable</span>")+"</div><button class='web-result-action' data-action='search-web-result' data-query='"+esc([r.manufacturer,r.model].filter(v=>v!=="Equipment category").join(" "))+"'>Check catalogue <span>↗</span></button></article>";
}
async function searchGroundsWeb(q){
  const box=document.querySelector("#web-results");if(!box)return;
  const query=(q||document.querySelector("#q")?.value||state.webSport).trim();if(query.length<2){box.innerHTML="<p class='tiny'>Enter a machine, task or sport to search public UK grounds sources.</p>";return}
  state.webResearching=true;box.innerHTML="<div class='loading'><div class='spinner'></div>Searching UK grounds sources…</div>";
  try{
    let result;
    if(state.demo){result=researchExamples[state.webSport]||researchExamples.golf;state.webResults=result.machines;state.webCitations=result.sources;state.webResearchCaveat=result.caveat}
    else{const {data,error}=await state.client.functions.invoke("discover-grounds-machines",{body:{query,sport:state.webSport}});if(error)throw error;state.webResults=data?.machines||[];state.webCitations=data?.sources||[];state.webResearchCaveat=data?.caveat||""}
    box.innerHTML=(state.webResults.length?state.webResults.map(webResultCard).join(""):"<div class='empty-mini'><b>No sourced equipment leads found.</b><div class='tiny' style='margin-top:5px'>Try a machine, brand or grounds task.</div></div>")+(state.webResearchCaveat?"<div class='web-research-note'>"+esc(state.webResearchCaveat)+(state.demo?" <span>DEMO RESEARCH</span>":"")+"</div>":"");
  }catch(e){box.innerHTML="<div class='error'>"+esc(e.message||"Web search is unavailable")+"</div><div class='tiny' style='margin-top:8px'>You can still scan a plate or search the verified catalogue.</div>"}
  finally{state.webResearching=false}
}
function shell(c){
  const connectionLabel=state.demo?"Demo mode":state.offline?(state.outboxCount?"Offline · "+state.outboxCount+" saved":"Offline"):connected()?"Connected":"Connect";
  const connectionClass=state.demo?"demo":state.offline?"offline":connected()?"ok":"";
  const active=state.view||"today";
  const nav=(key,label)=>"<button class='nav-link "+(active===key?"active":"")+"' data-action='"+key+"'>"+label+"</button>";
  return "<div class='shell'><header class='topbar'><div class='brand'><span class='mark'></span>REEL<span>MOW</span></div><nav class='top-nav'>"+nav("garage","Garage")+nav("today","Today")+nav("catalogue","Catalogue")+"</nav><div class='top-actions'><button class='btn ghost small' data-action='connection'><span class='dot "+connectionClass+"'></span>"+connectionLabel+"</button>"+(state.user?"<div class='avatar'>"+esc(initials(state.user.email))+"</div>":"")+"</div></header><main class='page'>"+c+"</main><nav class='mobile-nav'>"+nav("garage","Garage")+nav("today","Today")+nav("activity","Activity")+nav("profile","Profile")+"</nav><div class='footer'>REELMOW · Field operations, under control.</div></div>"
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
  if(!state.demo&&state.workspaceNeedsSelection)return renderWorkspacePicker();
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
function machineIcon(){
  return "<svg class='machine-svg' viewBox='0 0 64 48' aria-hidden='true'><rect x='18' y='14' width='30' height='17' rx='4' fill='none' stroke='currentColor' stroke-width='2.6'/><path d='M48 19h7l4 7v5H48M18 23H9l-4 7h13M15 38h7M43 38h7' fill='none' stroke='currentColor' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/><circle cx='17' cy='38' r='5' fill='none' stroke='currentColor' stroke-width='2.6'/><circle cx='46' cy='38' r='5' fill='none' stroke='currentColor' stroke-width='2.6'/></svg>";
}
function actionIcon(type){
  const icons={
    mow:"<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M5 17h14M7 17V9h7l3 3v5M9 9V6h5M8 20h2M15 20h2' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>",
    hours:"<svg viewBox='0 0 24 24' aria-hidden='true'><circle cx='12' cy='12' r='8' fill='none' stroke='currentColor' stroke-width='1.8'/><path d='M12 8v4l3 2' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/></svg>",
    service:"<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M14.5 6.5a4 4 0 0 0-5 5L5 16l3 3 4.5-4.5a4 4 0 0 0 5-5l-2.3 2.3-2.5-2.5 2.3-2.3Z' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linejoin='round'/></svg>",
    fault:"<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 4 21 19H3L12 4Z' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linejoin='round'/><path d='M12 9v4M12 16v.5' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/></svg>"
  };
  return icons[type]||icons.mow;
}
function card(m){
  const n=m.model?.model_name||"Machine",v=m.variant?.variant_name||"Catalogue variant";
  const status=statusLabel(m.status);
  return "<article class='card machine-card' data-action='open' data-id='"+esc(m.id)+"' tabindex='0' role='button' aria-label='Open "+esc(m.nickname||n)+"'><div class='machine-visual'><div class='glyph'>"+machineIcon()+"</div></div><div class='machine-name'>"+esc(m.nickname||n)+"</div><div class='machine-sub'>"+esc(m.manufacturer?.name||"Manufacturer")+" · "+esc(v)+"</div><div class='machine-meta'><span class='badge "+statusClass(m.status)+"'>"+esc(status)+"</span><span class='tiny'>"+(m.current_engine_hours!=null?esc(m.current_engine_hours)+" h":"No hours")+"</span></div></article>"
}
function renderToday(){
  const due=(state.dashboardDue||[]).filter(x=>x.service_status==="due");
  const unknown=(state.dashboardDue||[]).filter(x=>x.service_status==="history_unknown");
  const faults=(state.openFaults||[]).filter(x=>x.status!=="resolved");
  const outOfServiceMachines=state.machines.filter(m=>m.status==="out_of_service");
  const outOfService=outOfServiceMachines.length;
  const totalHours=state.machines.reduce((sum,m)=>sum+(Number(m.current_engine_hours)||0),0);
  const operationalAttention=due.length+faults.length+outOfService;
  const heading=operationalAttention?"A few things need attention.":"Ready to work.";
  const availability=state.machines.length-outOfService;
  const hours=totalHours?Math.round(totalHours):null;

  const actionable=[
    ...outOfServiceMachines.slice(0,3).map(m=>({kind:"availability",machineId:m.id,title:"Machine unavailable",detail:"Out of service"})),
    ...faults.slice(0,3).map(x=>({kind:"fault",machineId:x.machine_id,title:"Problem reported",detail:x.description||"Machine issue"})),
    ...due.slice(0,3).map(x=>({kind:"service",machineId:x.machine_id,title:x.task_name||"Service task",detail:x.hours_remaining!=null?Math.round(Number(x.hours_remaining)*10)/10+" h remaining":"Service due"})),
    ...unknown.slice(0,2).map(x=>({kind:"history",machineId:x.machine_id,title:x.task_name||"Service history",detail:"History not recorded"}))
  ].slice(0,4);

  const attention=actionable.length
    ? "<section class='today-block today-attention-section'><div class='today-section-head'><div><div class='eyebrow'>Needs attention</div><h2>Deal with these first</h2></div><span class='count-pill'>"+actionable.length+"</span></div><div class='today-attention-list'>"+actionable.map(x=>{
        const m=state.machines.find(v=>v.id===x.machineId);
        const badge=x.kind==="fault"?"FAULT":x.kind==="service"?"DUE":x.kind==="availability"?"OFFLINE":"HISTORY";
        const badgeClass=x.kind==="fault"?"fault":x.kind==="service"?"service":x.kind==="availability"?"fault":"history";
        return "<button class='today-attention-row' data-action='open' data-id='"+esc(x.machineId)+"'><span class='attention-main'><strong>"+esc(m?.nickname||m?.model?.model_name||"Machine")+"</strong><small>"+esc(x.title)+" · "+esc(x.detail)+"</small></span><span class='badge "+badgeClass+"'>"+badge+"</span><span class='row-arrow'>›</span></button>";
      }).join("")+"</div></section>"
    : "";

  const fleetRows=state.machines.length
    ? state.machines.slice(0,3).map(m=>{
        const status=statusLabel(m.status);
        const statusAttention=m.status==="out_of_service";
        return "<button class='today-machine-row' data-action='open' data-id='"+esc(m.id)+"'><span class='machine-row-icon'>"+machineIcon()+"</span><span class='machine-row-copy'><strong>"+esc(m.nickname||m.model?.model_name||"Machine")+"</strong><small>"+esc(m.manufacturer?.name||"")+" · "+esc(m.variant?.variant_name||"")+"</small></span><span class='machine-row-status'><i class='mini-status "+(statusAttention?"attention":"")+"'></i>"+esc(status)+"</span><span class='row-arrow'>›</span></button>";
      }).join("")
    : "<div class='today-empty-row'><strong>Add your first machine</strong><small>Build your Garage from the catalogue.</small><button class='text-button' data-action='add'>Add machine</button></div>";

  mount(
    "<section class='today-compact'>"+
      "<header class='today-heading'>"+
        "<div><div class='eyebrow'>Today · "+esc(state.garage?.name||"Garage")+"</div><h1>"+heading+"</h1><p class='today-summary'>"+availability+" machine"+(availability===1?"":"s")+" available"+(hours?" · "+hours.toLocaleString()+" recorded hours":"")+"</p></div>"+
      "</header>"+
      "<button class='start-mow-bar' data-action='mow' aria-label='Start mowing'><span class='start-mow-icon'>"+actionIcon("mow")+"</span><span><strong>Start mowing</strong><small>Choose a machine and begin tracking</small></span><span class='row-arrow'>›</span></button>"+
      "<section class='today-block today-actions-section'><div class='today-section-head'><div class='eyebrow'>Quick actions</div></div><div class='today-action-list'>"+
        "<button class='today-action-row' data-action='quick-hours'><span class='today-action-icon'>"+actionIcon("hours")+"</span><span><strong>Log hours</strong><small>Update a machine meter</small></span><span class='row-arrow'>›</span></button>"+
        "<button class='today-action-row' data-action='quick-service'><span class='today-action-icon'>"+actionIcon("service")+"</span><span><strong>Record service</strong><small>Log completed maintenance</small></span><span class='row-arrow'>›</span></button>"+
        "<button class='today-action-row' data-action='quick-fault'><span class='today-action-icon'>"+actionIcon("fault")+"</span><span><strong>Report a problem</strong><small>Capture a machine issue</small></span><span class='row-arrow'>›</span></button>"+
      "</div></section>"+
      attention+
      "<section class='today-block today-fleet-section'><div class='today-section-head'><div><div class='eyebrow'>Fleet</div><h2>Your machines</h2></div><button class='text-button' data-action='garage'>View all</button></div><div class='today-fleet-list'>"+fleetRows+"</div></section>"+
    "</section>"
  );
}
function quickActions(){ return ""; }
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
  mount("<section class='page-intro'><div class='eyebrow'>Profile</div><h1>Your workspace.</h1><p class='lede'>Organisation, account and operating preferences.</p></section><div class='grid two' style='margin-top:20px'><div class='card'><div class='eyebrow'>Current workspace</div><h2>"+esc(state.org?.name||"REELMOW Demo")+"</h2><p class='tiny'>"+esc(state.garage?.name||"Main Garage")+" · "+esc(state.garage?.location_name||"Field workspace")+"</p><button class='btn secondary small' style='margin-top:12px' data-action='switch-workspace'>Switch workspace</button></div><div class='card'><div class='eyebrow'>Account</div><h2>"+esc(state.user?.email||"Demo user")+"</h2><p class='tiny'>Your REELMOW field workspace.</p></div></div>");
}
function renderCataloguePage(){
  mount("<section class='page-intro'><div class='eyebrow'>Catalogue</div><h1>Find a machine.</h1><p class='lede'>Start with verified manufacturer, model and variant data.</p></section><div class='card' style='margin-top:20px'><button class='btn' data-action='add'>Search catalogue</button><button class='btn secondary' style='margin-left:8px' data-action='unknown-machine'>Scan model plate</button></div>");
}
function renderGarage(){
  const list=state.machines;
  const due=state.dashboardDue||[];
  const attention=due.filter(x=>x.service_status==="due").length;
  const historyUnknown=due.filter(x=>x.service_status==="history_unknown").length;
  const outOfService=list.filter(m=>m.status==="out_of_service").length;
  const active=list.length-outOfService;
  const totalHours=list.reduce((sum,m)=>sum+(Number(m.current_engine_hours)||0),0);
  const lead=list[0];
  const leadDue=due.some(x=>x.machine_id===lead?.id&&x.service_status==="due");
  const leadHistoryUnknown=due.some(x=>x.machine_id===lead?.id&&x.service_status==="history_unknown");
  const leadReadiness=lead?.status==="out_of_service"?"OUT OF SERVICE":lead?.status==="retired"?"RETIRED":lead?.status==="service_due"||leadDue?"SERVICE DUE":leadHistoryUnknown?"CHECK SERVICE HISTORY":lead?.status==="in_service"?"IN SERVICE":"READY FOR THE FIELD";
  const leadCanMow=["ready","in_service"].includes(lead?.status);
  const leadMowAction=leadCanMow?"<button class='garage-action-primary' data-action='garage-mow' data-id='"+esc(lead.id)+"'><span class='mow-icon'>↗</span><span>Start mowing</span></button>":"<button class='garage-action-primary' disabled aria-label='Mowing unavailable while machine is "+esc(leadReadiness.toLowerCase())+"'><span class='mow-icon'>↗</span><span>Unavailable</span></button>";
  const leadHours=lead?.current_engine_hours!=null?Number(lead.current_engine_hours):null;
  const leadModel=lead?.model?.model_name||lead?.variant?.variant_name||"Machine";
  const leadName=lead?.nickname||leadModel;
  const leadIdentity=[lead?.manufacturer?.name,lead?.variant?.variant_name||leadModel].filter(Boolean).join(" · ");
  const isJacobsenLF3800=/jacobsen/i.test(lead?.manufacturer?.name||"")&&/lf\s*3800/i.test(leadModel+" "+(lead?.variant?.variant_name||""));

  if(!list.length){
    mount("<section class='garage-empty-page'><div class='garage-kicker'>"+esc(state.demo?"Demo Garage":state.garage?.name||"Garage")+"</div><h1>The Garage.</h1><p>Every machine, ready for the work ahead.</p><button class='garage-primary-action' data-action='add'>Add your first machine <span>→</span></button></section>");
    return;
  }

  const attentionCopy=[
    outOfService?outOfService+" unavailable":"",
    attention?attention+" service due":"",
    historyUnknown?historyUnknown+" history unknown":""
  ].filter(Boolean).join(" · ")||"All machines ready";
  const shortAttentionCopy=[
    outOfService?outOfService+" off":"",
    attention?attention+" due":"",
    historyUnknown?historyUnknown+" check":""
  ].filter(Boolean).join(" · ")||"Ready";

  mount(
    "<section class='garage-page'>"+
      "<header class='garage-header'>"+
        "<div><div class='garage-kicker'>"+esc(state.demo?"DEMO · "+(state.garage?.name||"MAIN GARAGE"):state.garage?.name||"MAIN GARAGE")+"</div><h1>The Garage<span>.</span></h1></div>"+
        "<div class='garage-header-meta'><span class='garage-status-label "+((outOfService||attention||historyUnknown)?"warning":"")+"' aria-label='"+esc(attentionCopy)+"'><span class='garage-live-dot'></span><span class='garage-status-full'>"+esc(attentionCopy)+"</span><span class='garage-status-short'>"+esc(shortAttentionCopy)+"</span></span><button class='garage-add-link' data-action='add' aria-label='Add machine'><span class='garage-add-icon'>＋</span><span>Add machine</span></button></div>"+
      "</header>"+
      "<section class='garage-hero' aria-label='Featured machine: "+esc(leadName)+"'>"+
        "<div class='garage-hero-photo"+(isJacobsenLF3800?" concept-photo":"")+"' data-garage-photo='"+esc(lead.id)+"'>"+(isJacobsenLF3800?"<img src='./assets/garage-hero-concept.jpg' alt='Illustrative five-gang reel mower in a modern machinery garage' fetchpriority='high'>":"<div class='garage-photo-placeholder'>"+machineIcon()+"</div>")+"</div>"+
        "<div class='garage-hero-shade'></div>"+
        "<div class='garage-hero-content'>"+
          "<div class='garage-hero-top'><div class='garage-hero-index'><span class='garage-index-mark'>01</span><span class='garage-eyebrow'>"+esc(leadIdentity)+"</span></div><span class='garage-status-chip "+(leadReadiness.startsWith("READY")?"":lead.status==="in_service"?"working":"attention")+"'><i></i>"+esc(leadReadiness)+"</span></div>"+
          "<div class='garage-hero-bottom'>"+
            "<div class='garage-machine-title'><div class='garage-title-overline'>YOUR MACHINE <span>•</span> "+esc(leadReadiness)+"</div><h2>"+esc(leadName)+"</h2><p>"+esc(leadModel)+"</p></div>"+
            "<div class='garage-hero-actions'><div class='garage-hours'><strong>"+(leadHours!=null?leadHours.toLocaleString():"—")+"</strong><span>ENGINE HOURS</span></div>"+leadMowAction+"<button class='garage-action-secondary' data-action='open' data-id='"+esc(lead.id)+"'>Machine details <span>↗</span></button></div>"+
          "</div>"+
        "</div>"+
        "<div class='garage-photo-note'>GARAGE SERIES <span>01 / VISUAL CONCEPT</span></div>"+
      "</section>"+
      "<section class='garage-summary'>"+
        "<div><span>In your Garage</span><strong>"+String(list.length).padStart(2,"0")+"</strong><small>machines</small></div>"+
        "<div><span>Ready to work</span><strong>"+String(active).padStart(2,"0")+"</strong><small>available now</small></div>"+
        "<div><span>Total engine time</span><strong>"+(totalHours?Math.round(totalHours).toLocaleString():"—")+"</strong><small>hours recorded</small></div>"+
        "<div class='"+((historyUnknown||attention)?"has-warning":"")+"'><span>Service status</span><strong>"+(attention?String(attention).padStart(2,"0"):historyUnknown?"Check":"Clear")+"</strong><small>"+(historyUnknown?historyUnknown+" history unknown":attention?"items due":"all machines up to date")+"</small></div>"+
      "</section>"+
      (list.length>1?"<section class='garage-collection'><div class='garage-section-heading'><div><span class='garage-kicker'>Equipment</span><h2>The Garage</h2></div><span>"+list.length+" assets</span></div><div class='garage-machine-grid'>"+list.slice(1).map(m=>{
        const hrs=m.current_engine_hours!=null?Number(m.current_engine_hours).toLocaleString()+" h":"Hours not recorded";
        return "<article class='garage-machine-tile' data-action='open' data-id='"+esc(m.id)+"'><div class='garage-tile-photo' data-garage-photo='"+esc(m.id)+"'><div class='garage-photo-placeholder'>"+machineIcon()+"</div></div><div class='garage-tile-overlay'></div><div class='garage-tile-content'><span>"+esc(m.manufacturer?.name||"Machine")+"</span><h3>"+esc(m.nickname||m.model?.model_name||"Machine")+"</h3><small>"+esc(statusLabel(m.status))+" · "+hrs+"</small></div></article>";
      }).join("")+"</div></section>":"")+
      "<section class='garage-quick'><div class='garage-section-heading'><div><span class='garage-kicker'>Keep things moving</span><h2>Workshop</h2></div><span>FIELD TOOLS</span></div><div class='garage-quick-links'><button data-action='quick-hours'><i>◷</i><span><b>Log hours</b><small>Update a machine meter</small></span><em>↗</em></button><button data-action='quick-service'><i>⌁</i><span><b>Record service</b><small>Keep maintenance current</small></span><em>↗</em></button><button data-action='quick-fault'><i>＋</i><span><b>Report a problem</b><small>Flag an issue for the team</small></span><em>↗</em></button></div></section>"+
    "</section>"
  );
  loadGaragePhotos(list);
}
async function loadGaragePhotos(machines){
  if(state.demo)return;
  const ids=machines.map(m=>m.id).filter(Boolean);
  if(!ids.length)return;
  const {data,error}=await state.client.schema("garage").from("machine_photos").select("machine_id,storage_bucket,storage_path,caption,created_at").in("machine_id",ids).order("created_at",{ascending:false});
  if(error)return;
  const latest=new Map();
  for(const p of data||[])if(!latest.has(p.machine_id))latest.set(p.machine_id,p);
  for(const [id,p] of latest){
    const signed=await state.client.storage.from(p.storage_bucket).createSignedUrl(p.storage_path,3600);
    if(signed.error)continue;
    const el=document.querySelector("[data-garage-photo='"+CSS.escape(id)+"']");
    if(el){el.innerHTML="<img src='"+esc(signed.data.signedUrl)+"' alt='"+esc(p.caption||"Machine photo")+"' loading='eager'>";if(id===machines[0]?.id){const note=document.querySelector(".garage-photo-note span");if(note)note.textContent="01 / MACHINE PHOTO"}}
  }
}

function renderDetail(){
  const m=state.selected;
  const pending=readOutbox().filter(x=>x.payload?.machineId===m.id).length;
  mount("<div class='machine-page'>"+
    "<div class='machine-back'><button class='back' data-action='back'>← Garage</button></div>"+
    "<section class='machine-hero-compact'>"+
      "<div class='machine-identity'><div class='machine-hero-icon'>"+machineIcon()+"</div><div><div class='eyebrow'>"+esc(m.manufacturer?.name||"Manufacturer")+" · "+esc(m.variant?.variant_name||"Variant")+"</div><h1>"+esc(m.nickname||m.model?.model_name||"Machine")+"</h1><div class='machine-status-line'><span class='mini-status "+(m.status==="out_of_service"?"attention":"") +"'></span>"+esc(statusLabel(m.status))+"<button class='status-change' data-action='status'>Change</button></div></div></div>"+
      "<div class='machine-primary-actions'><button class='btn' data-action='machine-mow'>Mow</button><button class='btn secondary' data-action='hours'>Hours</button><button class='btn secondary' data-action='service'>Service</button><button class='btn secondary' data-action='fault'>Problem</button></div>"+
    "</section>"+
    (pending?"<div class='note compact-note'><b>"+pending+" saved change"+(pending===1?"":"s")+" pending sync.</b></div>":"")+
    "<section class='machine-glance'>"+
      "<div class='glance-metric'><strong>"+(m.current_engine_hours??"—")+"</strong><small>Engine hours</small></div>"+
      "<div class='glance-metric'><strong>"+(m.current_reel_hours??"—")+"</strong><small>Reel hours</small></div>"+
      "<div class='glance-metric'><strong id='machine-due-count'>—</strong><small>Maintenance</small></div>"+
    "</section>"+
    "<section class='machine-next'><div class='eyebrow'>Next</div><div id='service-due'><div class='loading'><div class='spinner'></div>Checking service schedule…</div></div></section>"+
    "<div class='machine-disclosures'>"+
      "<details open><summary><span>Problems</span><span class='disclosure-meta'>Active issues & repairs</span></summary><div class='disclosure-body'><div class='actions disclosure-action'><button class='btn secondary small' data-action='fault'>Report problem</button></div><div id='machine-faults'><div class='loading'><div class='spinner'></div>Loading fault history…</div></div></div></details>"+
      "<details><summary><span>Service history</span><span class='disclosure-meta'>Completed maintenance</span></summary><div class='disclosure-body'><div id='service-history'><div class='loading'><div class='spinner'></div>Loading service history…</div></div></div></details>"+
      "<details><summary><span>Machine details</span><span class='disclosure-meta'>Identity & ownership</span></summary><div class='disclosure-body'><div class='detail-facts'><div><small>Serial number</small><strong>"+esc(m.serial_number||"Not recorded")+"</strong></div><div><small>Asset number</small><strong>"+esc(m.asset_number||"Not recorded")+"</strong></div><div><small>Purchase date</small><strong>"+esc(m.purchase_date||"Not recorded")+"</strong></div></div><button class='btn secondary small' data-action='edit'>Edit machine</button></div></details>"+
      "<details><summary><span>Specifications</span><span class='disclosure-meta'>Verified catalogue data</span></summary><div class='disclosure-body'><div id='specs'><div class='loading'><div class='spinner'></div>Loading verified specifications…</div></div></div></details>"+
      "<details><summary><span>Evidence</span><span class='disclosure-meta'>Photos & documents</span></summary><div class='disclosure-body'><div class='evidence-actions'><button class='btn secondary small' data-action='photo-upload'>Add photo</button><button class='btn secondary small' data-action='document-upload'>Add document</button></div><div class='evidence-sub'><div class='eyebrow'>Photos</div><div id='machine-photos'><div class='loading'><div class='spinner'></div>Loading photos…</div></div></div><div class='evidence-sub'><div class='eyebrow'>Documents</div><div id='machine-documents'><div class='loading'><div class='spinner'></div>Loading documents…</div></div></div></div></details>"+
    "</div>"+
  "</div>");
  loadSpecs(m);loadServiceData(m);loadEvidence(m);loadMachineFaults(m);
}
function canOperate(){return state.demo||["owner","admin","manager","operator"].includes(state.role)}
function canEditMachine(){return canOperate()}
function canChangeStatus(){return canOperate()}
function statusLabel(status){return String(status||"ready").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}
function statusClass(status){return status==="service_due"||status==="out_of_service"?"service":status==="in_service"?"fault":status==="retired"?"retired":"ready"}
function faultHtml(){
  if(!state.machineFaults.length)return "<div class='empty-mini'><div class='tiny'>No reported problems.</div></div>";
  return "<div class='list'>"+state.machineFaults.map(x=>{
    const actions=x.status==="open"
      ?"<button class='btn ghost small' data-action='ack-fault' data-id='"+esc(x.id)+"'>Acknowledge</button>"
      :x.status==="acknowledged"
        ?"<button class='btn ghost small' data-action='resolve-fault' data-id='"+esc(x.id)+"'>Resolve</button>"
        :"<span class='badge ready'>RESOLVED</span>";
    return "<div class='list-row fault-row'><div><div class='list-title'>"+esc(x.severity.toUpperCase())+" · "+esc(x.status.replace("_"," "))+"</div><div class='list-meta'>"+esc(new Date(x.reported_at).toLocaleDateString())+" · "+esc(x.description)+"</div>"+(x.resolution_notes?"<div class='list-meta' style='margin-top:4px'>"+esc(x.resolution_notes)+"</div>":"")+"</div><div class='actions'>"+actions+"</div></div>";
  }).join("")+"</div>";
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
function acknowledgeFault(id){
  const fault=state.machineFaults.find(x=>x.id===id);if(!fault)return;
  if(state.demo){fault.status="acknowledged";closeModal();toast("Problem acknowledged");return renderDetail()}
  (async()=>{
    try{
      const {error}=await state.client.schema("garage").rpc("acknowledge_machine_fault",{p_fault_id:id,p_notes:"Acknowledged in Garage"});
      if(error)throw error;
      await loadMachines();state.selected=state.machines.find(x=>x.id===state.selected.id)||state.selected;await loadMachineFaults(state.selected);closeModal();toast("Problem acknowledged");renderDetail();
    }catch(x){toast(x.message||"Could not acknowledge problem")}
  })();
}
function resolveFaultModal(id){
  const fault=state.machineFaults.find(x=>x.id===id);if(!fault)return;
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Resolve issue</div><h2>Return the machine to repair complete.</h2><p class='tiny'>Record what was repaired, adjusted or checked. The machine will move to Repaired.</p></div><button class='close' data-action='close'>×</button></div><form id='resolve-form'><div class='field'><label>Resolution notes</label><textarea class='input' id='resolution-notes' rows='4' required placeholder='What was repaired, adjusted or checked?'></textarea></div><button class='btn' style='width:100%'>Mark repaired</button></form></div></div>");
  document.querySelector("#resolve-form").addEventListener("submit",async e=>{
    e.preventDefault();const notes=val("#resolution-notes");if(!notes){toast("Resolution notes are required");return}
    if(state.demo){fault.status="resolved";fault.resolution_notes=notes;fault.resolved_at=new Date().toISOString();state.selected.status="repaired";closeModal();toast("Problem resolved");return renderDetail()}
    try{
      const {error}=await state.client.schema("garage").rpc("resolve_machine_fault",{p_fault_id:id,p_resolution_notes:notes});
      if(error)throw error;
      closeModal();await loadMachines();state.selected=state.machines.find(x=>x.id===state.selected.id)||state.selected;await loadMachineFaults(state.selected);toast("Problem resolved — machine is repaired");renderDetail();
    }catch(x){toast(x.message||"Could not resolve problem")}
  });
}
function statusTransitionModal(){
  const m=state.selected;if(!m)return;
  let transitions={ready:["service_due","in_service","out_of_service"],service_due:["in_service","ready","out_of_service"],in_service:["ready","service_due","out_of_service"],out_of_service:["in_service","repaired","retired"],repaired:["ready","out_of_service"],retired:[]}[m.status]||[];
  if(!["owner","admin"].includes(state.role))transitions=transitions.filter(x=>x!=="retired");
  if(!transitions.length)return toast("No manual status transitions are available.");
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Machine status</div><h2>Change operational state.</h2><p class='tiny'>Current status: "+esc(statusLabel(m.status))+". Choose the next valid state.</p></div><button class='close' data-action='close'>×</button></div><div class='picker-list'>"+transitions.map(x=>"<button class='picker-row' data-action='set-status' data-status='"+esc(x)+"'><span><strong>"+esc(statusLabel(x))+"</strong><small>"+esc(x==="in_service"?"Machine is being worked on":x==="out_of_service"?"Machine is unavailable":x==="repaired"?"Repair completed; awaiting return to service":x==="retired"?"Remove from active fleet — permanent":"Operational state")+"</small></span><span>›</span></button>").join("")+"</div></div></div>");
}
async function setMachineStatus(status){
  const m=state.selected;if(!m)return;
  if(status==="retired"&&!confirm("Retire this machine? This removes it from the active fleet and cannot be reversed from the app."))return;
  if(state.demo){m.status=status;closeModal();toast("Status changed");return renderDetail()}
  try{
    const {data,error}=await state.client.schema("garage").rpc("transition_machine_status",{p_machine_id:m.id,p_target_status:status,p_notes:"Status changed in Garage"});
    if(error)throw error;
    closeModal();await loadMachines();state.selected=state.machines.find(x=>x.id===m.id)||m;await loadMachineFaults(state.selected);toast("Machine status updated");renderDetail();
  }catch(x){toast(x.message||"Could not change machine status")}
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
  return "<div class='photo-grid'>"+state.machinePhotos.map(x=>"<a class='photo-card' href='"+esc(x.url)+"' target='_blank' rel='noopener noreferrer' aria-label='Open "+esc(x.caption||"Machine photo")+"'><img src='"+esc(x.url)+"' alt='"+esc(x.caption||"Machine photo")+"' loading='lazy'><div class='tiny'>"+esc(x.caption||"Machine photo")+"</div></a>").join("")+"</div>"
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
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>"+(isPhoto?"Machine photo":"Machine document")+"</div><h2>"+(isPhoto?"Capture evidence.":"Attach a document.")+"</h2><p class='tiny'>Files are stored privately against this physical machine.</p></div><button class='close' data-action='close'>×</button></div><form id='evidence-form'><div class='field'><label>File</label><input class='input' id='evidence-file' type='file' "+(isPhoto?"accept='image/*'":"accept='.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx'")+" required></div><div class='field'><label>"+(isPhoto?"Caption":"Title")+"</label><input class='input' id='evidence-title' placeholder='"+(isPhoto?"e.g. Serial plate":"e.g. Service invoice")+"' required></div>"+(isPhoto?"<div class='field'><label>Photo type</label><select class='input' id='photo-type'><option value='machine'>Machine</option><option value='serial_plate'>Serial / model plate</option><option value='service_evidence'>Service evidence</option><option value='damage'>Damage / issue</option></select></div>":"<div class='field'><label>Document type</label><select class='input' id='document-type'><option value='service_record'>Service record</option><option value='invoice'>Invoice</option><option value='manual'>Manual</option><option value='other'>Other</option></select></div>")+"<button class='btn' style='width:100%'>Upload</button></form></div></div>");
  document.querySelector("#evidence-form").addEventListener("submit",e=>saveEvidence(e,kind))
}
async function saveEvidence(e,kind){
  e.preventDefault();
  const m=state.selected,file=document.querySelector("#evidence-file")?.files?.[0],title=val("#evidence-title");
  if(!file)return;
  if(state.demo){closeModal();toast("Demo mode: upload preview only");return}
  let path=null,bucket="reelmow-garage-private";
  try{
    const org=state.org.id, ext=(file.name.split(".").pop()||"bin").toLowerCase();
    path="org/"+org+"/machines/"+m.id+"/"+Date.now()+"-"+crypto.randomUUID()+"."+ext;
    if(file.size>25_000_000)throw new Error("Files must be under 25 MB.");
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
  }catch(x){
    if(path)try{await state.client.storage.from(bucket).remove([path])}catch{}
    toast(x.message||"Upload failed")
  }
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
  if(!state.serviceDue.length)return "<div class='next-empty'>No published service schedule.</div>";
  const ordered=[...state.serviceDue].sort((a,b)=>{
    const rank=x=>x.service_status==="due"?0:x.service_status==="history_unknown"?1:2;
    return rank(a)-rank(b);
  });
  const visible=ordered.slice(0,3);
  return "<div class='next-list'>"+visible.map(x=>{
    const due=x.service_status==="due",unknown=x.service_status==="history_unknown";
    const remaining=x.hours_remaining!=null?Math.round(Number(x.hours_remaining)*10)/10:null;
    const date=x.calendar_due_date;
    const detail=unknown?"History not recorded":remaining!=null?(remaining<=0?"Due now":remaining+" engine hours remaining"):(date?"Due "+date:"Schedule published");
    const badgeClass=due?"service":unknown?"history":"ready";
    const badgeLabel=due?"DUE":unknown?"HISTORY UNKNOWN":"UPCOMING";
    return "<button class='next-row' data-action='service-task' data-id='"+esc(x.service_task_id||"")+"'><span><strong>"+esc(x.task_name)+"</strong><small>"+esc(detail)+"</small></span><span class='badge "+badgeClass+"'>"+badgeLabel+"</span><span class='row-arrow'>›</span></button>";
  }).join("")+"</div>"+(ordered.length>3?"<div class='next-more'>"+(ordered.length-3)+" more maintenance item"+(ordered.length-3===1?"":"s")+" available below.</div>":"");
}
function serviceTaskModal(taskId){
  const x=state.serviceDue.find(v=>v.service_task_id===taskId);
  if(!x)return toast("Service task details are unavailable.");
  const unknown=x.service_status==="history_unknown";
  const status=x.service_status==="due"?"DUE":unknown?"HISTORY NOT RECORDED":"UPCOMING";
  const remaining=x.hours_remaining!=null?Math.round(Number(x.hours_remaining)*10)/10:null;
  const schedule=[x.interval_engine_hours?x.interval_engine_hours+" engine hours":null,x.interval_reel_hours?x.interval_reel_hours+" reel hours":null,x.interval_calendar_days?x.interval_calendar_days+" days":null].filter(Boolean).join(" · ");
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Maintenance task · "+esc(status)+"</div><h2>"+esc(x.task_name)+"</h2><p class='tiny'>"+esc(schedule||"Published maintenance requirement")+"</p></div><button class='close' data-action='close'>×</button></div><div class='note'>"+esc(x.instructions||"Follow the manufacturer maintenance instructions for this task.")+"</div>"+(x.safety_notes?"<div class='note' style='margin-top:10px'><b>Safety</b><br>"+esc(x.safety_notes)+"</div>":"")+"<div class='list' style='margin-top:14px'><div class='list-row'><div><div class='list-title'>Current engine hours</div><div class='list-meta'>"+esc(x.current_engine_hours??"Not recorded")+"</div></div></div><div class='list-row'><div><div class='list-title'>Current reel hours</div><div class='list-meta'>"+esc(x.current_reel_hours??"Not recorded")+"</div></div></div>"+(remaining!=null?"<div class='list-row'><div><div class='list-title'>Hours remaining</div><div class='list-meta'>"+esc(remaining<=0?"Due now":remaining+" engine hours")+"</div></div></div>":"")+(x.calendar_due_date?"<div class='list-row'><div><div class='list-title'>Calendar due</div><div class='list-meta'>"+esc(x.calendar_due_date)+"</div></div></div>":"")+"</div><button class='btn' style='width:100%;margin-top:14px' data-action='service'>Record this service</button></div></div>");
}

function serviceHistoryHtml(){
  if(!state.serviceRecords.length)return "<div class='empty-mini'><div class='tiny'>No service records yet.</div><button class='btn secondary small' style='margin-top:10px' data-action='service'>Record the first service</button></div>";
  return "<div class='list'>"+state.serviceRecords.map(x=>"<div class='list-row'><div><div class='list-title'>"+esc(x.task_name||"Service record")+"</div><div class='list-meta'>"+esc(new Date(x.serviced_at).toLocaleDateString())+" · "+(x.engine_hours!=null?esc(x.engine_hours)+" h":"hours not recorded")+(x.cost!=null?" · £"+Number(x.cost).toFixed(2):"")+"</div>"+(x.performed_by?"<div class='list-meta'>By "+esc(x.performed_by)+"</div>":"")+(x.notes?"<div class='list-meta' style='margin-top:4px'>"+esc(x.notes)+"</div>":"")+(x.evidence?.storage_path?"<button class='btn ghost small' style='margin-top:7px' data-action='open-service-evidence' data-id='"+esc(x.id)+"'>Open evidence</button>":"")+"</div></div>").join("")+"</div>"
}
async function loadServiceData(m){
  if(state.demo){
    state.serviceDue=demoServiceDue(m.id);
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
  const dueCount=document.querySelector("#machine-due-count");if(dueCount){const active=state.serviceDue.filter(x=>x.service_status==="due").length;const unknown=state.serviceDue.filter(x=>x.service_status==="history_unknown").length;dueCount.textContent=active?active+" due":unknown?unknown+" unknown":"Up to date";}
}

function demoServiceDue(machineId){
  return [
    {machine_id:machineId,task_name:"Engine oil change",service_status:"due",hours_remaining:-4.5,source_page:16},
    {machine_id:machineId,task_name:"Lubricate F1 grease points",service_status:"upcoming",hours_remaining:15.5,source_page:28},
    {machine_id:machineId,task_name:"Lubricate F2 grease points",service_status:"upcoming",hours_remaining:115.5,source_page:28},
    {machine_id:machineId,task_name:"Lubricate F3 grease points",service_status:"upcoming",hours_remaining:215.5,source_page:28},
    {machine_id:machineId,task_name:"Inspect fuel lines and clamps",service_status:"upcoming",hours_remaining:15.5,source_page:17}
  ];
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
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Record service</div><h2>Log maintenance.</h2><p class='tiny'>Keep the work attached to this physical machine.</p></div><button class='close' data-action='close'>×</button></div><form id='service-form'><div class='field'><label>Service task</label><select class='input' id='service-task'>"+options+"<option value=''>Other / unscheduled service</option></select></div><div class='grid two'><div class='field'><label>Date</label><input class='input' id='service-date' type='date' value='"+new Date().toISOString().slice(0,10)+"' required></div><div class='field'><label>Cost</label><input class='input' id='service-cost' type='number' min='0' step='.01' placeholder='0.00' aria-describedby='service-cost-error'><div id='service-cost-error' class='tiny' style='display:none;margin-top:5px'>Cost cannot be negative.</div></div></div><div class='grid two'><div class='field'><label>Engine hours</label><input class='input' id='service-engine' type='number' min='0' step='.1' value='"+esc(m.current_engine_hours??"")+"'></div><div class='field'><label>Reel hours</label><input class='input' id='service-reel' type='number' min='0' step='.1' value='"+esc(m.current_reel_hours??"")+"'></div></div><div class='field'><label>Performed by</label><input class='input' id='performed-by' placeholder='Person or company'></div><div class='field'><label>Work completed / notes</label><textarea class='input' id='service-notes' rows='4' placeholder='Oil, filters, reels, belts, inspection notes…'></textarea></div><div class='field'><label>Evidence</label><input class='input' id='service-evidence' type='file' accept='.pdf,.jpg,.jpeg,.png,.webp'><div class='tiny' style='margin-top:5px'>Attach an invoice, service sheet or photo. Evidence uploads require an internet connection.</div></div><button class='btn' style='width:100%'>Save service record</button></form></div></div>");
  const costInput=document.querySelector("#service-cost"),costError=document.querySelector("#service-cost-error"),saveButton=document.querySelector("#service-form button[type='submit']");
  const validateServiceCost=()=>{const invalid=costInput?.value!==""&&Number(costInput.value)<0;if(costInput){costInput.setCustomValidity(invalid?"Cost cannot be negative.":"");costInput.setAttribute("aria-invalid",invalid?"true":"false")}if(costError)costError.style.display=invalid?"block":"none";if(saveButton)saveButton.disabled=invalid;return !invalid};
  costInput?.addEventListener("input",validateServiceCost);
  costInput?.addEventListener("change",validateServiceCost);
  document.querySelector("#service-form").addEventListener("submit",e=>{if(!validateServiceCost()){e.preventDefault();return}saveService(e)})
}
async function saveService(e){
  e.preventDefault();const m=state.selected,file=document.querySelector("#service-evidence")?.files?.[0];
  const task=val("#service-task")||null,date=val("#service-date"),eh=num("#service-engine"),rh=num("#service-reel"),cost=num("#service-cost"),performed=val("#performed-by"),notes=val("#service-notes");
  if(eh!=null&&eh<0||rh!=null&&rh<0)return toast("Hours cannot be negative");
  if(cost!=null&&cost<0)return toast("Cost cannot be negative.");
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
  state.webSport="golf";state.webResults=[];state.webCitations=[];
  modal("<div class='modal-backdrop'><div class='modal discovery-modal'><div class='modal-head'><div><div class='eyebrow'>Find equipment</div><h2>Search the grounds world.</h2><p class='tiny'>Verified catalogue matches, plus sourced UK grounds research.</p></div><button class='close' data-action='close'>×</button></div><div class='discovery-tabs'><button class='discovery-tab active' data-action='catalogue-search-tab'>Catalogue</button><button class='discovery-tab' data-action='web-search-tab'>UK web research <span>NEW</span></button></div><div class='search-wrap'><span class='search-icon'>⌕</span><input id='q' class='search' placeholder='Search a machine, brand or grounds task…' autocomplete='off'></div><section class='discovery-pane' id='catalogue-pane'><div class='quick-searches'><button class='chip' data-search='LF3800'>Jacobsen LF3800</button><button class='chip' data-search='SC610'>Protea SC610</button><button class='chip' data-search='Shaver 24'>Allett Shaver 24</button><button class='chip' data-search='Royale 24'>ATCO Royale 24</button></div><div id='results' class='result-list'><p class='tiny'>Start typing, or choose a machine above.</p></div><div class='catalogue-help'><b>Have the machine with you?</b><span>Scan its model plate and check the exact catalogue match.</span><button class='btn secondary small' data-action='unknown-machine'>Scan plate</button></div></section><section class='discovery-pane' id='web-pane' hidden><div class='research-intro'><div class='eyebrow'>UK grounds research</div><p>Explore equipment found in public club reports, manufacturer sources and Grounds Management Association guidance.</p></div><div class='sport-filters'><button class='sport-filter active' data-action='web-sport' data-sport='golf'>Golf</button><button class='sport-filter' data-action='web-sport' data-sport='cricket'>Cricket</button><button class='sport-filter' data-action='web-sport' data-sport='football'>Football</button></div><button class='btn research-search-button' data-action='web-search'>"+(state.demo?"Explore UK source examples":"Search UK web now")+" <span>↗</span></button><div id='web-results' class='web-results'><p class='tiny'>Search for a machine or choose a sport to explore sourced examples.</p></div><div class='research-footnote'>Results include source links and identify whether evidence shows actual club use, supplier claims or equipment guidance.</div></section></div></div>");
  const q=document.querySelector("#q");let t;q.addEventListener("input",()=>{if(document.querySelector("#web-pane")?.hidden){clearTimeout(t);t=setTimeout(()=>search(q.value),220)}});
  document.querySelectorAll("[data-search]").forEach(b=>b.addEventListener("click",()=>{q.value=b.dataset.search;search(q.value)}));
  q.focus()
}
function unknownMachineModal(){
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Catalogue assistant</div><h2>Scan the machine plate.</h2><p class='tiny'>REELMOW reads the plate with AI, then matches the reading against the verified REELMOW catalogue. You confirm the machine before it is added.</p></div><button class='close' data-action='close'>×</button></div><div class='field'><label>Model / serial plate photo</label><input class='input' id='unknown-plate' type='file' accept='image/*' capture='environment'></div><div id='unknown-result' class='empty-mini'><div class='tiny'>Take a clear, close photo of the plate in good light.</div></div><div class='catalogue-help' style='margin-top:14px'><b>Nothing readable?</b><span>You can return to search and enter the manufacturer or model manually.</span><button class='btn secondary small' data-action='close'>Back to search</button></div></div></div>");
  document.querySelector("#unknown-plate").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    state.pendingIdentification=null;
    const box=document.querySelector("#unknown-result");box.innerHTML="<div class='loading' style='padding:22px 5px'><div class='spinner'></div>Reading plate and checking catalogue…</div>";
    if(state.demo){box.innerHTML="<div class='note'><b>Demo scan:</b> In live mode REELMOW reads the plate, matches it against the catalogue and asks you to confirm the suggested variant.</div>";return}
    try{
      const result=await identifyMachinePlate(file);
      const candidates=await matchPlateIdentification(result);
      state.pendingIdentification={serial_number:result.serial_number||null,manufacturer:result.manufacturer||null,product_family:result.product_family||null,model:result.model||null,variant:result.variant||null,visible_text:result.visible_text||"",confidence:Number(result.confidence||0),uncertainty:result.uncertainty||"",plateFile:file,candidates};
      const confidence=Math.round(Number(result.confidence||0)*100);
      const read="<div class='note'><b>AI plate reading</b><br>"+esc([result.manufacturer,result.product_family,result.model,result.variant].filter(Boolean).join(" · ")||"No model identified")+"<br>Serial "+esc(result.serial_number||"Not read")+" · AI confidence "+confidence+"%"+(result.uncertainty?"<br>"+esc(result.uncertainty):"")+"</div>";
      const list=candidates.length?candidates.map((x,i)=>identificationCard(x,i)).join(""):"<div class='empty-mini'><b>No verified catalogue match.</b><div class='tiny' style='margin-top:5px'>Check the plate reading and search the catalogue manually. Do not add an unverified variant.</div></div>";
      box.innerHTML=read+"<div class='eyebrow' style='margin-top:15px'>Catalogue suggestions</div><div class='result-list' style='margin-top:7px'>"+list+"</div>";
    }catch(x){box.innerHTML="<div class='error'>"+esc(x.message||"Plate scan failed")+"</div>"}
  })
}

async function startMow(machineId){
  if(!navigator.geolocation)return toast("Location is not available on this device.");
  const m=state.machines.find(x=>x.id===machineId);if(!m)return;
  if(m.status!=="ready"&&m.status!=="in_service")return toast("Mow Mode is unavailable while this machine is "+statusLabel(m.status)+".");
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
async function exitMow(){
  if(!state.mow.active)return setView("today");
  if(!confirm("Exit Mow Mode? The active session will be cancelled."))return;
  if(state.mow.watchId!=null)navigator.geolocation.clearWatch(state.mow.watchId);
  if(!state.demo&&state.mow.sessionId){
    const {error}=await state.client.schema("garage").from("mowing_sessions").update({ended_at:new Date().toISOString(),status:"cancelled"}).eq("id",state.mow.sessionId);
    if(error){toast(error.message||"Could not cancel the mowing session");return;}
  }
  state.mow.active=false;
  setView("today");
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
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Machine profile</div><h2>Edit machine.</h2><p class='tiny'>Keep the physical asset record complete.</p></div><button class='close' data-action='close'>×</button></div><form id='edit-machine'><div class='field'><label>Nickname</label><input class='input' id='edit-nickname' value='"+esc(m.nickname||"")+"' maxlength='80'></div><div class='grid two'><div class='field'><label>Serial number</label><input class='input' id='edit-serial' value='"+esc(m.serial_number||"")+"' maxlength='120'></div><div class='field'><label>Asset number</label><input class='input' id='edit-asset' value='"+esc(m.asset_number||"")+"' maxlength='80'></div></div><div class='grid two'><div class='field'><label>Purchase date</label><input class='input' id='edit-date' type='date' value='"+esc(m.purchase_date||"")+"'></div><div class='field'><label>Purchase price</label><input class='input' id='edit-price' type='number' min='0' step='.01' value='"+esc(m.purchase_price??"")+"'></div></div><div class='field'><label>Ownership</label><select class='input' id='edit-ownership'><option value=''>Not specified</option><option value='owned'>Owned</option><option value='leased'>Leased</option><option value='hired'>Hired</option><option value='loaned'>Loaned</option><option value='other'>Other</option></select></div><div class='field'><label>Owner / supplier</label><input class='input' id='edit-owner' value='"+esc(m.ownership_name||"")+"'></div><div class='grid two'><div class='field'><label>Warranty start</label><input class='input' id='edit-warranty-start' type='date' value='"+esc(m.warranty_start_date||"")+"'></div><div class='field'><label>Warranty end</label><input class='input' id='edit-warranty-end' type='date' value='"+esc(m.warranty_end_date||"")+"'></div></div><div class='field'><label>Warranty provider</label><input class='input' id='edit-warranty-provider' value='"+esc(m.warranty_provider||"")+"'></div><div class='field'><label>Notes</label><textarea class='input' id='edit-notes' rows='4' maxlength='2000'>"+esc(m.notes||"")+"</textarea></div><button class='btn' style='width:100%'>Save changes</button></form></div></div>");
  document.querySelector("#edit-ownership").value=m.ownership_type||"";
  document.querySelector("#edit-machine").addEventListener("submit",async e=>{
    e.preventDefault();if(!canEditMachine())return toast("Your role is read-only.");const serial=val("#edit-serial"),price=num("#edit-price");
    if(price!=null&&price<0)return toast("Purchase price cannot be negative");
    if(!state.demo&&serial){const {data,error}=await state.client.schema("garage").from("machines").select("id").eq("garage_id",state.garage.id).ilike("serial_number",serial).neq("id",m.id).limit(1);if(error)return toast(error.message);if(data?.length)return toast("A machine with this serial number is already in this Garage.")}
    const patch={serial_number:serial||null,nickname:val("#edit-nickname")||null,asset_number:val("#edit-asset")||null,purchase_date:val("#edit-date")||null,purchase_price:price,ownership_type:val("#edit-ownership")||null,ownership_name:val("#edit-owner")||null,warranty_start_date:val("#edit-warranty-start")||null,warranty_end_date:val("#edit-warranty-end")||null,warranty_provider:val("#edit-warranty-provider")||null,notes:val("#edit-notes")||null,updated_at:new Date().toISOString()};
    try{
      if(state.demo)Object.assign(m,patch);
      else{
        const {error}=await state.client.schema("garage").rpc("update_machine_profile",{
          p_machine_id:m.id,p_serial_number:patch.serial_number,p_asset_number:patch.asset_number,p_nickname:patch.nickname,
          p_purchase_date:patch.purchase_date,p_purchase_price:patch.purchase_price,p_ownership_type:patch.ownership_type,
          p_ownership_name:patch.ownership_name,p_warranty_start_date:patch.warranty_start_date,p_warranty_end_date:patch.warranty_end_date,
          p_warranty_provider:patch.warranty_provider,p_notes:patch.notes
        });
        if(error)throw error;
        await loadMachines();state.selected=state.machines.find(x=>x.id===m.id)||m;
      }
      closeModal();toast("Machine profile updated");render()
    }catch(x){toast(x.message||"Could not update machine")}
  });
}
function machineModal(r){
  const pending=state.pendingIdentification;
  state.pendingCatalogueVariantId=r.variant_id;
  const aiReview=pending?"<div class='note' style='margin-bottom:14px'><b>REELMOW identification</b><br>"+esc([pending.manufacturer,pending.product_family,pending.model,pending.variant].filter(Boolean).join(" · ")||"Catalogue match")+" · Serial "+esc(pending.serial_number||"Not read")+"<br>Review the verified catalogue match below before adding the machine.</div>":"<div class='note' style='margin-bottom:14px'><b>Scan the machine plate</b><br>REELMOW reads the visible model and serial text, then checks it against the catalogue. You confirm the result before adding the machine.</div>";
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Physical machine</div><h2>"+esc(r.manufacturer_name)+" "+esc(r.model_name)+"</h2><p class='tiny'>"+esc(r.variant_name||"Variant")+" · REELMOW catalogue</p></div><button class='close' data-action='close'>×</button></div><form id='machine-form'>"+aiReview+"<div class='field'><label>Plate photo</label><input class='input' id='plate-photo' type='file' accept='image/*' capture='environment'></div><div id='plate-result'></div><div class='field'><label>Serial number</label><input class='input' id='serial'></div><div class='field'><label>Asset number</label><input class='input' id='asset'></div><div class='field'><label>Nickname</label><input class='input' id='nickname' placeholder='e.g. Main Outfield Mower'></div><div class='grid two'><div class='field'><label>Purchase date</label><input class='input' id='date' type='date'></div><div class='field'><label>Purchase price</label><input class='input' id='purchase-price' type='number' min='0' step='.01' placeholder='0.00'></div></div><div class='grid two'><div class='field'><label>Engine hours</label><input class='input' id='hours' type='number' min='0' step='.1'></div><div class='field'><label>Reel hours</label><input class='input' id='reel' type='number' min='0' step='.1'></div></div><div class='field'><label>Ownership</label><select class='input' id='ownership-type'><option value=''>Not specified</option><option value='owned'>Owned</option><option value='leased'>Leased</option><option value='hired'>Hired</option><option value='loaned'>Loaned</option><option value='other'>Other</option></select></div><div class='field'><label>Owner / supplier</label><input class='input' id='ownership-name'></div><div class='grid two'><div class='field'><label>Warranty start</label><input class='input' id='warranty-start' type='date'></div><div class='field'><label>Warranty end</label><input class='input' id='warranty-end' type='date'></div></div><div class='field'><label>Warranty provider</label><input class='input' id='warranty-provider' placeholder='Dealer / manufacturer'></div><div class='field'><label>Notes</label><textarea class='input' id='machine-notes' rows='3'></textarea></div><div class='note'>This physical asset will be linked to the verified catalogue variant.</div><button class='btn' style='width:100%;margin-top:14px'>Add to Garage</button></form></div></div>");
  document.querySelector("#machine-form").addEventListener("submit",e=>saveMachine(e,r));
  if(pending?.serial_number)document.querySelector("#serial").value=pending.serial_number;
  if(pending?.plateFile)state.pendingPlateFile=pending.plateFile;
  document.querySelector("#plate-photo").addEventListener("change",e=>identifyPlate(e.target.files?.[0]))
}
async function identifyMachinePlate(file){
  if(!file)throw new Error("Please choose a machine plate image.");
  const data=await imageDataUrl(file);
  const {data:result,error}=await state.client.functions.invoke("identify-machine",{body:{image_data_url:data}});
  if(error)throw new Error(error.message||"The plate scanner could not be reached.");
  if(!result||typeof result!=="object")throw new Error("The plate scanner returned an invalid response.");
  if(result.error)throw new Error(result.error);
  return result;
}
async function matchPlateIdentification(result){
  const {data,error}=await state.client.schema("catalogue").rpc("match_machine_identification",{
    manufacturer_text:result.manufacturer||null,
    product_family_text:result.product_family||null,
    model_text:result.model||null,
    variant_text:result.variant||null,
    serial_number_text:result.serial_number||null,
    visible_text:result.visible_text||null,
    result_limit:6
  });
  if(error)throw error;
  return data||[];
}
function identificationCard(candidate,index){
  const pct=Math.round(Number(candidate.rank||0)*100);
  const reasons=candidate.match_reasons||{};
  const reasonText=[
    reasons.manufacturer_exact?"manufacturer":"",reasons.model_exact?"model":"",reasons.variant_exact?"variant":"",
    reasons.serial_prefix?"serial prefix":""
  ].filter(Boolean).join(" · ");
  return "<div class='result' style='display:block'><div style='display:flex;justify-content:space-between;gap:10px;align-items:flex-start'><div><div class='result-name'>"+esc((candidate.manufacturer_name||"")+" "+(candidate.model_name||""))+"</div><div class='result-meta'>"+esc(candidate.variant_name||"Variant")+" · "+esc(candidate.machine_type||"Machine")+"</div></div><span class='tiny'>"+pct+"%</span></div>"+(reasonText?"<div class='tiny' style='margin-top:6px'>Matched: "+esc(reasonText)+"</div>":"")+"<button class='btn small' style='width:100%;margin-top:10px' data-action='accept-identified' data-index='"+index+"'>Use this machine</button></div>";
}
async function identifyPlate(file){
  if(!file)return;
  state.pendingPlateFile=file;
  const box=document.querySelector("#plate-result");if(box)box.innerHTML="<div class='note'>Reading plate and checking catalogue…</div>";
  if(state.demo){if(box)box.innerHTML="<div class='note'>Demo mode: plate scan preview. In the live build this will use AI/OCR.</div>";return}
  try{
    const result=await identifyMachinePlate(file);
    state.pendingIdentification={serial_number:result.serial_number||null,manufacturer:result.manufacturer||null,product_family:result.product_family||null,model:result.model||null,variant:result.variant||null,visible_text:result.visible_text||"",confidence:Number(result.confidence||0),uncertainty:result.uncertainty||"",plateFile:file,candidates:[]};
    const set=(id,v)=>{if(v&&document.querySelector(id))document.querySelector(id).value=v};
    set("#serial",result.serial_number);
    const confidence=Math.round(Number(result.confidence||0)*100);
    if(box)box.innerHTML="<div class='note'><b>AI read:</b> "+esc([result.manufacturer,result.model,result.variant].filter(Boolean).join(" · ")||"No model identified")+"<br>Confidence "+confidence+"%"+(result.uncertainty?" · "+esc(result.uncertainty):"")+"</div>";
  }catch(x){if(box)box.innerHTML="<div class='error'>"+esc(x.message||"Plate scan failed")+"</div>"}
}
async function saveMachine(e,r){
  e.preventDefault();if(!canOperate())return toast("Your role is read-only.");
  const serial=val("#serial"),asset=val("#asset"),nickname=val("#nickname"),purchaseDate=val("#date"),purchasePrice=num("#purchase-price"),warrantyStart=val("#warranty-start"),warrantyEnd=val("#warranty-end"),warrantyProvider=val("#warranty-provider"),ownershipType=val("#ownership-type")||null,ownershipName=val("#ownership-name"),notes=val("#machine-notes"),engineHours=num("#hours"),reelHours=num("#reel");
  if(engineHours!=null&&engineHours<0||reelHours!=null&&reelHours<0){toast("Hours cannot be negative");return}
  if(state.demo){state.machines.unshift({id:crypto.randomUUID(),garage_id:state.garage.id,machine_variant_id:r.variant_id,serial_number:serial||null,asset_number:asset||null,nickname:nickname||null,purchase_date:purchaseDate||null,purchase_price:purchasePrice,current_engine_hours:engineHours,current_reel_hours:reelHours,status:"ready",variant:{variant_name:r.variant_name},model:{model_name:r.model_name},manufacturer:{name:r.manufacturer_name}});closeModal();toast("Machine added to Garage");return render()}
  let uploadedPath=null;
  try{
    const machineId=crypto.randomUUID(),file=state.pendingPlateFile;
    if(file){
      uploadedPath="org/"+state.org.id+"/machines/"+machineId+"/"+Date.now()+"-"+crypto.randomUUID()+".jpg";
      const resized=await imageDataUrl(file,1800,.84),blob=await (await fetch(resized)).blob();
      const up=await state.client.storage.from("reelmow-garage-private").upload(uploadedPath,blob,{contentType:"image/jpeg",upsert:false});
      if(up.error)throw new Error("Plate evidence could not be uploaded. The machine was not added.");
    }
    const {error}=await state.client.schema("garage").rpc("create_machine",{
      p_machine_id:machineId,p_garage_id:state.garage.id,p_machine_variant_id:r.variant_id,
      p_serial_number:serial||null,p_asset_number:asset||null,p_nickname:nickname||null,p_purchase_date:purchaseDate||null,
      p_purchase_price:purchasePrice,p_warranty_start_date:warrantyStart||null,p_warranty_end_date:warrantyEnd||null,
      p_warranty_provider:warrantyProvider||null,p_ownership_type:ownershipType,p_ownership_name:ownershipName||null,
      p_notes:notes||null,p_current_engine_hours:engineHours,p_current_reel_hours:reelHours,
      p_photo_bucket:uploadedPath?"reelmow-garage-private":null,p_photo_path:uploadedPath,p_photo_caption:"Machine model / serial plate",
      p_photo_mime_type:file?.type||"image/jpeg",p_photo_file_size:file?.size||null,
      p_photo_metadata:{source:"plate_scan",ai_confidence:state.pendingIdentification?.confidence??null,ai_reading:{
        manufacturer:state.pendingIdentification?.manufacturer||null,model:state.pendingIdentification?.model||null,
        variant:state.pendingIdentification?.variant||null,serial_number:state.pendingIdentification?.serial_number||null
      }}
    });
    if(error)throw error;
    state.pendingPlateFile=null;state.pendingIdentification=null;closeModal();await loadMachines();toast("Machine added to Garage");render()
  }catch(x){
    if(uploadedPath)await state.client.storage.from("reelmow-garage-private").remove([uploadedPath]).catch(()=>{});
    toast(x.message||"Could not add machine")
  }
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
  if(!state.machines.length)state.machines=[{id:"demo-lf3800",garage_id:"demo-garage",machine_variant_id:demoCatalogue[0].variant_id,serial_number:"DEMO-LF3800",asset_number:"BTCC-001",nickname:"Main Outfield Mower",purchase_date:"2025-03-14",current_engine_hours:1284.5,current_reel_hours:642.2,status:"ready",variant:{variant_name:"LF3800 5-Gang"},model:{model_name:"LF3800"},manufacturer:{name:"Jacobsen"}}];
  state.dashboardDue=demoServiceDue("demo-lf3800");
}
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter"&&e.key!==" ")return;
  const target=e.target.closest("[data-action]");
  if(!target||!target.matches(".machine-card"))return;
  e.preventDefault();
  target.click();
});
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-action]");if(!a)return;
  const x=a.dataset.action;
  if(["today","garage","catalogue","activity","profile"].includes(x))return setView(x);
  if(x==="quick-add")return setView("catalogue");
  if(x==="quick-hours")return machinePicker("hours");
  if(x==="quick-service")return machinePicker("service");
  if(x==="quick-fault")return machinePicker("fault");
  if(x==="mow"){return machinePicker("mow")}
    if(x==="machine-mow"){return startMow(state.selected?.id)}
  if(x==="garage-mow"){state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;return startMow(state.selected?.id)}
  if(x==="mow-pause")return pauseMow();
  if(x==="mow-stop")return finishMow();
  if(x==="exit-mow")return exitMow();
  if(x==="quick-machine"){
    state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;
    const action=state.quickAction;state.quickAction=null;closeModal();
    if(action==="hours")return hoursModal();if(action==="service")return serviceModal();if(action==="fault")return faultModal();if(action==="mow")return startMow(state.selected.id);
    return;
  }
  if(x==="resolve-fault")return resolveFaultModal(a.dataset.id);
  if(x==="ack-fault")return acknowledgeFault(a.dataset.id);
  if(x==="status")return statusTransitionModal();
  if(x==="set-status")return setMachineStatus(a.dataset.status);
  if(x==="connection")return connectionModal();
  if(x==="switch-workspace")return workspacePickerModal();
  if(x==="select-workspace"){return selectWorkspace(a.dataset.orgId,a.dataset.garageId).catch(err=>toast(err.message||"Could not switch workspace"))}
  if(x==="demo"){state.demo=true;localStorage.setItem(DEMO_KEY,"true");loadDemo();closeModal();return render()}
  if(x==="close")return closeModal();
  if(x==="add"){state.catalogueResults=[];return addModal()}
  if(x==="catalogue-search-tab"||x==="web-search-tab"){
    const web=x==="web-search-tab";document.querySelector("#catalogue-pane")?.toggleAttribute("hidden",web);document.querySelector("#web-pane")?.toggleAttribute("hidden",!web);
    document.querySelectorAll(".discovery-tab").forEach(b=>b.classList.toggle("active",b.dataset.action===x));
    if(web&&!state.webResults.length){const q=document.querySelector("#q");if(q&&!q.value)q.value=state.webSport;searchGroundsWeb(q?.value)}return;
  }
  if(x==="web-sport"){
    state.webSport=a.dataset.sport||"golf";document.querySelectorAll(".sport-filter").forEach(b=>b.classList.toggle("active",b===a));
    const q=document.querySelector("#q");if(q)q.value=state.webSport;return searchGroundsWeb(q?.value);
  }
  if(x==="web-search")return searchGroundsWeb();
  if(x==="search-web-result"){
    const query=a.dataset.query||"";
    document.querySelector("#catalogue-pane")?.removeAttribute("hidden");document.querySelector("#web-pane")?.setAttribute("hidden","");
    document.querySelectorAll(".discovery-tab").forEach(b=>b.classList.toggle("active",b.dataset.action==="catalogue-search-tab"));
    const q=document.querySelector("#q");if(q&&query){q.value=query;search(query)}return;
  }
  if(x==="select"){const r=state.catalogueResults.find(v=>v.variant_id===a.dataset.id);if(r)machineModal(r);return}
  if(x==="accept-identified"){
    const pending=state.pendingIdentification,candidates=pending?.candidates||[],r=candidates[Number(a.dataset.index)];
    if(!r)return;
    closeModal();state.pendingIdentification=pending;machineModal(r);return;
  }
  if(x==="open"){state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;state.specs=[];return render()}
  if(x==="back"||x==="home")return setView("garage");
  if(x==="edit")return editModal();
  if(x==="hours")return hoursModal();
  if(x==="fault")return faultModal();
  if(x==="document-upload")return evidenceUploadModal("document");
  if(x==="photo-upload")return evidenceUploadModal("photo");
  if(x==="open-document")return openDocument(e.target.closest("[data-id]")?.dataset.id);
  if(x==="open-service-evidence")return openServiceEvidence(e.target.closest("[data-id]")?.dataset.id);
  if(x==="service-task")return serviceTaskModal(a.dataset.id);
  if(x==="service")return serviceModal();
  if(x==="unknown-machine")return unknownMachineModal();
  if(x==="search-identified"){const query=a.dataset.query||"";closeModal();addModal();const q=document.querySelector("#q");if(q){q.value=query;search(query);q.focus()}return}
  if(x==="signup")return signUp();
});
boot();

window.addEventListener("online",()=>{state.offline=false;syncOutbox()});
window.addEventListener("offline",()=>{state.offline=true;render()});
setInterval(()=>{if(navigator.onLine)syncOutbox()},15000);
