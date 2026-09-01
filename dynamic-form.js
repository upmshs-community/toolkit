(() => {
  const cfg = window.APP_CONFIG || {}, db = window.ToolkitOfflineDB, engine = window.ToolkitFormEngine;
  const loading = document.getElementById("dynamic-form-loading"), app = document.getElementById("dynamic-form-app");
  const formEl = document.getElementById("dynamic-field-form"), params = new URLSearchParams(location.search);
  let client=null,user=null,profile=null,rotation=null,template=null,schema={sections:[]};
  let localId=params.get("local_id")||crypto.randomUUID(),versionId=params.get("version_id"),currentRecord=null,saveTimer=null;const previewMode=params.get("preview")==="1";
  const objectUrls=new Map(), safe=engine.safe;
  const initials=name=>String(name).split(/[\s._-]+/).filter(Boolean).slice(0,2).map(v=>v[0]?.toUpperCase()).join("")||"UP";

  async function loadAuthContext(){
    if(window.supabase?.createClient&&cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY){
      client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
      const {data:s}=await client.auth.getSession(); user=s?.session?.user||null;
      if(user&&navigator.onLine){
        const [{data:p},{data:r}]=await Promise.all([
          client.from("profiles").select("email,full_name,status,role,batch,year_level").eq("id",user.id).maybeSingle(),
          client.from("rotation_assignments").select("id,community_id,course_code,rotation_type,batch,status,communities(name,province)")
            .eq("user_id",user.id).eq("status","active").order("created_at",{ascending:false}).limit(1)
        ]);
        if(p){profile=p;await db.setSetting("cached_profile",p)}
        if(r?.[0]){rotation=r[0];await db.setSetting("cached_rotation",rotation)}
      }
    }
    if(!profile)profile=await db.getSetting("cached_profile");
    if(!rotation)rotation=await db.getSetting("cached_rotation");
    if(!profile){
      if(!navigator.onLine){loading.innerHTML=`<strong>Offline session not prepared</strong><span>Open Field Forms once while signed in and online before fieldwork.</span><a href="index.html">Return to sign in</a>`;throw new Error("No cached profile")}
      location.replace("index.html");throw new Error("No profile");
    }
    if(profile.status&&profile.status!=="active"){location.replace("portal.html");throw new Error("Inactive profile")}
    const name=profile.full_name||profile.email||"Toolkit user";
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=profile.email||"");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));
    document.querySelectorAll("[data-sign-out]").forEach(btn=>btn.addEventListener("click",async()=>{if(client)await client.auth.signOut();location.replace("index.html")}));
  }

  function updateNetworkUI(){const online=navigator.onLine;document.getElementById("dynamic-network-dot").classList.toggle("online",online);document.getElementById("dynamic-network-text").textContent=online?"Online":"Offline"}
  const fieldId=f=>`field-${f.id||f.key}`;
  const options=f=>Array.isArray(f.options)?f.options:[];

  function renderField(f){
    const id=fieldId(f),req=f.required?'<span class="dynamic-required">*</span>':"",opts=options(f);let control="";
    if(f.type==="long_text")control=`<textarea id="${id}" data-field-key="${safe(f.key)}" rows="4" placeholder="${safe(f.placeholder||"")}"></textarea>`;
    else if(f.type==="number")control=`<input id="${id}" data-field-key="${safe(f.key)}" type="number" ${f.min!==""&&f.min!=null?`min="${safe(f.min)}"`:""} ${f.max!==""&&f.max!=null?`max="${safe(f.max)}"`:""} ${f.step?`step="${safe(f.step)}"`:""}>`;
    else if(f.type==="date")control=`<input id="${id}" data-field-key="${safe(f.key)}" type="date">`;
    else if(f.type==="yes_no")control=`<div class="dynamic-choice-row"><label><input data-field-key="${safe(f.key)}" type="radio" name="${safe(f.key)}" value="Yes"> Yes</label><label><input data-field-key="${safe(f.key)}" type="radio" name="${safe(f.key)}" value="No"> No</label></div>`;
    else if(f.type==="single_choice")control=`<div class="dynamic-choice-stack">${opts.map(o=>`<label><input data-field-key="${safe(f.key)}" type="radio" name="${safe(f.key)}" value="${safe(o)}"> ${safe(o)}</label>`).join("")}</div>`;
    else if(f.type==="multiple_choice")control=`<div class="dynamic-choice-stack">${opts.map(o=>`<label><input data-field-key="${safe(f.key)}" type="checkbox" name="${safe(f.key)}" value="${safe(o)}"> ${safe(o)}</label>`).join("")}</div>`;
    else if(f.type==="dropdown")control=`<select id="${id}" data-field-key="${safe(f.key)}"><option value="">Select…</option>${opts.map(o=>`<option value="${safe(o)}">${safe(o)}</option>`).join("")}</select>`;
    else if(f.type==="scale"){const min=Number.isFinite(Number(f.min))?Number(f.min):1,max=Number.isFinite(Number(f.max))?Number(f.max):5;control=`<div class="dynamic-scale-row">${Array.from({length:Math.max(1,max-min+1)},(_,i)=>min+i).map(v=>`<label><input data-field-key="${safe(f.key)}" type="radio" name="${safe(f.key)}" value="${v}"><span>${v}</span></label>`).join("")}</div>`}
    else if(f.type==="gps")control=`<div class="dynamic-capture-card"><button class="button button-outline-maroon" type="button" data-gps-key="${safe(f.key)}">📍 Capture Location</button><div class="dynamic-capture-readout" data-gps-readout="${safe(f.key)}">No location captured.</div></div>`;
    else if(f.type==="photo"||f.type==="file"){const accept=f.type==="photo"?'accept="image/*" capture="environment"':"";control=`<div class="dynamic-capture-card"><input class="dynamic-file-input" data-file-key="${safe(f.key)}" data-file-type="${safe(f.type)}" type="file" ${accept}><div class="dynamic-file-preview" data-file-preview="${safe(f.key)}">No file saved.</div></div>`}
    else if(f.type==="repeater"){control=`<div class="dynamic-repeater" data-repeater-key="${safe(f.key)}"><div class="dynamic-repeater-rows"></div><button class="button button-outline-maroon dynamic-add-row" type="button">+ Add row</button><script type="application/json" class="dynamic-repeater-config">${safe(JSON.stringify(Array.isArray(f.columns)?f.columns:[]))}</script></div>`}
    else control=`<input id="${id}" data-field-key="${safe(f.key)}" type="text" placeholder="${safe(f.placeholder||"")}">`;

    return `<div class="dynamic-field" data-field-wrapper="${safe(f.key)}" data-field-required="${f.required?"true":"false"}" data-condition='${safe(JSON.stringify(f.condition||null))}'>
      <label class="dynamic-field-label">${safe(f.label||f.key)} ${req}</label>${f.help?`<small class="dynamic-field-help">${safe(f.help)}</small>`:""}${control}<small class="dynamic-field-error" hidden></small></div>`;
  }

  function renderSchema(){
    const target=document.getElementById("dynamic-form-sections"),nav=document.getElementById("dynamic-section-nav");
    if(!schema.sections.length){target.innerHTML=`<section class="portal-panel dynamic-form-section"><div class="table-empty">This form has no published fields yet.</div></section>`;nav.innerHTML="";return}
    target.innerHTML=schema.sections.map((s,i)=>`<section id="section-${safe(s.id||i)}" class="portal-panel dynamic-form-section">
      <header class="dynamic-form-section-heading"><span>${String(i+1).padStart(2,"0")}</span><div><h2>${safe(s.title||`Section ${i+1}`)}</h2>${s.description?`<p>${safe(s.description)}</p>`:""}</div></header>
      <div class="dynamic-fields">${(s.fields||[]).map(renderField).join("")||'<div class="table-empty">No fields in this section.</div>'}</div></section>`).join("");
    nav.innerHTML=schema.sections.map((s,i)=>`<a href="#section-${safe(s.id||i)}">${i+1}. ${safe(s.title||"Section")}</a>`).join("");
    setupRepeaters();attachListeners();refreshConditions();
  }

  function repeaterCols(w){const t=w.querySelector(".dynamic-repeater-config");try{const x=document.createElement("textarea");x.innerHTML=t?.textContent||"[]";return JSON.parse(x.value||"[]")}catch{return[]}}
  function addRow(w,data={}){
    const row=document.createElement("div");row.className="dynamic-repeater-row";
    row.innerHTML=`<div class="dynamic-repeater-grid">${repeaterCols(w).map(c=>`<label><span>${safe(c.label||c.key)}</span><input data-repeater-col="${safe(c.key)}" type="${c.type==="number"?"number":c.type==="date"?"date":"text"}" value="${safe(data[c.key]??"")}"></label>`).join("")}</div><button class="dynamic-remove-row" type="button">×</button>`;
    w.querySelector(".dynamic-repeater-rows").appendChild(row);
    row.querySelectorAll("input").forEach(i=>{i.addEventListener("input",scheduleSave);i.addEventListener("change",scheduleSave)});
    row.querySelector(".dynamic-remove-row").addEventListener("click",()=>{row.remove();scheduleSave()});
  }
  function setupRepeaters(){document.querySelectorAll(".dynamic-repeater").forEach(w=>w.querySelector(".dynamic-add-row").addEventListener("click",()=>{addRow(w);scheduleSave()}))}
  function collectRepeater(w){return [...w.querySelectorAll(".dynamic-repeater-row")].map(r=>{const o={};r.querySelectorAll("[data-repeater-col]").forEach(i=>o[i.dataset.repeaterCol]=i.value);return o}).filter(o=>Object.values(o).some(v=>String(v||"").trim()!==""))}

  function collectResponses(){
    const r={...(currentRecord?.responses||{})};
    schema.sections.forEach(s=>(s.fields||[]).forEach(f=>{
      const k=f.key;if(!k)return;
      if(["gps","photo","file"].includes(f.type)){r[k]=currentRecord?.responses?.[k]||null;return}
      if(f.type==="repeater"){const w=document.querySelector(`[data-repeater-key="${CSS.escape(k)}"]`);r[k]=w?collectRepeater(w):[];return}
      const ins=[...formEl.querySelectorAll(`[data-field-key="${CSS.escape(k)}"]`)];if(!ins.length)return;
      if(f.type==="multiple_choice")r[k]=ins.filter(i=>i.checked).map(i=>i.value);
      else if(["single_choice","yes_no","scale"].includes(f.type))r[k]=ins.find(i=>i.checked)?.value||"";
      else r[k]=ins[0].value;
    }));return r;
  }

  function conditionMet(c,res){if(!c?.field_key)return true;const v=res[c.field_key],e=c.value??"";if(c.operator==="not_equals")return String(v??"")!==String(e);if(c.operator==="contains")return Array.isArray(v)?v.map(String).includes(String(e)):String(v??"").includes(String(e));if(c.operator==="answered")return Array.isArray(v)?v.length>0:v!=null&&String(v).trim()!=="";return String(v??"")===String(e)}
  function refreshConditions(){const r=collectResponses();document.querySelectorAll("[data-field-wrapper]").forEach(w=>{let c=null;try{c=JSON.parse(w.dataset.condition||"null")}catch{}const show=conditionMet(c,r);w.hidden=!show})}

  async function restore(){
    const r=currentRecord?.responses||{};
    for(const s of schema.sections)for(const f of s.fields||[]){
      const k=f.key,v=r[k];
      if(f.type==="gps"){renderGps(k,v);continue}
      if(f.type==="photo"||f.type==="file"){await renderFile(k);continue}
      if(f.type==="repeater"){const w=document.querySelector(`[data-repeater-key="${CSS.escape(k)}"]`);if(w){w.querySelector(".dynamic-repeater-rows").innerHTML="";(Array.isArray(v)?v:[]).forEach(x=>addRow(w,x))}continue}
      const ins=[...formEl.querySelectorAll(`[data-field-key="${CSS.escape(k)}"]`)];if(!ins.length)continue;
      if(f.type==="multiple_choice"){const vals=Array.isArray(v)?v.map(String):[];ins.forEach(i=>i.checked=vals.includes(String(i.value)))}
      else if(["single_choice","yes_no","scale"].includes(f.type))ins.forEach(i=>i.checked=String(i.value)===String(v??""));
      else ins[0].value=v??"";
    }
    refreshConditions();
  }

  function renderGps(k,g){const t=document.querySelector(`[data-gps-readout="${CSS.escape(k)}"]`);if(!t)return;if(!g?.latitude){t.textContent="No location captured.";return}t.innerHTML=`<strong>Location captured ✓</strong><span>${Number(g.latitude).toFixed(6)}, ${Number(g.longitude).toFixed(6)}</span><small>${g.accuracy?`Accuracy ±${Math.round(g.accuracy)} m`:"Accuracy not reported"}</small>`}
  async function captureGps(k,b){if(!navigator.geolocation)return alert("Geolocation is not supported on this device/browser.");b.disabled=true;b.textContent="Getting location…";navigator.geolocation.getCurrentPosition(async p=>{currentRecord.responses=collectResponses();currentRecord.responses[k]={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,altitude:p.coords.altitude,captured_at:new Date().toISOString()};renderGps(k,currentRecord.responses[k]);await saveLocal();b.disabled=false;b.textContent="📍 Retake Location"},e=>{alert(`Unable to capture location: ${e.message}`);b.disabled=false;b.textContent="📍 Capture Location"},{enableHighAccuracy:true,timeout:20000,maximumAge:0})}
  async function saveFile(k,file,type){if(!file)return;if(file.size>8*1024*1024)return alert("Please use a file under 8 MB.");await db.putMedia({local_media_id:`${localId}:${k}`,local_uuid:localId,field_key:k,media_type:type,file_name:file.name||"attachment",content_type:file.type||"application/octet-stream",blob:file,updated_at:new Date().toISOString()});currentRecord.responses=collectResponses();currentRecord.responses[k]={file_name:file.name||"attachment",content_type:file.type||"application/octet-stream",local:true};await renderFile(k);await saveLocal()}
  async function renderFile(k){const t=document.querySelector(`[data-file-preview="${CSS.escape(k)}"]`);if(!t)return;const m=await db.getMedia(`${localId}:${k}`),old=objectUrls.get(k);if(old)URL.revokeObjectURL(old);if(!m?.blob){const info=currentRecord?.responses?.[k];t.textContent=info?.file_name?`Saved: ${info.file_name}`:"No file saved.";return}if((m.content_type||"").startsWith("image/")){const u=URL.createObjectURL(m.blob);objectUrls.set(k,u);t.innerHTML=`<img src="${u}" alt="Saved field attachment"><small>${safe(m.file_name)}</small>`}else t.innerHTML=`<strong>${safe(m.file_name)}</strong><small>Saved on this device.</small>`}

  function attachListeners(){
    formEl.querySelectorAll("input,select,textarea").forEach(i=>{if(i.classList.contains("dynamic-file-input"))return;i.addEventListener("input",()=>{refreshConditions();scheduleSave()});i.addEventListener("change",()=>{refreshConditions();scheduleSave()})});
    formEl.querySelectorAll("[data-gps-key]").forEach(b=>b.addEventListener("click",()=>captureGps(b.dataset.gpsKey,b)));
    formEl.querySelectorAll("[data-file-key]").forEach(i=>i.addEventListener("change",()=>saveFile(i.dataset.fileKey,i.files?.[0],i.dataset.fileType)));
  }

  async function saveLocal(status=null){
    if(previewMode)return currentRecord;
    const now=new Date().toISOString(),media=await db.getMediaForSubmission(localId);
    currentRecord={...(currentRecord||{}),local_uuid:localId,dynamic_form_id:template.form_id,dynamic_form_version_id:template.version_id,form_code:template.form_code,form_title:template.title,form_version:template.version_label||String(template.version_number),version_number:template.version_number,form_status:status||currentRecord?.form_status||"draft",sync_status:"pending",server_id:currentRecord?.server_id||null,user_id:user?.id||currentRecord?.user_id||null,rotation_id:rotation?.id||currentRecord?.rotation_id||null,community_id:rotation?.community_id||currentRecord?.community_id||null,community_name:rotation?.communities?.name||currentRecord?.community_name||null,responses:collectResponses(),has_media:media.some(x=>!!x?.blob),created_at:currentRecord?.created_at||now,updated_at:now,last_error:null};
    await db.putSubmission(currentRecord);setSave("Saved locally","pending");return currentRecord;
  }
  function setSave(t,state="pending",detail=""){document.getElementById("dynamic-save-status").textContent=t;document.getElementById("dynamic-bottom-save").textContent=t;document.getElementById("dynamic-bottom-detail").textContent=detail||(state==="synced"?"Latest changes are synchronized to the Toolkit.":state==="error"?"The form remains safely saved on this device.":"Draft remains on this device until synchronization succeeds.")}
  function scheduleSave(){clearTimeout(saveTimer);setSave("Saving…");saveTimer=setTimeout(()=>saveLocal().catch(console.error),500)}
  function validate(){
    const responses=collectResponses();let first=null,ok=true;
    document.querySelectorAll("[data-field-wrapper]").forEach(w=>{const e=w.querySelector(".dynamic-field-error");e.hidden=true;w.classList.remove("has-error");if(w.hidden||w.dataset.fieldRequired!=="true")return;const k=w.dataset.fieldWrapper,f=schema.sections.flatMap(s=>s.fields||[]).find(x=>x.key===k),v=responses[k];let a=true;if(["multiple_choice","repeater"].includes(f?.type))a=Array.isArray(v)&&v.length>0;else if(f?.type==="gps")a=!!v?.latitude;else if(["photo","file"].includes(f?.type))a=!!v?.file_name;else a=v!=null&&String(v).trim()!=="";if(!a){ok=false;w.classList.add("has-error");e.textContent="This field is required.";e.hidden=false;if(!first)first=w}});
    if(first)first.scrollIntoView({behavior:"smooth",block:"center"});return ok;
  }
  async function syncCurrent(){if(!navigator.onLine||!client){setSave("Saved offline","pending","No internet connection. Sync can be retried later.");return}try{setSave("Syncing…");currentRecord=await engine.syncDynamicRecord({client,db,record:currentRecord});setSave("Synced ✓","synced")}catch(e){currentRecord={...currentRecord,sync_status:"error",last_error:e.message||String(e),updated_at:new Date().toISOString()};await db.putSubmission(currentRecord);setSave("Saved locally","error",currentRecord.last_error)}}
  async function complete(){if(!validate())return alert("Please complete the required visible fields first.");await saveLocal("completed");await syncCurrent()}

  async function load(){
    if(!versionId&&params.get("local_id"))versionId=(await db.getSubmission(localId))?.dynamic_form_version_id||null;
    if(!versionId)throw new Error("No form version was specified.");
    template=await engine.fetchVersion(client,db,versionId);if(!template)throw new Error("This form is not cached on this device. Open Field Forms once while online first.");
    schema=engine.normalizeSchema(template.schema_json);
    currentRecord=previewMode?null:await db.getSubmission(localId);
    if(!currentRecord){currentRecord={local_uuid:localId,dynamic_form_id:template.form_id,dynamic_form_version_id:template.version_id,form_code:template.form_code,form_title:template.title,form_version:template.version_label||String(template.version_number),version_number:template.version_number,form_status:"draft",sync_status:"pending",user_id:user?.id||null,rotation_id:rotation?.id||null,community_id:rotation?.community_id||null,community_name:rotation?.communities?.name||null,responses:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()};if(!previewMode)await db.putSubmission(currentRecord)}
    document.title=`${template.title} | Community Health Toolkit`;document.getElementById("dynamic-header-title").textContent=template.title;document.getElementById("dynamic-form-category").textContent=template.category||"SHS Field Form";document.getElementById("dynamic-form-title").textContent=template.title;document.getElementById("dynamic-form-description").textContent=template.description||"";document.getElementById("dynamic-form-code").textContent=template.form_code;document.getElementById("dynamic-form-version").textContent=template.version_label||`Version ${template.version_number}`;document.getElementById("dynamic-form-community").textContent=previewMode?"Preview mode":(rotation?.communities?.name||currentRecord.community_name||"No active community");renderSchema();await restore();if(previewMode){document.getElementById("dynamic-save-btn").hidden=true;document.getElementById("dynamic-complete-btn").hidden=true;setSave("Preview only","synced","No response is saved or submitted from Form Builder preview.")}else setSave(currentRecord.sync_status==="synced"?"Synced ✓":"Saved locally",currentRecord.sync_status||"pending",currentRecord.last_error||"");
  }

  async function init(){try{updateNetworkUI();window.addEventListener("online",updateNetworkUI);window.addEventListener("offline",updateNetworkUI);if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.warn);await db.openDB();await loadAuthContext();await load();document.getElementById("dynamic-save-btn").addEventListener("click",()=>saveLocal());document.getElementById("dynamic-complete-btn").addEventListener("click",complete);loading.hidden=true;app.hidden=false;document.body.classList.remove("portal-is-loading")}catch(e){console.error("[Dynamic Form]",e);loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open this field form</strong><span>${safe(e.message||e)}</span><a href="field-forms.html">Return to Field Forms</a>`}}
  init();
})();