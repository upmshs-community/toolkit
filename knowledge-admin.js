(() => {
  const cfg=window.APP_CONFIG||{};
  let client,user,profile,resources=[],communities=[],selectedResourceId=null;
  const safe=(v="")=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  async function init(){
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:ud}=await client.auth.getUser();if(!ud?.user)return location.replace("index.html");user=ud.user;
    const {data:p}=await client.from("profiles").select("email,full_name,role,status").eq("id",user.id).single();profile=p;
    if(!p||p.status!=="active"||!["admin","coordinator","faculty"].includes(p.role))return fatal("Knowledge manager access required.");
    const n=p.full_name||p.email;document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=n);document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||"");document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=n.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()).join("")||"UP");
    document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html");}));

    // Faculty can manage resources, but community/directory governance stays admin/coordinator.
    if(p.role==="faculty"){document.getElementById("community-admin-section").hidden=true;document.getElementById("directory-admin-section").hidden=true;}

    bind();
    await Promise.all([loadResources(),loadCommunities()]);
    document.getElementById("knowledge-loading").hidden=true;document.getElementById("knowledge-app").hidden=false;
  }

  function bind(){
    document.getElementById("open-new-resource").addEventListener("click",()=>document.getElementById("new-resource-form").hidden=false);
    document.getElementById("cancel-new-resource").addEventListener("click",()=>{document.getElementById("new-resource-form").reset();document.getElementById("new-resource-form").hidden=true;});
    document.getElementById("new-resource-form").addEventListener("submit",createResource);
    document.getElementById("attach-resource-file").addEventListener("change",attachSeededFile);
    document.getElementById("community-profile-form").addEventListener("submit",saveProfile);
    document.getElementById("directory-entry-form").addEventListener("submit",addDirectoryEntry);
  }

  function msg(id,text,type=""){const e=document.getElementById(id);e.textContent=text;e.className="admin-message"+(type?` ${type}`:"");}
  function clean(name){return name.normalize("NFKD").replace(/[^\w.\-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");}

  async function loadResources(){
    const {data,error}=await client.from("toolkit_resources").select("*").order("status").order("title");
    if(error){msg("resource-admin-message",error.message,"error");return;}resources=data||[];renderResources();
  }

  function renderResources(){
    const grid=document.getElementById("resource-admin-grid");
    grid.innerHTML=resources.map(r=>`
      <article class="resource-admin-card">
        <div class="project-card-top"><span class="project-pill status-${safe(r.status)}">${safe(r.status)}</span><small>${safe(r.resource_type)}</small></div>
        <h3>${safe(r.title)}</h3>
        <p>${safe(r.file_name||"No filename recorded")}</p>
        <div class="resource-admin-meta"><span>${safe(r.source_class==="upmshs_internal"?"UPM-SHS Internal":"External Reference")}</span><span>${r.storage_path?"File attached":"Needs file upload"}</span></div>
        <div class="review-actions">
          ${!r.storage_path?`<button class="mini-action approve" data-attach-resource="${r.id}">Attach File & Publish</button>`:`<button class="mini-action save" data-open-resource="${r.id}">Open</button>`}
          ${r.storage_path&&r.status!=="active"?`<button class="mini-action approve" data-activate-resource="${r.id}">Activate</button>`:""}
          ${r.status==="active"?`<button class="mini-action suspend" data-archive-resource="${r.id}">Archive</button>`:""}
        </div>
      </article>`).join("");

    grid.querySelectorAll("[data-attach-resource]").forEach(b=>b.addEventListener("click",()=>{selectedResourceId=b.dataset.attachResource;document.getElementById("attach-resource-file").value="";document.getElementById("attach-resource-file").click();}));
    grid.querySelectorAll("[data-open-resource]").forEach(b=>b.addEventListener("click",()=>openResource(b.dataset.openResource)));
    grid.querySelectorAll("[data-activate-resource]").forEach(b=>b.addEventListener("click",()=>setResourceStatus(b.dataset.activateResource,"active")));
    grid.querySelectorAll("[data-archive-resource]").forEach(b=>b.addEventListener("click",()=>setResourceStatus(b.dataset.archiveResource,"archived")));
  }

  async function uploadFile(resourceId,file){
    if(file.size>25*1024*1024)throw new Error("File exceeds the 25 MB resource limit.");
    const path=`${resourceId}/${crypto.randomUUID()}-${clean(file.name)||"resource"}`;
    const {error}=await client.storage.from("toolkit-resources").upload(path,file,{contentType:file.type||undefined,upsert:false});
    if(error)throw error;
    return path;
  }

  async function attachSeededFile(e){
    const file=e.target.files?.[0];if(!file||!selectedResourceId)return;
    try{
      msg("resource-admin-message","Uploading resource…");
      const path=await uploadFile(selectedResourceId,file);
      const {error}=await client.from("toolkit_resources").update({storage_path:path,file_name:file.name,status:"active"}).eq("id",selectedResourceId);
      if(error){await client.storage.from("toolkit-resources").remove([path]);throw error;}
      msg("resource-admin-message","Resource attached and published.","success");selectedResourceId=null;await loadResources();
    }catch(err){msg("resource-admin-message",err.message,"error");}
  }

  async function createResource(e){
    e.preventDefault();const file=document.getElementById("new-resource-file").files?.[0];if(!file)return;
    const payload={
      title:document.getElementById("new-resource-title").value.trim(),
      resource_type:document.getElementById("new-resource-type").value,
      source_class:document.getElementById("new-resource-source").value,
      organization:document.getElementById("new-resource-org").value.trim()||null,
      publication_year:Number(document.getElementById("new-resource-year").value)||null,
      tags:document.getElementById("new-resource-tags").value.split(",").map(x=>x.trim()).filter(Boolean),
      description:document.getElementById("new-resource-description").value.trim()||null,
      file_name:file.name,status:"draft",created_by:user.id
    };
    msg("resource-admin-message","Creating resource…");
    const {data,error}=await client.from("toolkit_resources").insert(payload).select("id").single();
    if(error){msg("resource-admin-message",error.message,"error");return;}
    try{
      const path=await uploadFile(data.id,file);
      const {error:uerr}=await client.from("toolkit_resources").update({storage_path:path,status:"active"}).eq("id",data.id);
      if(uerr)throw uerr;
      msg("resource-admin-message","Resource created and published.","success");document.getElementById("new-resource-form").reset();document.getElementById("new-resource-form").hidden=true;await loadResources();
    }catch(err){msg("resource-admin-message",`Catalog entry created, but upload failed: ${err.message}`,"error");await loadResources();}
  }

  async function openResource(id){
    const r=resources.find(x=>x.id===id);if(!r?.storage_path)return;
    const {data,error}=await client.storage.from("toolkit-resources").createSignedUrl(r.storage_path,300);
    if(error)return msg("resource-admin-message",error.message,"error");window.open(data.signedUrl,"_blank","noopener,noreferrer");
  }
  async function setResourceStatus(id,status){const {error}=await client.from("toolkit_resources").update({status}).eq("id",id);if(error)return msg("resource-admin-message",error.message,"error");await loadResources();}

  async function loadCommunities(){
    if(profile.role==="faculty")return;
    const {data}=await client.from("communities").select("id,name,province").eq("is_active",true).order("name");communities=data||[];
    const list=document.getElementById("community-editor-list");list.innerHTML=communities.map(c=>`<button type="button" data-edit-community="${c.id}"><strong>${safe(c.name)}</strong><span>${safe(c.province||"")}</span></button>`).join("");
    list.querySelectorAll("[data-edit-community]").forEach(b=>b.addEventListener("click",()=>loadProfile(b.dataset.editCommunity)));
    if(communities[0])loadProfile(communities[0].id);
  }

  async function loadProfile(id){
    document.getElementById("profile-community-id").value=id;
    const {data}=await client.from("community_profiles").select("*").eq("community_id",id).limit(1);
    const p=data?.[0]||{};
    document.getElementById("profile-overview").value=p.overview||"";
    document.getElementById("profile-catchment").value=p.catchment_notes||"";
    document.getElementById("profile-health-system").value=p.local_health_system||"";
    document.getElementById("profile-priorities").value=p.priority_health_issues||"";
    document.getElementById("profile-referral").value=p.referral_notes||"";
    document.getElementById("profile-logistics").value=p.logistics_notes||"";
    document.getElementById("profile-source").value=p.verification_source||"";
    document.getElementById("profile-verified").value=p.last_verified_at||"";
  }

  async function saveProfile(e){
    e.preventDefault();const community_id=document.getElementById("profile-community-id").value;if(!community_id)return;
    const payload={community_id,overview:v("profile-overview"),catchment_notes:v("profile-catchment"),local_health_system:v("profile-health-system"),priority_health_issues:v("profile-priorities"),referral_notes:v("profile-referral"),logistics_notes:v("profile-logistics"),verification_source:v("profile-source"),last_verified_at:document.getElementById("profile-verified").value||null,updated_by:user.id};
    const {error}=await client.from("community_profiles").upsert(payload,{onConflict:"community_id"});msg("profile-admin-message",error?error.message:"Community profile saved.",error?"error":"success");
  }
  function v(id){return document.getElementById(id).value.trim()||null;}

  async function addDirectoryEntry(e){
    e.preventDefault();const payload={province:v("dir-province"),lgu:v("dir-lgu"),entry_type:document.getElementById("dir-type").value,evidence_level:document.getElementById("dir-evidence").value,person_name:v("dir-person"),organization_name:v("dir-org"),designation_status:v("dir-designation"),support_text:v("dir-support"),evidence_date_text:v("dir-evidence-date"),source_url:v("dir-source-url"),research_notes:v("dir-notes"),last_verified_at:document.getElementById("dir-verified").value||null,is_current:true,created_by:user.id};
    const {error}=await client.from("health_directory_entries").insert(payload);msg("directory-admin-message",error?error.message:"Directory entry added.",error?"error":"success");if(!error)document.getElementById("directory-entry-form").reset();
  }

  function fatal(text){document.getElementById("knowledge-loading").innerHTML=`<strong>Access unavailable</strong><span>${safe(text)}</span><a href="portal.html">Return to Toolkit</a>`;}
  init();
})();
