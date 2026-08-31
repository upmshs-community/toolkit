(() => {
  const cfg=window.APP_CONFIG||{};
  const id=new URLSearchParams(location.search).get("id");
  let client;
  const safe=(v="")=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  async function init(){
    if(!id)return fail("No community was selected.");
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:ud}=await client.auth.getUser(); if(!ud?.user)return location.replace("index.html");
    const {data:p}=await client.from("profiles").select("email,full_name,status").eq("id",ud.user.id).single();
    if(!p||p.status!=="active")return location.replace("portal.html");

    const name=p.full_name||p.email;
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||"");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=name.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()).join("")||"UP");
    document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html");}));

    const {data:c,error}=await client.from("communities").select("id,name,province,municipality,description,preceptor_name").eq("id",id).single();
    if(error||!c)return fail(error?.message||"Community not found.");

    const {data:profiles}=await client.from("community_profiles")
      .select("overview,catchment_notes,local_health_system,priority_health_issues,referral_notes,logistics_notes,verification_source,last_verified_at")
      .eq("community_id",id).limit(1);

    const cp=profiles?.[0]||{};
    document.title=`${c.name} | Community Health Toolkit`;
    document.getElementById("community-name").textContent=c.name;
    document.getElementById("community-province").textContent=[c.municipality||c.name,c.province].filter(Boolean).join(", ");
    document.getElementById("community-overview").textContent=cp.overview||c.description||"Community learning site profile awaiting enrichment.";
    document.getElementById("community-catchment").textContent=cp.catchment_notes||"No catchment notes recorded yet.";
    document.getElementById("community-health-system").textContent=cp.local_health_system||"No local health system notes recorded yet.";
    document.getElementById("community-priorities").textContent=cp.priority_health_issues||"No priority health issues recorded yet.";
    document.getElementById("community-referral").textContent=cp.referral_notes||"No referral pathway notes recorded yet.";
    document.getElementById("community-logistics").textContent=cp.logistics_notes||"";
    document.getElementById("community-verified").textContent=cp.last_verified_at||"Not recorded";
    document.getElementById("community-source").textContent=cp.verification_source?`Source: ${cp.verification_source}`:"";

    await Promise.all([loadDirectory(c),loadProjects()]);
    document.getElementById("community-loading").hidden=true; document.getElementById("community-app").hidden=false;
  }

  async function loadDirectory(c){
    const {data}=await client.from("health_directory_entries")
      .select("id,entry_type,person_name,organization_name,designation_status,evidence_level,evidence_date_text,source_url,verification_needed")
      .ilike("lgu",c.name)
      .eq("is_current",true)
      .order("entry_type");
    const target=document.getElementById("community-directory");
    if(!data?.length){target.innerHTML='<div class="table-empty">No matching directory entry yet.</div>';return;}
    target.innerHTML=data.map(e=>`
      <article class="directory-card compact-card">
        <div class="directory-card-head">
          <div><span class="directory-location">${safe(e.entry_type.replaceAll("_"," "))}</span><h2>${safe(e.person_name||e.organization_name||"Entry")}</h2><p>${safe(e.designation_status||"")}</p></div>
          <span class="evidence-badge evidence-${safe(e.evidence_level)}">${safe(e.evidence_level||"needs confirmation")}</span>
        </div>
        <div class="directory-meta"><span><strong>Evidence</strong>${safe(e.evidence_date_text||"—")}</span><span><strong>Verify?</strong>${safe(e.verification_needed||"—")}</span></div>
        ${e.source_url?`<a class="directory-source" href="${safe(e.source_url)}" target="_blank" rel="noopener noreferrer">Supporting source ↗</a>`:""}
      </article>
    `).join("");
  }

  async function loadProjects(){
    const {data}=await client.from("projects")
      .select("id,title,category,summary,status,school_year,batch")
      .eq("community_id",id)
      .order("created_at",{ascending:false});
    const target=document.getElementById("community-projects");
    if(!data?.length){target.innerHTML='<div class="table-empty">No projects registered for this community.</div>';return;}
    target.innerHTML=data.map(p=>`
      <article class="project-portal-card">
        <div class="project-card-top"><span class="project-pill status-${safe(p.status)}">${safe((p.status||"").replaceAll("_"," "))}</span><small>${safe(p.category||"General")}</small></div>
        <h3>${safe(p.title)}</h3><p>${safe(p.summary||"No summary yet.")}</p>
        <div class="project-meta"><span>${safe(p.school_year||"—")}</span><span>${safe(p.batch||"—")}</span></div>
        <a class="mini-action save project-open-link" href="project.html?id=${encodeURIComponent(p.id)}">Open Project</a>
      </article>`).join("");
  }

  function fail(msg){document.getElementById("community-loading").innerHTML=`<strong>Unable to open community</strong><span>${safe(msg)}</span><a href="portal.html#communities">Return to Toolkit</a>`;}
  init();
})();
