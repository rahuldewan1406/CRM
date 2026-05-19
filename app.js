// ── Config ────────────────────────────────────────────────────────────────────
const API      = 'http://localhost:3002';
const SMTP_API = 'http://localhost:3001';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  contacts:     [],
  leads:        [],
  tickets:      [],
  opportunities: JSON.parse(localStorage.getItem('crm_opps')        || '[]'),
  accounts:      JSON.parse(localStorage.getItem('crm_accounts')    || '[]'),
  projects:      JSON.parse(localStorage.getItem('crm_projects')    || '[]'),
  tasks:         JSON.parse(localStorage.getItem('crm_tasks')       || '[]'),
  milestones:    JSON.parse(localStorage.getItem('crm_milestones')  || '[]'),
  activities:    JSON.parse(localStorage.getItem('crm_activities')  || '[]'),
  session: null, accessToken: null, refreshToken: null, permissions: new Set(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const q = id => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail  = a => EMAIL_RE.test(String(a).trim());
function can(p) { return state.permissions.has(p); }
function fmtMoney(v) { return Number(v||0).toLocaleString('en-IN'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'; }
function timeAgo(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}
function badgeClass(val) {
  const map = { New:'new', Qualified:'qualified', Proposal:'proposal', Won:'won', Lost:'lost',
    Active:'active', Planning:'planning', 'On Hold':'onhold', Completed:'completed',
    Open:'open', 'In Progress':'inprogress', Resolved:'resolved',
    High:'high', Medium:'medium', Low:'low', Critical:'critical',
    'To Do':'todo', Done:'done', Blocked:'blocked' };
  return `badge badge-${map[val]||'low'}`;
}
function persistLocal() {
  ['opps','accounts','projects','tasks','milestones','activities'].forEach(k =>
    localStorage.setItem(`crm_${k}`, JSON.stringify(state[k==='opps'?'opportunities':k] || state[k]))
  );
  localStorage.setItem('crm_opps', JSON.stringify(state.opportunities));
  localStorage.setItem('crm_accounts', JSON.stringify(state.accounts));
  localStorage.setItem('crm_projects', JSON.stringify(state.projects));
  localStorage.setItem('crm_tasks', JSON.stringify(state.tasks));
  localStorage.setItem('crm_milestones', JSON.stringify(state.milestones));
  localStorage.setItem('crm_activities', JSON.stringify(state.activities));
}

// ── API fetch ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type':'application/json', ...(opts.headers||{}) };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;
  let res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401 && state.refreshToken) {
    const ok = await tryRefresh();
    if (ok) { headers['Authorization'] = `Bearer ${state.accessToken}`; res = await fetch(`${API}${path}`, { ...opts, headers }); }
    else { logout(); return null; }
  }
  return res;
}
async function tryRefresh() {
  try {
    const r = await fetch(`${API}/auth/refresh`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({refreshToken:state.refreshToken}) });
    if (!r.ok) return false;
    const d = await r.json();
    state.accessToken = d.accessToken; state.refreshToken = d.refreshToken; return true;
  } catch { return false; }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login(e) {
  e.preventDefault();
  q('loginStatus').textContent = '';
  try {
    const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:q('loginEmail').value.trim().toLowerCase(), password:q('loginPassword').value }) });
    const d = await r.json();
    if (!r.ok) { q('loginStatus').textContent = d.message||'Login failed.'; return; }
    state.accessToken = d.accessToken; state.refreshToken = d.refreshToken;
    state.session = d.user; state.permissions = new Set(d.permissions);
    q('loginForm').reset(); q('loginDialog').close();
    renderSession(); await loadAllData(); renderAll();
  } catch { q('loginStatus').textContent = 'Cannot reach API (port 3002). Is the server running?'; }
}
async function logout() {
  if (state.refreshToken) apiFetch('/auth/logout',{method:'POST',body:JSON.stringify({refreshToken:state.refreshToken})}).catch(()=>{});
  Object.assign(state, { session:null, accessToken:null, refreshToken:null, permissions:new Set(), contacts:[], leads:[], tickets:[] });
  renderSession(); renderAll();
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadAllData() {
  await Promise.all([
    apiFetch('/contacts').then(r=>r&&r.ok?r.json().then(d=>state.contacts=d):null),
    apiFetch('/leads').then(r=>r&&r.ok?r.json().then(d=>state.leads=d):null),
    apiFetch('/tickets').then(r=>r&&r.ok?r.json().then(d=>state.tickets=d):null),
  ]);
}
async function apiCreate(res, body) {
  const r = await apiFetch(`/${res}`, { method:'POST', body:JSON.stringify(body) });
  if (!r||!r.ok) { const e=r?await r.json():{message:'Error'}; alert(e.message); return false; }
  return true;
}
async function apiUpdate(res, id, body) {
  const r = await apiFetch(`/${res}/${id}`, { method:'PUT', body:JSON.stringify(body) });
  if (!r||!r.ok) { const e=r?await r.json():{message:'Error'}; alert(e.message); return false; }
  return true;
}
async function apiDelete(res, id) {
  if (!confirm('Delete this record?')) return;
  const r = await apiFetch(`/${res}/${id}`, { method:'DELETE' });
  if (!r||!r.ok) { alert('Delete failed.'); return; }
  if (res==='contacts') { await apiFetch('/contacts').then(r2=>r2&&r2.ok?r2.json().then(d=>state.contacts=d):null); }
  else if (res==='leads') { await apiFetch('/leads').then(r2=>r2&&r2.ok?r2.json().then(d=>state.leads=d):null); }
  else if (res==='tickets') { await apiFetch('/tickets').then(r2=>r2&&r2.ok?r2.json().then(d=>state.tickets=d):null); }
  renderAll();
}

// ── Navigation ────────────────────────────────────────────────────────────────
const PAGES = ['dashboard','customers','sales','projects','support','email'];
function switchTab(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tnav').forEach(b=>b.classList.remove('active'));
  q(id).classList.add('active');
  document.querySelector(`.tnav[data-tab="${id}"]`).classList.add('active');
  if (id==='projects') renderProjectViews();
}
function switchProjectView(view) {
  document.querySelectorAll('.project-view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.vtab').forEach(b=>b.classList.remove('active'));
  q(`project${view.charAt(0).toUpperCase()+view.slice(1)}View`).classList.add('active');
  document.querySelector(`.vtab[data-view="${view}"]`).classList.add('active');
  if (view==='gantt') renderGantt();
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id) { q(id).showModal(); }
function closeModal(id) { q(id).close(); }

// ── Forms ─────────────────────────────────────────────────────────────────────
q('loginForm').addEventListener('submit', login);
q('logoutBtn').addEventListener('click', logout);
q('loginBtn').addEventListener('click', ()=>q('loginDialog').showModal());
document.querySelectorAll('.tnav').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
q('mailForm').addEventListener('submit', sendMail);

// Contact form
q('contactForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.session) { alert('Please log in first.'); return; }
  const ok = await apiCreate('contacts', { name:q('name').value.trim(), email:q('email').value.trim(), secondaryEmail:q('secondaryEmail').value.trim(), phone:q('phone').value.trim(), company:q('company').value.trim(), gender:q('gender').value, age:Number(q('age').value), location:q('location').value.trim() });
  if (ok) { e.target.reset(); closeModal('contactModal'); await apiFetch('/contacts').then(r=>r&&r.ok?r.json().then(d=>state.contacts=d):null); renderAll(); }
});

