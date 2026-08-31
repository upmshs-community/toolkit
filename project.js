(() => {
  const cfg = window.APP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";

  const loading = document.getElementById("project-loading");
  const app = document.getElementById("project-app");

  let client;
  let currentUser;
  let currentProfile;
  let project;
  let indicators = [];
  let documents = [];
  let handovers = [];
  let canContribute = false;

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("id");

  function safe(value = "") {
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setMessage(id, message = "", type = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = "admin-message";
    if (type) el.classList.add(type);
  }

  function fatal(title, text) {
    loading.hidden = false;
    loading.innerHTML = `
      <img src="assets/shs-logo.png" alt="UPM-SHS">
      <strong>${safe(title)}</strong>
      <span>${safe(text)}</span>
      <a href="portal.html#projects">Return to projects</a>
    `;
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.replace("index.html");
  }

  async function bootstrap() {
    if (!projectId) {
      fatal("Project not specified", "Open a project from the Toolkit project registry.");
      return;
    }

    if (!url || !key || url.includes("PASTE_YOUR") || key.includes("PASTE_YOUR")) {
      fatal("Supabase setup required", "Check supabase-config.js.");
      return;
    }

    client = window.supabase.createClient(url, key);

    const { data: userData } = await client.auth.getUser();
    if (!userData?.user) {
      window.location.replace("index.html");
      return;
    }

    currentUser = userData.user;

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,email,full_name,role,status,batch,year_level")
      .eq("id", currentUser.id)
      .single();

    if (profileError || !profile || profile.status !== "active") {
      fatal("Active account required", "Your Toolkit profile is not currently active.");
      return;
    }

    currentProfile = profile;

    const { data: allowed } = await client.rpc("user_can_contribute_to_project", {
      target_project: projectId
    });
    canContribute = !!allowed;

    const { data: projectData, error: projectError } = await client
      .from("projects")
      .select(`
        id,community_id,title,category,summary,objectives,status,school_year,batch,start_date,end_date,
        communities(name,province,preceptor_name)
      `)
      .eq("id", projectId)
      .single();

    if (projectError || !projectData) {
      fatal("Project unavailable", projectError?.message || "The project could not be loaded.");
      return;
    }

    project = projectData;

    const fullName = profile.full_name || profile.email;
    const initials = fullName.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0].toUpperCase()).join("") || "UP";
    document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = fullName);
    document.querySelectorAll("[data-user-email]").forEach(el => el.textContent = profile.email || "");
    document.querySelectorAll("[data-user-initials]").forEach(el => el.textContent = initials);

    document.querySelectorAll("[data-sign-out]").forEach(button => {
      button.addEventListener("click", signOut);
    });

    renderProjectHeader();
    bindEvents();

    loading.hidden = true;
    app.hidden = false;

    await Promise.all([
      loadIndicators(),
      loadDocuments(),
      loadHandovers()
    ]);
  }

  function renderProjectHeader() {
    document.title = `${project.title} | Community Health Toolkit`;
    document.getElementById("project-community-label").textContent =
      `${project.communities?.name || "Community"} · ${project.communities?.province || ""}`;
    document.getElementById("project-title").textContent = project.title;
    document.getElementById("project-summary").textContent = project.summary || "No summary recorded.";
    document.getElementById("project-objectives").textContent = project.objectives || "No objectives recorded.";

    const status = document.getElementById("project-status-pill");
    status.textContent = (project.status || "").replaceAll("_"," ");
    status.className = `project-pill status-${project.status || "planning"}`;

    document.getElementById("project-category").textContent = project.category || "General";
    document.getElementById("project-school-year").textContent = project.school_year || "School year —";
    document.getElementById("project-batch").textContent = project.batch || "Batch —";

    document.getElementById("toggle-indicator-form").hidden = !canContribute;
    document.getElementById("document-upload-form").hidden = !canContribute;
  }

  function bindEvents() {
    document.getElementById("toggle-indicator-form")?.addEventListener("click", () => {
      document.getElementById("indicator-form").hidden = false;
    });

    document.getElementById("cancel-indicator-form")?.addEventListener("click", () => {
      document.getElementById("indicator-form").reset();
      document.getElementById("indicator-form").hidden = true;
    });

    document.getElementById("indicator-form")?.addEventListener("submit", saveIndicator);
    document.getElementById("document-upload-form")?.addEventListener("submit", uploadDocument);
  }

  async function loadIndicators() {
    const { data, error } = await client
      .from("project_indicators")
      .select("id,name,definition,unit,baseline_value,target_value,current_value,status,updated_at")
      .eq("project_id", projectId)
      .order("created_at");

    if (error) {
      setMessage("indicator-message", error.message, "error");
      return;
    }

    indicators = data || [];
    renderIndicators();
  }

  function renderIndicators() {
    const target = document.getElementById("indicator-list");
    if (!indicators.length) {
      target.innerHTML = `<div class="table-empty">No monitoring indicators yet.</div>`;
      return;
    }

    target.innerHTML = indicators.map(i => `
      <article class="indicator-card">
        <div class="project-card-top">
          <span class="project-pill indicator-${safe(i.status)}">${safe((i.status || "").replaceAll("_"," "))}</span>
          <small>${safe(i.unit || "No unit")}</small>
        </div>
        <h3>${safe(i.name)}</h3>
        <p>${safe(i.definition || "No definition recorded.")}</p>
        <div class="indicator-values">
          <span><small>Baseline</small><strong>${safe(i.baseline_value || "—")}</strong></span>
          <span><small>Target</small><strong>${safe(i.target_value || "—")}</strong></span>
          <span><small>Current</small><strong>${safe(i.current_value || "—")}</strong></span>
        </div>
      </article>
    `).join("");
  }

  async function saveIndicator(event) {
    event.preventDefault();

    const payload = {
      project_id: projectId,
      name: document.getElementById("indicator-name").value.trim(),
      definition: document.getElementById("indicator-definition").value.trim() || null,
      unit: document.getElementById("indicator-unit").value.trim() || null,
      baseline_value: document.getElementById("indicator-baseline").value.trim() || null,
      target_value: document.getElementById("indicator-target").value.trim() || null,
      current_value: document.getElementById("indicator-current").value.trim() || null,
      status: document.getElementById("indicator-status").value,
      last_updated_by: currentUser.id
    };

    if (!payload.name) return;

    setMessage("indicator-message", "Saving indicator…");
    const { error } = await client.from("project_indicators").insert(payload);

    if (error) {
      setMessage("indicator-message", error.message, "error");
      return;
    }

    setMessage("indicator-message", "Indicator saved.", "success");
    document.getElementById("indicator-form").reset();
    document.getElementById("indicator-form").hidden = true;
    await loadIndicators();
  }

  async function loadDocuments() {
    const { data, error } = await client
      .from("project_documents")
      .select("id,file_name,storage_path,mime_type,size_bytes,document_type,description,review_status,review_note,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("document-message", error.message, "error");
      return;
    }

    documents = data || [];
    renderDocuments();
  }

  function renderDocuments() {
    const target = document.getElementById("document-list");
    if (!documents.length) {
      target.innerHTML = `<div class="table-empty">No uploaded documents yet.</div>`;
      return;
    }

    target.innerHTML = documents.map(d => `
      <article class="document-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(d.review_status)}">${safe(d.review_status)}</span>
          <small>${safe(d.document_type)}</small>
        </div>
        <h3>${safe(d.file_name)}</h3>
        <p>${safe(d.description || "No description.")}</p>
        ${d.review_note ? `<div class="document-review-note">Review note: ${safe(d.review_note)}</div>` : ""}
        <button class="mini-action save" data-open-document="${d.id}">Open</button>
      </article>
    `).join("");

    target.querySelectorAll("[data-open-document]").forEach(button => {
      button.addEventListener("click", () => openDocument(button.dataset.openDocument));
    });
  }

  async function openDocument(id) {
    const doc = documents.find(d => d.id === id);
    if (!doc) return;

    const { data, error } = await client.storage
      .from("project-documents")
      .createSignedUrl(doc.storage_path, 300);

    if (error) {
      setMessage("document-message", error.message, "error");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function cleanFileName(name) {
    return name
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function uploadDocument(event) {
    event.preventDefault();

    const input = document.getElementById("document-file");
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setMessage("document-message", "Maximum file size is 10 MB.", "error");
      return;
    }

    const unique = crypto.randomUUID();
    const safeName = cleanFileName(file.name) || "document";
    const storagePath = `${projectId}/${unique}-${safeName}`;

    setMessage("document-message", "Uploading document…");

    const { error: uploadError } = await client.storage
      .from("project-documents")
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined
      });

    if (uploadError) {
      setMessage("document-message", uploadError.message, "error");
      return;
    }

    const metadata = {
      project_id: projectId,
      uploaded_by: currentUser.id,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      document_type: document.getElementById("document-type").value,
      description: document.getElementById("document-description").value.trim() || null,
      review_status: "pending"
    };

    const { error: metadataError } = await client
      .from("project_documents")
      .insert(metadata);

    if (metadataError) {
      await client.storage.from("project-documents").remove([storagePath]);
      setMessage("document-message", metadataError.message, "error");
      return;
    }

    setMessage("document-message", "Document uploaded and sent for review.", "success");
    document.getElementById("document-upload-form").reset();
    await loadDocuments();
  }

  async function loadHandovers() {
    const { data, error } = await client
      .from("project_handovers")
      .select("id,outgoing_batch,status,accomplishments,pending_tasks,recommendations,updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    if (error) return;

    handovers = data || [];
    const target = document.getElementById("project-handover-list");

    if (!handovers.length) {
      target.innerHTML = `<article class="portal-handover-card"><strong>No handovers yet</strong><span>No continuity notes have been submitted.</span></article>`;
      return;
    }

    target.innerHTML = handovers.map(h => `
      <article class="portal-handover-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(h.status)}">${safe(h.status)}</span>
          <a class="mini-action save handover-report-link" href="handover-report.html?id=${encodeURIComponent(h.id)}">Print View</a>
        </div>
        <strong>${safe(h.outgoing_batch || "Outgoing batch not specified")}</strong>
        <span>${safe(h.pending_tasks || h.accomplishments || h.recommendations || "No summary text.")}</span>
      </article>
    `).join("");
  }

  bootstrap();
})();
