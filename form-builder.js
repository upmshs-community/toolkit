(() => {
  const cfg=window.APP_CONFIG||{},engine=window.ToolkitFormEngine;
  const loading=document.getElementById("form-builder-loading"),app=document.getElementById("form-builder-app");
  let client,user,profile,forms=[],communities=[],versions=[],assignments=[],selectedForm=null,selectedVersion=null,workingSchema={sections:[]},saveTimer=null;
  const roles=["admin","coordinator","faculty"],safe=engine.safe;
  const fieldTypes=[["short_text","Short text"],["long_text","Long text"],["number","Number"],["date","Date"],["yes_no","Yes / No"],["single_choice","Single choice"],["multiple_choice","Multiple choice"],["dropdown","Dropdown"],["scale","Scale"],["gps","GPS location"],["photo","Photo"],["file","File"],["repeater","Repeating rows"]];
  const initials=n=>String(n||"UP").split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"UP";
  const uid=p=>`${p}_${crypto.randomUUID().replaceAll("-","").slice(0,10)}`;

  function normalize(schema){
    return {sections:(Array.isArray(schema?.sections)?schema.sections:[]).map(s=>({
      id:s.id||uid("section"),title:s.title||"Untitled Section",description:s.description||"",
      fields:(Array.isArray(s.fields)?s.fields:[]).map(f=>({
        id:f.id||uid("field"),key:f.key||uid("field"),label:f.label||"Untitled field",type:f.type||"short_text",
        required:!!f.required,help:f.help||"",placeholder:f.placeholder||"",options:Array.isArray(f.options)?f.options:[],
        min:f.min??"",max:f.max??"",step:f.step??"",columns:Array.isArray(f.columns)?f.columns:[],condition:f.condition||null
      }))
    }))};
  }

  async function authorize(){
    if(!window.supabase?.createClient||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw new Error("Supabase configuration is missing.");
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:a,error:ae}=await client.auth.getUser();user=a?.user;if(ae||!user)return location.replace("index.html");
    const {data:p,error}=await client.from("profiles").select("email,full_name,role,status").eq("id",user.id).single();
    if(error||!p||p.status!=="active"||!roles.includes(String(p.role)))return location.replace("portal.html");
    profile=p;const name=p.full_name||p.email||user.email||"Form Manager";
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||user.email||"");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));
    document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html")}));
  }

  async function loadReferenceData(){
    const [{data:f,error:fe},{data:c,error:ce}]=await Promise.all([
      client.from("dynamic_forms").select("*").neq("status","archived").order("title"),
      client.from("communities").select("id,name,is_active").eq("is_active",true).order("name")
    ]);
    if(fe){if(/does not exist|schema cache/i.test(fe.message||""))throw new Error("Form Builder database is not installed yet. Run phase7d-form-builder.sql first.");throw fe}
    if(ce)throw ce;forms=f||[];communities=c||[];
    document.getElementById("assignment-community").innerHTML='<option value="">Any community</option>'+communities.map(x=>`<option value="${safe(x.id)}">${safe(x.name)}</option>`).join("");
    renderCatalog();
  }

  function renderCatalog(){
    const t=document.getElementById("form-catalog");
    if(!forms.length){t.innerHTML='<div class="table-empty">No dynamic forms yet. Create the first one.</div>';return}
    t.innerHTML=forms.map(f=>`<button class="form-catalog-item ${selectedForm?.id===f.id?"active":""}" type="button" data-form-id="${safe(f.id)}"><span>${safe(f.code)}</span><strong>${safe(f.title)}</strong><small>${safe(f.category||"SHS field form")}</small></button>`).join("");
    t.querySelectorAll("[data-form-id]").forEach(b=>b.addEventListener("click",()=>selectForm(b.dataset.formId)));
  }

  async function selectForm(id){
    selectedForm=forms.find(f=>f.id===id)||null;if(!selectedForm)return;renderCatalog();
    const [v,a]=await Promise.all([
      client.from("dynamic_form_versions").select("*").eq("form_id",id).order("version_number",{ascending:false}),
      client.from("dynamic_form_assignments").select("*").eq("form_id",id).eq("is_active",true).order("created_at")
    ]);
    if(v.error)throw v.error;if(a.error)throw a.error;
    versions=v.data||[];assignments=a.data||[];
    selectedVersion=versions.find(x=>x.status==="draft")||versions.find(x=>x.status==="published")||versions[0]||null;
    workingSchema=normalize(selectedVersion?.schema_json);renderEditor();renderAssignments();
  }

  function renderEditor(){
    document.getElementById("form-empty-state").hidden=!!selectedForm;document.getElementById("form-editor").hidden=!selectedForm;if(!selectedForm)return;
    document.getElementById("editor-form-code").textContent=selectedForm.code;document.getElementById("editor-form-title").textContent=selectedForm.title;
    document.getElementById("editor-form-description").textContent=selectedForm.description||"";
    document.getElementById("prop-title").value=selectedForm.title||"";document.getElementById("prop-code").value=selectedForm.code||"";
    document.getElementById("prop-category").value=selectedForm.category||"";document.getElementById("prop-description").value=selectedForm.description||"";
    document.getElementById("version-select").innerHTML=versions.map(v=>`<option value="${safe(v.id)}" ${v.id===selectedVersion?.id?"selected":""}>${safe(v.version_label||`Version ${v.version_number}`)} · ${safe(v.status)}</option>`).join("");
    const draft=selectedVersion?.status==="draft",status=document.getElementById("version-status");
    status.textContent=selectedVersion?.status||"No version";status.className=`form-version-status status-${selectedVersion?.status||"none"}`;
    document.getElementById("published-version-note").hidden=draft;document.getElementById("add-section-btn").disabled=!draft;
    document.getElementById("publish-version-btn").disabled=!draft;document.getElementById("new-version-btn").disabled=!selectedVersion||draft;
    renderSections();
  }

  function fieldEditor(f,s,i,editable){
    const typeOptions=fieldTypes.map(([v,l])=>`<option value="${v}" ${f.type===v?"selected":""}>${l}</option>`).join("");
    const choice=["single_choice","multiple_choice","dropdown"].includes(f.type),numeric=["number","scale"].includes(f.type),repeat=f.type==="repeater",cond=f.condition||{};
    return `<div class="builder-field-card">
      <div class="builder-field-order"><button type="button" data-field-up="${s}:${i}" ${!editable||i===0?"disabled":""}>↑</button><button type="button" data-field-down="${s}:${i}" ${!editable||i===workingSchema.sections[s].fields.length-1?"disabled":""}>↓</button></div>
      <div class="builder-field-main">
        <div class="builder-field-row">
          <label><span>Question / label</span><input data-field-prop="${s}:${i}:label" value="${safe(f.label)}" ${editable?"":"disabled"}></label>
          <label><span>Type</span><select data-field-prop="${s}:${i}:type" ${editable?"":"disabled"}>${typeOptions}</select></label>
          <label><span>Field key</span><input data-field-prop="${s}:${i}:key" value="${safe(f.key)}" ${editable?"":"disabled"}></label>
        </div>
        <div class="builder-field-row secondary"><label><span>Helper text</span><input data-field-prop="${s}:${i}:help" value="${safe(f.help||"")}" ${editable?"":"disabled"}></label><label class="builder-required-check"><input data-field-required="${s}:${i}" type="checkbox" ${f.required?"checked":""} ${editable?"":"disabled"}><span>Required</span></label></div>
        <div class="builder-type-config ${choice?"":"is-hidden"}"><label><span>Choices · one option per line</span><textarea data-field-options="${s}:${i}" rows="3" ${editable?"":"disabled"}>${safe((f.options||[]).join("\n"))}</textarea></label></div>
        <div class="builder-type-config ${numeric?"":"is-hidden"}"><label><span>Minimum</span><input data-field-prop="${s}:${i}:min" type="number" value="${safe(f.min??"")}" ${editable?"":"disabled"}></label><label><span>Maximum</span><input data-field-prop="${s}:${i}:max" type="number" value="${safe(f.max??"")}" ${editable?"":"disabled"}></label><label><span>Step</span><input data-field-prop="${s}:${i}:step" type="number" value="${safe(f.step??"")}" ${editable?"":"disabled"}></label></div>
        <div class="builder-type-config ${repeat?"":"is-hidden"}"><label><span>Columns · key | Label | text/number/date</span><textarea data-field-columns="${s}:${i}" rows="4" ${editable?"":"disabled"}>${safe((f.columns||[]).map(c=>`${c.key} | ${c.label} | ${c.type||"text"}`).join("\n"))}</textarea></label></div>
        <details class="builder-condition-box"><summary>Conditional display</summary><div class="builder-condition-grid">
          <label><span>Depends on field key</span><input data-condition-prop="${s}:${i}:field_key" value="${safe(cond.field_key||"")}" ${editable?"":"disabled"}></label>
          <label><span>Rule</span><select data-condition-prop="${s}:${i}:operator" ${editable?"":"disabled"}><option value="equals" ${!cond.operator||cond.operator==="equals"?"selected":""}>Equals</option><option value="not_equals" ${cond.operator==="not_equals"?"selected":""}>Does not equal</option><option value="contains" ${cond.operator==="contains"?"selected":""}>Contains</option><option value="answered" ${cond.operator==="answered"?"selected":""}>Is answered</option></select></label>
          <label><span>Value</span><input data-condition-prop="${s}:${i}:value" value="${safe(cond.value||"")}" ${editable?"":"disabled"}></label>
        </div></details>
      </div>
      <button class="builder-delete-field danger" type="button" data-delete-field="${s}:${i}" ${editable?"":"disabled"}>×</button>
    </div>`;
  }

  function renderSections(){
    const t=document.getElementById("section-builder");if(!selectedVersion){t.innerHTML='<div class="table-empty">No version exists.</div>';return}
    if(!workingSchema.sections.length){t.innerHTML='<article class="portal-panel builder-no-sections"><strong>No sections yet.</strong><span>Add the first section to begin building.</span></article>';return}
    const editable=selectedVersion.status==="draft";
    t.innerHTML=workingSchema.sections.map((s,i)=>`<article class="portal-panel builder-section-card">
      <header class="builder-section-header">
        <div class="builder-order-controls"><button data-section-up="${i}" ${!editable||i===0?"disabled":""}>↑</button><button data-section-down="${i}" ${!editable||i===workingSchema.sections.length-1?"disabled":""}>↓</button></div>
        <div class="builder-section-copy"><input class="builder-section-title" data-section-title="${i}" value="${safe(s.title)}" ${editable?"":"disabled"}><input class="builder-section-description" data-section-description="${i}" value="${safe(s.description||"")}" placeholder="Optional section description" ${editable?"":"disabled"}></div>
        <div class="builder-section-actions"><button data-add-field="${i}" ${editable?"":"disabled"}>+ Field</button><button class="danger" data-delete-section="${i}" ${editable?"":"disabled"}>Delete</button></div>
      </header><div class="builder-field-list">${(s.fields||[]).map((f,j)=>fieldEditor(f,i,j,editable)).join("")||'<div class="builder-field-empty">No fields yet.</div>'}</div></article>`).join("");
    bindBuilder();
  }

  function getField(path){const [s,i]=path.split(":").map(Number);return workingSchema.sections[s]?.fields?.[i]}
  function scheduleSave(){if(selectedVersion?.status!=="draft")return;clearTimeout(saveTimer);document.getElementById("builder-save-status").textContent="Saving…";saveTimer=setTimeout(saveSchema,500)}
  async function saveSchema(){if(selectedVersion?.status!=="draft")return;const {error}=await client.from("dynamic_form_versions").update({schema_json:workingSchema}).eq("id",selectedVersion.id);document.getElementById("builder-save-status").textContent=error?"Save error":"Draft saved ✓";if(error)console.error(error)}

  function bindBuilder(){
    document.querySelectorAll("[data-section-title]").forEach(x=>x.addEventListener("input",()=>{workingSchema.sections[+x.dataset.sectionTitle].title=x.value;scheduleSave()}));
    document.querySelectorAll("[data-section-description]").forEach(x=>x.addEventListener("input",()=>{workingSchema.sections[+x.dataset.sectionDescription].description=x.value;scheduleSave()}));
    document.querySelectorAll("[data-section-up]").forEach(b=>b.addEventListener("click",()=>{const i=+b.dataset.sectionUp;[workingSchema.sections[i-1],workingSchema.sections[i]]=[workingSchema.sections[i],workingSchema.sections[i-1]];renderSections();scheduleSave()}));
    document.querySelectorAll("[data-section-down]").forEach(b=>b.addEventListener("click",()=>{const i=+b.dataset.sectionDown;[workingSchema.sections[i+1],workingSchema.sections[i]]=[workingSchema.sections[i],workingSchema.sections[i+1]];renderSections();scheduleSave()}));
    document.querySelectorAll("[data-add-field]").forEach(b=>b.addEventListener("click",()=>addField(+b.dataset.addField)));
    document.querySelectorAll("[data-delete-section]").forEach(b=>b.addEventListener("click",()=>{const i=+b.dataset.deleteSection;if(confirm(`Delete "${workingSchema.sections[i].title}" and all fields?`)){workingSchema.sections.splice(i,1);renderSections();scheduleSave()}}));

    document.querySelectorAll("[data-field-prop]").forEach(x=>{const h=()=>{const [s,i,p]=x.dataset.fieldProp.split(":"),f=workingSchema.sections[+s].fields[+i];f[p]=x.value;if(p==="type")renderSections();scheduleSave()};x.addEventListener("input",h);x.addEventListener("change",h)});
    document.querySelectorAll("[data-field-required]").forEach(x=>x.addEventListener("change",()=>{getField(x.dataset.fieldRequired).required=x.checked;scheduleSave()}));
    document.querySelectorAll("[data-field-options]").forEach(x=>x.addEventListener("input",()=>{getField(x.dataset.fieldOptions).options=x.value.split("\n").map(v=>v.trim()).filter(Boolean);scheduleSave()}));
    document.querySelectorAll("[data-field-columns]").forEach(x=>x.addEventListener("input",()=>{getField(x.dataset.fieldColumns).columns=x.value.split("\n").map(line=>{const [k,l,t]=line.split("|").map(v=>(v||"").trim());return k?{key:engine.slugKey(k),label:l||k,type:["number","date"].includes(t)?t:"text"}:null}).filter(Boolean);scheduleSave()}));
    document.querySelectorAll("[data-condition-prop]").forEach(x=>{const h=()=>{const [s,i,p]=x.dataset.conditionProp.split(":"),f=workingSchema.sections[+s].fields[+i],c=f.condition||{field_key:"",operator:"equals",value:""};c[p]=x.value;f.condition=c.field_key?c:null;scheduleSave()};x.addEventListener("input",h);x.addEventListener("change",h)});
    document.querySelectorAll("[data-field-up]").forEach(b=>b.addEventListener("click",()=>{const [s,i]=b.dataset.fieldUp.split(":").map(Number),a=workingSchema.sections[s].fields;[a[i-1],a[i]]=[a[i],a[i-1]];renderSections();scheduleSave()}));
    document.querySelectorAll("[data-field-down]").forEach(b=>b.addEventListener("click",()=>{const [s,i]=b.dataset.fieldDown.split(":").map(Number),a=workingSchema.sections[s].fields;[a[i+1],a[i]]=[a[i],a[i+1]];renderSections();scheduleSave()}));
    document.querySelectorAll("[data-delete-field]").forEach(b=>b.addEventListener("click",()=>{const [s,i]=b.dataset.deleteField.split(":").map(Number);workingSchema.sections[s].fields.splice(i,1);renderSections();scheduleSave()}));
  }

  function addSection(){if(selectedVersion?.status!=="draft")return;workingSchema.sections.push({id:uid("section"),title:`Section ${workingSchema.sections.length+1}`,description:"",fields:[]});renderSections();scheduleSave()}
  function addField(s){if(selectedVersion?.status!=="draft")return;workingSchema.sections[s].fields.push({id:uid("field"),key:uid("field"),label:"New question",type:"short_text",required:false,help:"",placeholder:"",options:[],min:"",max:"",step:"",columns:[],condition:null});renderSections();scheduleSave()}

  async function createForm(e){
    e.preventDefault();const title=document.getElementById("new-form-title").value.trim(),code=document.getElementById("new-form-code").value.trim().toUpperCase().replace(/\s+/g,"-");if(!title||!code)return;
    const {data:f,error}=await client.from("dynamic_forms").insert({title,code,category:document.getElementById("new-form-category").value.trim()||null,description:document.getElementById("new-form-description").value.trim()||null,created_by:user.id}).select().single();if(error)return alert(error.message);
    const {error:ve}=await client.from("dynamic_form_versions").insert({form_id:f.id,version_number:1,version_label:"Version 1",schema_json:{sections:[]},status:"draft",created_by:user.id});if(ve)return alert(ve.message);
    document.getElementById("new-form-dialog").close();document.getElementById("new-form-form").reset();await loadReferenceData();await selectForm(f.id);
  }

  async function saveProperties(e){
    e.preventDefault();if(!selectedForm)return;const payload={title:document.getElementById("prop-title").value.trim(),code:document.getElementById("prop-code").value.trim().toUpperCase().replace(/\s+/g,"-"),category:document.getElementById("prop-category").value.trim()||null,description:document.getElementById("prop-description").value.trim()||null};
    const {data,error}=await client.from("dynamic_forms").update(payload).eq("id",selectedForm.id).select().single(),m=document.getElementById("form-properties-message");if(error){m.textContent=error.message;m.className="admin-message error";return}selectedForm=data;forms=forms.map(x=>x.id===data.id?data:x);m.textContent="Form details saved ✓";m.className="admin-message success";renderCatalog();renderEditor();
  }

  async function publish(){if(selectedVersion?.status!=="draft")return;await saveSchema();if(!workingSchema.sections.length)return alert("Add at least one section before publishing.");if(!confirm("Publish this version? Its schema will be frozen."))return;const {error}=await client.rpc("publish_dynamic_form_version",{p_version_id:selectedVersion.id});if(error)return alert(error.message);await selectForm(selectedForm.id)}
  async function newVersion(){if(!selectedForm||!selectedVersion||selectedVersion.status==="draft")return;const {error}=await client.rpc("create_dynamic_form_version",{p_form_id:selectedForm.id});if(error)return alert(error.message);await selectForm(selectedForm.id)}
  function preview(){if(selectedVersion)window.open(`dynamic-form.html?version_id=${encodeURIComponent(selectedVersion.id)}&preview=1`,"_blank")}
  async function switchVersion(id){selectedVersion=versions.find(v=>v.id===id)||null;workingSchema=normalize(selectedVersion?.schema_json);renderEditor()}

  async function addAssignment(e){
    e.preventDefault();if(!selectedForm)return;const community_id=document.getElementById("assignment-community").value||null,course_code=document.getElementById("assignment-course").value.trim()||null,batch=document.getElementById("assignment-batch").value.trim()||null;if(!community_id&&!course_code&&!batch)return alert("Choose at least one assignment scope. Leave the assignment list empty if the form should be available to everyone.");
    const {error}=await client.from("dynamic_form_assignments").insert({form_id:selectedForm.id,community_id,course_code,batch,is_active:true,created_by:user.id});if(error)return alert(error.message);e.target.reset();const {data}=await client.from("dynamic_form_assignments").select("*").eq("form_id",selectedForm.id).eq("is_active",true).order("created_at");assignments=data||[];renderAssignments();
  }

  function renderAssignments(){
    const t=document.getElementById("assignment-list");if(!selectedForm){t.innerHTML='<div class="table-empty">Select a form.</div>';return}
    if(!assignments.length){t.innerHTML='<div class="assignment-global"><strong>All active Toolkit users</strong><span>No audience restrictions configured.</span></div>';return}
    t.innerHTML=assignments.map(a=>{const c=communities.find(x=>x.id===a.community_id)?.name,parts=[c,a.course_code,a.batch].filter(Boolean);return `<div class="assignment-row"><div><strong>${safe(parts.join(" · "))}</strong><small>Assignment rule</small></div><button data-delete-assignment="${safe(a.id)}">×</button></div>`}).join("");
    t.querySelectorAll("[data-delete-assignment]").forEach(b=>b.addEventListener("click",async()=>{const {error}=await client.from("dynamic_form_assignments").delete().eq("id",b.dataset.deleteAssignment);if(error)return alert(error.message);assignments=assignments.filter(x=>x.id!==b.dataset.deleteAssignment);renderAssignments()}));
  }

  function bind(){
    const d=document.getElementById("new-form-dialog");document.getElementById("new-form-btn").addEventListener("click",()=>d.showModal());document.getElementById("cancel-new-form").addEventListener("click",()=>d.close());
    document.getElementById("new-form-form").addEventListener("submit",createForm);document.getElementById("form-properties-form").addEventListener("submit",saveProperties);document.getElementById("assignment-form").addEventListener("submit",addAssignment);
    document.getElementById("add-section-btn").addEventListener("click",addSection);document.getElementById("publish-version-btn").addEventListener("click",publish);document.getElementById("new-version-btn").addEventListener("click",newVersion);document.getElementById("preview-version-btn").addEventListener("click",preview);document.getElementById("version-select").addEventListener("change",e=>switchVersion(e.target.value));
    document.getElementById("new-form-title").addEventListener("input",e=>{const c=document.getElementById("new-form-code");if(!c.dataset.manual)c.value=engine.slugKey(e.target.value).replaceAll("_","-").toUpperCase()});document.getElementById("new-form-code").addEventListener("input",e=>e.target.dataset.manual="true");
  }

  async function init(){try{await authorize();bind();await loadReferenceData();loading.hidden=true;app.hidden=false;document.body.classList.remove("portal-is-loading")}catch(e){console.error("[Form Builder]",e);loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open Form Builder</strong><span>${safe(e.message||e)}</span><a href="admin.html">Return to Administration</a>`}}
  init();
})();