// Lead form
q('leadForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.session) { alert('Please log in first.'); return; }
  const ok = await apiCreate('leads', { title:q('leadName').value.trim(), stage:q('leadStage').value, value:Number(q('leadValue').value), contactId:q('leadContact').value||null });
  if (ok) { e.target.reset(); closeModal('leadModal'); await apiFetch('/leads').then(r=>r&&r.ok?r.json().then(d=>state.leads=d):null); renderAll(); }
});

// Ticket form
q('ticketForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.session) { alert('Please log in first.'); return; }
  const ok = await apiCreate('tickets', { title:q('ticketTitle').value.trim(), priority:q('ticketPriority').value, status:q('ticketStatus').value, contactId:q('ticketContact').value||null });
  if (ok) { e.target.reset(); closeModal('ticketModal'); await apiFetch('/tickets').then(r=>r&&r.ok?r.json().then(d=>state.tickets=d):null); renderAll(); }
});

// Local-storage forms
function localForm(id, buildFn, saveKey, collection, closeId) {
  q(id).addEventListener('submit', e => {
    e.preventDefault();
    state[collection].push({ id:crypto.randomUUID(), created_at:new Date().toISOString(), ...buildFn() });
    persistLocal(); e.target.reset(); if(closeId) closeModal(closeId); renderAll();
  });
}

localForm('accountForm', ()=>({ name:q('accountName').value.trim(), tier:q('accountTier').value, renewalDate:q('renewalDate').value }), 'crm_accounts', 'accounts', 'accountModal');
localForm('opportunityForm', ()=>({ name:q('oppName').value.trim(), value:Number(q('oppValue').value), probability:Number(q('oppProbability').value) }), 'crm_opps', 'opportunities', 'oppModal');
localForm('projectForm', ()=>({ name:q('projectName').value.trim(), status:q('projectStatus').value, priority:q('projectPriority').value, manager:q('projectManager').value.trim(), startDate:q('projectStartDate').value, dueDate:q('projectDueDate').value, budget:Number(q('projectBudget').value||0), contactId:q('projectContact').value||null, description:q('projectDesc').value.trim(), progress:0 }), 'crm_projects', 'projects', 'projectModal');
localForm('taskForm', ()=>({ title:q('taskTitle').value.trim(), projectId:q('taskProject').value||null, assignee:q('taskAssignee').value.trim(), status:q('taskStatus').value, priority:q('taskPriority').value, dueDate:q('taskDueDate').value }), 'crm_tasks', 'tasks', 'taskModal');
localForm('milestoneForm', ()=>({ name:q('milestoneName').value.trim(), projectId:q('milestoneProject').value||null, date:q('milestoneDate').value, status:q('milestoneStatus').value }), 'crm_milestones', 'milestones', 'milestoneModal');
localForm('activityForm', ()=>({ type:q('activityType').value, note:q('activityNote').value.trim(), contactId:q('activityContact').value||null }), 'crm_activities', 'activities', 'activityModal');

// ── Session & Role ────────────────────────────────────────────────────────────
function renderSession() {
  const li = Boolean(state.session);
  q('loginBtn').classList.toggle('hidden', li);
  q('logoutBtn').classList.toggle('hidden', !li);
  q('userChip').classList.toggle('hidden', !li);
  if (li) {
    q('userBadge').textContent = state.session.name;
    q('userAvatar').textContent = state.session.name.charAt(0).toUpperCase();
    const role = can('users.delete')?'Admin':can('users.read')?'Manager':can('leads.delete')?'Sales Rep':'Viewer';
    q('roleBadge').textContent = role;
  }
}

// ── SMTP ──────────────────────────────────────────────────────────────────────
async function checkSmtp() {
  try {
    const r = await fetch(`${SMTP_API}/api/health`); const d = await r.json();
    const ok = r.ok && d.status==='ok';
    q('smtpDot').className = `status-dot ${ok?'online':'warning'}`;
    q('smtpDot').title = ok ? 'SMTP Ready' : 'SMTP Not Configured';
    q('smtpStatusPanel').innerHTML = ok
      ? `<span style="color:var(--green);font-weight:600">✓ SMTP is configured and ready.</span>`
      : `<span style="color:var(--amber)">⚠ SMTP not configured. Create a <code>.env</code> file from <code>.env.example</code>.</span>`;
    return ok;
  } catch {
    q('smtpDot').className = 'status-dot';
    q('smtpStatusPanel').innerHTML = `<span style="color:var(--text-3)">SMTP server unreachable (port 3001).</span>`;
    return false;
  }
}

