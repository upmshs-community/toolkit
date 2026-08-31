(() => {
  const cfg = window.APP_CONFIG || {};
  let client, user, profile;

  const safe = (v = "") => String(v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function fatal(title, text) {
    const loading = document.getElementById("faculty-loading");
    loading.innerHTML = `<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>${safe(title)}</strong><span>${safe(text)}</span><a href="portal.html">Return to portal</a>`;
  }

  async function countRows(table, column, value) {
    let q = client.from(table).select("id", { count: "exact", head: true });
    if (column) q = q.eq(column, value);
    const { count, error } = await q;
    return error ? null : (count || 0);
  }

  async function init() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return fatal("Supabase setup required", "Check supabase-config.js.");
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data: ud } = await client.auth.getUser();
    if (!ud?.user) return location.replace("index.html");
    user = ud.user;

    const { data: p, error } = await client.from("profiles").select("id,email,full_name,role,status").eq("id", user.id).single();
    if (error || !p) return fatal("Profile unavailable", error?.message || "Your profile could not be loaded.");
    profile = p;
    if (p.status !== "active" || !["faculty","coordinator","admin"].includes(p.role)) {
      return fatal("Faculty access required", "This workspace is intended for active faculty and program administrators.");
    }

    const fullName = p.full_name || p.email || "Faculty";
    const firstName = fullName.trim().split(/\s+/)[0] || "Faculty";
    document.querySelectorAll("[data-user-name]").forEach(x => x.textContent = fullName);
    document.querySelectorAll("[data-user-email]").forEach(x => x.textContent = p.email || "");
    document.querySelectorAll("[data-user-first-name]").forEach(x => x.textContent = firstName);
    document.querySelectorAll("[data-user-initials]").forEach(x => x.textContent = fullName.split(/\s+/).slice(0,2).map(s => s[0]?.toUpperCase()).join("") || "UP");
    document.querySelectorAll("[data-sign-out]").forEach(b => b.addEventListener("click", async () => { await client.auth.signOut(); location.replace("index.html"); }));

    const [{ data: assignments, error: assignmentError }, docCount, handoverCount, resourceCount] = await Promise.all([
      client.from("faculty_community_assignments")
        .select(`id,community_id,role_label,course_code,batch,start_date,end_date,notes,is_active,communities(name,province,municipality)`)
        .eq("faculty_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      countRows("project_documents", "review_status", "pending"),
      countRows("project_handovers", "status", "submitted"),
      countRows("toolkit_resources", "created_by", user.id)
    ]);

    const currentAssignments = assignmentError ? [] : (assignments || []);
    document.getElementById("faculty-stat-assignments").textContent = String(currentAssignments.length);
    document.getElementById("faculty-stat-documents").textContent = docCount ?? "—";
    document.getElementById("faculty-stat-handovers").textContent = handoverCount ?? "—";
    document.getElementById("faculty-stat-resources").textContent = resourceCount ?? "—";

    renderAssignments(currentAssignments);
    await Promise.all([loadProjects(currentAssignments), loadResources()]);

    document.getElementById("faculty-loading").hidden = true;
    document.getElementById("faculty-app").hidden = false;
  }

  function renderAssignments(assignments) {
    const target = document.getElementById("faculty-assignment-cards");
    if (!assignments.length) {
      target.innerHTML = `<div class="table-empty">No active community assignment recorded yet. A coordinator/admin can assign one from Toolkit Administration.</div>`;
      return;
    }
    target.innerHTML = assignments.map(a => `
      <article class="faculty-assignment-card">
        <span class="project-pill status-active">${safe(a.role_label || "Preceptor")}</span>
        <h3>${safe(a.communities?.name || "Community")}</h3>
        <p>${safe([a.communities?.municipality, a.communities?.province].filter(Boolean).join(", "))}</p>
        <div class="faculty-card-meta"><span>${safe(a.course_code || "Community Medicine")}</span><span>${safe(a.batch || "—")}</span></div>
        ${a.community_id ? `<a class="mini-action save" href="community.html?id=${encodeURIComponent(a.community_id)}">Open Community</a>` : ""}
      </article>
    `).join("");
  }

  async function loadProjects(assignments) {
    const target = document.getElementById("faculty-projects");
    const ids = [...new Set(assignments.map(a => a.community_id).filter(Boolean))];
    if (!ids.length) {
      target.innerHTML = `<div class="table-empty">Projects will appear here once you have an active community assignment.</div>`;
      return;
    }
    const { data, error } = await client.from("projects")
      .select("id,title,category,status,school_year,batch,community_id,communities(name)")
      .in("community_id", ids)
      .order("updated_at", { ascending: false });
    if (error || !data?.length) {
      target.innerHTML = `<div class="table-empty">No project records found for your assigned communities.</div>`;
      return;
    }
    target.innerHTML = data.slice(0,8).map(p => `
      <a class="faculty-project-row" href="project.html?id=${encodeURIComponent(p.id)}">
        <div><strong>${safe(p.title)}</strong><span>${safe(p.communities?.name || "")} · ${safe(p.category || "General")}</span></div>
        <span class="project-pill status-${safe(p.status)}">${safe(String(p.status || "").replaceAll("_"," "))}</span>
      </a>
    `).join("");
  }

  async function loadResources() {
    const target = document.getElementById("faculty-resources");
    const { data, error } = await client.from("toolkit_resources")
      .select("id,title,resource_type,status,updated_at")
      .eq("created_by", user.id)
      .order("updated_at", { ascending: false })
      .limit(8);
    if (error || !data?.length) {
      target.innerHTML = `<div class="table-empty">You have not contributed a resource yet. Use Knowledge & Resources to add one.</div>`;
      return;
    }
    target.innerHTML = data.map(r => `
      <article class="faculty-resource-row">
        <div><strong>${safe(r.title)}</strong><span>${safe(String(r.resource_type || "resource").replaceAll("_"," "))}</span></div>
        <span class="project-pill status-${safe(r.status)}">${safe(r.status)}</span>
      </article>
    `).join("");
  }

  init();
})();
