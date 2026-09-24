
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CONFIG_KEY="reelmow.connection.v1", DEMO_KEY="reelmow.demo.v1";
const app=document.querySelector("#app");
const demoCatalogue=[{model_id:"830038a1-6367-4beb-87f1-f692c98dc9ef",manufacturer_name:"Jacobsen",model_name:"LF3800",variant_id:"c7834745-3328-4d30-ae8a-bb35f7798848",variant_name:"LF3800 5-Gang",machine_type:"Cylinder Mower",rank:1}];
const state={client:null,user:null,org:null,garage:null,machines:[],selected:null,specs:[],catalogueResults:[],loading:false,error:"",demo:localStorage.getItem(DEMO_KEY)==="true"};

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=s=>document.querySelector(s)?.value.trim()||"";
const num=s=>{const v=document.querySelector(s)?.value;return v===""||v==null?null:Number(v)};
const slug=v=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);
const initials=v=>(v||"RE").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
const cfg=()=>{try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||"null")}catch{return null}};
const connected=()=>{const c=cfg();return !!(c?.url&&c?.key)};
function toast(t){document.querySelector(".toast")?.remove();const e=document.createElement("div");e.className="toast";e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2600)}
function modal(h){document.querySelector(".modal-backdrop")?.remove();document.body.insertAdjacentHTML("beforeend",h)}
function closeModal(){document.querySelector(".modal-backdrop")?.remove()}

