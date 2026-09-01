(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById("lms-admin-loading");
  const app = document.getElementById("lms-admin-app");

  let client, user, profile;
  let courses = [], modules = [], lessons = [], resources = [], lessonResources = [];
  let selectedType = null, selectedId = null;
  let progressRows = [];
  const managerRoles = ["admin","coordinator","faculty"];

  const safe = (v="") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  const initials = name => String(name || "UP").split(/[\s._-]+/)
    .filter(Boolean).slice(0,2).map(v=>v[0]?.toUpperCase()).join("") || "UP";

  function message(text="", type="") {
    const el = document.getElementById("lms-editor-message");
    el.textContent = text;
    el.className = `admin-message ${type}`;
  }

  function selectedCourseForNode() {
    if (selectedType === "course") return courses.find(c => c.id === selectedId) || null;
    if (selectedType === "module") {
      const m = modules.find(m => m.id === selectedId);
      return courses.find(c => c.id === m?.course_id) || null;
    }
    if (selectedType === "lesson") {
      const l = lessons.find(l => l.id === selectedId);
      const m = modules.find(m => m.id === l?.module_id);
      return courses.find(c => c.id === m?.course_id) || null;
    }
    return null;
  }

  function moduleLessons(moduleId) {
    return lessons.filter(l => l.module_id === moduleId)
      .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || (a.lesson_number||0)-(b.lesson_number||0));
  }

  function courseModules(courseId) {
    return modules.filter(m => m.course_id === courseId)
      .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || (a.module_number||0)-(b.module_number||0));
  }

  function localDateTimeValue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  function sanitizeLessonHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    root.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach(el => el.remove());
    root.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || "").trim().toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);
        if ((name === "href" || name === "src") && value.startsWith("javascript:")) el.removeAttribute(attr.name);
        if (name === "style") el.removeAttribute("style");
      });
    });
    return root.innerHTML;
  }

  async function authorize() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error("Supabase configuration is missing.");
    }
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data: userData, error: userError } = await client.auth.getUser();
    user = userData?.user;
    if (userError || !user) return location.replace("index.html");

    const { data: p, error } = await client.from("profiles")
      .select("email,full_name,role,status")
      .eq("id", user.id).single();

    if (error || !p || p.status !== "active" || !managerRoles.includes(String(p.role))) {
      return location.replace("portal.html");
    }

    profile = p;
    const name = p.full_name || p.email || user.email || "LMS Manager";
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=p.email || user.email || "");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));
    document.querySelectorAll("[data-sign-out]").forEach(btn=>btn.addEventListener("click",async()=>{
      await client.auth.signOut();
      location.replace("index.html");
    }));
  }

  async function loadData(keepSelection=true) {
    const [courseRes,moduleRes,lessonRes,resourceLinkRes,libraryRes] = await Promise.all([
      client.from("lms_courses").select("*").order("sort_order"),
      client.from("lms_modules").select("*").order("sort_order"),
      client.from("lms_lessons").select("*").order("sort_order"),
      client.from("lms_lesson_resources").select("*").order("sort_order"),
      client.from("toolkit_resources").select("id,title,resource_type,organization,status")
        .eq("status","active").order("title")
    ]);

    for (const result of [courseRes,moduleRes,lessonRes,resourceLinkRes,libraryRes]) {
      if (result.error) {
        if (/due_at|lms_lesson_resources|schema cache|does not exist/i.test(result.error.message || "")) {
          throw new Error("Phase 7E database changes are not installed yet. Run phase7e-lms-administration.sql first.");
        }
        throw result.error;
      }
    }

    courses = courseRes.data || [];
    modules = moduleRes.data || [];
    lessons = lessonRes.data || [];
    lessonResources = resourceLinkRes.data || [];
    resources = libraryRes.data || [];

    renderTree();
    populateProgressCourse();
    populateResourceSelect();

    if (keepSelection && selectedType && selectedId) {
      selectNode(selectedType, selectedId, false);
    }
  }

  function renderTree() {
    const target = document.getElementById("lms-tree");
    if (!courses.length) {
      target.innerHTML = `<div class="table-empty">No LMS courses yet.</div>`;
      return;
    }

    target.innerHTML = courses.map(course => {
      const mods = courseModules(course.id);
      return `
        <article class="lms-tree-course">
          <div class="lms-tree-course-header">
            <button type="button" data-select-course="${safe(course.id)}">
              <span>${safe(course.code)}</span>
              <strong>${safe(course.title)}</strong>
              <small>${course.is_active ? "Active" : "Inactive"}</small>
            </button>
            <button class="lms-tree-add" type="button" data-add-module="${safe(course.id)}">+ Module</button>
          </div>
          ${mods.map((module,moduleIndex) => {
            const ls = moduleLessons(module.id);
            return `
              <section class="lms-tree-module">
                <div class="lms-tree-module-header">
                  <button type="button" data-select-module="${safe(module.id)}">
                    <strong>Module ${safe(module.module_number)} · ${safe(module.title)}</strong>
                    <small>${module.is_published ? "Published" : "Unpublished"} · ${ls.length} lesson${ls.length===1?"":"s"}</small>
                  </button>
                  <div>
                    <button class="lms-tree-add" type="button" data-move-module-up="${safe(module.id)}" ${moduleIndex===0?"disabled":""}>↑</button>
                    <button class="lms-tree-add" type="button" data-move-module-down="${safe(module.id)}" ${moduleIndex===mods.length-1?"disabled":""}>↓</button>
                    <button class="lms-tree-add" type="button" data-add-lesson="${safe(module.id)}">+ Lesson</button>
                  </div>
                </div>
                <div class="lms-tree-lessons">
                  ${ls.map((lesson,lessonIndex)=>`
                    <button class="lms-tree-lesson ${selectedType==="lesson"&&selectedId===lesson.id?"active":""}" type="button" data-select-lesson="${safe(lesson.id)}">
                      <span>
                        <strong>${safe(lesson.lesson_number)}. ${safe(lesson.title)}</strong>
                        <small>${safe((lesson.lesson_type||"reading").replaceAll("_"," "))}${lesson.due_at?` · Due ${safe(new Date(lesson.due_at).toLocaleDateString())}`:""}</small>
                      </span>
                      <span>
                        <i class="publish-dot ${lesson.is_published?"on":""}"></i>
                        <small data-move-lesson-up="${safe(lesson.id)}" data-stop-select="1" title="Move up">↑</small>
                        <small data-move-lesson-down="${safe(lesson.id)}" data-stop-select="1" title="Move down">↓</small>
                      </span>
                    </button>`).join("") || '<div class="table-empty">No lessons.</div>'}
                </div>
              </section>`;
          }).join("")}
        </article>`;
    }).join("");

    target.querySelectorAll("[data-select-course]").forEach(btn=>btn.addEventListener("click",()=>selectNode("course",btn.dataset.selectCourse)));
    target.querySelectorAll("[data-select-module]").forEach(btn=>btn.addEventListener("click",()=>selectNode("module",btn.dataset.selectModule)));
    target.querySelectorAll("[data-select-lesson]").forEach(btn=>btn.addEventListener("click",event=>{
      if (event.target.dataset.stopSelect) return;
      selectNode("lesson",btn.dataset.selectLesson);
    }));
    target.querySelectorAll("[data-add-module]").forEach(btn=>btn.addEventListener("click",()=>addModule(btn.dataset.addModule)));
    target.querySelectorAll("[data-add-lesson]").forEach(btn=>btn.addEventListener("click",()=>addLesson(btn.dataset.addLesson)));
    target.querySelectorAll("[data-move-module-up]").forEach(btn=>btn.addEventListener("click",()=>moveModule(btn.dataset.moveModuleUp,-1)));
    target.querySelectorAll("[data-move-module-down]").forEach(btn=>btn.addEventListener("click",()=>moveModule(btn.dataset.moveModuleDown,1)));
    target.querySelectorAll("[data-move-lesson-up]").forEach(el=>el.addEventListener("click",event=>{event.stopPropagation();moveLesson(el.dataset.moveLessonUp,-1)}));
    target.querySelectorAll("[data-move-lesson-down]").forEach(el=>el.addEventListener("click",event=>{event.stopPropagation();moveLesson(el.dataset.moveLessonDown,1)}));
  }

  function hideEditors() {
    document.getElementById("lms-editor-empty").hidden = true;
    document.getElementById("course-editor").hidden = true;
    document.getElementById("module-editor").hidden = true;
    document.getElementById("lesson-editor").hidden = true;
  }

  function selectNode(type,id,scroll=true) {
    selectedType = type;
    selectedId = id;
    hideEditors();
    message("");

    if (type === "course") renderCourseEditor(id);
    if (type === "module") renderModuleEditor(id);
    if (type === "lesson") renderLessonEditor(id);
    renderTree();

    if (scroll) {
      document.querySelector(".lms-editor-column")?.scrollIntoView({behavior:"smooth",block:"start"});
    }
  }

  function renderCourseEditor(id) {
    const c = courses.find(x=>x.id===id);
    if (!c) return;
    document.getElementById("course-editor").hidden = false;
    document.getElementById("course-id").value = c.id;
    document.getElementById("course-code").value = c.code || "";
    document.getElementById("course-title").value = c.title || "";
    document.getElementById("course-description").value = c.description || "";
    document.getElementById("course-sort").value = c.sort_order ?? 0;
    document.getElementById("course-active").checked = !!c.is_active;
  }

  function renderModuleEditor(id) {
    const m = modules.find(x=>x.id===id);
    if (!m) return;
    document.getElementById("module-editor").hidden = false;
    document.getElementById("module-id").value = m.id;
    document.getElementById("module-number").value = m.module_number ?? "";
    document.getElementById("module-title").value = m.title || "";
    document.getElementById("module-summary").value = m.summary || "";
    document.getElementById("module-sort").value = m.sort_order ?? 0;
    document.getElementById("module-published").checked = !!m.is_published;
  }

  function renderLessonEditor(id) {
    const l = lessons.find(x=>x.id===id);
    if (!l) return;
    document.getElementById("lesson-editor").hidden = false;
    document.getElementById("lesson-id").value = l.id;
    document.getElementById("lesson-number").value = l.lesson_number ?? "";
    document.getElementById("lesson-title-input").value = l.title || "";
    document.getElementById("lesson-type-input").value = l.lesson_type || "reading";
    document.getElementById("lesson-minutes").value = l.estimated_minutes ?? "";
    document.getElementById("lesson-sort").value = l.sort_order ?? 0;
    document.getElementById("lesson-due").value = localDateTimeValue(l.due_at);
    document.getElementById("lesson-due-batch").value = l.due_batch || "";
    document.getElementById("lesson-published").checked = !!l.is_published;
    document.getElementById("lesson-activity-prompt").value = l.activity_prompt || "";
    document.getElementById("lesson-content-editor").innerHTML = l.content_html || "<p></p>";
    document.getElementById("lesson-editor-heading-title").textContent = l.title || "Lesson Editor";
    document.getElementById("preview-lesson-link").href = `lesson.html?id=${encodeURIComponent(l.id)}&preview=1`;
    renderLessonResources();
  }

  function populateResourceSelect() {
    const select = document.getElementById("lesson-resource-library");
    select.innerHTML = '<option value="">Select Toolkit Library resource…</option>' +
      resources.map(r=>`<option value="${safe(r.id)}">${safe(r.title)}${r.organization?` · ${safe(r.organization)}`:""}</option>`).join("");
  }

  function renderLessonResources() {
    const target = document.getElementById("lesson-resource-list");
    if (selectedType !== "lesson") {
      target.innerHTML = '<div class="table-empty">Select a lesson first.</div>';
      return;
    }
    const rows = lessonResources.filter(r=>r.lesson_id===selectedId)
      .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));

    if (!rows.length) {
      target.innerHTML = '<div class="table-empty">No resources attached to this lesson.</div>';
      return;
    }

    target.innerHTML = rows.map(row=>{
      const resource = resources.find(r=>r.id===row.resource_id);
      const title = row.label || resource?.title || row.external_url || "Resource";
      const type = resource ? `Toolkit Library · ${resource.resource_type || "resource"}` : "External link";
      return `<div class="lesson-resource-row">
        <div><strong>${safe(title)}</strong><small>${safe(type)}</small></div>
        <button type="button" data-remove-lesson-resource="${safe(row.id)}">×</button>
      </div>`;
    }).join("");

    target.querySelectorAll("[data-remove-lesson-resource]").forEach(btn=>btn.addEventListener("click",()=>removeLessonResource(btn.dataset.removeLessonResource)));
  }

  async function addCourse() {
    const title = prompt("New course title:");
    if (!title?.trim()) return;
    const code = prompt("Course code (e.g. CH205):");
    if (!code?.trim()) return;

    const sort = courses.length ? Math.max(...courses.map(c=>Number(c.sort_order)||0))+10 : 10;
    const { data,error } = await client.from("lms_courses")
      .insert({code:code.trim().toUpperCase(),title:title.trim(),sort_order:sort,is_active:false,updated_by:user.id})
      .select().single();
    if (error) return alert(error.message);
    await loadData(false);
    selectNode("course",data.id);
  }

  async function addModule(courseId) {
    const title = prompt("New module title:");
    if (!title?.trim()) return;
    const existing = courseModules(courseId);
    const nextNumber = existing.length ? Math.max(...existing.map(m=>Number(m.module_number)||0))+1 : 1;
    const sort = existing.length ? Math.max(...existing.map(m=>Number(m.sort_order)||0))+10 : 10;

    const { data,error } = await client.from("lms_modules")
      .insert({course_id:courseId,module_number:nextNumber,title:title.trim(),summary:null,sort_order:sort,is_published:false,updated_by:user.id})
      .select().single();
    if (error) return alert(error.message);
    await loadData(false);
    selectNode("module",data.id);
  }

  async function addLesson(moduleId) {
    const title = prompt("New lesson title:");
    if (!title?.trim()) return;
    const existing = moduleLessons(moduleId);
    const nextNumber = existing.length ? Math.max(...existing.map(l=>Number(l.lesson_number)||0))+1 : 1;
    const sort = existing.length ? Math.max(...existing.map(l=>Number(l.sort_order)||0))+10 : 10;

    const { data,error } = await client.from("lms_lessons")
      .insert({
        module_id:moduleId,lesson_number:nextNumber,title:title.trim(),
        lesson_type:"reading",content_html:"<p>This lesson is awaiting validated learning content.</p>",
        sort_order:sort,is_published:false,updated_by:user.id
      }).select().single();

    if (error) return alert(error.message);
    await loadData(false);
    selectNode("lesson",data.id);
  }

  async function saveCourse(event) {
    event.preventDefault();
    const id = document.getElementById("course-id").value;
    const payload = {
      code:document.getElementById("course-code").value.trim().toUpperCase(),
      title:document.getElementById("course-title").value.trim(),
      description:document.getElementById("course-description").value.trim() || null,
      sort_order:Number(document.getElementById("course-sort").value)||0,
      is_active:document.getElementById("course-active").checked,
      updated_by:user.id,
      updated_at:new Date().toISOString()
    };
    const { error } = await client.from("lms_courses").update(payload).eq("id",id);
    if (error) return message(error.message,"error");
    message("Course saved ✓","success"); await loadData();
  }

  async function saveModule(event) {
    event.preventDefault();
    const id = document.getElementById("module-id").value;
    const payload = {
      module_number:Number(document.getElementById("module-number").value),
      title:document.getElementById("module-title").value.trim(),
      summary:document.getElementById("module-summary").value.trim() || null,
      sort_order:Number(document.getElementById("module-sort").value)||0,
      is_published:document.getElementById("module-published").checked,
      updated_by:user.id,
      updated_at:new Date().toISOString()
    };
    const { error } = await client.from("lms_modules").update(payload).eq("id",id);
    if (error) return message(error.message,"error");
    message("Module saved ✓","success"); await loadData();
  }

  async function saveLesson(event) {
    event.preventDefault();
    const id = document.getElementById("lesson-id").value;
    const dueValue = document.getElementById("lesson-due").value;
    const content = sanitizeLessonHtml(document.getElementById("lesson-content-editor").innerHTML);
    const payload = {
      lesson_number:Number(document.getElementById("lesson-number").value),
      title:document.getElementById("lesson-title-input").value.trim(),
      lesson_type:document.getElementById("lesson-type-input").value,
      estimated_minutes:document.getElementById("lesson-minutes").value ? Number(document.getElementById("lesson-minutes").value) : null,
      sort_order:Number(document.getElementById("lesson-sort").value)||0,
      due_at:dueValue ? new Date(dueValue).toISOString() : null,
      due_batch:document.getElementById("lesson-due-batch").value.trim() || null,
      is_published:document.getElementById("lesson-published").checked,
      content_html:content || "<p></p>",
      activity_prompt:document.getElementById("lesson-activity-prompt").value.trim() || null,
      updated_by:user.id,
      updated_at:new Date().toISOString()
    };
    const { error } = await client.from("lms_lessons").update(payload).eq("id",id);
    if (error) return message(error.message,"error");
    message("Lesson saved ✓","success"); await loadData();
  }

  async function deleteLesson() {
    if (selectedType!=="lesson") return;
    const l = lessons.find(x=>x.id===selectedId);
    if (!l || !confirm(`Delete "${l.title}"? This is allowed only if no learner record exists.`)) return;
    const { error } = await client.rpc("delete_lms_lesson_safe",{p_lesson_id:l.id});
    if (error) return alert(error.message);
    selectedType=selectedId=null;
    await loadData(false);
    hideEditors(); document.getElementById("lms-editor-empty").hidden=false;
  }

  async function deleteModule() {
    if (selectedType!=="module") return;
    const m = modules.find(x=>x.id===selectedId);
    if (!m || !confirm(`Delete module "${m.title}" and its unused lessons?`)) return;
    const { error } = await client.rpc("delete_lms_module_safe",{p_module_id:m.id});
    if (error) return alert(error.message);
    selectedType=selectedId=null;
    await loadData(false);
    hideEditors(); document.getElementById("lms-editor-empty").hidden=false;
  }

  async function addLibraryResource() {
    if (selectedType!=="lesson") return alert("Select a lesson first.");
    const resourceId=document.getElementById("lesson-resource-library").value;
    if (!resourceId) return;
    const label=document.getElementById("lesson-resource-label").value.trim()||null;
    const current=lessonResources.filter(r=>r.lesson_id===selectedId);
    const sort=current.length?Math.max(...current.map(r=>Number(r.sort_order)||0))+10:10;
    const {error}=await client.from("lms_lesson_resources").insert({
      lesson_id:selectedId,resource_id:resourceId,label,sort_order:sort,created_by:user.id
    });
    if(error)return alert(error.message);
    document.getElementById("lesson-resource-library").value="";
    document.getElementById("lesson-resource-label").value="";
    await loadData();
  }

  async function addExternalResource() {
    if (selectedType!=="lesson") return alert("Select a lesson first.");
    const url=document.getElementById("lesson-external-url").value.trim();
    const label=document.getElementById("lesson-external-label").value.trim();
    if(!url)return;
    try{new URL(url)}catch{return alert("Enter a complete external URL including https://");}
    const current=lessonResources.filter(r=>r.lesson_id===selectedId);
    const sort=current.length?Math.max(...current.map(r=>Number(r.sort_order)||0))+10:10;
    const {error}=await client.from("lms_lesson_resources").insert({
      lesson_id:selectedId,external_url:url,label:label||url,sort_order:sort,created_by:user.id
    });
    if(error)return alert(error.message);
    document.getElementById("lesson-external-url").value="";
    document.getElementById("lesson-external-label").value="";
    await loadData();
  }

  async function removeLessonResource(id) {
    if (!confirm("Remove this resource from the lesson?")) return;
    const {error}=await client.from("lms_lesson_resources").delete().eq("id",id);
    if(error)return alert(error.message);
    await loadData();
  }

  async function moveModule(id,direction) {
    const m=modules.find(x=>x.id===id); if(!m)return;
    const list=courseModules(m.course_id),i=list.findIndex(x=>x.id===id),j=i+direction;
    if(j<0||j>=list.length)return;
    const a=list[i],b=list[j],aSort=Number(a.sort_order)||0,bSort=Number(b.sort_order)||0;
    const [ra,rb]=await Promise.all([
      client.from("lms_modules").update({sort_order:bSort,updated_by:user.id}).eq("id",a.id),
      client.from("lms_modules").update({sort_order:aSort,updated_by:user.id}).eq("id",b.id)
    ]);
    if(ra.error||rb.error)return alert((ra.error||rb.error).message);
    await loadData();
  }

  async function moveLesson(id,direction) {
    const l=lessons.find(x=>x.id===id); if(!l)return;
    const list=moduleLessons(l.module_id),i=list.findIndex(x=>x.id===id),j=i+direction;
    if(j<0||j>=list.length)return;
    const a=list[i],b=list[j],aSort=Number(a.sort_order)||0,bSort=Number(b.sort_order)||0;
    const [ra,rb]=await Promise.all([
      client.from("lms_lessons").update({sort_order:bSort,updated_by:user.id}).eq("id",a.id),
      client.from("lms_lessons").update({sort_order:aSort,updated_by:user.id}).eq("id",b.id)
    ]);
    if(ra.error||rb.error)return alert((ra.error||rb.error).message);
    await loadData();
  }

  function setupRichEditor() {
    const editor=document.getElementById("lesson-content-editor");
    document.querySelectorAll("[data-rich-command]").forEach(btn=>btn.addEventListener("click",()=>{
      editor.focus();
      document.execCommand(btn.dataset.richCommand,false,null);
    }));
    document.querySelectorAll("[data-rich-block]").forEach(btn=>btn.addEventListener("click",()=>{
      editor.focus();
      document.execCommand("formatBlock",false,btn.dataset.richBlock);
    }));
    document.querySelector("[data-rich-link]").addEventListener("click",()=>{
      const url=prompt("Link URL:");
      if(!url)return;
      editor.focus();
      document.execCommand("createLink",false,url);
    });
  }

  function setupTabs() {
    document.querySelectorAll("[data-lms-admin-tab]").forEach(btn=>btn.addEventListener("click",async()=>{
      const tab=btn.dataset.lmsAdminTab;
      document.querySelectorAll("[data-lms-admin-tab]").forEach(b=>b.classList.toggle("active",b===btn));
      document.getElementById("lms-content-tab").hidden=tab!=="content";
      document.getElementById("lms-progress-tab").hidden=tab!=="progress";
      if(tab==="progress") await loadProgress();
    }));
  }

  function populateProgressCourse() {
    const select=document.getElementById("progress-course");
    const current=select.value;
    select.innerHTML=courses.map(c=>`<option value="${safe(c.id)}">${safe(c.code)} · ${safe(c.title)}</option>`).join("");
    if(courses.some(c=>c.id===current))select.value=current;
  }

  async function loadProgress() {
    const courseId=document.getElementById("progress-course").value || courses[0]?.id;
    if(!courseId){document.getElementById("progress-body").innerHTML='<tr><td colspan="6" class="table-empty">No courses available.</td></tr>';return}
    document.getElementById("progress-course").value=courseId;
    const {data,error}=await client.rpc("get_lms_course_progress",{p_course_id:courseId});
    if(error){document.getElementById("progress-body").innerHTML=`<tr><td colspan="6" class="table-empty">${safe(error.message)}</td></tr>`;return}
    progressRows=data||[];
    renderProgress();
  }

  function renderProgress() {
    const q=document.getElementById("progress-search").value.trim().toLowerCase();
    const filtered=progressRows.filter(r=>!q||[r.full_name,r.email,r.batch].filter(Boolean).join(" ").toLowerCase().includes(q));
    const total=progressRows.length;
    const avg=total?Math.round(progressRows.reduce((s,r)=>s+(Number(r.percent_complete)||0),0)/total):0;
    const complete=progressRows.filter(r=>Number(r.percent_complete)===100).length;
    const notStarted=progressRows.filter(r=>Number(r.started_lessons)===0).length;
    document.getElementById("progress-students").textContent=String(total);
    document.getElementById("progress-average").textContent=`${avg}%`;
    document.getElementById("progress-complete").textContent=String(complete);
    document.getElementById("progress-not-started").textContent=String(notStarted);

    const body=document.getElementById("progress-body");
    if(!filtered.length){body.innerHTML='<tr><td colspan="6" class="table-empty">No matching learners.</td></tr>';return}
    body.innerHTML=filtered.map(r=>`<tr>
      <td><strong>${safe(r.full_name||r.email||"Student")}</strong><small>${safe(r.email||"")}</small></td>
      <td>${safe(r.batch||"—")}</td>
      <td class="progress-bar-cell"><strong>${safe(r.percent_complete)}%</strong><div class="progress-mini-track"><i style="width:${Math.max(0,Math.min(100,Number(r.percent_complete)||0))}%"></i></div></td>
      <td>${safe(r.completed_lessons)} / ${safe(r.total_lessons)}</td>
      <td>${safe(fmtDateTime(r.last_activity))}</td>
      <td><button class="progress-open-btn" type="button" data-progress-user="${safe(r.user_id)}">View</button></td>
    </tr>`).join("");
    body.querySelectorAll("[data-progress-user]").forEach(btn=>btn.addEventListener("click",()=>openLearnerProgress(btn.dataset.progressUser)));
  }

  async function openLearnerProgress(userId) {
    const row=progressRows.find(r=>r.user_id===userId),courseId=document.getElementById("progress-course").value;
    if(!row)return;
    const dialog=document.getElementById("learner-progress-dialog");
    document.getElementById("learner-detail-name").textContent=row.full_name||row.email||"Learner";
    document.getElementById("learner-detail-meta").textContent=[row.batch,`${row.percent_complete}% complete`].filter(Boolean).join(" · ");
    document.getElementById("learner-detail-lessons").innerHTML='<div class="table-loading">Loading lesson detail…</div>';
    dialog.showModal();

    const {data,error}=await client.rpc("get_lms_learner_lesson_progress",{p_course_id:courseId,p_user_id:userId});
    const target=document.getElementById("learner-detail-lessons");
    if(error){target.innerHTML=`<div class="table-empty">${safe(error.message)}</div>`;return}
    target.innerHTML=(data||[]).map(item=>`<article class="learner-lesson-row">
      <div><strong>Module ${safe(item.module_number)} · ${safe(item.lesson_title)}</strong><small>${safe(item.module_title)}${item.last_opened_at?` · Last opened ${safe(fmtDateTime(item.last_opened_at))}`:""}</small></div>
      <span class="learner-status ${safe(item.status)}">${safe(String(item.status).replaceAll("_"," "))}</span>
      ${item.response_text?`<div class="learner-response">${safe(item.response_text)}</div>`:""}
    </article>`).join("") || '<div class="table-empty">No lessons in this course.</div>';
  }

  function bind() {
    document.getElementById("add-course-btn").addEventListener("click",addCourse);
    document.getElementById("course-form").addEventListener("submit",saveCourse);
    document.getElementById("module-form").addEventListener("submit",saveModule);
    document.getElementById("lesson-form").addEventListener("submit",saveLesson);
    document.getElementById("delete-module-btn").addEventListener("click",deleteModule);
    document.getElementById("delete-lesson-btn").addEventListener("click",deleteLesson);
    document.getElementById("add-library-resource-btn").addEventListener("click",addLibraryResource);
    document.getElementById("add-external-resource-btn").addEventListener("click",addExternalResource);
    document.getElementById("progress-course").addEventListener("change",loadProgress);
    document.getElementById("progress-search").addEventListener("input",renderProgress);
    document.getElementById("close-progress-dialog").addEventListener("click",()=>document.getElementById("learner-progress-dialog").close());
    setupRichEditor();
    setupTabs();
  }

  async function init() {
    try {
      await authorize();
      bind();
      await loadData(false);
      loading.hidden=true;
      app.hidden=false;
      document.body.classList.remove("portal-is-loading");
    } catch(error) {
      console.error("[LMS Administration]",error);
      loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open LMS Administration</strong><span>${safe(error.message||error)}</span><a href="admin.html">Return to Administration</a>`;
    }
  }

  init();
})();