async function sendMail(e) {
  e.preventDefault();
  const mode = q('mailMode').value;
  const recipients = mode==='bulk'
    ? state.contacts.flatMap(c=>[c.email,c.secondary_email]).filter(Boolean)
    : mode==='multi' ? q('mailTo').value.split(',').map(v=>v.trim()).filter(Boolean)
    : [q('mailTo').value.trim()].filter(Boolean);
  const payload = { recipients, subject:q('mailSubject').value.trim(), body:q('mailBody').value.trim() };
  const banner = q('mailStatus');
  if (!payload.recipients.length) { showBanner(banner,'Provide at least one recipient.','warning'); return; }
  const bad = payload.recipients.filter(r=>!isEmail(r));
  if (bad.length) { showBanner(banner,`Invalid address${bad.length>1?'es':''}: ${bad.join(', ')}`,'error'); return; }
  if (!payload.subject||!payload.body) { showBanner(banner,'Complete subject and message.','warning'); return; }
  showBanner(banner,'Sending…','info');
  try {
    const r = await fetch(`${SMTP_API}/api/send-email`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    showBanner(banner, d.message||'Email sent.', 'info');
    q('mailForm').reset(); checkSmtp();
  } catch(err) {
    const ml = `mailto:${encodeURIComponent(recipients[0])}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    banner.innerHTML = `SMTP failed. <a href="${ml}">Open email client</a> as fallback.`;
    banner.className = 'status-banner error'; banner.classList.remove('hidden');
  }
}
function showBanner(el, msg, type) {
  el.textContent = msg; el.className = `status-banner ${type}`; el.classList.remove('hidden');
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────
async function deleteRecord(col, id) { await apiDelete(col, id); }

async function openEditDialog(collection, id) {
  const record = state[collection].find(r=>r.id===id);
  if (!record) return;
  const fields = {
    contacts:[{id:'eName',label:'Full Name',type:'text',key:'name'},{id:'eEmail',label:'Primary Email',type:'email',key:'email'},{id:'ePhone',label:'Phone',type:'text',key:'phone'},{id:'eCompany',label:'Company',type:'text',key:'company'},{id:'eLocation',label:'Location',type:'text',key:'location'},{id:'eAge',label:'Age',type:'number',key:'age'}],
    leads:[{id:'eLeadTitle',label:'Lead Title',type:'text',key:'title'},{id:'eLeadValue',label:'Value (₹)',type:'number',key:'value'}],
    tickets:[{id:'eTicketTitle',label:'Title',type:'text',key:'title'}],
    projects:[{id:'eProjName',label:'Project Name',type:'text',key:'name'},{id:'eProjManager',label:'Manager',type:'text',key:'manager'},{id:'eProjProgress',label:'Progress %',type:'number',key:'progress'},{id:'eProjDue',label:'Due Date',type:'date',key:'dueDate'}],
    tasks:[{id:'eTaskTitle',label:'Task Title',type:'text',key:'title'},{id:'eTaskAssignee',label:'Assignee',type:'text',key:'assignee'},{id:'eTaskDue',label:'Due Date',type:'date',key:'dueDate'}],
  };
  const selects = {
    contacts:[{id:'eGender',label:'Gender',key:'gender',opts:['Female','Male','Other']}],
    leads:[{id:'eLeadStage',label:'Stage',key:'stage',opts:['New','Qualified','Proposal','Won','Lost']}],
    tickets:[{id:'eTkPriority',label:'Priority',key:'priority',opts:['Low','Medium','High']},{id:'eTkStatus',label:'Status',key:'status',opts:['Open','In Progress','Resolved']}],
    projects:[{id:'eProjStatus',label:'Status',key:'status',opts:['Planning','Active','On Hold','Completed']},{id:'eProjPriority',label:'Priority',key:'priority',opts:['Low','Medium','High','Critical']}],
    tasks:[{id:'eTaskStatus',label:'Status',key:'status',opts:['To Do','In Progress','Done','Blocked']},{id:'eTaskPriority',label:'Priority',key:'priority',opts:['Low','Medium','High','Critical']}],
  };
  const titles = {contacts:'Edit Contact',leads:'Edit Lead',tickets:'Edit Ticket',projects:'Edit Project',tasks:'Edit Task'};
  q('editDialogTitle').textContent = titles[collection]||'Edit';
  q('editDialogBody').innerHTML =
    (fields[collection]||[]).map(f=>`<label style="display:flex;flex-direction:column;gap:.3rem;font-size:.8rem;font-weight:600;color:var(--text-2)">${f.label}<input id="${f.id}" type="${f.type}" value="${record[f.key]??''}" style="padding:.5rem .7rem;border:1px solid var(--border);border-radius:7px;background:var(--bg);font-size:.88rem" /></label>`).join('') +
    (selects[collection]||[]).map(f=>`<label style="display:flex;flex-direction:column;gap:.3rem;font-size:.8rem;font-weight:600;color:var(--text-2)">${f.label}<select id="${f.id}" style="padding:.5rem .7rem;border:1px solid var(--border);border-radius:7px;background:var(--bg)">${f.opts.map(o=>`<option${record[f.key]===o?' selected':''}>${o}</option>`).join('')}</select></label>`).join('');

  q('editDialogForm').onsubmit = async ev => {
    ev.preventDefault();
    const body = {};
    (fields[collection]||[]).forEach(f=>{ const el=q(f.id); if(el) body[f.key]=f.type==='number'?Number(el.value):el.value.trim(); });
    (selects[collection]||[]).forEach(f=>{ const el=q(f.id); if(el) body[f.key]=el.value; });
    if (['contacts','leads','tickets'].includes(collection)) {
      const ok = await apiUpdate(collection, id, body);
      if (ok) { await loadAllData(); renderAll(); q('editDialog').close(); }
    } else {
      const idx = state[collection].findIndex(r=>r.id===id);
      if (idx!==-1) { Object.assign(state[collection][idx], body); persistLocal(); renderAll(); q('editDialog').close(); }
    }
  };
  q('editDialog').showModal();
}

function deleteLocal(collection, id) {
  if (!confirm('Delete this record?')) return;
  state[collection] = state[collection].filter(r=>r.id!==id);
  persistLocal(); renderAll();
}

// ── Render helpers ────────────────────────────────────────────────────────────
function actBtns(col, id, canEdit=true, canDel=true) {
  const e = canEdit ? `<button class="btn-edit" onclick="openEditDialog('${col}','${id}')">Edit</button>` : '';
  const d = canDel  ? `<button class="btn-delete" onclick="${['contacts','leads','tickets'].includes(col)?'deleteRecord':'deleteLocal'}('${col}','${id}')">Delete</button>` : '';
  return (e||d) ? `<div class="record-actions">${e}${d}</div>` : '';
}
function pBar(pct, color='var(--accent)') {
  const p = Math.min(100, Math.max(0, pct||0));
  return `<div class="progress-bar-wrap"><div class="progress-bar" style="width:${p}%;background:${color}"></div></div>`;
}

// ── Populate contact dropdowns ────────────────────────────────────────────────
function syncContactDropdowns() {
  const opts = '<option value="">— None —</option>' + state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  ['leadContact','projectContact','activityContact','ticketContact'].forEach(id=>{ const el=q(id); if(el) el.innerHTML=opts; });
  q('customerSelect').innerHTML = '<option value="">Select a contact…</option>' + state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
}
function syncProjectDropdowns() {
  const opts = '<option value="">— None —</option>' + state.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  ['taskProject','milestoneProject','taskProjectFilter'].forEach(id=>{ const el=q(id); if(el) el.innerHTML=(id==='taskProjectFilter'?'<option value="">All Projects</option>':'')+opts; });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const today = new Date(), in30 = new Date(Date.now()+30*86400000);
  q('contactCount').textContent    = state.contacts.length;
  q('leadCount').textContent       = state.leads.length;
  q('opportunityCount').textContent = state.opportunities.length;
  q('ticketOpenCount').textContent = state.tickets.filter(t=>t.status==='Open').length;
  q('projectActiveCount').textContent = state.projects.filter(p=>p.status==='Active').length;
  q('renewalDueCount').textContent = state.accounts.filter(a=>a.renewalDate&&new Date(a.renewalDate)>=today&&new Date(a.renewalDate)<=in30).length;
  q('dashDate').textContent = today.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // ── Pipeline bar chart ─────────────────────────────────────────────────────
  const stages = ['New','Qualified','Proposal','Won','Lost'];
  const colors  = ['#94a3b8','#7c3aed','#d97706','#16a34a','#e11d48'];
  const totals  = stages.map(s=>state.leads.filter(l=>l.stage===s).reduce((a,l)=>a+(l.value||0),0));
  const max     = Math.max(...totals, 1);
  const wf      = state.leads.filter(l=>l.stage==='Qualified'||l.stage==='Proposal').reduce((a,l)=>a+(l.value||0)*({'Qualified':0.4,'Proposal':0.7}[l.stage]||0),0)
                + state.leads.filter(l=>l.stage==='Won').reduce((a,l)=>a+(l.value||0),0);
  q('pipelineChart').innerHTML = stages.map((s,i)=>`
    <div class="pipeline-row">
      <span style="color:var(--text-2);font-size:.78rem">${s}</span>
      <div class="pipeline-bar-wrap"><div class="pipeline-bar" style="width:${(totals[i]/max*100).toFixed(1)}%;background:${colors[i]}"></div></div>
      <span class="pipeline-val">₹${fmtMoney(totals[i])}</span>
    </div>`).join('');
  q('weightedForecast').textContent = fmtMoney(wf);
  q('weightedForecast2').textContent = fmtMoney(wf);

  // ── Ticket donut ───────────────────────────────────────────────────────────
  const open=state.tickets.filter(t=>t.status==='Open').length, prog=state.tickets.filter(t=>t.status==='In Progress').length, res=state.tickets.filter(t=>t.status==='Resolved').length;
  const tot=Math.max(open+prog+res,1);
  const donutData=[{l:'Open',v:open,c:'#d97706'},{l:'In Progress',v:prog,c:'#2563eb'},{l:'Resolved',v:res,c:'#16a34a'}];
  let offset=0; const R=45,CX=60,CY=60,circ=2*Math.PI*R;
  const paths=donutData.map(({v,c})=>{const pct=v/tot,len=pct*circ,path=`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${c}" stroke-width="18" stroke-dasharray="${len} ${circ-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${CX} ${CY})" />`;offset+=len;return path;}).join('');
  q('donutSvg').innerHTML = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#f1f5f9" stroke-width="18"/>${paths}<text x="${CX}" y="${CY+5}" text-anchor="middle" font-size="14" font-weight="700" fill="#0f172a">${tot}</text>`;
  q('donutLegend').innerHTML = donutData.map(({l,v,c})=>`<div class="legend-item"><div class="legend-dot" style="background:${c}"></div>${l}: <strong>${v}</strong></div>`).join('');

  // ── Conversion funnel ──────────────────────────────────────────────────────
  const funnelStages = ['New','Qualified','Proposal','Won'];
  const funnelColors = ['#94a3b8','#7c3aed','#d97706','#16a34a'];
  const funnelCounts = funnelStages.map(s=>state.leads.filter(l=>l.stage===s).length);
  const funnelMax = Math.max(funnelCounts[0], 1);
  q('conversionFunnel').innerHTML = funnelStages.map((s,i)=>{
    const pct = ((funnelCounts[i]/funnelMax)*100).toFixed(0);
    const conv = i>0&&funnelCounts[i-1]>0 ? ((funnelCounts[i]/funnelCounts[i-1])*100).toFixed(0)+'%' : '—';
    return `<div class="funnel-row">
      <div class="funnel-label"><span>${s}</span><span style="font-family:var(--mono);">${funnelCounts[i]} leads</span></div>
      <div class="funnel-bar-outer"><div class="funnel-bar-inner" style="width:${pct}%;background:${funnelColors[i]}"></div></div>
      ${i>0?'<div class="funnel-pct">↑ '+conv+' conv.</div>':'<div class="funnel-pct">baseline</div>'}
    </div>`;
  }).join('') || '<p style="color:var(--text-3);font-size:.82rem">No leads yet.</p>';

  // ── Task workload ──────────────────────────────────────────────────────────
  const wlStatuses = [['To Do','#94a3b8'],['In Progress','#2563eb'],['Done','#16a34a'],['Blocked','#e11d48']];
  const wlCounts = wlStatuses.map(([s])=>state.tasks.filter(t=>t.status===s).length);
  const wlMax = Math.max(...wlCounts, 1);
  q('workloadChart').innerHTML = wlStatuses.map(([s,c],i)=>`
    <div class="workload-row">
      <span style="font-size:.75rem;color:var(--text-2)">${s}</span>
      <div class="workload-bar-wrap"><div class="workload-bar" style="width:${(wlCounts[i]/wlMax*100).toFixed(1)}%;background:${c}"></div></div>
      <span style="font-family:var(--mono);font-size:.75rem;text-align:right">${wlCounts[i]}</span>
    </div>`).join('') + `<div style="margin-top:.75rem;padding-top:.6rem;border-top:1px solid var(--border);font-size:.78rem;color:var(--text-2)">
      Total tasks: <strong>${state.tasks.length}</strong> · Done: <strong style="color:var(--green)">${wlCounts[2]}</strong>
    </div>`;

  // ── Top accounts ───────────────────────────────────────────────────────────
  const now = Date.now();
  const accs = [...state.accounts].sort((a,b)=>{
    const tierVal = {Enterprise:3,'Mid-Market':2,SMB:1};
    return (tierVal[b.tier]||0)-(tierVal[a.tier]||0);
  }).slice(0,6);
  q('topAccounts').innerHTML = accs.map(a=>{
    const daysLeft = a.renewalDate ? Math.ceil((new Date(a.renewalDate)-now)/86400000) : null;
    const renewalLabel = daysLeft===null ? '—' : daysLeft<=0 ? 'Overdue' : daysLeft<=30 ? `${daysLeft}d left` : fmtDate(a.renewalDate);
    const isSoon = daysLeft!==null && daysLeft<=30;
    return `<div class="account-row">
      <div class="account-row-name">${a.name}</div>
      <span class="${badgeClass(a.tier||'SMB')}">${a.tier}</span>
      <span class="account-row-renewal ${isSoon?'renewal-soon':''}">${renewalLabel}</span>
    </div>`;
  }).join('') || '<p style="color:var(--text-3);font-size:.82rem;padding:.4rem">No accounts yet.</p>';

  // ── Projects at a glance ───────────────────────────────────────────────────
  q('dashProjects').innerHTML = state.projects.slice(0,6).map(p=>`
    <div class="dash-proj-row">
      <div class="dash-proj-name">${p.name}</div>
      <span class="${badgeClass(p.status)}" style="font-size:.65rem">${p.status}</span>
      ${pBar(p.progress)}
      <span style="font-family:var(--mono);font-size:.72rem;color:var(--text-3)">${p.progress||0}%</span>
    </div>`).join('') || '<p style="color:var(--text-3);font-size:.82rem;padding:.5rem">No projects yet.</p>';

  // ── Activity feed ──────────────────────────────────────────────────────────
  const acts = [...state.activities].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,8);
  const icons = {Call:'📞',Meeting:'🤝',Demo:'💻','Follow-up':'🔁',Email:'📧',Note:'📝'};
  q('activityFeed').innerHTML = acts.length
    ? acts.map(a=>`<li><span class="activity-type-icon">${icons[a.type]||'📋'}</span><span class="activity-text"><strong>${a.type}</strong> — ${a.note.slice(0,70)}${a.note.length>70?'…':''}</span><span class="activity-time">${timeAgo(a.created_at||new Date().toISOString())}</span></li>`).join('')
    : '<li style="color:var(--text-3);font-size:.82rem;padding:.4rem">No activities yet.</li>';
}


// ── Contacts ──────────────────────────────────────────────────────────────────
function filterContacts() {
  const q2 = q('contactSearch').value.toLowerCase();
  const list = state.contacts.filter(c=>c.name.toLowerCase().includes(q2)||c.email.toLowerCase().includes(q2)||(c.company||'').toLowerCase().includes(q2));
  renderContactList(list);
}
function renderContactList(list) {
  const canE=state.session&&can('contacts.update'), canD=state.session&&can('contacts.delete');
  q('contactList').innerHTML = list.map(c=>`
    <li>
      <div class="record-main">
        <div class="record-name">${c.name}</div>
        <div class="record-sub">${c.company||''} · ${c.email} · ${c.location||''}</div>
      </div>
      ${actBtns('contacts',c.id,canE,canD)}
    </li>`).join('') || '<li style="color:var(--text-3);font-size:.82rem;padding:.5rem">No contacts. Log in and add one.</li>';
}
function renderCustomers() {
  renderContactList(state.contacts);
  q('accountList').innerHTML = state.accounts.map(a=>`
    <li>
      <div class="record-main">
        <div class="record-name">${a.name} <span class="${badgeClass(a.tier||'SMB')}">${a.tier}</span></div>
        <div class="record-sub">Renewal: ${fmtDate(a.renewalDate)}</div>
      </div>
      ${actBtns('accounts',a.id)}
    </li>`).join('') || '<li style="color:var(--text-3);font-size:.82rem;padding:.5rem">No accounts yet.</li>';
  q('contactEmailCount').textContent = state.contacts.filter(c=>c.email).length;
  syncContactDropdowns();
}

function deleteLocal2(col, id) { deleteLocal(col, id); }

// ── Customer 360 ──────────────────────────────────────────────────────────────
q('customerSelect').addEventListener('change', renderC360);
function renderC360() {
  const c = state.contacts.find(x=>x.id===q('customerSelect').value);
  const el = q('customer360');
  if (!c) { el.innerHTML='<div class="c360-empty">Select a contact to view their full profile.</div>'; return; }
  const myTickets  = state.tickets.filter(t=>t.contact_id===c.id);
  const myLeads    = state.leads.filter(l=>l.contact_id===c.id);
  const myProjects = state.projects.filter(p=>p.contactId===c.id);
  const myActs     = state.activities.filter(a=>a.contactId===c.id);
  const openT=myTickets.filter(t=>t.status==='Open').length, wonL=myLeads.filter(l=>l.stage==='Won').length;
  const totalVal=myLeads.reduce((s,l)=>s+(l.value||0),0);
  el.innerHTML = `
    <div class="c360-header">
      <div class="c360-avatar">${c.name.charAt(0)}</div>
      <div><div class="c360-name">${c.name}</div><div class="c360-company">${c.company||''} · ${c.location||''}</div></div>
    </div>
    <div class="c360-contact-row">
      <span>📧 ${c.email}</span>${c.secondary_email?`<span>📧 ${c.secondary_email}</span>`:''}
      <span>📞 ${c.phone||'—'}</span><span>🧑 ${c.gender||'—'}, ${c.age||'—'} yrs</span>
    </div>
    <div class="c360-stats">
      <div class="c360-stat"><div class="c360-stat-val">${myTickets.length}</div><div class="c360-stat-label">Tickets</div></div>
      <div class="c360-stat"><div class="c360-stat-val">${wonL}/${myLeads.length}</div><div class="c360-stat-label">Leads Won</div></div>
      <div class="c360-stat"><div class="c360-stat-val">₹${fmtMoney(totalVal)}</div><div class="c360-stat-label">Lead Value</div></div>
    </div>
    <div class="c360-section"><div class="c360-section-title">Tickets</div><ul>${myTickets.slice(0,3).map(t=>`<li>${t.title} <span class="${badgeClass(t.status)}">${t.status}</span></li>`).join('')||'<li style="color:var(--text-3)">None</li>'}</ul></div>
    <div class="c360-section"><div class="c360-section-title">Leads</div><ul>${myLeads.slice(0,3).map(l=>`<li>${l.title} — <span style="font-family:var(--mono);color:var(--accent)">₹${fmtMoney(l.value)}</span> <span class="${badgeClass(l.stage)}">${l.stage}</span></li>`).join('')||'<li style="color:var(--text-3)">None</li>'}</ul></div>
    <div class="c360-section"><div class="c360-section-title">Projects</div><ul>${myProjects.slice(0,3).map(p=>`<li>${p.name} <span class="${badgeClass(p.status)}">${p.status}</span></li>`).join('')||'<li style="color:var(--text-3)">None</li>'}</ul></div>
    <div class="c360-section"><div class="c360-section-title">Recent Activities</div><ul>${myActs.slice(0,4).map(a=>`<li><strong>${a.type}</strong>: ${a.note.slice(0,60)}</li>`).join('')||'<li style="color:var(--text-3)">None</li>'}</ul></div>`;
}

// ── Sales / Kanban ────────────────────────────────────────────────────────────
function renderSales() {
  const canE=state.session&&can('leads.update'), canD=state.session&&can('leads.delete');
  ['New','Qualified','Proposal','Won','Lost'].forEach(stage=>{
    const col = q(`kStage${stage.replace(' ','')}`);
    const leads = state.leads.filter(l=>l.stage===stage);
    col.innerHTML = leads.map(l=>`
      <div class="kanban-card">
        <div class="kanban-card-title">${l.title}</div>
        <div class="kanban-card-val">₹${fmtMoney(l.value)}</div>
        ${l.contact_id ? `<div class="kanban-card-contact">👤 ${state.contacts.find(c=>c.id===l.contact_id)?.name||'—'}</div>` : ''}
        <div class="kanban-card-actions">${actBtns('leads',l.id,canE,canD)}</div>
      </div>`).join('') || '<div style="color:var(--text-3);font-size:.75rem;padding:.3rem">Empty</div>';
  });
  const canOE=true, canOD=true;
  q('opportunityList').innerHTML = state.opportunities.map(o=>`
    <li>
      <div class="record-main">
        <div class="record-name">${o.name}</div>
        <div class="record-sub">₹${fmtMoney(o.value)} <span class="opp-prob">@ ${o.probability}%</span> · Weighted: ₹${fmtMoney(o.value*o.probability/100)}</div>
      </div>
      ${actBtns('opportunities',o.id)}
    </li>`).join('') || '<li style="color:var(--text-3);font-size:.82rem;padding:.5rem">No opportunities yet.</li>';
}

// ── Projects ──────────────────────────────────────────────────────────────────
function renderProjectViews() {
  renderProjectBoard();
  renderProjectList();
  renderTasks();
  renderMilestones();
  renderActivities();
  syncProjectDropdowns();
}

function renderProjectBoard() {
  const cols = { Planning:'pColPlanning', Active:'pColActive', 'On Hold':'pColOnHold', Completed:'pColCompleted' };
  Object.entries(cols).forEach(([status, colId]) => {
    const projs = state.projects.filter(p=>p.status===status);
    q(colId).innerHTML = projs.map(p=>`
      <div class="project-card">
        <div class="project-card-name">${p.name}</div>
        <div class="project-card-meta">
          <span>👤 ${p.manager}</span>
          ${p.dueDate?`<span>📅 ${fmtDate(p.dueDate)}</span>`:''}
          ${p.budget?`<span>💰 ₹${fmtMoney(p.budget)}</span>`:''}
          <span class="${badgeClass(p.priority||'Medium')}">${p.priority||'Medium'}</span>
        </div>
        <div class="project-card-progress">
          <div class="project-card-progress-label"><span>Progress</span><span>${p.progress||0}%</span></div>
          ${pBar(p.progress)}
        </div>
        <div class="project-card-actions">${actBtns('projects',p.id)}<button class="btn-mail-status" onclick="openProjectMailModal('${p.id}')">📧 Mail Status</button></div>
      </div>`).join('') || '<div style="color:var(--text-3);font-size:.75rem;padding:.3rem">None</div>';
  });
}

function renderProjectList() {
  q('projectTableBody').innerHTML = state.projects.map(p=>`
    <tr>
      <td><strong>${p.name}</strong>${p.description?`<div style="font-size:.72rem;color:var(--text-3)">${p.description.slice(0,60)}</div>`:''}</td>
      <td><span class="${badgeClass(p.status)}">${p.status}</span></td>
      <td>${p.manager}</td>
      <td class="td-progress">${pBar(p.progress)} <span style="font-size:.72rem;color:var(--text-3)">${p.progress||0}%</span></td>
      <td style="font-family:var(--mono);font-size:.78rem">${fmtDate(p.dueDate)}</td>
      <td style="display:flex;gap:.3rem;align-items:center">${actBtns('projects',p.id)}<button class="btn-mail-status" onclick="openProjectMailModal('${p.id}')">📧</button></td>
    </tr>`).join('') || `<tr><td colspan="6" style="color:var(--text-3);font-size:.82rem;padding:1rem;text-align:center">No projects yet. Click "+ New Project" to start.</td></tr>`;
}

function renderGantt() {
  const now = new Date();
  const allDates = state.projects.flatMap(p=>[p.startDate,p.dueDate]).filter(Boolean).map(d=>new Date(d));
  if (!allDates.length) { q('ganttWrap').innerHTML='<p style="color:var(--text-3);font-size:.82rem;padding:1rem">Add projects with start and due dates to see the timeline.</p>'; return; }
  const minD = new Date(Math.min(...allDates)), maxD = new Date(Math.max(...allDates));
  const span = Math.max((maxD-minD)/86400000, 30);
  const colors = {'Planning':'#f59e0b','Active':'#2563eb','On Hold':'#f97316','Completed':'#16a34a'};
  q('ganttWrap').innerHTML = `
    <div class="gantt-row" style="border-bottom:1px solid var(--border);margin-bottom:.5rem;padding-bottom:.4rem">
      <div class="gantt-name" style="color:var(--text-3);font-size:.72rem;font-weight:700">PROJECT</div>
      <div style="flex:1;font-size:.7rem;color:var(--text-3);font-family:var(--mono)">${minD.toLocaleDateString('en-IN',{month:'short',day:'numeric'})} → ${maxD.toLocaleDateString('en-IN',{month:'short',day:'numeric'})}</div>
    </div>` +
    state.projects.map(p => {
      const s = p.startDate ? new Date(p.startDate) : now;
      const e = p.dueDate   ? new Date(p.dueDate)   : new Date(s.getTime()+14*86400000);
      const left = ((s-minD)/86400000/span*100).toFixed(1);
      const width = Math.max(((e-s)/86400000/span*100).toFixed(1), 5);
      return `<div class="gantt-row"><div class="gantt-name">${p.name}</div><div class="gantt-track"><div class="gantt-bar" style="left:${left}%;width:${width}%;background:${colors[p.status]||'#94a3b8'}">${p.name.slice(0,12)}</div></div></div>`;
    }).join('');
}

function renderTasks() {
  const projFilter = q('taskProjectFilter')?.value;
  const statFilter = q('taskStatusFilter')?.value;
  let tasks = [...state.tasks];
  if (projFilter) tasks = tasks.filter(t=>t.projectId===projFilter);
  if (statFilter) tasks = tasks.filter(t=>t.status===statFilter);
  const icons = {'To Do':'○','In Progress':'◑','Done':'●','Blocked':'✕'};
  q('taskList').innerHTML = tasks.map(t=>`
    <div class="task-item">
      <div class="task-check ${t.status==='Done'?'done':''}" onclick="toggleTask('${t.id}')">${t.status==='Done'?'✓':''}</div>
      <div style="flex:1">
        <div class="task-title ${t.status==='Done'?'done':''}">${t.title}</div>
        <div class="task-meta">
          <span class="${badgeClass(t.priority||'Low')}">${t.priority||'Low'}</span>
          ${t.dueDate?`<span>📅 ${fmtDate(t.dueDate)}</span>`:''}
          ${t.projectId?`<span>📁 ${state.projects.find(p=>p.id===t.projectId)?.name||'—'}</span>`:''}
        </div>
      </div>
      ${t.assignee?`<span class="task-assignee">${t.assignee}</span>`:''}
      ${actBtns('tasks',t.id)}
    </div>`).join('') || '<div style="color:var(--text-3);font-size:.82rem;padding:.5rem">No tasks. Click "+ Task" to add one.</div>';
}

function toggleTask(id) {
  const t = state.tasks.find(t=>t.id===id);
  if (t) { t.status = t.status==='Done'?'To Do':'Done'; persistLocal(); renderTasks(); }
}

function renderMilestones() {
  const icons = {Upcoming:'🎯',Achieved:'✅',Missed:'❌'};
  q('milestoneList').innerHTML = state.milestones.map(m=>`
    <div class="milestone-item">
      <span class="milestone-icon">${icons[m.status]||'🎯'}</span>
      <span class="milestone-name">${m.name}</span>
      <span class="milestone-date">${fmtDate(m.date)}</span>
      <span class="${badgeClass(m.status==='Achieved'?'Won':m.status==='Missed'?'Lost':'New')}">${m.status}</span>
      ${actBtns('milestones',m.id,false)}
    </div>`).join('') || '<div style="color:var(--text-3);font-size:.82rem;padding:.5rem">No milestones yet.</div>';
}

function renderActivities() {
  const icons={Call:'📞',Meeting:'🤝',Demo:'💻','Follow-up':'🔁',Email:'📧',Note:'📝'};
  q('activityList').innerHTML = [...state.activities].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,8).map(a=>`
    <li>
      <span class="activity-type-icon">${icons[a.type]||'📋'}</span>
      <span class="activity-text"><strong>${a.type}</strong> — ${a.note.slice(0,80)}</span>
      <span class="activity-time">${timeAgo(a.created_at||new Date().toISOString())}</span>
    </li>`).join('') || '<li style="color:var(--text-3);font-size:.82rem">No activities yet.</li>';
}