async function connect(){
  if(state.demo)return;
  const c=cfg();if(!c?.url||!c?.key)return;
  state.client=createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data,error}=await state.client.auth.getSession();if(error)throw error;
  state.user=data.session?.user||null;
  state.client.auth.onAuthStateChange((_e,s)=>{state.user=s?.user||null;render()});
}
async function boot(){
  try{await connect();if(state.demo){loadDemo();return render()}if(!connected()||!state.user)return render();await loadWorkspace();render()}
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
  const {data,error}=await state.client.schema("garage").from("machines").select("id,garage_id,machine_variant_id,serial_number,asset_number,nickname,purchase_date,current_engine_hours,current_reel_hours,status,created_at").eq("garage_id",state.garage.id).order("created_at",{ascending:false});if(error)throw error;
  const rows=data||[];if(!rows.length){state.machines=[];return}
  const vids=rows.map(x=>x.machine_variant_id).filter(Boolean);
  const {data:v,error:ve}=await state.client.schema("catalogue").from("machine_variants").select("id,variant_name,machine_model_id").in("id",vids);if(ve)throw ve;
  const mids=(v||[]).map(x=>x.machine_model_id);
  const {data:mo,error:me}=mids.length?await state.client.schema("catalogue").from("machine_models").select("id,model_name,model_code,manufacturer_id").in("id",mids):{data:[]};if(me)throw me;
  const fids=(mo||[]).map(x=>x.manufacturer_id);
  const {data:f,error:fe}=fids.length?await state.client.schema("catalogue").from("manufacturers").select("id,name").in("id",fids):{data:[]};if(fe)throw fe;
  const vm=new Map((v||[]).map(x=>[x.id,x])),mm=new Map((mo||[]).map(x=>[x.id,x])),fm=new Map((f||[]).map(x=>[x.id,x]));
  state.machines=rows.map(x=>{const vv=vm.get(x.machine_variant_id),model=vv&&mm.get(vv.machine_model_id),man=model&&fm.get(model.manufacturer_id);return {...x,variant:vv,model,manufacturer:man}});
}
async function search(q){
  const box=document.querySelector("#results");if(!q.trim()){box.innerHTML="<p class='tiny'>Try <b>LF3800</b>.</p>";return}
  state.loading=true;box.innerHTML="<div class='loading'><div class='spinner'></div>Searching catalogue…</div>";
  try{
    if(state.demo)state.catalogueResults=demoCatalogue.filter(x=>[x.manufacturer_name,x.model_name,x.variant_name].some(v=>v.toLowerCase().includes(q.toLowerCase())));
    else{const {data,error}=await state.client.schema("catalogue").rpc("search_machines",{search_text:q.trim(),result_limit:12});if(error)throw error;state.catalogueResults=data||[]}
    box.innerHTML=state.catalogueResults.length?state.catalogueResults.map(r=>"<button class='result' data-action='select' data-id='"+esc(r.variant_id)+"'><div><div class='result-name'>"+esc(r.manufacturer_name)+" "+esc(r.model_name)+"</div><div class='result-meta'>"+esc(r.variant_name||"Model")+" · "+esc(r.machine_type||"Machine")+"</div></div><span class='arrow'>›</span></button>").join(""):"<p class='tiny'>No catalogue matches.</p>";
  }catch(e){box.innerHTML="<div class='error'>"+esc(e.message||"Search failed")+"</div>"}finally{state.loading=false}
}
function shell(c){
  const ok=state.demo||connected();
  return "<div class='shell'><header class='topbar'><div class='brand'><span class='mark'></span>REEL<span>MOW</span></div><div class='top-actions'><button class='btn ghost small' data-action='connection'><span class='dot "+(ok?"ok":"")+"'></span>"+(ok?"Connected":"Connect")+"</button>"+(state.user?"<div class='avatar'>"+esc(initials(state.user.email))+"</div>":"")+"</div></header><main class='page'>"+c+"</main><div class='footer'>REELMOW Garage · Every machine. Every manual. Every service. One place.</div></div>"
}
function mount(c){app.innerHTML="<div class='app'>"+shell(c)+"</div>"}
function render(){
  if(!state.demo&&!connected())return renderConnect();
  if(!state.demo&&!state.user)return renderAuth();
  if(!state.demo&&!state.org)return renderOrg();
  if(!state.demo&&!state.garage)return renderGarageSetup();
  if(state.selected)return renderDetail();
  renderGarage();
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
function renderGarage(){
  const list=state.machines;
  mount("<section class='hero'><div class='hero-card'><div class='hero-copy'><div class='eyebrow'>"+esc(state.demo?"Demo Garage":state.org?.name||"Garage")+"</div><h1>Every machine.<br>One Garage.</h1><p class='lede' style='color:#d2e1d8'>Your machinery, manuals, specifications and service history in one place.</p><div class='actions' style='margin-top:23px'><button class='btn' data-action='add'>＋ Add machine</button></div></div></div><div class='hero-stat'><div><div class='stat-num'>"+list.length+"</div><div class='stat-label'>Machines in "+esc(state.garage?.name||"your Garage")+"</div></div><div class='tiny'>"+esc(state.garage?.location_name||"Digital machinery record")+"</div></div></section><div class='section-head'><div><div class='eyebrow'>Garage</div><h2>Your machinery</h2></div><button class='btn secondary small' data-action='add'>Add machine</button></div>"+(list.length?"<div class='grid'>"+list.map(card).join("")+"</div>":"<div class='card empty'><div class='empty-icon'>⚙︎</div><h2>Your Garage is empty.</h2><p class='lede' style='margin:0 auto 18px'>Start by adding a machine from the REELMOW catalogue.</p><button class='btn' data-action='add'>Add your first machine</button></div>"))
}
function renderDetail(){
  const m=state.selected;
  mount("<button class='back' data-action='back'>← Garage</button><section class='detail-head'><div class='machine-title'><div class='machine-title-icon'>⚙︎</div><div><div class='eyebrow'>"+esc(m.manufacturer?.name||"Manufacturer")+"</div><h1 style='font-size:38px;margin-bottom:5px'>"+esc(m.model?.model_name||"Machine")+"</h1><p class='muted'>"+esc(m.variant?.variant_name||"Variant")+"</p></div></div><div class='actions'><span class='badge "+(m.status==="service_due"?"service":"ready")+"'>"+esc((m.status||"ready").replaceAll("_"," "))+"</span></div></section><div class='detail-grid'><div><div class='card'><div class='section-head' style='margin:0 0 12px'><div><div class='eyebrow'>Machine health</div><h2>At a glance</h2></div><button class='btn secondary small' data-action='edit'>Edit</button></div><div class='metric-row'><div class='metric'><div class='num'>"+(m.current_engine_hours??"—")+"</div><div class='label'>Engine hours</div></div><div class='metric'><div class='num'>"+(m.current_reel_hours??"—")+"</div><div class='label'>Reel hours</div></div></div><div class='list'><div class='list-row'><div><div class='list-title'>Serial number</div><div class='list-meta'>"+esc(m.serial_number||"Not recorded")+"</div></div></div><div class='list-row'><div><div class='list-title'>Asset number</div><div class='list-meta'>"+esc(m.asset_number||"Not recorded")+"</div></div></div><div class='list-row'><div><div class='list-title'>Purchase date</div><div class='list-meta'>"+esc(m.purchase_date||"Not recorded")+"</div></div></div></div></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Catalogue specifications</div><h2>Known machine data</h2><div id='specs'><div class='loading'><div class='spinner'></div>Loading verified specifications…</div></div></div></div><div><div class='card'><div class='eyebrow'>Service</div><h2>Keep it maintained.</h2><p class='tiny'>Service history belongs to the physical machine.</p><div class='note' style='margin-top:13px'>Verified maintenance rules will drive service reminders as they are published.</div><button class='btn secondary' style='width:100%;margin-top:12px' data-action='service'>View service history</button></div><div class='card' style='margin-top:15px'><div class='eyebrow'>Documents</div><h2>Machine knowledge</h2><div class='list'><div class='list-row'><div><div class='list-title'>Operator manual</div><div class='list-meta'>Manufacturer source linked to catalogue</div></div><span>→</span></div><div class='list-row'><div><div class='list-title'>Parts</div><div class='list-meta'>Verified fitments will appear here</div></div><span>→</span></div></div></div></div></div>");
  loadSpecs(m)
}
function specsHtml(){
  return "<div class='spec-grid'>"+state.specs.map(s=>"<div class='spec'><div class='v'>"+esc(s.value_text??s.value_number??"—")+(s.unit?" "+esc(s.unit):"")+"</div><div class='k'>"+esc(s.label)+"</div></div>").join("")+"</div>"
}
async function loadSpecs(m){
  if(state.demo){state.specs=[{label:"Cutting width",value_number:2.54,unit:"m"},{label:"Number of reels",value_number:5,unit:"count"},{label:"Reel diameter",value_number:178,unit:"mm"},{label:"Reel width",value_number:559,unit:"mm"},{label:"Minimum height of cut",value_number:9.5,unit:"mm"},{label:"Maximum height of cut",value_number:29,unit:"mm"},{label:"Reel blades",value_text:"9 or 11"},{label:"Fuel",value_text:"Diesel"},{label:"Engine",value_text:"Kubota"}]}
  else{const {data,error}=await state.client.schema("catalogue").from("facts").select("value_text,value_number,unit,spec_definition_id").eq("machine_model_id",m.model.id).eq("status","active");if(error)return toast(error.message);const ids=(data||[]).map(x=>x.spec_definition_id);const {data:d,error:de}=ids.length?await state.client.schema("catalogue").from("spec_definitions").select("id,label").in("id",ids):{data:[]};if(de)return toast(de.message);const map=new Map((d||[]).map(x=>[x.id,x.label]));state.specs=(data||[]).map(x=>({...x,label:map.get(x.spec_definition_id)||"Specification"}))}
  const box=document.querySelector("#specs");if(box)box.innerHTML=state.specs.length?specsHtml():"<p class='tiny'>No verified specifications available.</p>"
}
function addModal(){
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Add machine</div><h2>Find it in the catalogue.</h2><p class='tiny'>Search manufacturer, model or variant.</p></div><button class='close' data-action='close'>×</button></div><div class='search-wrap'><span class='search-icon'>⌕</span><input id='q' class='search' placeholder='Search manufacturer or model…'></div><div id='results' class='result-list'><p class='tiny'>Try <b>LF3800</b>.</p></div></div></div>");
  const q=document.querySelector("#q");let t;q.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(()=>search(q.value),220)});q.focus()
}
function machineModal(r){
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Physical machine</div><h2>"+esc(r.manufacturer_name)+" "+esc(r.model_name)+"</h2><p class='tiny'>"+esc(r.variant_name||"Variant")+" · REELMOW catalogue</p></div><button class='close' data-action='close'>×</button></div><form id='machine-form'><div class='field'><label>Serial number</label><input class='input' id='serial'></div><div class='field'><label>Asset number</label><input class='input' id='asset'></div><div class='field'><label>Nickname</label><input class='input' id='nickname' placeholder='e.g. Main Outfield Mower'></div><div class='grid two'><div class='field'><label>Purchase date</label><input class='input' id='date' type='date'></div><div class='field'><label>Engine hours</label><input class='input' id='hours' type='number' min='0' step='.1'></div></div><div class='field'><label>Reel hours</label><input class='input' id='reel' type='number' min='0' step='.1'></div><div class='note'>This physical asset will be linked to the verified catalogue variant.</div><button class='btn' style='width:100%;margin-top:14px'>Add to Garage</button></form></div></div>");
  document.querySelector("#machine-form").addEventListener("submit",e=>saveMachine(e,r))
}
async function saveMachine(e,r){
  e.preventDefault();
  const p={garage_id:state.garage.id,machine_variant_id:r.variant_id,serial_number:val("#serial"),asset_number:val("#asset"),nickname:val("#nickname"),purchase_date:val("#date")||null,current_engine_hours:num("#hours"),current_reel_hours:num("#reel"),created_by:state.user?.id||null};
  if(state.demo){state.machines.unshift({...p,id:crypto.randomUUID(),status:"ready",variant:{variant_name:r.variant_name},model:{model_name:r.model_name},manufacturer:{name:r.manufacturer_name}});closeModal();toast("Machine added to Garage");return render()}
  try{const {error}=await state.client.schema("garage").from("machines").insert(p);if(error)throw error;closeModal();await loadMachines();toast("Machine added to Garage");render()}catch(x){toast(x.message||"Could not add machine")}
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
  modal("<div class='modal-backdrop'><div class='modal'><div class='modal-head'><div><div class='eyebrow'>Supabase connection</div><h2>Connect REELMOW.</h2><p class='tiny'>Use the project URL and public anon key. Never use a service-role key in the browser.</p></div><button class='close' data-action='close'>×</button></div><form id='connect-form'><div class='field'><label>Project URL</label><input class='input' id='sb-url' value='"+esc(c.url)+"' placeholder='https://your-project.supabase.co' required></div><div class='field'><label>Anon public key</label><input class='input' id='sb-key' value='"+esc(c.key)+"' placeholder='eyJ...' required></div><div class='note'>The public anon key is stored locally by this prototype. RLS remains the database security boundary.</div><div class='actions' style='margin-top:15px'><button class='btn'>Connect</button><button class='btn secondary' type='button' data-action='demo'>Preview demo</button></div></form></div></div>");
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
  if(x==="connection")return connectionModal();
  if(x==="demo"){state.demo=true;localStorage.setItem(DEMO_KEY,"true");loadDemo();closeModal();return render()}
  if(x==="close")return closeModal();
  if(x==="add"){state.catalogueResults=[];return addModal()}
  if(x==="select"){const r=state.catalogueResults.find(v=>v.variant_id===a.dataset.id);if(r)machineModal(r);return}
  if(x==="open"){state.selected=state.machines.find(v=>v.id===a.dataset.id)||null;state.specs=[];return render()}
  if(x==="back"){state.selected=null;state.specs=[];return render()}
  if(x==="edit")return toast("Machine editing is next.");
  if(x==="service")return toast("Service history is the next Garage module.");
  if(x==="signup")return signUp();
});
boot();
