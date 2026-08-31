
(() => {
  // Lets portal.html distinguish a JS loading problem from an auth/data problem.
  window.__TOOLKIT_PORTAL_JS_LOADED__ = true;
  const cfg = window.APP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";
  const app = document.getElementById("portal-app");
  const loading = document.getElementById("portal-loading");

  let client;
  let currentUser = null;
  let currentProfile = null;
  let currentRotation = null;
  let communities = [];
  let projects = [];
  let handovers = [];

  function withTimeout(promise, milliseconds, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.round(milliseconds / 1000)} seconds.`));
      }, milliseconds);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function showBootstrapError(title, error, detail = "") {
    console.error("[Toolkit Portal]", title, error);
    setLoadingCard({
      title,
      text: error?.message || String(error || "Unknown error"),
      detail: detail || "Refresh once. If this continues, verify supabase-config.js and the browser console.",
      action: `
        <div class="pending-actions">
          <button id="portal-retry" class="button button-green" type="button">Retry</button>
          <a class="button button-outline-maroon" href="index.html">Back to Login</a>
        </div>
      `
    });
    document.getElementById("portal-retry")?.addEventListener("click", () => window.location.reload());
  }

  function configMissing() {
    return !url || !key || url.includes("PASTE_YOUR") || key.includes("PASTE_YOUR");
  }

  function safe(value = "") {
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setLoadingCard({title, text, detail = "", action = ""}) {
    if (!loading) return;
    document.body.classList.add("portal-is-loading");
    document.body.classList.remove("portal-is-ready");
    if (app) app.hidden = true;
    loading.hidden = false;
    loading.removeAttribute("aria-hidden");
    loading.innerHTML = `
      <img src="assets/shs-logo.png" alt="UPM-SHS">
      <strong>${safe(title)}</strong>
      <span>${safe(text)}</span>
      ${detail ? `<small class="portal-status-detail">${safe(detail)}</small>` : ""}
      ${action}
    `;
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.replace("index.html");
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }

  function renderCommunities() {
    const target = document.getElementById("portal-communities");
    if (!target) return;
    if (!communities.length) {
      target.innerHTML = `<article><span>—</span><strong>No communities</strong><small>No data yet</small></article>`;
      return;
    }
    target.innerHTML = communities.map((c, index) => `
      <a class="portal-community-link" href="community.html?id=${encodeURIComponent(c.id)}">
        <article>
          <span>${String(index + 1).padStart(2,"0")}</span>
          <strong>${safe(c.name)}</strong>
          <small>${safe(c.preceptor_name || c.province || "Learning site")}</small>
        </article>
      </a>
    `).join("");
  }

  function renderProjects() {
    const target = document.getElementById("portal-projects");
    if (!target) return;

    if (!projects.length) {
      target.innerHTML = `
        <article class="project-portal-card">
          <h3>No projects yet</h3>
          <p>No project records are available for your current view.</p>
        </article>
      `;
      document.getElementById("dashboard-project-count").textContent = "0";
      document.getElementById("dashboard-project-detail").textContent = "No registered projects yet.";
      return;
    }

    target.innerHTML = projects.map(p => `
      <article class="project-portal-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(p.status)}">${safe((p.status || "").replaceAll("_"," "))}</span>
          <small>${safe(p.community_name || "")}</small>
        </div>
        <h3>${safe(p.title)}</h3>
        <p>${safe(p.summary || "No summary yet.")}</p>
        <div class="project-meta">
          <span>${safe(p.category || "General")}</span>
          <span>${safe(p.school_year || "—")}</span>
          <span>${safe(p.batch || "—")}</span>
        </div>
        <a class="mini-action save project-open-link" href="project.html?id=${encodeURIComponent(p.id)}">Open Project</a>
      </article>
    `).join("");

    document.getElementById("dashboard-project-count").textContent = String(projects.filter(p => ["active","for_handover","planning"].includes(p.status)).length);
    document.getElementById("dashboard-project-detail").textContent =
      currentRotation ? `Projects linked to ${currentRotation.community_name}.` : "Showing accessible project records.";
  }

  function renderHandovers() {
    const target = document.getElementById("portal-handover-list");
    if (!target) return;

    if (!handovers.length) {
      target.innerHTML = `
        <article class="portal-handover-card">
          <strong>No handovers yet</strong>
          <span>No continuity notes are available yet for your current view.</span>
        </article>
      `;
      document.getElementById("dashboard-handover-count").textContent = "0";
      document.getElementById("dashboard-handover-detail").textContent = "No pending or recent handovers.";
      return;
    }

    target.innerHTML = handovers.map(h => `
      <article class="portal-handover-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(h.status)}">${safe((h.status || "").replaceAll("_"," "))}</span>
          <small>${safe(h.project_title)}</small>
        </div>
        <strong>${safe(h.community_name || "Community project")}</strong>
        <span>${safe(h.outgoing_batch ? `Outgoing batch: ${h.outgoing_batch}` : "Outgoing batch not specified")}</span>
        <p>${safe(h.pending_tasks || h.accomplishments || h.recommendations || "No summary text.")}</p>
      </article>
    `).join("");

    document.getElementById("dashboard-handover-count").textContent = String(handovers.filter(h => ["submitted","returned"].includes(h.status)).length);
    document.getElementById("dashboard-handover-detail").textContent =
      currentRotation ? `Recent handovers for ${currentRotation.community_name}.` : "Showing accessible handover notes.";
  }

  function populatePortalHandoverProjects() {
    const select = document.getElementById("portal-handover-project");
    if (!select) return;
    select.innerHTML = `<option value="">Select project</option>` +
      projects.map(p => `<option value="${p.id}">${safe(p.title)} · ${safe(p.community_name || "")}</option>`).join("");
  }

  function setHandoverEligibility() {
    const note = document.getElementById("portal-handover-eligibility");
    const form = document.getElementById("portal-handover-form");
    if (!note || !form) return;

    const elevated = ["admin","coordinator","faculty","preceptor"].includes(currentProfile.role);
    const canSubmit = elevated || !!currentRotation;

    if (canSubmit && projects.length) {
      note.textContent = elevated
        ? "You may submit continuity notes for any listed project."
        : `You may submit continuity notes for projects in ${currentRotation.community_name}.`;
      form.hidden = false;
      document.getElementById("portal-handover-batch").value = currentProfile.batch || "";
    } else if (canSubmit && !projects.length) {
      note.textContent = "You have handover permission, but no project records are available yet.";
      form.hidden = true;
    } else {
      note.textContent = "A current community assignment is required before a student can submit a handover.";
      form.hidden = true;
    }
  }

  async function loadResourceCount() {
    const countEl = document.getElementById("dashboard-resource-count");
    const detailEl = document.getElementById("dashboard-resource-detail");

    const { count, error } = await client
      .from("toolkit_resources")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    if (error) {
      if (countEl) countEl.textContent = "—";
      if (detailEl) detailEl.textContent = "Approved resource count unavailable.";
      return;
    }

    if (countEl) countEl.textContent = String(count || 0);
    if (detailEl) {
      detailEl.textContent = count
        ? `${count} approved resource${count === 1 ? "" : "s"} available in the Library.`
        : "Resources are being prepared for publication.";
    }
  }

  async function loadCommunities() {
    const { data, error } = await client
      .from("communities")
      .select("id,name,province,municipality,preceptor_name,is_active")
      .eq("is_active", true)
      .order("name");
    if (!error) communities = data || [];
    renderCommunities();
  }

  async function loadCurrentRotation(userId) {
    const { data, error } = await client
      .from("rotation_assignments")
      .select(`
        id,community_id,course_code,rotation_type,batch,start_date,end_date,status,notes,
        communities(name,province,municipality,preceptor_name,description)
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    const summary = document.getElementById("current-rotation-summary");
    const communityEl = document.getElementById("dashboard-community");
    const detailEl = document.getElementById("dashboard-rotation-detail");

    if (error || !data?.length) {
      currentRotation = null;
      if (summary) {
        summary.innerHTML = `
          <strong>No active rotation assigned yet.</strong>
          <span>Your coordinator can assign your community from the Admin portal.</span>
        `;
      }
      if (communityEl) communityEl.textContent = "To be assigned";
      if (detailEl) detailEl.textContent = "No active rotation assignment yet.";
      return;
    }

    const rotation = data[0];
    currentRotation = {
      id: rotation.id,
      community_id: rotation.community_id,
      community_name: rotation.communities?.name || "Assigned community",
      preceptor_name: rotation.communities?.preceptor_name || "",
      course_code: rotation.course_code,
      rotation_type: rotation.rotation_type,
      batch: rotation.batch
    };

    const details = [rotation.rotation_type, rotation.course_code, rotation.batch].filter(Boolean).join(" · ");
    if (communityEl) communityEl.textContent = currentRotation.community_name;
    if (detailEl) detailEl.textContent = details || "Active rotation";

    if (summary) {
      const preceptor = currentRotation.preceptor_name
        ? `<small>Preceptor: ${safe(currentRotation.preceptor_name)}</small>`
        : "";
      summary.innerHTML = `
        <span class="portal-label">Current assignment</span>
        <strong>${safe(currentRotation.community_name)}</strong>
        <span>${safe(details || "Active rotation")}</span>
        ${preceptor}
      `;
    }
  }

  async function loadProjects() {
    let query = client
      .from("projects")
      .select(`
        id,community_id,title,category,summary,objectives,status,school_year,batch,start_date,end_date,created_at,
        communities(name,province)
      `)
      .order("created_at", { ascending: false });

    const elevated = ["admin","coordinator","faculty","preceptor"].includes(currentProfile.role);
    if (!elevated && currentRotation?.community_id) {
      query = query.eq("community_id", currentRotation.community_id);
    }

    const { data, error } = await query;
    if (error) {
      document.getElementById("dashboard-project-count").textContent = "—";
      document.getElementById("dashboard-project-detail").textContent = error.message;
      return;
    }

    projects = (data || []).map(p => ({
      ...p,
      community_name: p.communities?.name || "Unknown community"
    }));
    renderProjects();
    populatePortalHandoverProjects();
    setHandoverEligibility();
  }

  async function loadHandovers() {
    let query = client
      .from("project_handovers")
      .select(`
        id,project_id,outgoing_batch,status,accomplishments,pending_tasks,recommendations,updated_at,
        projects(title,community_id,communities(name))
      `)
      .order("updated_at", { ascending: false })
      .limit(8);

    const elevated = ["admin","coordinator","faculty","preceptor"].includes(currentProfile.role);
    if (!elevated && currentRotation?.community_id) {
      query = query.eq("projects.community_id", currentRotation.community_id);
    }

    const { data, error } = await query;
    if (error) {
      document.getElementById("dashboard-handover-count").textContent = "—";
      document.getElementById("dashboard-handover-detail").textContent = error.message;
      return;
    }

    handovers = (data || []).map(h => ({
      ...h,
      project_title: h.projects?.title || "Unknown project",
      community_name: h.projects?.communities?.name || ""
    }));
    renderHandovers();
  }

  async function submitPortalHandover(event) {
    event.preventDefault();
    const payload = {
      project_id: document.getElementById("portal-handover-project").value,
      outgoing_batch: document.getElementById("portal-handover-batch").value.trim() || null,
      accomplishments: document.getElementById("portal-handover-accomplishments").value.trim() || null,
      pending_tasks: document.getElementById("portal-handover-pending").value.trim() || null,
      recommendations: document.getElementById("portal-handover-recommendations").value.trim() || null,
      status: "submitted",
      submitted_by: currentUser.id
    };

    if (!payload.project_id) {
      const m = document.getElementById("portal-handover-message");
      m.textContent = "Select a project first.";
      m.className = "admin-message error";
      return;
    }

    const { error } = await client.from("project_handovers").insert(payload);
    const m = document.getElementById("portal-handover-message");
    if (error) {
      m.textContent = error.message;
      m.className = "admin-message error";
      return;
    }

    m.textContent = "Handover submitted.";
    m.className = "admin-message success";
    document.getElementById("portal-handover-form").reset();
    document.getElementById("portal-handover-batch").value = currentProfile.batch || "";
    await loadHandovers();
  }

  async function start() {
    try {
      if (configMissing() || !window.supabase?.createClient) {
        document.body.classList.add("portal-is-loading");
        if (app) app.hidden = true;
        if (loading) {
          loading.innerHTML = `
            <img src="assets/shs-logo.png" alt="UPM-SHS">
            <strong>Supabase setup required.</strong>
            <span>Check <code>supabase-config.js</code> and make sure the Supabase browser client loaded.</span>
            <a href="index.html">Return to login</a>
          `;
          loading.classList.add("portal-error");
        }
        return;
      }

      client = window.supabase.createClient(url, key);

      // Use the browser's persisted session first.
      // This avoids blocking the whole portal on auth.getUser() after a successful login.
      const sessionResult = await withTimeout(
        client.auth.getSession(),
        8000,
        "Supabase session check"
      );

      const session = sessionResult?.data?.session;
      const sessionError = sessionResult?.error;

      if (sessionError) throw sessionError;

      if (!session?.user) {
        setLoadingCard({
          title: "Your login session was not found",
          text: "Please sign in again.",
          detail: "This can happen after changing Supabase projects or clearing browser storage.",
          action: `<a class="button button-maroon" href="index.html">Go to Login</a>`
        });
        return;
      }

      const user = session.user;
      currentUser = user;

      // Load the Toolkit profile with a timeout so the UI never spins forever.
      const profileResult = await withTimeout(
        client
          .from("profiles")
          .select("id,email,full_name,student_number,year_level,batch,role,status")
          .eq("id", user.id)
          .maybeSingle(),
        10000,
        "Toolkit profile lookup"
      );

      const profile = profileResult?.data;
      const profileError = profileResult?.error;

      if (profileError) {
        showBootstrapError(
          "Profile lookup failed",
          profileError,
          "Your Supabase login worked, but the profiles table could not be read. Check the Phase 1 schema/RLS."
        );
        return;
      }

      if (!profile) {
        setLoadingCard({
          title: "Profile setup incomplete",
          text: "Your authenticated account exists, but there is no matching row in public.profiles.",
          detail: `Auth user: ${user.email || user.id}`,
          action: `
            <div class="pending-actions">
              <button id="status-signout" class="button button-maroon" type="button">Sign out</button>
            </div>
          `
        });
        document.getElementById("status-signout")?.addEventListener("click", signOut);
        return;
      }

      currentProfile = profile;

      if (profile.status === "pending") {
        setLoadingCard({
          title: "Registration received",
          text: "Your account is verified but is still Pending Approval.",
          detail: `${profile.full_name || "Toolkit user"} · ${profile.email || user.email || ""}${profile.batch ? ` · ${profile.batch}` : ""}`,
          action: `
            <div class="pending-actions">
              <a class="button button-green" href="index.html">Return to public site</a>
              <button id="status-signout" class="button button-outline-maroon" type="button">Sign out</button>
            </div>
          `
        });
        document.getElementById("status-signout")?.addEventListener("click", signOut);
        return;
      }

      if (profile.status === "suspended") {
        setLoadingCard({
          title: "Account suspended",
          text: "Your Toolkit access has been temporarily suspended.",
          detail: "Please contact the program coordinator if you believe this is an error.",
          action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
        });
        document.getElementById("status-signout")?.addEventListener("click", signOut);
        return;
      }

      if (profile.status === "archived") {
        setLoadingCard({
          title: "Account archived",
          text: "This Toolkit account is archived and no longer has active access.",
          action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
        });
        document.getElementById("status-signout")?.addEventListener("click", signOut);
        return;
      }

      if (profile.status !== "active") {
        setLoadingCard({
          title: "Access unavailable",
          text: `Your account status is “${profile.status || "unknown"}”.`,
          detail: "The account must be Active before the Toolkit dashboard can open.",
          action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
        });
        document.getElementById("status-signout")?.addEventListener("click", signOut);
        return;
      }

      const fullName = profile.full_name || user.email || "Authorized user";
      const email = profile.email || user.email || "";
      const role = profile.role || "student";

      document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = fullName);
      document.querySelectorAll("[data-user-email]").forEach(el => el.textContent = email);
      document.querySelectorAll("[data-user-role]").forEach(el => el.textContent = role.charAt(0).toUpperCase() + role.slice(1));
      document.querySelectorAll("[data-user-batch]").forEach(el => el.textContent = profile.batch || "—");
      document.querySelectorAll("[data-user-year]").forEach(el => el.textContent = profile.year_level || "—");

      const initials = fullName
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("") || "UP";
      document.querySelectorAll("[data-user-initials]").forEach(el => el.textContent = initials);

      const adminLink = document.getElementById("admin-link");
      if (adminLink && ["admin","coordinator"].includes(role)) adminLink.hidden = false;

      const reviewLink = document.getElementById("review-link");
      if (reviewLink && ["admin","coordinator","faculty","preceptor"].includes(role)) reviewLink.hidden = false;

      const knowledgeLink = document.getElementById("knowledge-link");
      if (knowledgeLink && ["admin","coordinator","faculty"].includes(role)) knowledgeLink.hidden = false;

      document.querySelectorAll("[data-sign-out]").forEach(button => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          button.textContent = "Signing out…";
          await signOut();
        });
      });

      document.getElementById("portal-handover-form")?.addEventListener("submit", submitPortalHandover);

      // Switch atomically from the full-screen loader to the app.
      // The CSS also has explicit [hidden] rules so loader and dashboard can never show together.
      if (app) app.hidden = false;
      if (loading) {
        loading.hidden = true;
        loading.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("portal-is-loading");
      document.body.classList.add("portal-is-ready");
      window.scrollTo(0, 0);

      // The rest of the dashboard data should not be allowed to block opening.
      const settled = await Promise.allSettled([
        loadCurrentRotation(user.id),
        loadCommunities(),
        loadResourceCount()
      ]);

      settled.forEach(result => {
        if (result.status === "rejected") console.warn("[Toolkit Portal] non-blocking dashboard load:", result.reason);
      });

      try { await loadProjects(); } catch (error) { console.warn("[Toolkit Portal] projects:", error); }
      try { await loadHandovers(); } catch (error) { console.warn("[Toolkit Portal] handovers:", error); }

      // Optional server verification AFTER the UI is already open.
      client.auth.getUser().then(({ error }) => {
        if (error) console.warn("[Toolkit Portal] background auth verification:", error.message);
      }).catch(() => {});

    } catch (error) {
      showBootstrapError(
        "The Toolkit could not finish opening",
        error,
        "The page is no longer allowed to stay on an infinite loading screen."
      );
    }
  }

  start();
})();