// ── Support ───────────────────────────────────────────────────────────────────
function renderTickets() {
  const stFilter = q('ticketFilter')?.value||'All';
  const prFilter = q('ticketPriorityFilter')?.value||'All';
  const open=state.tickets.filter(t=>t.status==='Open').length;
  const prog=state.tickets.filter(t=>t.status==='In Progress').length;
  const res=state.tickets.filter(t=>t.status==='Resolved').length;
  if(q('sOpenCount'))    q('sOpenCount').textContent    = open;
  if(q('sProgressCount'))q('sProgressCount').textContent= prog;
  if(q('sResolvedCount'))q('sResolvedCount').textContent= res;
  let tks = [...state.tickets];
  if (stFilter!=='All') tks = tks.filter(t=>t.status===stFilter);
  if (prFilter!=='All') tks = tks.filter(t=>t.priority===prFilter);
  const prColors={High:'#e11d48',Medium:'#d97706',Low:'#94a3b8'};
  const canE=state.session&&can('tickets.update'), canD=state.session&&can('tickets.delete');
  q('ticketList').innerHTML = tks.map(t=>`
    <div class="ticket-item">
      <div class="ticket-priority-stripe" style="background:${prColors[t.priority]||'#94a3b8'}"></div>
      <div class="ticket-body">
        <div class="ticket-title">${t.title}</div>
        <div class="ticket-meta">
          <span class="${badgeClass(t.status)}">${t.status}</span>
          <span class="${badgeClass(t.priority)}">${t.priority}</span>
          ${t.contact_id?`<span>👤 ${state.contacts.find(c=>c.id===t.contact_id)?.name||'—'}</span>`:''}
        </div>
      </div>
      <div class="ticket-actions">${actBtns('tickets',t.id,canE,canD)}</div>
    </div>`).join('') || '<div style="color:var(--text-3);font-size:.82rem;padding:.5rem">No tickets match filters.</div>';

  const tot=Math.max(open+prog+res,1);
  q('ticketAnalytics').innerHTML = [['Open',open,'#d97706'],['In Progress',prog,'#2563eb'],['Resolved',res,'#16a34a']].map(([l,v,c])=>`
    <div class="bar-row">
      <span style="font-size:.8rem">${l}</span>
      <div class="bar-wrap"><div class="bar-fill" style="width:${(v/tot*100).toFixed(1)}%;background:${c}"></div></div>
      <span style="font-family:var(--mono);font-size:.78rem;text-align:right">${v}</span>
    </div>`).join('');
  q('ticketSLAPanel').innerHTML = `
    <div class="sla-item"><span>Total Tickets</span><strong>${state.tickets.length}</strong></div>
    <div class="sla-item"><span>Resolution Rate</span><strong>${tot>1?(res/state.tickets.length*100).toFixed(0):0}%</strong></div>
    <div class="sla-item"><span>High Priority Open</span><strong style="color:var(--rose)">${state.tickets.filter(t=>t.priority==='High'&&t.status!=='Resolved').length}</strong></div>`;
}

