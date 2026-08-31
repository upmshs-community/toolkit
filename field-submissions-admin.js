(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById('field-admin-loading');
  const app = document.getElementById('field-admin-app');
  let client, user, profile;
  let rows = [], communities = [], profiles = new Map();
  let filtered = [];
  let selected = null;
  let detailMap = null;
  let detailMarker = null;

  const managerRoles = ['admin','coordinator','faculty'];
  const safe = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const humanize = key => String(key || '').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase());
  const fmtDate = v => v ? new Date(v).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : '—';
  const fmtDateTime = v => v ? new Date(v).toLocaleString() : '—';
  const initials = name => String(name||'UP').split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || 'UP';

  function message(text='', type='') {
    const el = document.getElementById('field-admin-message');
    el.textContent = text;
    el.className = `admin-message ${type}`;
  }

  function setUserUI() {
    const name = profile.full_name || profile.email || user.email || 'Toolkit Manager';
    document.querySelectorAll('[data-user-name]').forEach(x=>x.textContent=name);
    document.querySelectorAll('[data-user-email]').forEach(x=>x.textContent=profile.email || user.email || '');
    document.querySelectorAll('[data-user-initials]').forEach(x=>x.textContent=initials(name));
  }

  async function authorize() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error('Supabase configuration is missing.');
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const {data:u,error:e} = await client.auth.getUser();
    if (e || !u?.user) return location.replace('index.html');
    user = u.user;
    const {data:p,error:pe} = await client.from('profiles').select('email,full_name,role,status').eq('id',user.id).single();
    if (pe || !p) throw pe || new Error('Profile not found.');
    profile = p;
    if (p.status !== 'active' || !managerRoles.includes(String(p.role))) return location.replace('portal.html');
    setUserUI();
    document.querySelectorAll('[data-sign-out]').forEach(btn=>btn.addEventListener('click',async()=>{await client.auth.signOut();location.replace('index.html');}));
  }

  async function loadData() {
    message('Loading synced household surveys…');
    const [submissionRes, communityRes] = await Promise.all([
      client.from('field_form_submissions').select('*').order('updated_at',{ascending:false}),
      client.from('communities').select('id,name,province').order('name')
    ]);
    if (submissionRes.error) throw submissionRes.error;
    if (communityRes.error) throw communityRes.error;
    rows = submissionRes.data || [];
    communities = communityRes.data || [];

    const ids = [...new Set(rows.map(r=>r.submitted_by).filter(Boolean))];
    profiles = new Map();
    if (ids.length) {
      const pr = await client.from('profiles').select('id,full_name,email,batch,year_level').in('id',ids);
      if (!pr.error) (pr.data || []).forEach(p=>profiles.set(p.id,p));
    }
    populateFilters();
    applyFilters();
    message('');
  }

  function communityName(id) {
    const c = communities.find(x=>x.id===id);
    return c ? `${c.name}${c.province ? `, ${c.province}` : ''}` : 'Unassigned community';
  }

  function enumerator(r) {
    const p = profiles.get(r.submitted_by);
    return p?.full_name || r.interviewer || p?.email || 'Unknown';
  }

  function populateFilters() {
    const csel = document.getElementById('field-community-filter');
    const current = csel.value;
    csel.innerHTML = '<option value="">All communities</option>' + communities.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join('');
    csel.value = current;
    refreshBarangays();
  }

  function refreshBarangays() {
    const c = document.getElementById('field-community-filter').value;
    const bsel = document.getElementById('field-barangay-filter');
    const current = bsel.value;
    const names = [...new Set(rows.filter(r=>!c || r.community_id===c).map(r=>r.barangay).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    bsel.innerHTML = '<option value="">All barangays</option>' + names.map(n=>`<option>${safe(n)}</option>`).join('');
    if (names.includes(current)) bsel.value=current;
  }

  function applyFilters() {
    const q = document.getElementById('field-search').value.trim().toLowerCase();
    const community = document.getElementById('field-community-filter').value;
    const barangay = document.getElementById('field-barangay-filter').value;
    const status = document.getElementById('field-status-filter').value;
    const from = document.getElementById('field-date-from').value;
    const to = document.getElementById('field-date-to').value;
    filtered = rows.filter(r=>{
      const hay = [r.household_code,r.barangay,r.zone,r.interviewer,enumerator(r),communityName(r.community_id)].join(' ').toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (community && r.community_id!==community) return false;
      if (barangay && r.barangay!==barangay) return false;
      if (status && r.status!==status) return false;
      if (from && (!r.interview_date || r.interview_date < from)) return false;
      if (to && (!r.interview_date || r.interview_date > to)) return false;
      return true;
    });
    renderStats(); renderTable();
  }

  function renderStats() {
    document.getElementById('field-stat-total').textContent = rows.length;
    document.getElementById('field-stat-draft').textContent = rows.filter(r=>r.status==='draft').length;
    document.getElementById('field-stat-completed').textContent = rows.filter(r=>r.status==='completed').length;
    document.getElementById('field-stat-reviewed').textContent = rows.filter(r=>r.status==='reviewed').length;
    document.getElementById('field-stat-gps').textContent = rows.filter(r=>Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).length;
  }

  function statusChip(status='draft') { return `<span class="field-status-chip status-${safe(status)}">${safe(status)}</span>`; }

  function renderTable() {
    const body = document.getElementById('field-submissions-body');
    document.getElementById('field-result-count').textContent = `${filtered.length} record${filtered.length===1?'':'s'}`;
    if (!filtered.length) { body.innerHTML='<tr><td colspan="8" class="table-empty">No household surveys match the current filters.</td></tr>'; return; }
    body.innerHTML = filtered.map(r=>`
      <tr>
        <td><strong>${safe(r.household_code || 'No household #')}</strong><small>${safe(r.zone || '')}</small></td>
        <td><strong>${safe(communityName(r.community_id))}</strong><small>${safe(r.barangay || 'Barangay not entered')}</small></td>
        <td>${safe(fmtDate(r.interview_date))}</td>
        <td><strong>${safe(enumerator(r))}</strong></td>
        <td>${statusChip(r.status)}</td>
        <td>${Number.isFinite(r.latitude) && Number.isFinite(r.longitude) ? '<span class="field-gps-yes">● Captured</span>' : '<span class="field-gps-no">—</span>'}</td>
        <td><small>${safe(fmtDateTime(r.synced_at || r.updated_at))}</small></td>
        <td><button class="mini-action" type="button" data-open-submission="${safe(r.id)}">Review</button></td>
      </tr>`).join('');
    body.querySelectorAll('[data-open-submission]').forEach(btn=>btn.addEventListener('click',()=>openDetail(btn.dataset.openSubmission)));
  }

  function answerValue(value) {
    if (value === null || value === undefined || value === '') return '<span class="field-empty-answer">—</span>';
    if (Array.isArray(value)) {
      if (!value.length) return '<span class="field-empty-answer">—</span>';
      if (typeof value[0] === 'object') return `<div class="field-repeat-answer">${value.map((row,i)=>`<article><strong>Entry ${i+1}</strong>${Object.entries(row).filter(([,v])=>String(v||'').trim()).map(([k,v])=>`<span><b>${safe(humanize(k))}</b>${safe(v)}</span>`).join('')}</article>`).join('')}</div>`;
      return safe(value.join(', '));
    }
    if (typeof value === 'object') return `<pre>${safe(JSON.stringify(value,null,2))}</pre>`;
    return safe(value);
  }

  const sectionGroups = [
    ['Visit / Household', ['household_number','interview_date','barangay','zone','interviewer']],
    ['I. Family Members and Characteristics', ['head_name','head_age','head_sex','head_education','head_occupation','head_monthly_income','head_civil_status','head_employment_status','children_total','children_male','children_female','dependents_total','dependents_male','dependents_female','family_members']],
    ['II. Socio-Economic and Cultural', ['religion','primary_language','family_income_bracket','livelihood','livelihood_other','food_production_engaged','food_production_other','foodprod_vegetable','foodprod_piggery','foodprod_poultry','foodprod_fruit','property_owned','property_other','housing_ownership','housing_construction','appliances','appliance_other','transport','transport_other','utilities','basic_clothing','food_consumption','decision_0','decision_1','decision_2','decision_3']],
    ['III. Health Status and Practices', ['breastfeeding','supplementary_feeding','nutrition_children','immunization_children','pn_iron_iodine','pn_folic_calcium','pn_td_first','pn_td_repeat','pn_prenatal_care','pn_first_trimester','pn_visit_each_trimester','pn_total_visits','pn_postnatal_visit','delivery_trained_personnel','delivery_personnel_type','delivery_other_personnel','delivery_facility','fp_access','fp_practicing','fp_method','fp_reason_no','morbidity_diarrhea','illnesses','mortality_preventable','deaths','philhealth_members','avail_health_services','solo_parent_services','delay_decision','delay_decision_other','delay_reaching','delay_reaching_other','delay_receiving','delay_receiving_other','health_services_rank','health_worker_rank','health_interventions_rank','covid_vaccines','covid_no_reason']],
    ['IV. Environmental Condition', ['water_domestic','water_drinking','water_other','water_storage','water_treatment','food_storage','food_storage_other','with_toilet','toilet_type','toilet_no_reason','toilet_ownership_function','wastewater_disposal','garbage_collection','garbage_disposal','with_animals','animal_kind','animal_management']],
    ["V. People's Participation", ['community_org_involvement','community_org_member_count','community_org_names','known_organizations','community_projects_participated']],
    ['VI. Community Resources, Needs and Problems', ['community_leaders','material_resources','problems']]
  ];

  function renderResponses(response={}) {
    const used = new Set();
    const blocks = sectionGroups.map(([title,keys])=>{
      const items = keys.filter(k=>Object.prototype.hasOwnProperty.call(response,k)).map(k=>{used.add(k);return `<div class="field-answer-row"><dt>${safe(humanize(k))}</dt><dd>${answerValue(response[k])}</dd></div>`;}).join('');
      return items ? `<details class="field-response-group" open><summary>${safe(title)}</summary><dl>${items}</dl></details>` : '';
    }).join('');
    const other = Object.keys(response).filter(k=>!used.has(k));
    return blocks + (other.length ? `<details class="field-response-group"><summary>Other fields</summary><dl>${other.map(k=>`<div class="field-answer-row"><dt>${safe(humanize(k))}</dt><dd>${answerValue(response[k])}</dd></div>`).join('')}</dl></details>` : '');
  }

  async function openDetail(id) {
    selected = rows.find(r=>r.id===id); if (!selected) return;
    document.getElementById('detail-household-title').textContent = selected.household_code || 'Household Survey';
    document.getElementById('detail-subtitle').textContent = `${communityName(selected.community_id)} · ${selected.barangay || 'Barangay not entered'}`;
    document.getElementById('detail-summary-grid').innerHTML = `
      <article><span>Status</span>${statusChip(selected.status)}</article>
      <article><span>Interview date</span><strong>${safe(fmtDate(selected.interview_date))}</strong></article>
      <article><span>Enumerator</span><strong>${safe(enumerator(selected))}</strong></article>
      <article><span>Synced</span><strong>${safe(fmtDateTime(selected.synced_at || selected.updated_at))}</strong></article>`;
    document.getElementById('detail-responses').innerHTML = renderResponses(selected.response_json || {});
    document.getElementById('mark-reviewed').disabled = selected.status==='reviewed';
    document.getElementById('mark-reviewed').textContent = selected.status==='reviewed' ? 'Reviewed ✓' : 'Mark Reviewed';
    document.getElementById('archive-submission').disabled = selected.status==='archived';
    await renderLocation(selected);
    await renderPhoto(selected);
    document.getElementById('field-detail-backdrop').hidden=false;
    const drawer=document.getElementById('field-detail-drawer'); drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
    document.body.classList.add('field-detail-open');
  }

  function closeDetail() {
    document.getElementById('field-detail-backdrop').hidden=true;
    const drawer=document.getElementById('field-detail-drawer');drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');
    document.body.classList.remove('field-detail-open');
    document.getElementById('detail-action-message').textContent='';
  }

  async function renderLocation(r) {
    const section=document.getElementById('detail-map-section');
    const valid=Number.isFinite(r.latitude)&&Number.isFinite(r.longitude);
    section.hidden=!valid;
    if (!valid) return;
    document.getElementById('detail-gps-copy').textContent = `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}${r.gps_accuracy_m ? ` · ±${Math.round(r.gps_accuracy_m)} m` : ''}`;
    setTimeout(()=>{
      if (!detailMap) {
        detailMap=L.map('field-detail-map',{zoomControl:true}).setView([r.latitude,r.longitude],16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(detailMap);
      } else detailMap.setView([r.latitude,r.longitude],16);
      if (detailMarker) detailMarker.remove();
      detailMarker=L.marker([r.latitude,r.longitude]).addTo(detailMap).bindPopup(safe(r.household_code||'Household')).openPopup();
      detailMap.invalidateSize();
    },180);
  }

  async function renderPhoto(r) {
    const section=document.getElementById('detail-photo-section'); const target=document.getElementById('detail-photo');
    section.hidden=!r.photo_path; target.innerHTML=''; if (!r.photo_path) return;
    const {data,error}=await client.storage.from('field-media').createSignedUrl(r.photo_path,300);
    if (error || !data?.signedUrl) { target.innerHTML='<span>Photo could not be opened with the current permissions.</span>'; return; }
    target.innerHTML=`<img src="${safe(data.signedUrl)}" alt="Household reference photo"><small>Temporary 5-minute access link.</small>`;
  }

  async function setStatus(status) {
    if (!selected) return;
    const el=document.getElementById('detail-action-message');el.textContent='Saving…';
    const {data,error}=await client.from('field_form_submissions').update({status,updated_at:new Date().toISOString()}).eq('id',selected.id).select().single();
    if (error){el.textContent=error.message;return;}
    rows=rows.map(r=>r.id===data.id?data:r); selected=data; applyFilters(); el.textContent=status==='reviewed'?'Marked reviewed ✓':'Archived ✓';
    document.getElementById('mark-reviewed').disabled=status==='reviewed'; document.getElementById('mark-reviewed').textContent=status==='reviewed'?'Reviewed ✓':'Mark Reviewed';
    document.getElementById('archive-submission').disabled=status==='archived';
  }

  function csvEscape(v) { const s=String(v??''); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
  function exportCSV() {
    const headers=['submission_id','household_code','community','barangay','zone','interview_date','enumerator','status','latitude','longitude','gps_accuracy_m','synced_at','response_json'];
    const lines=[headers.join(',')];
    filtered.forEach(r=>lines.push([
      r.id,r.household_code,communityName(r.community_id),r.barangay,r.zone,r.interview_date,enumerator(r),r.status,r.latitude,r.longitude,r.gps_accuracy_m,r.synced_at||r.updated_at,JSON.stringify(r.response_json||{})
    ].map(csvEscape).join(',')));
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`household-surveys-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  function bind() {
    ['field-search','field-barangay-filter','field-status-filter','field-date-from','field-date-to'].forEach(id=>document.getElementById(id).addEventListener(id==='field-search'?'input':'change',applyFilters));
    document.getElementById('field-community-filter').addEventListener('change',()=>{refreshBarangays();applyFilters();});
    document.getElementById('clear-field-filters').addEventListener('click',()=>{['field-search','field-community-filter','field-barangay-filter','field-status-filter','field-date-from','field-date-to'].forEach(id=>document.getElementById(id).value='');refreshBarangays();applyFilters();});
    document.getElementById('refresh-submissions').addEventListener('click',()=>loadData().catch(err=>message(err.message,'error')));
    document.getElementById('export-submissions').addEventListener('click',exportCSV);
    document.getElementById('close-field-detail').addEventListener('click',closeDetail);
    document.getElementById('field-detail-backdrop').addEventListener('click',closeDetail);
    document.getElementById('mark-reviewed').addEventListener('click',()=>setStatus('reviewed'));
    document.getElementById('archive-submission').addEventListener('click',()=>{if(confirm('Archive this household survey record?'))setStatus('archived');});
    window.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetail();});
  }

  async function init(){
    try{await authorize();bind();await loadData();loading.hidden=true;app.hidden=false;document.body.classList.remove('portal-is-loading');}
    catch(err){console.error('[Field Survey Admin]',err);loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open Field Survey Manager</strong><span>${safe(err.message||err)}</span><a href="admin.html">Return to Administration</a>`;}
  }
  init();
})();
