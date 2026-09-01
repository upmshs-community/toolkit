(() => {
  const cfg=window.APP_CONFIG||{};
  const params=new URLSearchParams(location.search);
  const lessonId=params.get("id");
  const previewMode=params.get("preview")==="1";
  const loading=document.getElementById("lesson-loading");
  const app=document.getElementById("lesson-app");

  let client,user,profile,lesson,module,course;
  let courseModules=[],courseLessons=[],userProgress=[],responseRecord=null,lessonResources=[];
  const managerRoles=["admin","coordinator","faculty"];

  const safe=(v="")=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const initials=name=>String(name).split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"UP";
  const progressFor=id=>userProgress.find(p=>p.lesson_id===id)||null;

  function setUserUI(){
    const name=profile.full_name||profile.email||user.email||"Toolkit user";
    document.querySelectorAll("[data-user-name]").forEach(x=>x.textContent=name);
    document.querySelectorAll("[data-user-email]").forEach(x=>x.textContent=profile.email||user.email||"");
    document.querySelectorAll("[data-user-initials]").forEach(x=>x.textContent=initials(name));
    if(managerRoles.includes(String(profile.role)))document.getElementById("lesson-admin-link").hidden=false;
  }

  async function loadLessonData(){
    let lessonQuery=client.from("lms_lessons").select("*").eq("id",lessonId);
    if(!(previewMode&&managerRoles.includes(String(profile.role))))lessonQuery=lessonQuery.eq("is_published",true);
    const {data:lessonData,error:lessonError}=await lessonQuery.single();
    if(lessonError||!lessonData)throw lessonError||new Error("Lesson not found.");
    lesson=lessonData;

    const {data:moduleData,error:moduleError}=await client.from("lms_modules").select("*").eq("id",lesson.module_id).single();
    if(moduleError||!moduleData)throw moduleError||new Error("Module not found.");
    module=moduleData;

    const {data:courseData,error:courseError}=await client.from("lms_courses").select("*").eq("id",module.course_id).single();
    if(courseError||!courseData)throw courseError||new Error("Course not found.");
    course=courseData;

    let moduleQuery=client.from("lms_modules").select("*").eq("course_id",course.id).order("sort_order");
    let lessonQueryAll=client.from("lms_lessons").select("*").order("sort_order");
    const showDrafts=previewMode&&managerRoles.includes(String(profile.role));
    if(!showDrafts){
      moduleQuery=moduleQuery.eq("is_published",true);
      lessonQueryAll=lessonQueryAll.eq("is_published",true);
    }

    const [moduleRes,lessonRes,resourceRes]=await Promise.all([
      moduleQuery,
      lessonQueryAll,
      client.from("lms_lesson_resources")
        .select("id,label,external_url,sort_order,resource_id,toolkit_resources(id,title,resource_type,organization)")
        .eq("lesson_id",lesson.id).order("sort_order")
    ]);
    if(moduleRes.error)throw moduleRes.error;
    if(lessonRes.error)throw lessonRes.error;
    if(resourceRes.error)throw resourceRes.error;

    courseModules=moduleRes.data||[];
    const moduleIds=courseModules.map(m=>m.id);
    courseLessons=(lessonRes.data||[]).filter(l=>moduleIds.includes(l.module_id));
    lessonResources=resourceRes.data||[];

    if(previewMode){
      userProgress=[];
      responseRecord=null;
      return;
    }

    const ids=courseLessons.map(l=>l.id);
    const progressPromise=ids.length
      ? client.from("lms_lesson_progress").select("*").eq("user_id",user.id).in("lesson_id",ids)
      : Promise.resolve({data:[],error:null});
    const responsePromise=client.from("lms_activity_responses").select("*").eq("user_id",user.id).eq("lesson_id",lesson.id).maybeSingle();
    const [progressRes,responseRes]=await Promise.all([progressPromise,responsePromise]);
    if(progressRes.error)throw progressRes.error;
    if(responseRes.error)throw responseRes.error;
    userProgress=progressRes.data||[];
    responseRecord=responseRes.data||null;
  }

  async function markInProgress(){
    if(previewMode)return;
    const current=progressFor(lesson.id);
    if(current?.status==="completed")return;
    const payload={user_id:user.id,lesson_id:lesson.id,status:"in_progress",percent_complete:Math.max(current?.percent_complete||0,10),last_opened_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    const {data,error}=await client.from("lms_lesson_progress").upsert(payload,{onConflict:"user_id,lesson_id"}).select().single();
    if(!error&&data){userProgress=userProgress.filter(p=>p.lesson_id!==lesson.id);userProgress.push(data)}
  }

  function renderOutline(){
    document.getElementById("lesson-course-code").textContent=course.code;
    document.getElementById("lesson-course-title").textContent=course.title;
    const target=document.getElementById("lesson-outline-list");
    target.innerHTML=courseModules.map(m=>{
      const ls=courseLessons.filter(l=>l.module_id===m.id);
      return `<section class="lesson-outline-module ${m.id===module.id?"active":""}">
        <div><span>Module ${m.module_number}</span><strong>${safe(m.title)}</strong></div>
        ${ls.map(l=>{const p=progressFor(l.id),status=previewMode?"not_started":(p?.status||"not_started");return `<a class="${l.id===lesson.id?"current":""}" href="lesson.html?id=${encodeURIComponent(l.id)}${previewMode?"&preview=1":""}"><span class="outline-dot status-${status}"></span><span>${safe(l.title)}</span></a>`}).join("")}
      </section>`;
    }).join("");
  }

  function courseStats(){
    const completed=courseLessons.filter(l=>progressFor(l.id)?.status==="completed").length,total=courseLessons.length;
    return {completed,total,percent:total?Math.round((completed/total)*100):0};
  }

  function renderResources(){
    const section=document.getElementById("lesson-resources"),target=document.getElementById("lesson-resource-list");
    if(!lessonResources.length){section.hidden=true;return}
    section.hidden=false;
    target.innerHTML=lessonResources.map(row=>{
      const r=row.toolkit_resources;
      const title=row.label||r?.title||row.external_url||"Resource";
      const href=r?`library.html?resource=${encodeURIComponent(r.id)}`:row.external_url;
      const meta=r?[r.resource_type,r.organization].filter(Boolean).join(" · "):"External reference";
      return `<a class="lesson-resource-link-7e" href="${safe(href||"#")}" ${row.external_url?'target="_blank" rel="noopener noreferrer"':""}>
        <div><strong>${safe(title)}</strong><small>${safe(meta||"Supporting material")}</small></div><span>Open →</span>
      </a>`;
    }).join("");
  }

  function renderLesson(){
    document.title=`${lesson.title} | Community Health Toolkit`;
    document.getElementById("lesson-module-breadcrumb").textContent=`Module ${module.module_number}`;
    document.getElementById("lesson-title-breadcrumb").textContent=lesson.title;
    document.getElementById("lesson-type").textContent=(lesson.lesson_type||"reading").replaceAll("_"," ");
    document.getElementById("lesson-module-number").textContent=`${course.code} · Module ${module.module_number}`;
    document.getElementById("lesson-title").textContent=lesson.title;
    document.getElementById("lesson-estimate").textContent=lesson.estimated_minutes?`Estimated time: ${lesson.estimated_minutes} minutes`:"Self-paced lesson";

    const due=document.getElementById("lesson-due-chip");
    const appliesToBatch=!lesson.due_batch||!profile.batch||String(lesson.due_batch)===String(profile.batch);
    if(lesson.due_at&&appliesToBatch){
      due.textContent=`Due ${new Date(lesson.due_at).toLocaleString()}`;
      due.hidden=false;
    }else due.hidden=true;

    const current=progressFor(lesson.id);
    const status=previewMode?"preview":(current?.status||"not_started");
    document.getElementById("lesson-status").textContent=previewMode?"Preview":status==="completed"?"Completed":status==="in_progress"?"In progress":"Not started";

    document.getElementById("lesson-content").innerHTML=lesson.content_html||"<p>This lesson is awaiting validated learning content.</p>";

    const stats=courseStats();
    document.getElementById("lesson-course-progress-bar").style.width=`${previewMode?0:stats.percent}%`;
    document.getElementById("lesson-course-progress-copy").textContent=previewMode
      ? `${course.code} · Previewing authored content`
      : `${course.code}: ${stats.completed} of ${stats.total} lessons completed (${stats.percent}%)`;

    renderResources();

    if(lesson.activity_prompt){
      document.getElementById("lesson-activity").hidden=false;
      document.getElementById("lesson-activity-prompt").textContent=lesson.activity_prompt;
      document.getElementById("lesson-activity-response").value=responseRecord?.response_text||"";
      if(previewMode){
        document.getElementById("lesson-activity-response").disabled=true;
        document.getElementById("lesson-save-response").hidden=true;
      }
    }else document.getElementById("lesson-activity").hidden=true;

    const index=courseLessons.findIndex(l=>l.id===lesson.id),prev=courseLessons[index-1],next=courseLessons[index+1];
    const prevEl=document.getElementById("lesson-prev"),nextEl=document.getElementById("lesson-next");
    if(prev){prevEl.href=`lesson.html?id=${encodeURIComponent(prev.id)}${previewMode?"&preview=1":""}`;prevEl.hidden=false}else prevEl.hidden=true;
    if(next){nextEl.href=`lesson.html?id=${encodeURIComponent(next.id)}${previewMode?"&preview=1":""}`;nextEl.hidden=false}else nextEl.hidden=true;

    const completeBtn=document.getElementById("lesson-mark-complete");
    if(previewMode){
      document.getElementById("lesson-preview-banner").hidden=false;
      document.getElementById("lesson-actions").hidden=true;
    }else if(status==="completed"){completeBtn.textContent="Completed ✓";completeBtn.disabled=true}
    else{completeBtn.textContent="Mark Complete";completeBtn.disabled=false}
  }

  async function saveResponse(){
    if(previewMode)return;
    const text=document.getElementById("lesson-activity-response").value.trim(),status=document.getElementById("lesson-response-status");
    status.textContent="Saving…";
    const {data,error}=await client.from("lms_activity_responses").upsert({user_id:user.id,lesson_id:lesson.id,response_text:text,updated_at:new Date().toISOString()},{onConflict:"user_id,lesson_id"}).select().single();
    if(error){status.textContent=error.message;status.className="error";return}
    responseRecord=data;status.textContent="Saved ✓";status.className="success";
  }

  async function markComplete(){
    if(previewMode)return;
    const button=document.getElementById("lesson-mark-complete");button.disabled=true;button.textContent="Saving…";
    if(lesson.activity_prompt)await saveResponse();
    const now=new Date().toISOString();
    const {data,error}=await client.from("lms_lesson_progress").upsert({user_id:user.id,lesson_id:lesson.id,status:"completed",percent_complete:100,last_opened_at:now,completed_at:now,updated_at:now},{onConflict:"user_id,lesson_id"}).select().single();
    if(error){button.disabled=false;button.textContent="Mark Complete";alert(error.message);return}
    userProgress=userProgress.filter(p=>p.lesson_id!==lesson.id);userProgress.push(data);renderOutline();renderLesson();
  }

  async function init(){
    try{
      if(!lessonId)throw new Error("No lesson was selected.");
      if(!window.supabase?.createClient||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw new Error("Supabase configuration is missing.");
      client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
      const {data:userData,error:userError}=await client.auth.getUser();
      if(userError||!userData?.user)return location.replace("index.html");
      user=userData.user;

      const {data:p,error:pe}=await client.from("profiles").select("email,full_name,status,role,batch").eq("id",user.id).single();
      if(pe||!p||p.status!=="active")return location.replace("portal.html");
      profile=p;

      if(previewMode&&!managerRoles.includes(String(profile.role)))throw new Error("Preview mode is restricted to LMS managers.");

      setUserUI();
      document.querySelectorAll("[data-sign-out]").forEach(b=>b.addEventListener("click",async()=>{await client.auth.signOut();location.replace("index.html")}));

      await loadLessonData();
      await markInProgress();
      document.getElementById("lesson-save-response").addEventListener("click",saveResponse);
      document.getElementById("lesson-mark-complete").addEventListener("click",markComplete);
      renderOutline();renderLesson();

      loading.hidden=true;app.hidden=false;document.body.classList.remove("portal-is-loading");
    }catch(error){
      console.error("[Phase 7E Lesson]",error);
      loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open lesson</strong><span>${safe(error.message||error)}</span><a href="modules.html">Return to Manual & Modules</a>`;
    }
  }
  init();
})();