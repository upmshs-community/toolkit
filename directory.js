(() => {
  const cfg=window.APP_CONFIG||{};
  let client, entries=[];
  const safe=(v="")=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  async function init(){
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:ud}=await client.auth.getUser(); if(!ud?.user)return location.replace("index.html");
    const {data:p}=await client.from("profiles").select("email,full_name,status").eq("id",ud.user.id).single();
    if(!p||p.status!=="active")return location.replace("portal.html");
    const name=p.full_name||p.email;
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||"");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=name.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()).join("")||"UP");
    document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html");}));

    const {data,error}=await client.from("health_directory_entries")
      .select("id,province,lgu,entry_type,person_name,organization_name,designation_status,evidence_level,support_text,evidence_date_text,source_url,tracker_status,verification_needed,research_notes,last_verified_at")
      .eq("is_current",true)
      .order("province").order("lgu");
    if(error)console.error(error);
    entries=data||[];

    const prov=[...new Set(entries.map(e=>e.province).filter(Boolean))].sort();
    document.getElementById("directory-province").innerHTML='<option value="all">All provinces</option>'+prov.map(p=>`<option value="${safe(p)}">${safe(p)}</option>`).join("");
    ["directory-search","directory-province","directory-type","directory-evidence"].forEach(id=>{
      document.getElementById(id).addEventListener(id==="directory-search"?"input":"change",render);
    });

    document.getElementById("directory-loading").hidden=true; document.getElementById("directory-app").hidden=false;
    render();

    const wanted=new URLSearchParams(location.search).get("entry");
    if(wanted)setTimeout(()=>document.querySelector(`[data-directory-id="${wanted}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}),120);
  }

  function evidenceLabel(v){
    if(v==="high")return "High evidence";
    if(v==="moderate")return "Moderate evidence";
    if(v==="low")return "Low evidence";
    return "Needs confirmation";
  }

  function render(){
    const q=document.getElementById("directory-search").value.trim().toLowerCase();
    const province=document.getElementById("directory-province").value;
    const type=document.getElementById("directory-type").value;
    const evidence=document.getElementById("directory-evidence").value;

    const data=entries.filter(e=>{
      const hay=[e.province,e.lgu,e.person_name,e.organization_name,e.designation_status,e.support_text].filter(Boolean).join(" ").toLowerCase();
      return (!q||hay.includes(q))&&(province==="all"||e.province===province)&&(type==="all"||e.entry_type===type)&&(evidence==="all"||e.evidence_level===evidence);
    });
    document.getElementById("directory-count").textContent=`${data.length} record${data.length===1?"":"s"}`;

    document.getElementById("directory-list").innerHTML=data.length?data.map(e=>`
      <article class="directory-card" data-directory-id="${e.id}">
        <div class="directory-card-head">
          <div>
            <span class="directory-location">${safe(e.lgu||"")}${e.province?`, ${safe(e.province)}`:""}</span>
            <h2>${safe(e.person_name||e.organization_name||"Directory entry")}</h2>
            <p>${safe(e.designation_status||e.entry_type.replaceAll("_"," "))}</p>
          </div>
          <span class="evidence-badge evidence-${safe(e.evidence_level)}">${safe(evidenceLabel(e.evidence_level))}</span>
        </div>
        <div class="directory-support">${safe(e.support_text||"No supporting note recorded.")}</div>
        <div class="directory-meta">
          <span><strong>Latest evidence</strong>${safe(e.evidence_date_text||"—")}</span>
          <span><strong>Last checked</strong>${safe(e.last_verified_at||"—")}</span>
          <span><strong>Direct verification</strong>${safe(e.verification_needed||"—")}</span>
        </div>
        ${e.source_url?`<a class="directory-source" href="${safe(e.source_url)}" target="_blank" rel="noopener noreferrer">Open supporting source ↗</a>`:""}
        ${e.research_notes?`<details><summary>Research notes</summary><p>${safe(e.research_notes)}</p></details>`:""}
      </article>
    `).join(""):'<div class="table-empty">No matching directory records.</div>';
  }

  init();
})();