// ── Render All ────────────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderCustomers();
  renderSales();
  renderProjectViews();
  renderTickets();
  syncContactDropdowns();
  syncProjectDropdowns();
}


// ── Mail Project Status ───────────────────────────────────────────────────────
let _mailProjectId = null;

function openProjectMailModal(projectId) {
  const p = state.projects.find(x=>x.id===projectId);
  if (!p) return;
  _mailProjectId = projectId;

  const tasks      = state.tasks.filter(t=>t.projectId===projectId);
  const milestones = state.milestones.filter(m=>m.projectId===projectId);
  const doneTasks  = tasks.filter(t=>t.status==='Done').length;
  const contact    = state.contacts.find(c=>c.id===p.contactId);

  // Pre-fill subject
  q('mailProjectSubject').value = `Project Status Update: ${p.name} — ${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}`;

  // Pre-fill recipients from linked contact
  q('mailProjectTo').value = contact?.email || '';

  // Build preview
  const taskRows = tasks.map(t=>`
    <div class="report-task-row">
      <span>${t.status==='Done'?'✅':t.status==='Blocked'?'🚫':t.status==='In Progress'?'🔵':'⚪'}</span>
      <span>${t.title}</span>
      ${t.assignee?'<span style="color:var(--text-3);font-size:.75rem">→ '+t.assignee+'</span>':''}
      ${t.dueDate?'<span style="color:var(--text-3);font-size:.75rem">📅 '+fmtDate(t.dueDate)+'</span>':''}
    </div>`).join('') || '<div style="color:var(--text-3)">No tasks.</div>';

  const msRows = milestones.map(m=>`
    <div class="report-milestone-row">
      <span>${m.status==='Achieved'?'✅':m.status==='Missed'?'❌':'🎯'}</span>
      <span>${m.name}</span>
      <span style="color:var(--text-3);font-size:.75rem">${fmtDate(m.date)}</span>
      <span class="${badgeClass(m.status==='Achieved'?'Won':m.status==='Missed'?'Lost':'New')}">${m.status}</span>
    </div>`).join('') || '<div style="color:var(--text-3)">No milestones.</div>';

  q('mailProjectPreview').innerHTML = `
    <div style="font-weight:700;font-size:.95rem;margin-bottom:.5rem">📁 ${p.name}</div>
    <div class="report-meta-grid">
      <div class="report-meta-item"><span class="report-meta-key">Status: </span><span class="${badgeClass(p.status)}">${p.status}</span></div>
      <div class="report-meta-item"><span class="report-meta-key">Priority: </span><span class="${badgeClass(p.priority||'Medium')}">${p.priority||'Medium'}</span></div>
      <div class="report-meta-item"><span class="report-meta-key">Manager: </span>${p.manager}</div>
      <div class="report-meta-item"><span class="report-meta-key">Due: </span>${fmtDate(p.dueDate)}</div>
      <div class="report-meta-item"><span class="report-meta-key">Budget: </span>₹${fmtMoney(p.budget)}</div>
      <div class="report-meta-item"><span class="report-meta-key">Progress: </span><strong>${p.progress||0}%</strong></div>
    </div>
    ${p.description?'<div style="font-size:.8rem;color:var(--text-2);margin-bottom:.5rem">'+p.description+'</div>':''}
    <div class="report-section-title">Tasks (${doneTasks}/${tasks.length} done)</div>
    ${taskRows}
    <div class="report-section-title">Milestones</div>
    ${msRows}`;

  openModal('mailProjectModal');
}

