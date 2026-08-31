(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById("analytics-loading");
  const app = document.getElementById("analytics-app");

  let client, user, profile;
  let submissions = [], communities = [], filtered = [];

  const managerRoles = ["admin","coordinator","faculty"];
  const safe = (v="") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const initials = name => String(name||"UP").split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("") || "UP";

  function answer(r, key) {
    return r?.response_json?.[key];
  }

  function normalizedYN(value, allowNA=false) {
    const v = String(value ?? "").trim().toLowerCase();
    if (v === "yes") return "Yes";
    if (v === "no") return "No";
    if (allowNA && v === "na") return "NA";
    return null;
  }

  function rateFor(rows, key, {allowNA=false}={}) {
    const values = rows.map(r => normalizedYN(answer(r,key), allowNA)).filter(v => v && v !== "NA");
    const yes = values.filter(v => v === "Yes").length;
    const no = values.filter(v => v === "No").length;
    const answered = yes + no;
    return { yes, no, answered, rate: answered ? Math.round((yes/answered)*100) : null };
  }

  function formatRate(stat) {
    return stat.rate === null ? "—" : `${stat.rate}%`;
  }

  function categorical(rows, key, {exclude=[]}={}) {
    const map = new Map();
    rows.forEach(r => {
      const raw = answer(r,key);
      const value = String(raw ?? "").trim();
      if (!value || exclude.includes(value)) return;
      map.set(value, (map.get(value) || 0) + 1);
    });
    return [...map.entries()]
      .map(([label,count]) => ({label,count}))
      .sort((a,b) => b.count-a.count || a.label.localeCompare(b.label));
  }

  function multiSelectCounts(rows, keys) {
    const map = new Map();
    rows.forEach(r => {
      keys.forEach(key => {
        const raw = answer(r,key);
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        arr.forEach(v => {
          const label = String(v || "").trim();
          if (label) map.set(label, (map.get(label)||0)+1);
        });
      });
    });
    return [...map.entries()]
      .map(([label,count]) => ({label,count}))
      .sort((a,b) => b.count-a.count || a.label.localeCompare(b.label));
  }

  function renderBars(targetId, list, denominator, {yesNo=false}={}) {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (!list.length) {
      target.innerHTML = '<div class="table-empty">No answered records in the current dataset.</div>';
      return;
    }
    const max = Math.max(1, ...list.map(x=>x.count));
    target.innerHTML = list.map(item => {
      const percent = denominator ? Math.round((item.count/denominator)*100) : 0;
      const width = Math.round((item.count/max)*100);
      const cls = yesNo ? ` analytics-${String(item.label).toLowerCase()}` : "";
      return `<div class="analytics-bar-row${cls}">
        <div><span>${safe(item.label)}</span><strong>${item.count}${denominator ? ` · ${percent}%` : ""}</strong></div>
        <div class="analytics-bar-track"><i style="width:${width}%"></i></div>
      </div>`;
    }).join("");
  }

  function setRateCard(valueId, noteId, stat, label="answered") {
    document.getElementById(valueId).textContent = formatRate(stat);
    document.getElementById(noteId).textContent = `${stat.answered} ${label}`;
  }

  function communityName(id) {
    return communities.find(c=>c.id===id)?.name || "Unassigned";
  }

  function populateFilters() {
    const csel = document.getElementById("analytics-community-filter");
    csel.innerHTML = '<option value="">All communities</option>' +
      communities.map(c => `<option value="${safe(c.id)}">${safe(c.name)}</option>`).join("");
    refreshBarangays();
  }

  function refreshBarangays() {
    const community = document.getElementById("analytics-community-filter").value;
    const sel = document.getElementById("analytics-barangay-filter");
    const current = sel.value;
    const list = [...new Set(
      submissions
        .filter(r => !community || r.community_id === community)
        .map(r => r.barangay)
        .filter(Boolean)
    )].sort((a,b)=>a.localeCompare(b));
    sel.innerHTML = '<option value="">All barangays</option>' + list.map(v=>`<option>${safe(v)}</option>`).join("");
    if (list.includes(current)) sel.value = current;
  }

  function applyFilters() {
    const dataset = document.getElementById("analytics-dataset-filter").value;
    const community = document.getElementById("analytics-community-filter").value;
    const barangay = document.getElementById("analytics-barangay-filter").value;
    const from = document.getElementById("analytics-date-from").value;
    const to = document.getElementById("analytics-date-to").value;

    filtered = submissions.filter(r => {
      if (dataset === "reviewed" && r.status !== "reviewed") return false;
      if (dataset === "completed_reviewed" && !["completed","reviewed"].includes(r.status)) return false;
      if (dataset === "all_non_archived" && r.status === "archived") return false;
      if (community && r.community_id !== community) return false;
      if (barangay && r.barangay !== barangay) return false;
      if (from && (!r.interview_date || r.interview_date < from)) return false;
      if (to && (!r.interview_date || r.interview_date > to)) return false;
      return true;
    });

    renderAnalytics();
  }

  function renderAnalytics() {
    document.getElementById("kpi-households").textContent = filtered.length;
    const datasetLabel = document.getElementById("analytics-dataset-filter").selectedOptions[0]?.textContent || "Dataset";
    document.getElementById("kpi-households-note").textContent = datasetLabel;

    const toilet = rateFor(filtered, "with_toilet");
    const services = rateFor(filtered, "avail_health_services");
    const fpAccess = rateFor(filtered, "fp_access", {allowNA:true});
    const prenatal = rateFor(filtered, "pn_prenatal_care", {allowNA:true});
    const participation = rateFor(filtered, "community_org_involvement");
    setRateCard("kpi-toilet","kpi-toilet-note",toilet);
    setRateCard("kpi-services","kpi-services-note",services);
    setRateCard("kpi-fp-access","kpi-fp-note",fpAccess,"applicable/answered");
    setRateCard("kpi-prenatal","kpi-prenatal-note",prenatal,"applicable/answered");
    setRateCard("kpi-participation","kpi-participation-note",participation);

    const waterSource = categorical(filtered, "water_drinking");
    const waterTreatment = categorical(filtered, "water_treatment");
    const waterSourceN = waterSource.reduce((s,x)=>s+x.count,0);
    const waterTreatmentN = waterTreatment.reduce((s,x)=>s+x.count,0);
    renderBars("chart-water-source", waterSource, waterSourceN);
    renderBars("chart-water-treatment", waterTreatment, waterTreatmentN);
    document.getElementById("water-source-denominator").textContent = `${waterSourceN} household records answered drinking-water source`;
    document.getElementById("water-treatment-denominator").textContent = `${waterTreatmentN} household records answered water treatment`;

    renderBars("chart-toilet-access",
      [{label:"Yes",count:toilet.yes},{label:"No",count:toilet.no}].filter(x=>x.count),
      toilet.answered, {yesNo:true});
    document.getElementById("toilet-denominator").textContent = `${toilet.answered} answered`;

    renderBars("chart-services",
      [{label:"Yes",count:services.yes},{label:"No",count:services.no}].filter(x=>x.count),
      services.answered, {yesNo:true});
    document.getElementById("services-denominator").textContent = `${services.answered} answered`;

    renderBars("chart-participation",
      [{label:"Yes",count:participation.yes},{label:"No",count:participation.no}].filter(x=>x.count),
      participation.answered, {yesNo:true});
    document.getElementById("participation-denominator").textContent = `${participation.answered} answered`;

    const fpPractice = rateFor(filtered, "fp_practicing", {allowNA:true});
    document.getElementById("fp-access-rate").textContent = formatRate(fpAccess);
    document.getElementById("fp-access-denom").textContent = `${fpAccess.answered} applicable/answered`;
    document.getElementById("fp-practice-rate").textContent = formatRate(fpPractice);
    document.getElementById("fp-practice-denom").textContent = `${fpPractice.answered} applicable/answered`;

    const firstTrimester = rateFor(filtered, "pn_first_trimester", {allowNA:true});
    const postnatal = rateFor(filtered, "pn_postnatal_visit", {allowNA:true});
    document.getElementById("maternal-prenatal-rate").textContent = formatRate(prenatal);
    document.getElementById("maternal-prenatal-denom").textContent = `${prenatal.answered} applicable/answered`;
    document.getElementById("maternal-trimester-rate").textContent = formatRate(firstTrimester);
    document.getElementById("maternal-trimester-denom").textContent = `${firstTrimester.answered} applicable/answered`;
    document.getElementById("maternal-postnatal-rate").textContent = formatRate(postnatal);
    document.getElementById("maternal-postnatal-denom").textContent = `${postnatal.answered} applicable/answered`;

    const delays = multiSelectCounts(filtered, ["delay_decision","delay_reaching","delay_receiving"]);
    renderRankedList("delay-reasons-list", delays, "No delay reasons were selected in the current dataset.");

    let philhealthHouseholds=0, philhealthMembers=0, active=0, inactive=0;
    filtered.forEach(r => {
      const rows = Array.isArray(answer(r,"philhealth_members")) ? answer(r,"philhealth_members") : [];
      if (rows.length) philhealthHouseholds++;
      rows.forEach(m => {
        if (!m || !Object.values(m).some(v=>String(v||"").trim())) return;
        philhealthMembers++;
        const remarks = String(m.remarks||"").trim().toLowerCase();
        if (remarks==="active") active++;
        if (remarks==="inactive") inactive++;
      });
    });
    document.getElementById("philhealth-households").textContent = philhealthHouseholds;
    document.getElementById("philhealth-members").textContent = philhealthMembers;
    document.getElementById("philhealth-active").textContent = active;
    document.getElementById("philhealth-inactive").textContent = inactive;

    const diarrhea = rateFor(filtered, "morbidity_diarrhea", {allowNA:true});
    renderBars("chart-diarrhea",
      [{label:"Yes",count:diarrhea.yes},{label:"No",count:diarrhea.no}].filter(x=>x.count),
      diarrhea.answered, {yesNo:true});
    document.getElementById("diarrhea-denominator").textContent = `${diarrhea.answered} applicable/answered`;

    const garbage = multiSelectCounts(filtered, ["garbage_disposal"]);
    renderRankedList("garbage-disposal-list", garbage, "No garbage-disposal selections recorded.");

    renderQuality([
      ["With toilet", toilet.answered],
      ["Avail health services", services.answered],
      ["Family planning access", fpAccess.answered],
      ["Family planning practice", fpPractice.answered],
      ["Prenatal care", prenatal.answered],
      ["First trimester visit", firstTrimester.answered],
      ["Postnatal visit", postnatal.answered],
      ["Community organization involvement", participation.answered],
      ["Drinking water source", waterSourceN],
      ["Water treatment", waterTreatmentN],
      ["Repeated diarrheal episodes", diarrhea.answered]
    ]);
  }

  function renderRankedList(targetId, list, emptyText) {
    const target = document.getElementById(targetId);
    if (!list.length) {
      target.innerHTML = `<div class="table-empty">${safe(emptyText)}</div>`;
      return;
    }
    target.innerHTML = list.map((item,index)=>`
      <article>
        <span>${index+1}</span>
        <div><strong>${safe(item.label)}</strong><small>Selected in ${item.count} household record${item.count===1?"":"s"}</small></div>
        <b>${item.count}</b>
      </article>
    `).join("");
  }

  function renderQuality(rows) {
    const total = filtered.length;
    const target = document.getElementById("analytics-quality-grid");
    target.innerHTML = rows.map(([label,n]) => {
      const pct = total ? Math.round((n/total)*100) : 0;
      return `<article>
        <span>${safe(label)}</span>
        <strong>${n}</strong>
        <small>${pct}% of current dataset has an applicable/answered value</small>
        <div class="analytics-quality-track"><i style="width:${pct}%"></i></div>
      </article>`;
    }).join("");
  }

  function exportSummaryCSV() {
    const toilet = rateFor(filtered, "with_toilet");
    const services = rateFor(filtered, "avail_health_services");
    const fp = rateFor(filtered, "fp_access", {allowNA:true});
    const prenatal = rateFor(filtered, "pn_prenatal_care", {allowNA:true});
    const participation = rateFor(filtered, "community_org_involvement");

    const rows = [
      ["Metric","Value","Answered denominator"],
      ["Households in current dataset", filtered.length, filtered.length],
      ["Households with toilet (%)", toilet.rate ?? "", toilet.answered],
      ["Households availing health services (%)", services.rate ?? "", services.answered],
      ["Family planning access (%)", fp.rate ?? "", fp.answered],
      ["Prenatal care received (%)", prenatal.rate ?? "", prenatal.answered],
      ["Community organization involvement (%)", participation.rate ?? "", participation.answered]
    ];

    const csv = rows.map(row => row.map(v => `"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `community-health-analytics-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function init() {
    try {
      if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
        throw new Error("Supabase configuration is missing.");
      }
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

      const {data:userData,error:userError} = await client.auth.getUser();
      if (userError || !userData?.user) return location.replace("index.html");
      user = userData.user;

      const {data:p,error:pError} = await client.from("profiles")
        .select("id,email,full_name,role,status")
        .eq("id",user.id).single();
      if (pError || !p || p.status!=="active" || !managerRoles.includes(p.role)) {
        return location.replace("portal.html");
      }
      profile=p;

      const name = p.full_name || p.email || "Toolkit Manager";
      document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
      document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email||"");
      document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));
      document.querySelectorAll("[data-sign-out]").forEach(btn=>btn.addEventListener("click",async()=>{
        await client.auth.signOut(); location.replace("index.html");
      }));

      const [sRes,cRes] = await Promise.all([
        client.from("field_form_submissions")
          .select("id,community_id,status,household_code,interview_date,barangay,zone,interviewer,response_json,updated_at"),
        client.from("communities")
          .select("id,name,province,is_active")
          .eq("is_active",true)
          .order("name")
      ]);
      if (sRes.error) throw sRes.error;
      if (cRes.error) throw cRes.error;
      submissions = sRes.data || [];
      communities = cRes.data || [];

      populateFilters();

      document.getElementById("analytics-dataset-filter").addEventListener("change",applyFilters);
      document.getElementById("analytics-community-filter").addEventListener("change",()=>{
        refreshBarangays(); applyFilters();
      });
      document.getElementById("analytics-barangay-filter").addEventListener("change",applyFilters);
      document.getElementById("analytics-date-from").addEventListener("change",applyFilters);
      document.getElementById("analytics-date-to").addEventListener("change",applyFilters);
      document.getElementById("analytics-clear-filters").addEventListener("click",()=>{
        document.getElementById("analytics-dataset-filter").value="reviewed";
        document.getElementById("analytics-community-filter").value="";
        document.getElementById("analytics-barangay-filter").value="";
        document.getElementById("analytics-date-from").value="";
        document.getElementById("analytics-date-to").value="";
        refreshBarangays(); applyFilters();
      });
      document.getElementById("analytics-export-btn").addEventListener("click",exportSummaryCSV);

      applyFilters();
      loading.hidden=true;
      app.hidden=false;
      document.body.classList.remove("portal-is-loading");
    } catch (err) {
      console.error("[Health Analytics]",err);
      loading.innerHTML = `<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open analytics</strong><span>${safe(err.message||err)}</span><a href="admin.html">Return to Administration</a>`;
    }
  }

  init();
})();
