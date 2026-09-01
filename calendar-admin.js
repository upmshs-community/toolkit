(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById("calendar-admin-loading");
  const app = document.getElementById("calendar-admin-app");

  let client, user, profile;
  let events = [];
  let communities = [];
  let projects = [];
  let courses = [];
  let modules = [];
  let lessons = [];
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const allowedRoles = ["admin","coordinator","faculty"];

  const safe = (v="") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  const initials = name => String(name||"UP")
    .split(/[\s._-]+/).filter(Boolean).slice(0,2)
    .map(x=>x[0]?.toUpperCase()).join("") || "UP";

  function dateKey(value) {
    const d = value instanceof Date ? value : new Date(`${String(value).slice(0,10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function fmtDate(value) {
    if (!value) return "—";
    return new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString(undefined,{
      year:"numeric",month:"short",day:"numeric"
    });
  }

  function typeLabel(type="") {
    return {
      lms_due:"LMS deadline",
      fieldwork:"Fieldwork",
      meeting:"Meeting",
      project:"Project milestone",
      rotation:"Rotation",
      other:"Other"
    }[type] || "Activity";
  }

  function lessonLabel(lesson) {
    const module = modules.find(m=>m.id===lesson.module_id);
    const course = courses.find(c=>c.id===module?.course_id);
    return `${course?.code || "LMS"} · ${module?.title || "Module"} · ${lesson.title}`;
  }

  function communityName(id) {
    return communities.find(c=>c.id===id)?.name || "";
  }

  function projectName(id) {
    return projects.find(p=>p.id===id)?.title || "";
  }

  function destinationLabel(event) {
    if (event.lesson_id) {
      const lesson = lessons.find(l=>l.id===event.lesson_id);
      return lesson ? `LMS · ${lesson.title}` : "LMS lesson";
    }
    const link = String(event.link_url || "");
    if (!link) return "No link";
    if (link === "field-forms.html") return "Field Forms";
    if (link === "community-diagnosis.html") return "Community Diagnosis";
    if (link.startsWith("community.html?id=")) return "Community Profile";
    if (link.startsWith("project.html?id=")) return "Project";
    return "Custom link";
  }

  function audienceLabel(event) {
    const parts = [];
    if (event.community_id) parts.push(communityName(event.community_id) || "Selected community");
    if (event.course_code) parts.push(event.course_code);
    if (event.batch) parts.push(event.batch);
    return parts.length ? parts.join(" · ") : "All active users";
  }

  function message(text, type="") {
    const el = document.getElementById("calendar-form-message");
    el.textContent = text;
    el.className = `admin-message ${type}`;
  }

  async function authorize() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error("Supabase configuration is missing.");
    }

    client = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:u,error:ue} = await client.auth.getUser();
    if (ue || !u?.user) return location.replace("index.html");
    user = u.user;

    const {data:p,error:pe} = await client.from("profiles")
      .select("email,full_name,role,status")
      .eq("id",user.id).single();

    if (pe || !p || p.status!=="active" || !allowedRoles.includes(String(p.role))) {
      return location.replace("portal.html");
    }

    profile = p;
    const name = p.full_name || p.email || user.email || "Calendar Manager";
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email || user.email || "");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));

    document.querySelectorAll("[data-sign-out]").forEach(btn=>btn.addEventListener("click",async()=>{
      await client.auth.signOut();
      location.replace("index.html");
    }));
  }

  async function loadReferenceData() {
    const [communityRes, projectRes, courseRes, moduleRes, lessonRes] = await Promise.all([
      client.from("communities").select("id,name,is_active").eq("is_active",true).order("name"),
      client.from("projects").select("id,title,community_id,status").neq("status","archived").order("title"),
      client.from("lms_courses").select("id,code,title,is_active").eq("is_active",true).order("sort_order"),
      client.from("lms_modules").select("id,title,course_id,is_published").eq("is_published",true).order("sort_order"),
      client.from("lms_lessons").select("id,title,module_id,is_published").eq("is_published",true).order("sort_order")
    ]);

    for (const res of [communityRes,projectRes,courseRes,moduleRes,lessonRes]) {
      if (res.error) throw res.error;
    }

    communities = communityRes.data || [];
    projects = projectRes.data || [];
    courses = courseRes.data || [];
    modules = moduleRes.data || [];
    lessons = lessonRes.data || [];

    const communitySelect = document.getElementById("calendar-event-community");
    communitySelect.innerHTML =
      '<option value="">All communities</option>' +
      communities.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join("");

    const courseOptions = document.getElementById("calendar-course-options");
    courseOptions.innerHTML = courses.map(c=>`<option value="${safe(c.code)}">${safe(c.title || c.code)}</option>`).join("");

    const lessonSelect = document.getElementById("calendar-event-lesson");
    lessonSelect.innerHTML =
      '<option value="">Select lesson</option>' +
      lessons.map(l=>`<option value="${safe(l.id)}">${safe(lessonLabel(l))}</option>`).join("");

    const projectSelect = document.getElementById("calendar-event-project");
    projectSelect.innerHTML =
      '<option value="">Select project</option>' +
      projects.map(p=>`<option value="${safe(p.id)}">${safe(p.title)}${p.community_id ? ` · ${safe(communityName(p.community_id))}` : ""}</option>`).join("");
  }

  async function loadEvents() {
    const {data,error} = await client.from("toolkit_calendar_events")
      .select("*")
      .order("event_date",{ascending:true})
      .order("start_time",{ascending:true});

    if (error) {
      if (/does not exist|schema cache/i.test(error.message || "")) {
        throw new Error("Calendar database is not installed yet. Run phase7c4-calendar-admin.sql in Supabase first.");
      }
      throw error;
    }

    events = data || [];
    renderStats();
    renderCalendar();
    renderEventList();
  }

  function renderStats() {
    const today = new Date();
    const todayKey = dateKey(today);
    const monthStart = dateKey(new Date(today.getFullYear(),today.getMonth(),1));
    const monthEnd = dateKey(new Date(today.getFullYear(),today.getMonth()+1,0));
    const next14 = dateKey(new Date(today.getFullYear(),today.getMonth(),today.getDate()+14));

    document.getElementById("calendar-stat-published").textContent =
      events.filter(e=>e.is_published).length;

    document.getElementById("calendar-stat-month").textContent =
      events.filter(e=>e.event_date>=monthStart && e.event_date<=monthEnd).length;

    document.getElementById("calendar-stat-upcoming").textContent =
      events.filter(e=>e.is_published && e.event_date>=todayKey && e.event_date<=next14).length;

    document.getElementById("calendar-stat-lms").textContent =
      events.filter(e=>e.event_type==="lms_due" && e.is_published).length;
  }

  function renderCalendar() {
    const grid = document.getElementById("admin-calendar-grid");
    const label = document.getElementById("admin-calendar-month-label");
    if (!grid || !label) return;

    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    label.textContent = calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});

    const firstDay = new Date(year,month,1).getDay();
    const days = new Date(year,month+1,0).getDate();
    const today = dateKey(new Date());

    const byDate = new Map();
    events.forEach(event=>{
      if (!byDate.has(event.event_date)) byDate.set(event.event_date,[]);
      byDate.get(event.event_date).push(event);
    });

    const cells = [];
    for (let i=0;i<firstDay;i++) cells.push('<div class="calendar-manager-day is-empty"></div>');

    for (let day=1;day<=days;day++) {
      const key = dateKey(new Date(year,month,day));
      const dayEvents = (byDate.get(key)||[]).sort((a,b)=>String(a.start_time||"").localeCompare(String(b.start_time||"")));

      const preview = dayEvents.slice(0,2).map(event=>`
        <button class="calendar-day-event type-${safe(event.event_type)}"
                type="button"
                data-edit-event="${safe(event.id)}">
          ${safe(event.title)}
        </button>
      `).join("");

      cells.push(`
        <div class="calendar-manager-day ${key===today ? "is-today" : ""}" data-calendar-day="${key}">
          <button class="calendar-day-number" type="button" data-new-on-date="${key}">${day}</button>
          <div class="calendar-day-events">${preview}</div>
          ${dayEvents.length>2 ? `<small>+${dayEvents.length-2} more</small>` : ""}
        </div>
      `);
    }

    grid.innerHTML = cells.join("");

    grid.querySelectorAll("[data-new-on-date]").forEach(btn=>{
      btn.addEventListener("click",()=>startNewEvent(btn.dataset.newOnDate));
    });

    grid.querySelectorAll("[data-edit-event]").forEach(btn=>{
      btn.addEventListener("click",event=>{
        event.stopPropagation();
        editEvent(btn.dataset.editEvent);
      });
    });
  }

  function filteredEvents() {
    const q = document.getElementById("calendar-search").value.trim().toLowerCase();
    const type = document.getElementById("calendar-filter-type").value;
    const publish = document.getElementById("calendar-filter-published").value;

    return events.filter(event=>{
      if (q) {
        const hay = [
          event.title,event.description,event.course_code,event.batch,
          communityName(event.community_id),destinationLabel(event)
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (type && event.event_type!==type) return false;
      if (publish==="published" && !event.is_published) return false;
      if (publish==="draft" && event.is_published) return false;
      return true;
    });
  }

  function renderEventList() {
    const rows = filteredEvents();
    const body = document.getElementById("calendar-events-body");
    const footer = document.getElementById("calendar-list-footer");

    footer.textContent = `${rows.length} activit${rows.length===1 ? "y" : "ies"}`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty">No calendar activities match the current filter.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(event=>`
      <tr>
        <td>
          <strong class="calendar-table-date">${safe(fmtDate(event.event_date))}</strong>
          <small>${event.start_time ? safe(String(event.start_time).slice(0,5)) : "All day"}</small>
        </td>
        <td>
          <span class="calendar-type-chip type-${safe(event.event_type)}">${safe(typeLabel(event.event_type))}</span>
          <strong class="calendar-table-title">${safe(event.title)}</strong>
          ${event.description ? `<small>${safe(event.description)}</small>` : ""}
        </td>
        <td><span class="calendar-audience-chip">${safe(audienceLabel(event))}</span></td>
        <td>${safe(destinationLabel(event))}</td>
        <td>
          <span class="calendar-publish-status ${event.is_published ? "published" : "draft"}">
            ${event.is_published ? "Published" : "Unpublished"}
          </span>
        </td>
        <td>
          <div class="calendar-row-actions">
            <button type="button" data-edit="${safe(event.id)}">Edit</button>
            <button type="button" data-duplicate="${safe(event.id)}">Duplicate</button>
            <button type="button" data-toggle="${safe(event.id)}">${event.is_published ? "Unpublish" : "Publish"}</button>
            <button class="danger" type="button" data-delete="${safe(event.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    body.querySelectorAll("[data-edit]").forEach(btn=>btn.addEventListener("click",()=>editEvent(btn.dataset.edit)));
    body.querySelectorAll("[data-duplicate]").forEach(btn=>btn.addEventListener("click",()=>duplicateEvent(btn.dataset.duplicate)));
    body.querySelectorAll("[data-toggle]").forEach(btn=>btn.addEventListener("click",()=>togglePublished(btn.dataset.toggle)));
    body.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>deleteEvent(btn.dataset.delete)));
  }

  function updateAudienceSummary() {
    const community = document.getElementById("calendar-event-community").value;
    const course = document.getElementById("calendar-event-course").value.trim();
    const batch = document.getElementById("calendar-event-batch").value.trim();
    const parts = [];
    if (community) parts.push(communityName(community));
    if (course) parts.push(course);
    if (batch) parts.push(batch);

    document.getElementById("calendar-audience-summary").textContent =
      parts.length
        ? `Visible to active users matching: ${parts.join(" · ")}.`
        : "Visible to all active Toolkit users.";
  }

  function updateLinkFields() {
    const type = document.getElementById("calendar-link-type").value;
    document.getElementById("calendar-lesson-wrap").hidden = type!=="lesson";
    document.getElementById("calendar-project-wrap").hidden = type!=="project";
    document.getElementById("calendar-custom-link-wrap").hidden = type!=="custom";
  }

  function resetForm(date="") {
    document.getElementById("calendar-event-form").reset();
    document.getElementById("calendar-event-id").value = "";
    document.getElementById("calendar-event-date").value = date || "";
    document.getElementById("calendar-event-type").value = "other";
    document.getElementById("calendar-event-published").checked = true;
    document.getElementById("calendar-link-type").value = "none";
    document.getElementById("calendar-event-lesson").value = "";
    document.getElementById("calendar-event-project").value = "";
    document.getElementById("calendar-event-custom-link").value = "";
    document.getElementById("calendar-editor-title").textContent = "Add Activity";
    document.getElementById("calendar-editor-copy").textContent =
      "Create a published activity or save it unpublished while preparing it.";
    document.getElementById("calendar-save-event").textContent = "Save Activity";
    updateAudienceSummary();
    updateLinkFields();
    message("");
  }

  function startNewEvent(date="") {
    resetForm(date);
    document.querySelector(".calendar-editor-card")?.scrollIntoView({behavior:"smooth",block:"start"});
    setTimeout(()=>document.getElementById("calendar-event-title")?.focus(),300);
  }

  function inferLinkType(event) {
    if (event.lesson_id) return "lesson";
    const link = String(event.link_url||"");
    if (!link) return "none";
    if (link==="field-forms.html") return "field_forms";
    if (link==="community-diagnosis.html") return "diagnosis";
    if (link.startsWith("community.html?id=")) return "community";
    if (link.startsWith("project.html?id=")) return "project";
    return "custom";
  }

  function editEvent(id) {
    const event = events.find(x=>x.id===id);
    if (!event) return;

    document.getElementById("calendar-event-id").value = event.id;
    document.getElementById("calendar-event-title").value = event.title || "";
    document.getElementById("calendar-event-date").value = event.event_date || "";
    document.getElementById("calendar-event-type").value = event.event_type || "other";
    document.getElementById("calendar-event-start").value = event.start_time ? String(event.start_time).slice(0,5) : "";
    document.getElementById("calendar-event-end").value = event.end_time ? String(event.end_time).slice(0,5) : "";
    document.getElementById("calendar-event-description").value = event.description || "";
    document.getElementById("calendar-event-community").value = event.community_id || "";
    document.getElementById("calendar-event-course").value = event.course_code || "";
    document.getElementById("calendar-event-batch").value = event.batch || "";
    document.getElementById("calendar-event-published").checked = !!event.is_published;

    const linkType = inferLinkType(event);
    document.getElementById("calendar-link-type").value = linkType;
    document.getElementById("calendar-event-lesson").value = event.lesson_id || "";

    if (linkType==="project") {
      document.getElementById("calendar-event-project").value =
        String(event.link_url||"").split("id=")[1] || "";
    } else {
      document.getElementById("calendar-event-project").value = "";
    }

    document.getElementById("calendar-event-custom-link").value =
      linkType==="custom" ? (event.link_url || "") : "";

    document.getElementById("calendar-editor-title").textContent = "Edit Activity";
    document.getElementById("calendar-editor-copy").textContent = `Editing ${fmtDate(event.event_date)} · ${typeLabel(event.event_type)}`;
    document.getElementById("calendar-save-event").textContent = "Update Activity";
    updateAudienceSummary();
    updateLinkFields();
    message("");

    document.querySelector(".calendar-editor-card")?.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function buildLinkPayload() {
    const type = document.getElementById("calendar-link-type").value;
    const communityId = document.getElementById("calendar-event-community").value || null;

    if (type==="none") return {link_url:null,lesson_id:null};
    if (type==="lesson") {
      const lesson = document.getElementById("calendar-event-lesson").value;
      if (!lesson) throw new Error("Select an LMS lesson.");
      return {link_url:null,lesson_id:lesson};
    }
    if (type==="field_forms") return {link_url:"field-forms.html",lesson_id:null};
    if (type==="diagnosis") return {link_url:"community-diagnosis.html",lesson_id:null};
    if (type==="community") {
      if (!communityId) throw new Error("Select a community before using Community Profile as the destination.");
      return {link_url:`community.html?id=${communityId}`,lesson_id:null};
    }
    if (type==="project") {
      const projectId = document.getElementById("calendar-event-project").value;
      if (!projectId) throw new Error("Select a project.");
      return {link_url:`project.html?id=${projectId}`,lesson_id:null};
    }
    if (type==="custom") {
      const url = document.getElementById("calendar-event-custom-link").value.trim();
      if (!url) throw new Error("Enter a custom URL or Toolkit page.");
      return {link_url:url,lesson_id:null};
    }
    return {link_url:null,lesson_id:null};
  }

  async function saveEvent(event) {
    event.preventDefault();
    try {
      const id = document.getElementById("calendar-event-id").value;
      const title = document.getElementById("calendar-event-title").value.trim();
      const eventDate = document.getElementById("calendar-event-date").value;
      if (!title || !eventDate) throw new Error("Activity title and date are required.");

      const links = buildLinkPayload();

      const payload = {
        title,
        event_date:eventDate,
        start_time:document.getElementById("calendar-event-start").value || null,
        end_time:document.getElementById("calendar-event-end").value || null,
        event_type:document.getElementById("calendar-event-type").value,
        description:document.getElementById("calendar-event-description").value.trim() || null,
        community_id:document.getElementById("calendar-event-community").value || null,
        course_code:document.getElementById("calendar-event-course").value.trim() || null,
        batch:document.getElementById("calendar-event-batch").value.trim() || null,
        is_published:document.getElementById("calendar-event-published").checked,
        link_url:links.link_url,
        lesson_id:links.lesson_id,
        created_by:user.id
      };

      message(id ? "Updating activity…" : "Saving activity…");

      let result;
      if (id) {
        const {created_by,...updatePayload} = payload;
        result = await client.from("toolkit_calendar_events")
          .update(updatePayload)
          .eq("id",id)
          .select()
          .single();
      } else {
        result = await client.from("toolkit_calendar_events")
          .insert(payload)
          .select()
          .single();
      }

      if (result.error) throw result.error;

      message(id ? "Activity updated ✓" : "Activity added ✓","success");
      resetForm();
      await loadEvents();
    } catch (error) {
      message(error.message || String(error),"error");
    }
  }

  async function duplicateEvent(id) {
    const source = events.find(x=>x.id===id);
    if (!source) return;

    const {id:sourceId,created_at,updated_at,...payload} = source;
    payload.title = `${source.title} (Copy)`;
    payload.is_published = false;
    payload.created_by = user.id;

    const {error} = await client.from("toolkit_calendar_events").insert(payload);
    if (error) return message(error.message,"error");

    message("Activity duplicated as unpublished draft ✓","success");
    await loadEvents();
  }

  async function togglePublished(id) {
    const source = events.find(x=>x.id===id);
    if (!source) return;

    const {error} = await client.from("toolkit_calendar_events")
      .update({is_published:!source.is_published})
      .eq("id",id);

    if (error) return message(error.message,"error");
    await loadEvents();
  }

  async function deleteEvent(id) {
    const source = events.find(x=>x.id===id);
    if (!source) return;
    if (!window.confirm(`Delete "${source.title}" from the Toolkit calendar?`)) return;

    const {error} = await client.from("toolkit_calendar_events").delete().eq("id",id);
    if (error) return message(error.message,"error");

    if (document.getElementById("calendar-event-id").value===id) resetForm();
    message("Activity deleted.","success");
    await loadEvents();
  }

  function bind() {
    document.getElementById("calendar-event-form").addEventListener("submit",saveEvent);
    document.getElementById("calendar-new-event").addEventListener("click",()=>startNewEvent());
    document.getElementById("calendar-cancel-edit").addEventListener("click",()=>resetForm());

    document.getElementById("calendar-link-type").addEventListener("change",updateLinkFields);
    ["calendar-event-community","calendar-event-course","calendar-event-batch"].forEach(id=>{
      document.getElementById(id).addEventListener("input",updateAudienceSummary);
      document.getElementById(id).addEventListener("change",updateAudienceSummary);
    });

    document.getElementById("admin-calendar-prev").addEventListener("click",()=>{
      calendarCursor = new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);
      renderCalendar();
    });

    document.getElementById("admin-calendar-next").addEventListener("click",()=>{
      calendarCursor = new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);
      renderCalendar();
    });

    ["calendar-search","calendar-filter-type","calendar-filter-published"].forEach(id=>{
      document.getElementById(id).addEventListener("input",renderEventList);
      document.getElementById(id).addEventListener("change",renderEventList);
    });
  }

  async function init() {
    try {
      await authorize();
      bind();
      await loadReferenceData();
      await loadEvents();
      resetForm();

      loading.hidden = true;
      app.hidden = false;
      document.body.classList.remove("portal-is-loading");
    } catch (error) {
      console.error("[Calendar Administration]",error);
      loading.innerHTML = `
        <img src="assets/shs-logo.png" alt="UPM-SHS">
        <strong>Unable to open Calendar Administration</strong>
        <span>${safe(error.message || error)}</span>
        <a href="admin.html">Return to Administration</a>
      `;
    }
  }

  init();
})();
