(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById("library-loading");
  const app = document.getElementById("library-app");
  let client, user, profile, resources = [];

  const safe = (v="") => String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  async function init() {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data: ud } = await client.auth.getUser();
    if (!ud?.user) return location.replace("index.html");
    user = ud.user;

    const { data: p } = await client.from("profiles").select("email,full_name,status").eq("id",user.id).single();
    if (!p || p.status !== "active") return location.replace("portal.html");
    profile = p;

    const name = p.full_name || p.email;
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||"");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=name.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()).join("")||"UP");
    document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html");}));

    document.getElementById("library-search").addEventListener("input",render);
    document.getElementById("library-type").addEventListener("change",render);
    document.getElementById("library-source").addEventListener("change",render);

    const { data, error } = await client.from("toolkit_resources")
      .select("id,title,description,resource_type,source_class,organization,publication_year,file_name,storage_path,tags,access_note,featured")
      .eq("status","active")
      .order("featured",{ascending:false})
      .order("title");

    if (error) document.getElementById("library-message").textContent=error.message;
    resources = data || [];

    loading.hidden = true; app.hidden = false;
    render();

    const requested = new URLSearchParams(location.search).get("resource");
    if (requested) setTimeout(()=>document.querySelector(`[data-resource-card="${requested}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}),150);
  }

  function render() {
    const q=(document.getElementById("library-search").value||"").trim().toLowerCase();
    const type=document.getElementById("library-type").value;
    const source=document.getElementById("library-source").value;
    const grid=document.getElementById("library-grid");

    const filtered=resources.filter(r=>{
      const hay=[r.title,r.description,r.organization,r.resource_type,...(r.tags||[])].filter(Boolean).join(" ").toLowerCase();
      return (!q||hay.includes(q)) && (type==="all"||r.resource_type===type) && (source==="all"||r.source_class===source);
    });

    if (!filtered.length) {
      grid.innerHTML='<div class="table-empty">No matching resources.</div>';
      return;
    }

    grid.innerHTML=filtered.map(r=>`
      <article class="library-card" data-resource-card="${r.id}">
        <div class="project-card-top">
          <span class="resource-source ${r.source_class==="upmshs_internal"?"internal":"external"}">${r.source_class==="upmshs_internal"?"UPM-SHS Internal":"External Reference"}</span>
          <small>${safe((r.resource_type||"reference").replaceAll("_"," "))}</small>
        </div>
        <h2>${safe(r.title)}</h2>
        <p>${safe(r.description||"No description.")}</p>
        <div class="resource-tags">${(r.tags||[]).slice(0,6).map(t=>`<span>${safe(t)}</span>`).join("")}</div>
        <div class="resource-footer">
          <div>
            <strong>${safe(r.organization||"")}</strong>
            <small>${r.publication_year?safe(r.publication_year):""}</small>
          </div>
          ${r.storage_path?`<button class="button button-maroon resource-open" data-resource-id="${r.id}">Open Resource</button>`:`<span class="resource-unavailable">File pending upload</span>`}
        </div>
        ${r.access_note?`<div class="resource-note">${safe(r.access_note)}</div>`:""}
      </article>
    `).join("");

    grid.querySelectorAll(".resource-open").forEach(b=>b.addEventListener("click",()=>openResource(b.dataset.resourceId)));
  }

  async function openResource(id) {
    const r=resources.find(x=>x.id===id);
    if (!r?.storage_path) return;
    const { data, error }=await client.storage.from("toolkit-resources").createSignedUrl(r.storage_path,300);
    if (error) {
      const m=document.getElementById("library-message"); m.textContent=error.message; m.className="admin-message error"; return;
    }
    window.open(data.signedUrl,"_blank","noopener,noreferrer");
  }

  init();
})();
