(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById("diagnosis-loading");
  const app = document.getElementById("diagnosis-app");

  let client, user, profile, rotation;
  let mySurveys = [], mapRecords = [], analyticsRecords = [], mapPoints = [], diagnoses = [];
  let map, householdCluster, healthLayer, projectLayer, resourceLayer;

  const safe = (v="") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const initials = name => String(name || "UP").split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("") || "UP";
  const fmtDate = v => v ? new Date(v).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "—";
  const fmtDateTime = v => v ? new Date(v).toLocaleString() : "—";
  const hasGPS = r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude));

  function setUserUI() {
    const name = profile.full_name || profile.email || user.email || "Student";
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=profile.email || user.email || "");
    document.querySelectorAll("[data-user-role]").forEach(x=>x.textContent=String(profile.role || "student").replaceAll("_"," "));
    document.querySelectorAll("[data-user-batch]").forEach(x=>x.textContent=profile.batch || rotation?.batch || "—");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));
  }

  async function authorize() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error("Supabase configuration is missing.");
    }
    client = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);

    const {data:u,error:e} = await client.auth.getUser();
    if (e || !u?.user) return location.replace("index.html");
    user = u.user;

    const {data:p,error:pe} = await client.from("profiles")
      .select("email,full_name,role,status,batch,year_level")
      .eq("id",user.id).single();
    if (pe || !p) throw pe || new Error("Profile not found.");
    if (String(p.status) !== "active") return location.replace("portal.html");
    profile = p;

    const {data:r,error:re} = await client.rpc("get_my_active_rotation_context");
    if (re) throw new Error("Run the Phase 7C.3 SQL first. " + re.message);
    rotation = Array.isArray(r) ? r[0] : r;
    if (!rotation?.community_id) {
      loading.innerHTML = `
        <img src="assets/shs-logo.png" alt="UPM-SHS">
        <strong>No active community rotation</strong>
        <span>The Community Diagnosis Workspace becomes available when an active community assignment is recorded.</span>
        <a href="portal.html">Return to Portal</a>`;
      throw new Error("No active rotation");
    }

    setUserUI();
    document.getElementById("diagnosis-community-title").textContent = `${rotation.community_name} Community Diagnosis`;
    document.getElementById("diagnosis-rotation-copy").textContent =
      [rotation.course_code, rotation.rotation_type, rotation.batch, rotation.province].filter(Boolean).join(" · ");

    document.querySelectorAll("[data-sign-out]").forEach(btn=>btn.addEventListener("click",async()=>{
      await client.auth.signOut();
      location.replace("index.html");
    }));
  }

  async function loadData() {
    const [mine, mapped, analytics, points, diag] = await Promise.all([
      client.from("field_form_submissions")
        .select("id,local_uuid,community_id,status,household_code,interview_date,barangay,zone,interviewer,response_json,latitude,longitude,gps_accuracy_m,synced_at,updated_at")
        .eq("submitted_by",user.id)
        .eq("community_id",rotation.community_id)
        .neq("status","archived")
        .order("updated_at",{ascending:false}),
      client.rpc("get_student_field_map_records"),
      client.rpc("get_student_community_analytics_records"),
      client.rpc("get_student_community_map_points"),
      client.from("community_diagnoses")
        .select("*")
        .eq("community_id",rotation.community_id)
        .neq("status","archived")
        .order("priority_rank",{ascending:true,nullsFirst:false})
        .order("updated_at",{ascending:false})
    ]);

    for (const res of [mine,mapped,analytics,points,diag]) {
      if (res.error) throw res.error;
    }

    mySurveys = mine.data || [];
    mapRecords = mapped.data || [];
    analyticsRecords = analytics.data || [];
    mapPoints = points.data || [];
    diagnoses = diag.data || [];

    renderOverview();
    setupMySurveyFilters();
    renderMySurveys();
    renderMapStats();
    renderStudentAnalytics();
    renderDiagnoses();
  }

  function setupTabs() {
    const openTab = name => {
      document.querySelectorAll("[data-diagnosis-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.diagnosisTab===name));
      document.querySelectorAll("[data-diagnosis-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.diagnosisPanel===name));
      if (name === "map") {
        renderMap();
        setTimeout(()=>map?.invalidateSize(),120);
      }
      if (name === "analytics") renderStudentAnalytics();
    };

    document.querySelectorAll("[data-diagnosis-tab]").forEach(btn=>btn.addEventListener("click",()=>openTab(btn.dataset.diagnosisTab)));
    document.querySelectorAll("[data-open-tab]").forEach(btn=>btn.addEventListener("click",()=>openTab(btn.dataset.openTab)));
  }

  function renderOverview() {
    const communityDataset = mapRecords.filter(r=>["completed","reviewed"].includes(String(r.status)));
    const barangays = new Set(communityDataset.map(r=>r.barangay).filter(Boolean));
    document.getElementById("diag-stat-my-surveys").textContent = mySurveys.length;
    document.getElementById("diag-stat-community-surveys").textContent = communityDataset.length;
    document.getElementById("diag-stat-gps").textContent = communityDataset.filter(hasGPS).length;
    document.getElementById("diag-stat-barangays").textContent = barangays.size;
    document.getElementById("diag-stat-priorities").textContent = diagnoses.filter(d=>["draft","proposed"].includes(String(d.status))).length;
  }

  function setupMySurveyFilters() {
    const sel = document.getElementById("my-survey-barangay");
    const barangays = [...new Set(mySurveys.map(r=>r.barangay).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    sel.innerHTML = '<option value="">All barangays</option>' + barangays.map(v=>`<option>${safe(v)}</option>`).join("");
    document.getElementById("my-survey-status").addEventListener("change",renderMySurveys);
    sel.addEventListener("change",renderMySurveys);
  }

  function statusChip(status) {
    return `<span class="field-status-chip status-${safe(status)}">${safe(status)}</span>`;
  }

  function renderMySurveys() {
    const status = document.getElementById("my-survey-status").value;
    const barangay = document.getElementById("my-survey-barangay").value;
    const rows = mySurveys.filter(r=>(!status||r.status===status)&&(!barangay||r.barangay===barangay));
    const body = document.getElementById("my-surveys-body");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty">No synced household surveys match the current filter.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r=>`
      <tr>
        <td><strong>${safe(r.household_code || "No household #")}</strong></td>
        <td><strong>${safe(r.barangay || "Barangay not entered")}</strong><small>${safe(r.zone || "")}</small></td>
        <td>${safe(fmtDate(r.interview_date))}</td>
        <td>${statusChip(r.status)}</td>
        <td>${hasGPS(r) ? '<span class="field-gps-yes">● Captured</span>' : '<span class="field-gps-no">—</span>'}</td>
        <td><button class="mini-action" type="button" data-view-my-survey="${safe(r.id)}">View</button></td>
      </tr>`).join("");
    body.querySelectorAll("[data-view-my-survey]").forEach(btn=>btn.addEventListener("click",()=>openMySurvey(btn.dataset.viewMySurvey)));
  }

  function humanize(key) {
    return String(key||"").replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());
  }

  function answerValue(value) {
    if (value === null || value === undefined || value === "") return '<span class="field-empty-answer">—</span>';
    if (Array.isArray(value)) {
      if (!value.length) return '<span class="field-empty-answer">—</span>';
      if (typeof value[0] === "object") {
        return `<div class="field-repeat-answer">${value.map((row,i)=>`
          <article><strong>Entry ${i+1}</strong>
          ${Object.entries(row).filter(([,v])=>String(v||"").trim()).map(([k,v])=>`<span><b>${safe(humanize(k))}</b>${safe(v)}</span>`).join("")}
          </article>`).join("")}</div>`;
      }
      return safe(value.join(", "));
    }
    if (typeof value === "object") return `<pre>${safe(JSON.stringify(value,null,2))}</pre>`;
    return safe(value);
  }

  const sectionGroups = [
    ["Visit / Household", ["household_number","interview_date","barangay","zone","interviewer"]],
    ["I. Family Members and Characteristics", ["head_name","head_age","head_sex","head_education","head_occupation","head_monthly_income","head_civil_status","head_employment_status","children_total","children_male","children_female","dependents_total","dependents_male","dependents_female","family_members"]],
    ["II. Socio-Economic and Cultural", ["religion","primary_language","family_income_bracket","livelihood","livelihood_other","food_production_engaged","food_production_other","foodprod_vegetable","foodprod_piggery","foodprod_poultry","foodprod_fruit","property_owned","property_other","housing_ownership","housing_construction","appliances","appliance_other","transport","transport_other","utilities","basic_clothing","food_consumption","decision_0","decision_1","decision_2","decision_3"]],
    ["III. Health Status and Practices", ["breastfeeding","supplementary_feeding","nutrition_children","immunization_children","pn_iron_iodine","pn_folic_calcium","pn_td_first","pn_td_repeat","pn_prenatal_care","pn_first_trimester","pn_visit_each_trimester","pn_total_visits","pn_postnatal_visit","delivery_trained_personnel","delivery_personnel_type","delivery_other_personnel","delivery_facility","fp_access","fp_practicing","fp_method","fp_reason_no","morbidity_diarrhea","illnesses","mortality_preventable","deaths","philhealth_members","avail_health_services","solo_parent_services","delay_decision","delay_decision_other","delay_reaching","delay_reaching_other","delay_receiving","delay_receiving_other","health_services_rank","health_worker_rank","health_interventions_rank","covid_vaccines","covid_no_reason"]],
    ["IV. Environmental Condition", ["water_domestic","water_drinking","water_other","water_storage","water_treatment","food_storage","food_storage_other","with_toilet","toilet_type","toilet_no_reason","toilet_ownership_function","wastewater_disposal","garbage_collection","garbage_disposal","with_animals","animal_kind","animal_management"]],
    ["V. People's Participation", ["community_org_involvement","community_org_member_count","community_org_names","known_organizations","community_projects_participated"]],
    ["VI. Community Resources, Needs and Problems", ["community_leaders","material_resources","problems"]]
  ];

  function renderResponses(response={}) {
    const used = new Set();
    const blocks = sectionGroups.map(([title,keys])=>{
      const items = keys.filter(k=>Object.prototype.hasOwnProperty.call(response,k)).map(k=>{
        used.add(k);
        return `<div class="field-answer-row"><dt>${safe(humanize(k))}</dt><dd>${answerValue(response[k])}</dd></div>`;
      }).join("");
      return items ? `<details class="field-response-group" open><summary>${safe(title)}</summary><dl>${items}</dl></details>` : "";
    }).join("");
    const other = Object.keys(response).filter(k=>!used.has(k));
    return blocks + (other.length ? `<details class="field-response-group"><summary>Other fields</summary><dl>${
      other.map(k=>`<div class="field-answer-row"><dt>${safe(humanize(k))}</dt><dd>${answerValue(response[k])}</dd></div>`).join("")
    }</dl></details>` : "");
  }

  function openMySurvey(id) {
    const r = mySurveys.find(x=>x.id===id);
    if (!r) return;
    document.getElementById("student-survey-detail-title").textContent = r.household_code || "Household Survey";
    document.getElementById("student-survey-detail-subtitle").textContent = `${r.barangay || "Barangay not entered"}${r.zone ? ` · ${r.zone}` : ""}`;
    document.getElementById("student-survey-detail-summary").innerHTML = `
      <article><span>Status</span>${statusChip(r.status)}</article>
      <article><span>Interview date</span><strong>${safe(fmtDate(r.interview_date))}</strong></article>
      <article><span>GPS</span><strong>${hasGPS(r) ? (r.gps_accuracy_m ? `±${Math.round(r.gps_accuracy_m)} m` : "Captured") : "Not captured"}</strong></article>
      <article><span>Synced</span><strong>${safe(fmtDateTime(r.synced_at || r.updated_at))}</strong></article>`;
    document.getElementById("student-survey-detail-responses").innerHTML = renderResponses(r.response_json || {});
    document.getElementById("student-survey-backdrop").hidden = false;
    const drawer = document.getElementById("student-survey-drawer");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden","false");
    document.body.classList.add("field-detail-open");
  }

  function closeMySurvey() {
    document.getElementById("student-survey-backdrop").hidden = true;
    const drawer = document.getElementById("student-survey-drawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden","true");
    document.body.classList.remove("field-detail-open");
  }

  function renderMapStats() {
    const mapped = mapRecords.filter(hasGPS);
    document.getElementById("student-map-count").textContent = mapped.length;
    document.getElementById("student-map-reviewed").textContent = mapRecords.filter(r=>r.status==="reviewed").length;
    document.getElementById("student-map-barangays").textContent = new Set(mapped.map(r=>r.barangay).filter(Boolean)).size;
  }

  function statusColor(status) {
    if (status==="reviewed") return "#17683b";
    if (status==="completed") return "#9a6712";
    return "#7b1113";
  }

  function householdIcon(status) {
    const color = statusColor(status);
    return L.divIcon({
      className:"field-map-household-icon-wrap",
      html:`<span class="field-map-household-icon" style="--marker-color:${color}"></span>`,
      iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-10]
    });
  }

  function pointIcon(type) {
    const cls = ["rhu","bhs","hospital","referral"].includes(type) ? "health" : type==="project" ? "project" : "resource";
    const glyph = type==="rhu" ? "R" : type==="bhs" ? "B" : type==="hospital" ? "H" : type==="project" ? "P" : "•";
    return L.divIcon({
      className:"field-map-point-icon-wrap",
      html:`<span class="field-map-point-icon ${cls}">${glyph}</span>`,
      iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-12]
    });
  }

  function initMap() {
    map = L.map("student-community-map",{zoomControl:true,preferCanvas:true}).setView([11.2,124.9],10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,attribution:"© OpenStreetMap contributors"
    }).addTo(map);
    householdCluster = L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:45,spiderfyOnMaxZoom:true});
    healthLayer=L.layerGroup(); projectLayer=L.layerGroup(); resourceLayer=L.layerGroup();
    map.addLayer(householdCluster); map.addLayer(healthLayer); map.addLayer(projectLayer); map.addLayer(resourceLayer);
  }

  function renderMap() {
    if (!map) initMap();
    householdCluster.clearLayers(); healthLayer.clearLayers(); projectLayer.clearLayers(); resourceLayer.clearLayers();
    const bounds = [];
    const showHouseholds = document.getElementById("student-layer-households").checked;
    const showHealth = document.getElementById("student-layer-health").checked;
    const showProjects = document.getElementById("student-layer-projects").checked;
    const showResources = document.getElementById("student-layer-resources").checked;

    if (showHouseholds) {
      mapRecords.filter(hasGPS).forEach(r=>{
        const latlng = [Number(r.latitude),Number(r.longitude)];
        bounds.push(latlng);
        const marker = L.marker(latlng,{icon:householdIcon(r.status)});
        marker.bindPopup(`<div class="field-map-popup">
          <span class="field-map-popup-kicker">Household survey</span>
          <strong>${safe(r.household_code || "No household #")}</strong>
          <small>${safe(r.barangay || "Barangay not entered")} · ${safe(fmtDate(r.interview_date))}</small>
          <span class="field-status-chip status-${safe(r.status)}">${safe(r.status)}</span>
        </div>`);
        householdCluster.addLayer(marker);
      });
    }

    mapPoints.forEach(p=>{
      if (!Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) return;
      const type = String(p.point_type || "resource");
      const isHealth = ["rhu","bhs","hospital","referral"].includes(type);
      const isProject = type==="project";
      if ((isHealth&&!showHealth)||(isProject&&!showProjects)||(!isHealth&&!isProject&&!showResources)) return;
      const latlng=[Number(p.latitude),Number(p.longitude)];
      bounds.push(latlng);
      const marker=L.marker(latlng,{icon:pointIcon(type)}).bindPopup(`<div class="field-map-popup">
        <span class="field-map-popup-kicker">${safe(type.replaceAll("_"," "))}</span>
        <strong>${safe(p.name)}</strong>
        ${p.notes ? `<small>${safe(p.notes)}</small>` : ""}
      </div>`);
      if (isHealth) healthLayer.addLayer(marker); else if (isProject) projectLayer.addLayer(marker); else resourceLayer.addLayer(marker);
    });

    if (map.hasLayer(householdCluster)!==showHouseholds) showHouseholds ? map.addLayer(householdCluster) : map.removeLayer(householdCluster);
    if (map.hasLayer(healthLayer)!==showHealth) showHealth ? map.addLayer(healthLayer) : map.removeLayer(healthLayer);
    if (map.hasLayer(projectLayer)!==showProjects) showProjects ? map.addLayer(projectLayer) : map.removeLayer(projectLayer);
    if (map.hasLayer(resourceLayer)!==showResources) showResources ? map.addLayer(resourceLayer) : map.removeLayer(resourceLayer);

    if (bounds.length) map.fitBounds(bounds,{padding:[30,30],maxZoom:15});
    setTimeout(()=>map.invalidateSize(),80);
  }

  function analyticsDataset() {
    const mode = document.getElementById("student-analytics-dataset").value;
    return analyticsRecords.filter(r=>mode==="reviewed" ? r.status==="reviewed" : ["completed","reviewed"].includes(r.status));
  }

  function ynStat(rows,key) {
    const vals = rows.map(r=>String(r[key]||"").trim().toLowerCase()).filter(v=>v==="yes"||v==="no");
    const yes=vals.filter(v=>v==="yes").length, no=vals.filter(v=>v==="no").length;
    return {yes,no,n:yes+no,rate:(yes+no)?Math.round(yes/(yes+no)*100):null};
  }

  function categorical(rows,key) {
    const m=new Map();
    rows.forEach(r=>{
      const v=String(r[key]||"").trim();
      if (v) m.set(v,(m.get(v)||0)+1);
    });
    return [...m.entries()].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  }

  function renderBars(targetId,list,denom) {
    const target=document.getElementById(targetId);
    if (!list.length) { target.innerHTML='<div class="table-empty">No answered records in the current dataset.</div>'; return; }
    const max=Math.max(1,...list.map(x=>x.count));
    target.innerHTML=list.map(x=>`<div class="analytics-bar-row">
      <div><span>${safe(x.label)}</span><strong>${x.count}${denom ? ` · ${Math.round(x.count/denom*100)}%` : ""}</strong></div>
      <div class="analytics-bar-track"><i style="width:${Math.round(x.count/max*100)}%"></i></div>
    </div>`).join("");
  }

  function arrayCounts(rows,keys) {
    const m=new Map();
    rows.forEach(r=>keys.forEach(k=>{
      const arr=Array.isArray(r[k]) ? r[k] : [];
      arr.forEach(v=>{ const label=String(v||"").trim(); if(label)m.set(label,(m.get(label)||0)+1); });
    }));
    return [...m.entries()].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  }

  function renderRanked(targetId,list,emptyText) {
    const target=document.getElementById(targetId);
    if (!list.length) { target.innerHTML=`<div class="table-empty">${safe(emptyText)}</div>`; return; }
    target.innerHTML=list.map((x,i)=>`<article>
      <span>${i+1}</span><div><strong>${safe(x.label)}</strong><small>Selected in ${x.count} household record${x.count===1?"":"s"}</small></div><b>${x.count}</b>
    </article>`).join("");
  }

  function renderStudentAnalytics() {
    const rows=analyticsDataset();
    document.getElementById("student-analytics-n").textContent=rows.length;

    const toilet=ynStat(rows,"with_toilet");
    const services=ynStat(rows,"avail_health_services");
    const participation=ynStat(rows,"community_org_involvement");
    document.getElementById("student-analytics-toilet").textContent=toilet.rate===null?"—":`${toilet.rate}%`;
    document.getElementById("student-analytics-toilet-n").textContent=`${toilet.n} answered`;
    document.getElementById("student-analytics-services").textContent=services.rate===null?"—":`${services.rate}%`;
    document.getElementById("student-analytics-services-n").textContent=`${services.n} answered`;
    document.getElementById("student-analytics-participation").textContent=participation.rate===null?"—":`${participation.rate}%`;
    document.getElementById("student-analytics-participation-n").textContent=`${participation.n} answered`;

    const water=categorical(rows,"water_drinking"), waterN=water.reduce((s,x)=>s+x.count,0);
    const treatment=categorical(rows,"water_treatment"), treatmentN=treatment.reduce((s,x)=>s+x.count,0);
    renderBars("student-water-source",water,waterN);
    renderBars("student-water-treatment",treatment,treatmentN);
    document.getElementById("student-water-source-n").textContent=`${waterN} answered drinking-water source`;
    document.getElementById("student-water-treatment-n").textContent=`${treatmentN} answered water treatment`;

    renderRanked("student-delay-reasons",arrayCounts(rows,["delay_decision","delay_reaching","delay_receiving"]),"No delay reasons selected in the current dataset.");
    renderRanked("student-garbage-list",arrayCounts(rows,["garbage_disposal"]),"No garbage-disposal selections recorded.");

    const quality=[
      ["With toilet",toilet.n],["Avail health services",services.n],["Organization involvement",participation.n],
      ["Drinking water source",waterN],["Water treatment",treatmentN]
    ];
    document.getElementById("student-denominator-grid").innerHTML=quality.map(([label,n])=>{
      const pct=rows.length?Math.round(n/rows.length*100):0;
      return `<article><span>${safe(label)}</span><strong>${n}</strong><small>${pct}% of dataset has an answered value</small><div class="analytics-quality-track"><i style="width:${pct}%"></i></div></article>`;
    }).join("");
  }

  function diagnosisMessage(text,type="") {
    const el=document.getElementById("diagnosis-form-message");
    el.textContent=text; el.className=`admin-message ${type}`;
  }

  async function saveDiagnosis(status) {
    const title=document.getElementById("diagnosis-problem-title").value.trim();
    const evidence=document.getElementById("diagnosis-evidence").value.trim();
    const recommendation=document.getElementById("diagnosis-recommendation").value.trim();
    const rankRaw=document.getElementById("diagnosis-priority-rank").value;
    const rank=rankRaw ? Number(rankRaw) : null;

    if (!title || !evidence) {
      diagnosisMessage("Enter the problem/priority and its evidence or basis.","error");
      return;
    }

    diagnosisMessage("Saving…");
    const {data,error}=await client.from("community_diagnoses").insert({
      community_id:rotation.community_id,
      created_by:user.id,
      problem_title:title,
      evidence_summary:evidence,
      recommendation:recommendation || null,
      priority_rank:Number.isFinite(rank)?rank:null,
      status
    }).select().single();

    if (error) { diagnosisMessage(error.message,"error"); return; }
    diagnoses.push(data);
    document.getElementById("community-diagnosis-form").reset();
    diagnosisMessage(status==="proposed" ? "Proposed for review ✓" : "Draft saved ✓","success");
    renderDiagnoses();
    renderOverview();
  }

  function renderDiagnoses() {
    const target=document.getElementById("community-diagnosis-list");
    const sorted=[...diagnoses].filter(d=>d.status!=="archived").sort((a,b)=>{
      const ar=a.priority_rank??999, br=b.priority_rank??999;
      return ar-br || new Date(b.updated_at)-new Date(a.updated_at);
    });
    if (!sorted.length) {
      target.innerHTML='<div class="table-empty">No community priority problems have been added yet.</div>';
      return;
    }
    target.innerHTML=sorted.map(d=>`
      <article class="community-diagnosis-card">
        <div class="diagnosis-rank">${d.priority_rank ? `#${d.priority_rank}` : "—"}</div>
        <div>
          <div class="diagnosis-card-topline">
            <span class="field-status-chip diagnosis-status-${safe(d.status)}">${safe(d.status)}</span>
            <small>${safe(fmtDate(d.updated_at))}</small>
          </div>
          <h3>${safe(d.problem_title)}</h3>
          <p><strong>Evidence:</strong> ${safe(d.evidence_summary)}</p>
          ${d.recommendation ? `<p><strong>Recommendation:</strong> ${safe(d.recommendation)}</p>` : ""}
          ${d.faculty_feedback ? `<div class="diagnosis-feedback"><strong>Faculty / preceptor feedback</strong><span>${safe(d.faculty_feedback)}</span></div>` : ""}
        </div>
      </article>`).join("");
  }

  function bind() {
    setupTabs();

    document.getElementById("student-survey-detail-close").addEventListener("click",closeMySurvey);
    document.getElementById("student-survey-detail-done").addEventListener("click",closeMySurvey);
    document.getElementById("student-survey-backdrop").addEventListener("click",closeMySurvey);

    ["student-layer-households","student-layer-health","student-layer-projects","student-layer-resources"].forEach(id=>{
      document.getElementById(id).addEventListener("change",renderMap);
    });

    document.getElementById("student-analytics-dataset").addEventListener("change",renderStudentAnalytics);

    document.getElementById("save-diagnosis-draft").addEventListener("click",()=>saveDiagnosis("draft"));
    document.getElementById("community-diagnosis-form").addEventListener("submit",e=>{
      e.preventDefault();
      saveDiagnosis("proposed");
    });
  }

  async function init() {
    try {
      await authorize();
      bind();
      await loadData();
      loading.hidden=true;
      app.hidden=false;
      document.body.classList.remove("portal-is-loading");
    } catch(err) {
      console.error("[Phase 7C.3 Student Diagnosis]",err);
      if (!/No active rotation/.test(err.message||"")) {
        loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open Community Diagnosis</strong><span>${safe(err.message||err)}</span><a href="portal.html">Return to Portal</a>`;
      }
    }
  }

  init();
})();
