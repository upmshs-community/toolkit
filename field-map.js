(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById('field-map-loading');
  const app = document.getElementById('field-map-app');

  let client, user, profile;
  let submissions = [], communities = [], mapPoints = [];
  let profiles = new Map();
  let filtered = [];
  let map, householdCluster, healthLayer, projectLayer, resourceLayer;

  const managerRoles = ['admin','coordinator','faculty'];
  const safe = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const fmtDate = v => v ? new Date(v).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : '—';
  const initials = name => String(name||'UP').split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || 'UP';
  const hasGPS = r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude);
  const pct = (n,d) => d ? Math.round((n/d)*100) : 0;

  function message(text='',type='') {
    const el=document.getElementById('field-map-message');
    el.textContent=text;
    el.className=`admin-message ${type}`;
  }

  function setUserUI() {
    const name=profile.full_name || profile.email || user.email || 'Toolkit Manager';
    document.querySelectorAll('[data-user-name]').forEach(x=>x.textContent=name);
    document.querySelectorAll('[data-user-email]').forEach(x=>x.textContent=profile.email || user.email || '');
    document.querySelectorAll('[data-user-initials]').forEach(x=>x.textContent=initials(name));
  }

  async function authorize() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error('Supabase configuration is missing.');
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:u,error:e}=await client.auth.getUser();
    if (e || !u?.user) return location.replace('index.html');
    user=u.user;
    const {data:p,error:pe}=await client.from('profiles').select('email,full_name,role,status').eq('id',user.id).single();
    if (pe || !p) throw pe || new Error('Profile not found.');
    profile=p;
    if (p.status!=='active' || !managerRoles.includes(String(p.role))) return location.replace('portal.html');
    setUserUI();
    document.querySelectorAll('[data-sign-out]').forEach(btn=>btn.addEventListener('click',async()=>{await client.auth.signOut();location.replace('index.html');}));
  }

  async function loadData() {
    message('Loading field map data…');
    const [sRes,cRes,mRes]=await Promise.all([
      client.from('field_form_submissions')
        .select('id,community_id,submitted_by,status,household_code,interview_date,barangay,zone,interviewer,latitude,longitude,gps_accuracy_m,location_captured_at,synced_at,updated_at')
        .order('updated_at',{ascending:false}),
      client.from('communities').select('id,name,province').order('name'),
      client.from('community_map_points').select('*').eq('is_active',true).order('name')
    ]);
    if (sRes.error) throw sRes.error;
    if (cRes.error) throw cRes.error;
    if (mRes.error) {
      if (/community_map_points/i.test(mRes.error.message || '')) throw new Error('Run the Phase 7C SQL first to create community_map_points.');
      throw mRes.error;
    }
    submissions=sRes.data || [];
    communities=cRes.data || [];
    mapPoints=mRes.data || [];

    const ids=[...new Set(submissions.map(r=>r.submitted_by).filter(Boolean))];
    profiles=new Map();
    if (ids.length) {
      const pr=await client.from('profiles').select('id,full_name,email,batch,year_level').in('id',ids);
      if (!pr.error) (pr.data||[]).forEach(p=>profiles.set(p.id,p));
    }
    populateFilters();
    applyFilters();
    message('');
  }

  function communityName(id) {
    const c=communities.find(x=>x.id===id);
    return c ? `${c.name}${c.province ? `, ${c.province}` : ''}` : 'Unassigned community';
  }

  function enumerator(r) {
    const p=profiles.get(r.submitted_by);
    return p?.full_name || r.interviewer || p?.email || 'Unknown';
  }

  function populateFilters() {
    const csel=document.getElementById('map-community-filter');
    const current=csel.value;
    csel.innerHTML='<option value="">All communities</option>'+communities.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join('');
    csel.value=current;

    const names=[...new Set(submissions.map(enumerator).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    document.getElementById('map-enumerator-filter').innerHTML='<option value="">All enumerators</option>'+names.map(n=>`<option>${safe(n)}</option>`).join('');
    refreshBarangays();
  }

  function refreshBarangays() {
    const community=document.getElementById('map-community-filter').value;
    const sel=document.getElementById('map-barangay-filter');
    const current=sel.value;
    const values=[...new Set(submissions.filter(r=>!community || r.community_id===community).map(r=>r.barangay).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    sel.innerHTML='<option value="">All barangays</option>'+values.map(v=>`<option>${safe(v)}</option>`).join('');
    if (values.includes(current)) sel.value=current;
  }

  function applyFilters() {
    const community=document.getElementById('map-community-filter').value;
    const barangay=document.getElementById('map-barangay-filter').value;
    const status=document.getElementById('map-status-filter').value;
    const enumeratorName=document.getElementById('map-enumerator-filter').value;
    const from=document.getElementById('map-date-from').value;
    const to=document.getElementById('map-date-to').value;

    filtered=submissions.filter(r=>{
      if (community && r.community_id!==community) return false;
      if (barangay && r.barangay!==barangay) return false;
      if (status && r.status!==status) return false;
      if (enumeratorName && enumerator(r)!==enumeratorName) return false;
      if (from && (!r.interview_date || r.interview_date<from)) return false;
      if (to && (!r.interview_date || r.interview_date>to)) return false;
      return true;
    });

    renderStats();
    renderAnalytics();
    renderMap();
    renderTable();
  }

  function renderStats() {
    const gps=filtered.filter(hasGPS).length;
    const reviewed=filtered.filter(r=>r.status==='reviewed').length;
    const barangays=new Set(filtered.map(r=>r.barangay).filter(Boolean));
    const enumerators=new Set(filtered.map(enumerator).filter(Boolean));
    document.getElementById('map-stat-total').textContent=filtered.length;
    document.getElementById('map-stat-gps').textContent=gps;
    document.getElementById('map-stat-gps-rate').textContent=`${pct(gps,filtered.length)}% capture`;
    document.getElementById('map-stat-reviewed').textContent=reviewed;
    document.getElementById('map-stat-review-rate').textContent=`${pct(reviewed,filtered.length)}% reviewed`;
    document.getElementById('map-stat-barangays').textContent=barangays.size;
    document.getElementById('map-stat-enumerators').textContent=enumerators.size;
  }

  function renderAnalytics() {
    const statusOrder=['reviewed','completed','draft','archived'];
    const max=Math.max(1,...statusOrder.map(s=>filtered.filter(r=>r.status===s).length));
    document.getElementById('map-status-bars').innerHTML=statusOrder.map(s=>{
      const count=filtered.filter(r=>r.status===s).length;
      return `<div class="map-status-row"><div><span>${safe(s)}</span><strong>${count}</strong></div><div class="map-status-track"><i class="bar-${safe(s)}" style="width:${Math.round((count/max)*100)}%"></i></div></div>`;
    }).join('');

    const groups=new Map();
    filtered.forEach(r=>{
      const key=r.barangay || 'Barangay not entered';
      if (!groups.has(key)) groups.set(key,{name:key,total:0,reviewed:0,gps:0,last:null});
      const g=groups.get(key); g.total++;
      if (r.status==='reviewed') g.reviewed++;
      if (hasGPS(r)) g.gps++;
      if (r.interview_date && (!g.last || r.interview_date>g.last)) g.last=r.interview_date;
    });
    const list=[...groups.values()].sort((a,b)=>b.total-a.total || a.name.localeCompare(b.name));
    const target=document.getElementById('map-barangay-analytics');
    target.innerHTML=list.length ? list.slice(0,12).map(g=>`<article><div><strong>${safe(g.name)}</strong><small>${g.reviewed}/${g.total} reviewed · ${g.gps} GPS</small></div><span>${g.total}</span></article>`).join('') : '<div class="table-empty">No barangay activity in the current filter.</div>';
  }

  function initMap() {
    map=L.map('community-field-map',{zoomControl:true,preferCanvas:true}).setView([11.2,124.9],9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      attribution:'© OpenStreetMap contributors'
    }).addTo(map);
    householdCluster=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:45,spiderfyOnMaxZoom:true});
    healthLayer=L.layerGroup();
    projectLayer=L.layerGroup();
    resourceLayer=L.layerGroup();
    map.addLayer(householdCluster);
    map.addLayer(healthLayer);
    map.addLayer(projectLayer);
    map.addLayer(resourceLayer);
  }

  function statusColor(status) {
    if (status==='reviewed') return '#17683b';
    if (status==='completed') return '#9a6712';
    if (status==='archived') return '#77706a';
    return '#7b1113';
  }

  function householdIcon(status) {
    const color=statusColor(status);
    return L.divIcon({
      className:'field-map-household-icon-wrap',
      html:`<span class="field-map-household-icon" style="--marker-color:${color}"></span>`,
      iconSize:[22,22],
      iconAnchor:[11,11],
      popupAnchor:[0,-10]
    });
  }

  function pointIcon(type) {
    const cls=type==='rhu'||type==='bhs'||type==='hospital'?'health':type==='project'?'project':'resource';
    const glyph=type==='rhu'?'R':type==='bhs'?'B':type==='hospital'?'H':type==='project'?'P':'•';
    return L.divIcon({
      className:'field-map-point-icon-wrap',
      html:`<span class="field-map-point-icon ${cls}">${glyph}</span>`,
      iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-12]
    });
  }

  function renderMap() {
    if (!map) initMap();
    householdCluster.clearLayers(); healthLayer.clearLayers(); projectLayer.clearLayers(); resourceLayer.clearLayers();

    const bounds=[];
    const showHouseholds=document.getElementById('layer-households').checked;
    const showHealth=document.getElementById('layer-health').checked;
    const showProjects=document.getElementById('layer-projects').checked;
    const showResources=document.getElementById('layer-resources').checked;
    const selectedCommunity=document.getElementById('map-community-filter').value;

    if (showHouseholds) {
      filtered.filter(hasGPS).forEach(r=>{
        const latlng=[r.latitude,r.longitude]; bounds.push(latlng);
        const marker=L.marker(latlng,{icon:householdIcon(r.status)});
        marker.bindPopup(`
          <div class="field-map-popup">
            <span class="field-map-popup-kicker">Household survey</span>
            <strong>${safe(r.household_code || 'No household #')}</strong>
            <small>${safe(communityName(r.community_id))}</small>
            <small>${safe(r.barangay || 'Barangay not entered')} · ${safe(fmtDate(r.interview_date))}</small>
            <span class="field-status-chip status-${safe(r.status)}">${safe(r.status)}</span>
            <a href="field-submissions-admin.html?open=${encodeURIComponent(r.id)}">Review survey →</a>
          </div>`);
        householdCluster.addLayer(marker);
      });
    }

    mapPoints.filter(p=>!selectedCommunity || p.community_id===selectedCommunity).forEach(p=>{
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return;
      const type=String(p.point_type || 'resource');
      const isHealth=['rhu','bhs','hospital','referral'].includes(type);
      const isProject=type==='project';
      const shouldShow=isHealth ? showHealth : isProject ? showProjects : showResources;
      if (!shouldShow) return;
      const marker=L.marker([p.latitude,p.longitude],{icon:pointIcon(type)}).bindPopup(`
        <div class="field-map-popup">
          <span class="field-map-popup-kicker">${safe(type.replaceAll('_',' '))}</span>
          <strong>${safe(p.name)}</strong>
          <small>${safe(communityName(p.community_id))}</small>
          ${p.notes ? `<small>${safe(p.notes)}</small>` : ''}
        </div>`);
      if (isHealth) healthLayer.addLayer(marker); else if (isProject) projectLayer.addLayer(marker); else resourceLayer.addLayer(marker);
      bounds.push([p.latitude,p.longitude]);
    });

    if (map.hasLayer(householdCluster)!==showHouseholds) showHouseholds ? map.addLayer(householdCluster) : map.removeLayer(householdCluster);
    if (map.hasLayer(healthLayer)!==showHealth) showHealth ? map.addLayer(healthLayer) : map.removeLayer(healthLayer);
    if (map.hasLayer(projectLayer)!==showProjects) showProjects ? map.addLayer(projectLayer) : map.removeLayer(projectLayer);
    if (map.hasLayer(resourceLayer)!==showResources) showResources ? map.addLayer(resourceLayer) : map.removeLayer(resourceLayer);

    if (bounds.length) {
      map.fitBounds(bounds,{padding:[30,30],maxZoom:15});
    }
    setTimeout(()=>map.invalidateSize(),80);
  }

  function renderTable() {
    const mapped=filtered.filter(hasGPS);
    const body=document.getElementById('mapped-households-body');
    if (!mapped.length) {
      body.innerHTML='<tr><td colspan="7" class="table-empty">No GPS-enabled household surveys match the current filters.</td></tr>';
      return;
    }
    body.innerHTML=mapped.map(r=>`<tr>
      <td><strong>${safe(r.household_code || 'No household #')}</strong><small>${safe(r.zone || '')}</small></td>
      <td><strong>${safe(communityName(r.community_id))}</strong><small>${safe(r.barangay || 'Barangay not entered')}</small></td>
      <td><span class="field-status-chip status-${safe(r.status)}">${safe(r.status)}</span></td>
      <td>${safe(fmtDate(r.interview_date))}</td>
      <td>${safe(enumerator(r))}</td>
      <td>${r.gps_accuracy_m ? `±${Math.round(r.gps_accuracy_m)} m` : '—'}</td>
      <td><a class="mini-action" href="field-submissions-admin.html?open=${encodeURIComponent(r.id)}">Review</a></td>
    </tr>`).join('');
  }

  function fitAll() {
    const points=filtered.filter(hasGPS).map(r=>[r.latitude,r.longitude]);
    if (!points.length) return;
    map.fitBounds(points,{padding:[35,35],maxZoom:15});
  }

  function bind() {
    ['map-barangay-filter','map-status-filter','map-enumerator-filter','map-date-from','map-date-to'].forEach(id=>document.getElementById(id).addEventListener('change',applyFilters));
    document.getElementById('map-community-filter').addEventListener('change',()=>{refreshBarangays();applyFilters();});
    ['layer-households','layer-health','layer-projects','layer-resources'].forEach(id=>document.getElementById(id).addEventListener('change',renderMap));
    document.getElementById('map-clear-filters').addEventListener('click',()=>{
      ['map-community-filter','map-barangay-filter','map-status-filter','map-enumerator-filter','map-date-from','map-date-to'].forEach(id=>document.getElementById(id).value='');
      refreshBarangays(); applyFilters();
    });
    document.getElementById('map-fit-all').addEventListener('click',fitAll);
  }

  async function init() {
    try {
      await authorize();
      bind();
      await loadData();
      loading.hidden=true;
      app.hidden=false;
      document.body.classList.remove('portal-is-loading');
      setTimeout(()=>map?.invalidateSize(),120);
    } catch(err) {
      console.error('[Phase 7C Field Map]',err);
      loading.innerHTML=`<img src="assets/shs-logo.png" alt="UPM-SHS"><strong>Unable to open Community Field Map</strong><span>${safe(err.message || err)}</span><a href="admin.html">Return to Administration</a>`;
    }
  }

  init();
})();