async function sendProjectStatus() {
  const p = state.projects.find(x=>x.id===_mailProjectId);
  if (!p) return;

  const recipients = q('mailProjectTo').value.split(',').map(v=>v.trim()).filter(Boolean);
  const subject    = q('mailProjectSubject').value.trim();
  const notes      = q('mailProjectNotes').value.trim();
  const banner     = q('mailProjectStatus');

  if (!recipients.length) { showBanner(banner,'Enter at least one recipient.','warning'); return; }
  const bad = recipients.filter(r=>!isEmail(r));
  if (bad.length) { showBanner(banner,'Invalid address: '+bad.join(', '),'error'); return; }
  if (!subject) { showBanner(banner,'Subject is required.','error'); return; }

  const tasks      = state.tasks.filter(t=>t.projectId===_mailProjectId);
  const milestones = state.milestones.filter(m=>m.projectId===_mailProjectId);
  const doneTasks  = tasks.filter(t=>t.status==='Done').length;

  const taskLines = tasks.map(t=>`  [${t.status==='Done'?'✓':' '}] ${t.title}${t.assignee?' → '+t.assignee:''}${t.dueDate?' (due: '+fmtDate(t.dueDate)+')':''}`).join('\n') || '  No tasks recorded.';
  const msLines   = milestones.map(m=>`  [${m.status}] ${m.name} — ${fmtDate(m.date)}`).join('\n') || '  No milestones recorded.';

  const body = `PROJECT STATUS REPORT
Generated: ${new Date().toLocaleString('en-IN')}
═══════════════════════════════════════

PROJECT: ${p.name}
Status:   ${p.status}
Priority: ${p.priority||'Medium'}
Manager:  ${p.manager}
Due Date: ${fmtDate(p.dueDate)}
Budget:   ₹${fmtMoney(p.budget)}
Progress: ${p.progress||0}%
${p.description?'\nDescription:\n'+p.description:''}

TASKS (${doneTasks}/${tasks.length} completed)
───────────────────────────────────────
${taskLines}

MILESTONES
───────────────────────────────────────
${msLines}

${notes?'ADDITIONAL NOTES\n───────────────────────────────────────\n'+notes+'\n\n':''}─────────────────────────────────────────
This report was generated automatically by OrgCRM.
`;

  showBanner(banner,'Sending…','info');
  try {
    const r = await fetch(`${SMTP_API}/api/send-email`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipients,subject,body})});
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    showBanner(banner,`✓ Report sent to ${recipients.length} recipient(s).`,'info');
    q('mailProjectNotes').value = '';
    setTimeout(()=>closeModal('mailProjectModal'), 2000);
  } catch(err) {
    const ml = `mailto:${encodeURIComponent(recipients[0])}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0,1800))}`;
    banner.innerHTML = `SMTP failed. <a href="${ml}">Open email client</a> as fallback.`;
    banner.className='status-banner error'; banner.classList.remove('hidden');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
renderSession();
renderAll();
checkSmtp();
q('dashDate').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
