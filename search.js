(() => {
 const cfg=window.APP_CONFIG||{}; let client;
 const safe=(v="")=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
 async function init(){
   client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
   const {data:ud}=await client.auth.getUser();if(!ud?.user)return location.replace("index.html");
   const {data:p}=await client.from("profiles").select("email,full_name,status").eq("id",ud.user.id).single();if(!p||p.status!=="active")return location.replace("portal.html");
   const n=p.full_name||p.email;document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=n);document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||"");document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=n.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()).join("")||"UP");
   document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html");}));
   document.getElementById("global-search-form").addEventListener("submit",run);
   document.getElementById("search-loading").hidden=true;document.getElementById("search-app").hidden=false;
   const q=new URLSearchParams(location.search).get("q");if(q){document.getElementById("global-search-input").value=q;run(new Event("submit"));}
 }
 async function run(e){e.preventDefault();const q=document.getElementById("global-search-input").value.trim();if(q.length<2)return;
   document.getElementById("search-message").textContent="Searching…";
   const {data,error}=await client.rpc("global_toolkit_search",{search_term:q});
   if(error){document.getElementById("search-message").textContent=error.message;return;}
   const results=data||[];document.getElementById("search-message").textContent=`${results.length} result${results.length===1?"":"s"} for “${q}”`;
   document.getElementById("search-results").innerHTML=results.length?results.map(r=>`
     <a class="search-result-card" href="${safe(r.href)}">
       <span class="search-entity">${safe(r.entity_type)}</span>
       <h2>${safe(r.title)}</h2>
       <strong>${safe(r.subtitle||"")}</strong>
       <p>${safe(r.snippet||"")}</p>
     </a>`).join(""):'<div class="table-empty">No matching records.</div>';
 }
 init();
})();
