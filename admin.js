
(() => {
  const cfg = window.APP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";
  const loading = document.getElementById("admin-loading");
  const app = document.getElementById("admin-app");

  const roles = ["student", "faculty", "preceptor", "coordinator", "admin"];
  const statuses = ["pending", "active", "suspended", "archived"];
  const projectStatuses = ["planning", "active", "for_handover", "completed", "archived"];
  const handoverStatuses = ["draft", "submitted", "approved", "returned"];

  let client;
  let currentUser;
  let currentProfile;
  let users = [];
  let communities = [];
  let rotations = [];
  let projects = [];
  let handovers = [];

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function configMissing() {
    return !url || !key || url.includes("PASTE_YOUR") || key.includes("PASTE_YOUR");
  }

  function showFatal(title, text) {
    loading.hidden = false;
    loading.innerHTML = `
      <img src="assets/shs-logo.png" alt="UPM-SHS">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(text)}</span>
      <a href="portal.html">Return to portal</a>
    `;
  }

  function setMessage(id, message = "", type = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = "admin-message";
    if (type) el.classList.add(type);
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }

  async function bootstrap() {
    if (configMissing() || !window.supabase?.createClient) {
      showFatal("Supabase setup required", "Check supabase-config.js.");
      return;
    }

    client = window.supabase.createClient(url, key);
    const { data: userData, error: userError } = await client.auth.getUser();

    if (userError || !userData?.user) {
      window.location.replace("index.html");
      return;
    }

    currentUser = userData.user;

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,email,full_name,role,status")
      .eq("id", currentUser.id)
      .single();

    if (profileError || !profile) {
      showFatal("Profile unavailable", "Your Toolkit profile could not be loaded.");
      return;
    }

    currentProfile = profile;

    if (profile.status !== "active" || !["admin","coordinator"].includes(profile.role)) {
      showFatal("Administrator access required", "This page is limited to active admins and coordinators.");
      return;
    }

    const name = profile.full_name || profile.email;
    document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = name);
    document.querySelectorAll("[data-user-email]").forEach(el => el.textContent = profile.email || "");
    const initials = name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0].toUpperCase()).join("") || "UP";
    document.querySelectorAll("[data-user-initials]").forEach(el => el.textContent = initials);

    loading.hidden = true;
    app.hidden = false;

    bindEvents();

    await Promise.all([
      loadUsers(),
      loadCommunities(),
      loadRotations(),
      loadProjects(),
      loadHandovers()
    ]);

    refreshStats();
  }

  function bindEvents() {
    document.querySelectorAll("[data-sign-out]").forEach(button => {
      button.addEventListener("click", async () => {
        await client.auth.signOut();
        window.location.replace("index.html");
      });
    });

    document.getElementById("user-search")?.addEventListener("input", renderUsers);
    document.getElementById("user-status-filter")?.addEventListener("change", renderUsers);

    document.getElementById("open-community-form")?.addEventListener("click", () => {
      resetCommunityForm();
      document.getElementById("community-form").hidden = false;
      document.getElementById("community-name").focus();
    });

    document.getElementById("cancel-community")?.addEventListener("click", () => {
      resetCommunityForm();
      document.getElementById("community-form").hidden = true;
    });
    document.getElementById("community-form")?.addEventListener("submit", saveCommunity);

    document.getElementById("rotation-form")?.addEventListener("submit", saveRotation);

    document.getElementById("open-project-form")?.addEventListener("click", () => {
      resetProjectForm();
      document.getElementById("project-form").hidden = false;
      document.getElementById("project-title").focus();
    });

    document.getElementById("cancel-project")?.addEventListener("click", () => {
      resetProjectForm();
      document.getElementById("project-form").hidden = true;
    });
    document.getElementById("project-form")?.addEventListener("submit", saveProject);

    document.getElementById("handover-form")?.addEventListener("submit", saveHandover);
  }

  async function loadUsers() {
    const { data, error } = await client
      .from("profiles")
      .select("id,email,full_name,student_number,year_level,batch,role,status,created_at,approved_at")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("user-message", error.message, "error");
      return;
    }

    users = data || [];
    renderUsers();
    populateRotationUsers();
    refreshStats();
  }

  function renderUsers() {
    const body = document.getElementById("users-body");
    if (!body) return;

    const q = (document.getElementById("user-search")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("user-status-filter")?.value || "all";

    const filtered = users.filter(user => {
      const haystack = [user.full_name, user.email, user.student_number, user.year_level, user.batch, user.role, user.status]
        .filter(Boolean).join(" ").toLowerCase();
      return (!q || haystack.includes(q)) && (statusFilter === "all" || user.status === statusFilter);
    });

    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="5" class="table-empty">No matching users.</td></tr>`;
      return;
    }

    body.innerHTML = filtered.map(user => {
      const isSelf = user.id === currentUser.id;
      const roleOptions = roles.map(role => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`).join("");
      const statusOptions = statuses.map(status => `<option value="${status}" ${user.status === status ? "selected" : ""}>${status}</option>`).join("");
      const approveButton = user.status === "pending"
        ? `<button class="mini-action approve" data-action="approve" data-user-id="${user.id}">Approve</button>`
        : "";
      return `
        <tr>
          <td>
            <div class="table-user">
              <strong>${escapeHtml(user.full_name || "Unnamed user")}</strong>
              <span>${escapeHtml(user.email || "")}</span>
              ${isSelf ? `<small>You</small>` : ""}
            </div>
          </td>
          <td>
            <div class="table-stack">
              <span>${escapeHtml(user.student_number || "—")}</span>
              <small>${escapeHtml([user.year_level, user.batch].filter(Boolean).join(" · ") || "No academic details")}</small>
            </div>
          </td>
          <td>
            <select class="table-select role-select" data-user-id="${user.id}" ${currentProfile.role !== "admin" ? "disabled" : ""}>
              ${roleOptions}
            </select>
          </td>
          <td>
            <select class="table-select status-select" data-user-id="${user.id}" ${currentProfile.role !== "admin" ? "disabled" : ""}>
              ${statusOptions}
            </select>
          </td>
          <td>
            <div class="table-actions">
              ${approveButton}
              ${currentProfile.role === "admin" ? `<button class="mini-action save" data-action="save-user" data-user-id="${user.id}">Save</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    }).join("");

    body.querySelectorAll("[data-action='approve']").forEach(button => {
      button.addEventListener("click", () => approveUser(button.dataset.userId));
    });
    body.querySelectorAll("[data-action='save-user']").forEach(button => {
      button.addEventListener("click", () => saveUser(button.dataset.userId));
    });
  }

  async function approveUser(userId) {
    setMessage("user-message", "Approving account…");
    const { error } = await client.rpc("approve_profile", { target_user: userId });
    if (error) {
      setMessage("user-message", error.message, "error");
      return;
    }
    setMessage("user-message", "Account approved.", "success");
    await loadUsers();
  }

  async function saveUser(userId) {
    const role = document.querySelector(`.role-select[data-user-id="${userId}"]`)?.value;
    const status = document.querySelector(`.status-select[data-user-id="${userId}"]`)?.value;
    if (!role || !status) return;

    setMessage("user-message", "Saving user…");
    const { error } = await client.rpc("admin_update_profile", {
      target_user: userId,
      new_role: role,
      new_status: status
    });

    if (error) {
      setMessage("user-message", error.message, "error");
      return;
    }

    setMessage("user-message", "User updated.", "success");
    await loadUsers();
  }

  async function loadCommunities() {
    const { data, error } = await client
      .from("communities")
      .select("id,name,province,municipality,description,preceptor_name,is_active,created_at")
      .order("name");

    if (error) {
      setMessage("community-message", error.message, "error");
      return;
    }

    communities = data || [];
    renderCommunities();
    populateRotationCommunities();
    populateProjectCommunities();
    refreshStats();
  }

  function renderCommunities() {
    const grid = document.getElementById("admin-community-grid");
    if (!grid) return;

    if (!communities.length) {
      grid.innerHTML = `<div class="table-empty">No communities yet.</div>`;
      return;
    }

    grid.innerHTML = communities.map(c => `
      <article class="admin-community-card ${c.is_active ? "" : "inactive"}">
        <span class="community-card-status">${c.is_active ? "Active" : "Inactive"}</span>
        <h3>${escapeHtml(c.name)}</h3>
        <p>${escapeHtml(c.municipality || c.name)}, ${escapeHtml(c.province || "")}</p>
        <small>${escapeHtml(c.preceptor_name || "No preceptor recorded")}</small>
        <div class="community-card-actions">
          <button class="mini-action save" data-community-action="edit" data-community-id="${c.id}">Edit</button>
          <button class="mini-action ${c.is_active ? "suspend" : "approve"}" data-community-action="toggle" data-community-id="${c.id}">
            ${c.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll("[data-community-action='edit']").forEach(button => {
      button.addEventListener("click", () => editCommunity(button.dataset.communityId));
    });
    grid.querySelectorAll("[data-community-action='toggle']").forEach(button => {
      button.addEventListener("click", () => toggleCommunity(button.dataset.communityId));
    });
  }

  function resetCommunityForm() {
    document.getElementById("community-form")?.reset();
    document.getElementById("community-id").value = "";
    document.getElementById("community-province").value = "Leyte";
    document.getElementById("save-community").textContent = "Save Community";
  }

  function editCommunity(id) {
    const c = communities.find(x => x.id === id);
    if (!c) return;
    document.getElementById("community-form").hidden = false;
    document.getElementById("community-id").value = c.id;
    document.getElementById("community-name").value = c.name || "";
    document.getElementById("community-province").value = c.province || "Leyte";
    document.getElementById("community-municipality").value = c.municipality || "";
    document.getElementById("community-preceptor").value = c.preceptor_name || "";
    document.getElementById("community-description").value = c.description || "";
    document.getElementById("save-community").textContent = "Update Community";
    document.getElementById("community-name").focus();
  }

  async function saveCommunity(event) {
    event.preventDefault();
    const id = document.getElementById("community-id").value;
    const payload = {
      name: document.getElementById("community-name").value.trim(),
      province: document.getElementById("community-province").value.trim() || "Leyte",
      municipality: document.getElementById("community-municipality").value.trim() || null,
      preceptor_name: document.getElementById("community-preceptor").value.trim() || null,
      description: document.getElementById("community-description").value.trim() || null
    };
    if (!payload.name) return;

    setMessage("community-message", id ? "Updating community…" : "Adding community…");

    let result;
    if (id) {
      result = await client.from("communities").update(payload).eq("id", id);
    } else {
      payload.created_by = currentUser.id;
      result = await client.from("communities").insert(payload);
    }

    if (result.error) {
      setMessage("community-message", result.error.message, "error");
      return;
    }

    setMessage("community-message", id ? "Community updated." : "Community added.", "success");
    resetCommunityForm();
    document.getElementById("community-form").hidden = true;
    await loadCommunities();
  }

  async function toggleCommunity(id) {
    const c = communities.find(x => x.id === id);
    if (!c) return;

    const { error } = await client.from("communities").update({ is_active: !c.is_active }).eq("id", id);
    if (error) {
      setMessage("community-message", error.message, "error");
      return;
    }

    setMessage("community-message", c.is_active ? "Community deactivated." : "Community activated.", "success");
    await loadCommunities();
  }

  function populateRotationUsers() {
    const select = document.getElementById("rotation-user");
    if (!select) return;
    const students = users.filter(u => u.status === "active" && u.role === "student")
      .sort((a,b) => (a.full_name || "").localeCompare(b.full_name || ""));
    select.innerHTML = `<option value="">Select active student</option>` + students.map(u => {
      const label = `${u.full_name || u.email}${u.batch ? ` · ${u.batch}` : ""}`;
      return `<option value="${u.id}">${escapeHtml(label)}</option>`;
    }).join("");
  }

  function populateRotationCommunities() {
    const select = document.getElementById("rotation-community");
    if (!select) return;
    select.innerHTML = `<option value="">Select community</option>` +
      communities.filter(c => c.is_active).map(c => `<option value="${c.id}">${escapeHtml(c.name)}, ${escapeHtml(c.province || "")}</option>`).join("");
  }

  async function saveRotation(event) {
    event.preventDefault();
    const payload = {
      user_id: document.getElementById("rotation-user").value,
      community_id: document.getElementById("rotation-community").value,
      rotation_type: document.getElementById("rotation-type").value,
      course_code: document.getElementById("rotation-course").value.trim() || "Community Medicine",
      batch: document.getElementById("rotation-batch").value.trim() || null,
      start_date: document.getElementById("rotation-start").value || null,
      end_date: document.getElementById("rotation-end").value || null,
      notes: document.getElementById("rotation-notes").value.trim() || null,
      status: "active",
      created_by: currentUser.id
    };

    if (!payload.user_id || !payload.community_id) {
      setMessage("rotation-message", "Select both a student and community.", "error");
      return;
    }

    setMessage("rotation-message", "Assigning rotation…");
    const { error } = await client.from("rotation_assignments").insert(payload);

    if (error) {
      setMessage("rotation-message", error.message, "error");
      return;
    }

    setMessage("rotation-message", "Rotation assigned.", "success");
    document.getElementById("rotation-form").reset();
    document.getElementById("rotation-course").value = "Community Medicine";
    await loadRotations();
  }

  async function loadRotations() {
    const { data, error } = await client
      .from("rotation_assignments")
      .select(`
        id,user_id,community_id,course_code,rotation_type,batch,start_date,end_date,status,notes,created_at,
        communities(name,province)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("rotation-message", error.message, "error");
      return;
    }

    rotations = data || [];
    renderRotations();
    refreshStats();
  }

  function renderRotations() {
    const body = document.getElementById("rotations-body");
    if (!body) return;

    if (!rotations.length) {
      body.innerHTML = `<tr><td colspan="6" class="table-empty">No rotation assignments yet.</td></tr>`;
      return;
    }

    body.innerHTML = rotations.map(r => {
      const student = users.find(u => u.id === r.user_id);
      const studentName = student?.full_name || student?.email || r.user_id;
      const community = r.communities?.name || "Unknown community";
      return `
        <tr>
          <td><div class="table-user"><strong>${escapeHtml(studentName)}</strong><span>${escapeHtml(student?.email || "")}</span></div></td>
          <td><div class="table-stack"><strong>${escapeHtml(community)}</strong><small>${escapeHtml(r.communities?.province || "")}</small></div></td>
          <td><div class="table-stack"><span>${escapeHtml(r.course_code || "")}</span><small>${escapeHtml(r.rotation_type || "")}${r.batch ? ` · ${escapeHtml(r.batch)}` : ""}</small></div></td>
          <td><div class="table-stack"><span>${formatDate(r.start_date)}</span><small>to ${formatDate(r.end_date)}</small></div></td>
          <td>
            <select class="table-select rotation-status-select" data-rotation-id="${r.id}">
              ${["planned","active","completed","cancelled"].map(s => `<option value="${s}" ${r.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </td>
          <td><button class="mini-action save" data-rotation-action="save" data-rotation-id="${r.id}">Save</button></td>
        </tr>
      `;
    }).join("");

    body.querySelectorAll("[data-rotation-action='save']").forEach(button => {
      button.addEventListener("click", () => saveRotationStatus(button.dataset.rotationId));
    });
  }

  async function saveRotationStatus(id) {
    const status = document.querySelector(`.rotation-status-select[data-rotation-id="${id}"]`)?.value;
    if (!status) return;

    const { error } = await client.from("rotation_assignments").update({ status }).eq("id", id);
    if (error) {
      setMessage("rotation-message", error.message, "error");
      return;
    }
    setMessage("rotation-message", "Rotation updated.", "success");
    await loadRotations();
  }

  function populateProjectCommunities() {
    const select = document.getElementById("project-community");
    if (!select) return;
    select.innerHTML = `<option value="">Select community</option>` +
      communities.filter(c => c.is_active).map(c => `<option value="${c.id}">${escapeHtml(c.name)}, ${escapeHtml(c.province || "")}</option>`).join("");
  }

  function populateHandoverProjects() {
    const select = document.getElementById("handover-project");
    if (!select) return;
    select.innerHTML = `<option value="">Select project</option>` +
      projects.map(p => `<option value="${p.id}">${escapeHtml(p.title)} · ${escapeHtml(p.community_name || "")}</option>`).join("");
  }

  function resetProjectForm() {
    document.getElementById("project-form")?.reset();
    document.getElementById("project-id").value = "";
    document.getElementById("project-status").value = "planning";
    document.getElementById("save-project").textContent = "Save Project";
  }

  async function loadProjects() {
    const { data, error } = await client
      .from("projects")
      .select(`
        id,community_id,title,category,summary,objectives,status,school_year,batch,start_date,end_date,lead_user_id,created_at,
        communities(name,province)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("project-message", error.message, "error");
      return;
    }

    projects = (data || []).map(p => ({
      ...p,
      community_name: p.communities?.name || "Unknown community",
      province: p.communities?.province || ""
    }));

    renderProjects();
    populateHandoverProjects();
    refreshStats();
  }

  function renderProjects() {
    const grid = document.getElementById("admin-project-grid");
    if (!grid) return;

    if (!projects.length) {
      grid.innerHTML = `<div class="table-empty">No projects yet.</div>`;
      return;
    }

    grid.innerHTML = projects.map(p => `
      <article class="admin-project-card">
        <div class="project-card-top">
          <span class="project-pill status-${escapeHtml(p.status)}">${escapeHtml(p.status.replaceAll("_"," "))}</span>
          <small>${escapeHtml(p.community_name)}</small>
        </div>
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.summary || "No summary yet.")}</p>
        <div class="project-meta">
          <span>${escapeHtml(p.category || "General")}</span>
          <span>${escapeHtml(p.school_year || "—")}</span>
          <span>${escapeHtml(p.batch || "—")}</span>
        </div>
        <div class="community-card-actions">
          <button class="mini-action save" data-project-action="edit" data-project-id="${p.id}">Edit</button>
          <button class="mini-action approve" data-project-action="prefill-handover" data-project-id="${p.id}">Handover</button>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll("[data-project-action='edit']").forEach(button => {
      button.addEventListener("click", () => editProject(button.dataset.projectId));
    });

    grid.querySelectorAll("[data-project-action='prefill-handover']").forEach(button => {
      button.addEventListener("click", () => {
        document.getElementById("handover-project").value = button.dataset.projectId;
        document.getElementById("handovers").scrollIntoView({ behavior: "smooth" });
      });
    });
  }

  function editProject(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    document.getElementById("project-form").hidden = false;
    document.getElementById("project-id").value = p.id;
    document.getElementById("project-community").value = p.community_id || "";
    document.getElementById("project-title").value = p.title || "";
    document.getElementById("project-category").value = p.category || "";
    document.getElementById("project-status").value = p.status || "planning";
    document.getElementById("project-school-year").value = p.school_year || "";
    document.getElementById("project-batch").value = p.batch || "";
    document.getElementById("project-start").value = p.start_date || "";
    document.getElementById("project-end").value = p.end_date || "";
    document.getElementById("project-summary").value = p.summary || "";
    document.getElementById("project-objectives").value = p.objectives || "";
    document.getElementById("save-project").textContent = "Update Project";
    document.getElementById("project-title").focus();
  }

  async function saveProject(event) {
    event.preventDefault();
    const id = document.getElementById("project-id").value;
    const payload = {
      community_id: document.getElementById("project-community").value,
      title: document.getElementById("project-title").value.trim(),
      category: document.getElementById("project-category").value.trim() || null,
      status: document.getElementById("project-status").value,
      school_year: document.getElementById("project-school-year").value.trim() || null,
      batch: document.getElementById("project-batch").value.trim() || null,
      start_date: document.getElementById("project-start").value || null,
      end_date: document.getElementById("project-end").value || null,
      summary: document.getElementById("project-summary").value.trim() || null,
      objectives: document.getElementById("project-objectives").value.trim() || null
    };
    if (!payload.community_id || !payload.title) {
      setMessage("project-message", "Community and title are required.", "error");
      return;
    }

    setMessage("project-message", id ? "Updating project…" : "Creating project…");
    let result;
    if (id) {
      result = await client.from("projects").update(payload).eq("id", id);
    } else {
      payload.created_by = currentUser.id;
      result = await client.from("projects").insert(payload);
    }

    if (result.error) {
      setMessage("project-message", result.error.message, "error");
      return;
    }

    setMessage("project-message", id ? "Project updated." : "Project created.", "success");
    resetProjectForm();
    document.getElementById("project-form").hidden = true;
    await loadProjects();
  }

  async function loadHandovers() {
    const { data, error } = await client
      .from("project_handovers")
      .select(`
        id,project_id,submitted_by,outgoing_batch,status,accomplishments,pending_tasks,recommendations,reviewed_by,reviewed_at,created_at,updated_at,
        projects(title,community_id,communities(name)),
        profiles:submitted_by(full_name,email)
      `)
      .order("updated_at", { ascending: false });

    if (error) {
      setMessage("handover-message", error.message, "error");
      return;
    }

    handovers = (data || []).map(h => ({
      ...h,
      project_title: h.projects?.title || "Unknown project",
      community_name: h.projects?.communities?.name || "",
      submitter_name: h.profiles?.full_name || h.profiles?.email || "Unknown user"
    }));

    renderHandovers();
    refreshStats();
  }

  function renderHandovers() {
    const body = document.getElementById("handovers-body");
    if (!body) return;

    if (!handovers.length) {
      body.innerHTML = `<tr><td colspan="6" class="table-empty">No handovers yet.</td></tr>`;
      return;
    }

    body.innerHTML = handovers.map(h => `
      <tr>
        <td>
          <div class="table-user">
            <strong>${escapeHtml(h.project_title)}</strong>
            <span>${escapeHtml(h.community_name || "")}</span>
          </div>
        </td>
        <td><div class="table-stack"><span>${escapeHtml(h.outgoing_batch || "—")}</span></div></td>
        <td><div class="table-stack"><span>${escapeHtml(h.submitter_name)}</span></div></td>
        <td>
          <select class="table-select handover-status-select" data-handover-id="${h.id}">
            ${handoverStatuses.map(s => `<option value="${s}" ${h.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td><div class="table-stack"><span>${formatDate(h.updated_at)}</span></div></td>
        <td><button class="mini-action save" data-handover-action="save" data-handover-id="${h.id}">Save</button></td>
      </tr>
    `).join("");

    body.querySelectorAll("[data-handover-action='save']").forEach(button => {
      button.addEventListener("click", () => saveHandoverStatus(button.dataset.handoverId));
    });
  }

  async function saveHandover(event) {
    event.preventDefault();
    const payload = {
      project_id: document.getElementById("handover-project").value,
      outgoing_batch: document.getElementById("handover-batch").value.trim() || null,
      status: document.getElementById("handover-status").value,
      accomplishments: document.getElementById("handover-accomplishments").value.trim() || null,
      pending_tasks: document.getElementById("handover-pending").value.trim() || null,
      recommendations: document.getElementById("handover-recommendations").value.trim() || null,
      submitted_by: currentUser.id
    };
    if (!payload.project_id) {
      setMessage("handover-message", "Select a project first.", "error");
      return;
    }

    setMessage("handover-message", "Saving handover…");
    const { error } = await client.from("project_handovers").insert(payload);
    if (error) {
      setMessage("handover-message", error.message, "error");
      return;
    }

    setMessage("handover-message", "Handover saved.", "success");
    document.getElementById("handover-form").reset();
    document.getElementById("handover-status").value = "submitted";
    await loadHandovers();
  }

  async function saveHandoverStatus(id) {
    const status = document.querySelector(`.handover-status-select[data-handover-id="${id}"]`)?.value;
    if (!status) return;

    const payload = { status };
    if (["approved","returned"].includes(status)) {
      payload.reviewed_by = currentUser.id;
      payload.reviewed_at = new Date().toISOString();
    }

    const { error } = await client.from("project_handovers").update(payload).eq("id", id);
    if (error) {
      setMessage("handover-message", error.message, "error");
      return;
    }

    setMessage("handover-message", "Handover updated.", "success");
    await loadHandovers();
  }

  function refreshStats() {
    document.getElementById("stat-pending").textContent = users.filter(u => u.status === "pending").length;
    document.getElementById("stat-active").textContent = users.filter(u => u.status === "active").length;
    document.getElementById("stat-communities").textContent = communities.filter(c => c.is_active).length;
    document.getElementById("stat-rotations").textContent = rotations.filter(r => r.status === "active").length;
    document.getElementById("stat-projects").textContent = projects.length;
    document.getElementById("stat-handovers").textContent = handovers.filter(h => ["submitted","returned"].includes(h.status)).length;
  }

  bootstrap();
})();
