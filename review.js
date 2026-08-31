(() => {
  const cfg = window.APP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";

  const loading = document.getElementById("review-loading");
  const app = document.getElementById("review-app");

  let client;
  let currentUser;
  let currentProfile;
  let documents = [];
  let handovers = [];

  function safe(value = "") {
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setMessage(message = "", type = "") {
    const el = document.getElementById("review-message");
    el.textContent = message;
    el.className = "admin-message";
    if (type) el.classList.add(type);
  }

  function fatal(title, text) {
    loading.innerHTML = `
      <img src="assets/shs-logo.png" alt="UPM-SHS">
      <strong>${safe(title)}</strong>
      <span>${safe(text)}</span>
      <a href="portal.html">Return to portal</a>
    `;
  }

  async function start() {
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

    const { data: profile, error } = await client
      .from("profiles")
      .select("id,email,full_name,role,status")
      .eq("id", currentUser.id)
      .single();

    if (error || !profile) {
      fatal("Profile unavailable", "Your Toolkit profile could not be loaded.");
      return;
    }

    currentProfile = profile;

    if (profile.status !== "active" || !["admin","coordinator","faculty"].includes(profile.role)) {
      fatal("Reviewer access required", "This page is for active faculty, coordinators, and admins.");
      return;
    }

    const fullName = profile.full_name || profile.email;
    const initials = fullName.split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0].toUpperCase()).join("") || "UP";
    document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = fullName);
    document.querySelectorAll("[data-user-email]").forEach(el => el.textContent = profile.email || "");
    document.querySelectorAll("[data-user-initials]").forEach(el => el.textContent = initials);

    document.querySelectorAll("[data-sign-out]").forEach(button => {
      button.addEventListener("click", async () => {
        await client.auth.signOut();
        window.location.replace("index.html");
      });
    });

    loading.hidden = true;
    app.hidden = false;

    await Promise.all([loadDocuments(), loadHandovers()]);
  }

  async function loadDocuments() {
    const { data, error } = await client
      .from("project_documents")
      .select(`
        id,file_name,storage_path,document_type,description,review_status,review_note,created_at,
        projects(title,communities(name))
      `)
      .in("review_status", ["pending","returned"])
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message, "error");
      return;
    }

    documents = data || [];
    renderDocuments();
  }

  function renderDocuments() {
    const target = document.getElementById("review-documents-list");

    if (!documents.length) {
      target.innerHTML = `<div class="table-empty">No pending documents.</div>`;
      return;
    }

    target.innerHTML = documents.map(d => `
      <article class="review-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(d.review_status)}">${safe(d.review_status)}</span>
          <small>${safe(d.document_type || "document")}</small>
        </div>
        <h4>${safe(d.file_name)}</h4>
        <p>${safe(d.projects?.title || "Unknown project")} · ${safe(d.projects?.communities?.name || "")}</p>
        ${d.review_note ? `<div class="document-review-note">Previous note: ${safe(d.review_note)}</div>` : ""}
        <div class="review-actions">
          <button class="mini-action save" data-open-document="${d.id}">Open</button>
          <button class="mini-action approve" data-review-document="${d.id}" data-status="approved">Approve</button>
          <button class="mini-action suspend" data-review-document="${d.id}" data-status="returned">Return</button>
        </div>
      </article>
    `).join("");

    target.querySelectorAll("[data-open-document]").forEach(button => {
      button.addEventListener("click", () => openDocument(button.dataset.openDocument));
    });

    target.querySelectorAll("[data-review-document]").forEach(button => {
      button.addEventListener("click", () => reviewDocument(button.dataset.reviewDocument, button.dataset.status));
    });
  }

  async function openDocument(id) {
    const doc = documents.find(d => d.id === id);
    if (!doc) return;

    const { data, error } = await client.storage
      .from("project-documents")
      .createSignedUrl(doc.storage_path, 300);

    if (error) {
      setMessage(error.message, "error");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function reviewDocument(id, status) {
    let note = "";
    if (status === "returned") {
      note = window.prompt("Optional note for the uploader:", "") || "";
    }

    const { error } = await client.rpc("review_project_document", {
      target_document: id,
      new_status: status,
      reviewer_note: note
    });

    if (error) {
      setMessage(error.message, "error");
      return;
    }

    setMessage(`Document ${status}.`, "success");
    await loadDocuments();
  }

  async function loadHandovers() {
    const { data, error } = await client
      .from("project_handovers")
      .select(`
        id,outgoing_batch,status,accomplishments,pending_tasks,recommendations,updated_at,
        projects(title,communities(name))
      `)
      .eq("status", "submitted")
      .order("updated_at", { ascending: false });

    if (error) {
      setMessage(error.message, "error");
      return;
    }

    handovers = data || [];
    renderHandovers();
  }

  function renderHandovers() {
    const target = document.getElementById("review-handovers-list");

    if (!handovers.length) {
      target.innerHTML = `<div class="table-empty">No submitted handovers.</div>`;
      return;
    }

    target.innerHTML = handovers.map(h => `
      <article class="review-card">
        <div class="project-card-top">
          <span class="project-pill status-submitted">submitted</span>
          <small>${safe(h.projects?.communities?.name || "")}</small>
        </div>
        <h4>${safe(h.projects?.title || "Project handover")}</h4>
        <p>${safe(h.outgoing_batch || "Outgoing batch not specified")}</p>
        <div class="review-actions">
          <a class="mini-action save" href="handover-report.html?id=${encodeURIComponent(h.id)}">Print View</a>
          <button class="mini-action approve" data-review-handover="${h.id}" data-status="approved">Approve</button>
          <button class="mini-action suspend" data-review-handover="${h.id}" data-status="returned">Return</button>
        </div>
      </article>
    `).join("");

    target.querySelectorAll("[data-review-handover]").forEach(button => {
      button.addEventListener("click", () => reviewHandover(button.dataset.reviewHandover, button.dataset.status));
    });
  }

  async function reviewHandover(id, status) {
    const { error } = await client.rpc("review_project_handover", {
      target_handover: id,
      new_status: status
    });

    if (error) {
      setMessage(error.message, "error");
      return;
    }

    setMessage(`Handover ${status}.`, "success");
    await loadHandovers();
  }

  start();
})();
