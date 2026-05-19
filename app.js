// ── Config ────────────────────────────────────────────────────────────────────
const API = 'http://localhost:3002';
const SMTP_API = 'http://localhost:3001';

// ── In-memory state ───────────────────────────────────────────────────────────
const state = {
  contacts: [],
  leads: [],
  opportunities: JSON.parse(localStorage.getItem('crm_opportunities') || '[]'),
  accounts:      JSON.parse(localStorage.getItem('crm_accounts')      || '[]'),
  projects:      JSON.parse(localStorage.getItem('crm_projects')      || '[]'),
  activities:    JSON.parse(localStorage.getItem('crm_activities')    || '[]'),
  tickets: [],
  session: null,
  accessToken: null,
  refreshToken: null,
  permissions: new Set(),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(addr) { return EMAIL_RE.test(String(addr).trim()); }
const q = (id) => document.getElementById(id);
const navButtons = [...document.querySelectorAll('.nav-btn')];

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;
  let res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401 && state.refreshToken) {
    const ok = await tryRefresh();
    if (ok) {
      headers['Authorization'] = `Bearer ${state.accessToken}`;
      res = await fetch(`${API}${path}`, { ...options, headers });
    } else { logout(); return null; }
  }
  return res;
}

async function tryRefresh() {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    return true;
  } catch { return false; }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login(event) {
  event.preventDefault();
  q('loginStatus').textContent = 'Signing in…';
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: q('loginEmail').value.trim().toLowerCase(), password: q('loginPassword').value }),
    });
    const data = await res.json();
    if (!res.ok) { q('loginStatus').textContent = data.message || 'Login failed.'; return; }
    state.accessToken  = data.accessToken;
    state.refreshToken = data.refreshToken;
    state.session      = data.user;
    state.permissions  = new Set(data.permissions);
    q('loginStatus').textContent = 'Login successful.';
    q('loginForm').reset();
    q('loginDialog').close();
    renderSession();
    await loadAllData();
  } catch (err) {
    q('loginStatus').textContent = 'Could not reach API. Is the backend running on port 3002?';
  }
}

async function logout() {
  if (state.refreshToken) apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: state.refreshToken }) }).catch(() => {});
  Object.assign(state, { session: null, accessToken: null, refreshToken: null, permissions: new Set(), contacts: [], leads: [], tickets: [] });
  renderSession(); render();
}

function can(perm) { return state.permissions.has(perm); }

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadAllData() {
  await Promise.all([loadContacts(), loadLeads(), loadTickets()]);
  render();
}
async function loadContacts() { const r = await apiFetch('/contacts'); if (r && r.ok) state.contacts = await r.json(); }
async function loadLeads()    { const r = await apiFetch('/leads');    if (r && r.ok) state.leads    = await r.json(); }
async function loadTickets()  { const r = await apiFetch('/tickets');  if (r && r.ok) state.tickets  = await r.json(); }

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function apiCreate(resource, body) {
  const r = await apiFetch(`/${resource}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r || !r.ok) { const e = r ? await r.json() : {}; alert(e.message || 'Error'); return false; }
  return true;
}
async function apiUpdate(resource, id, body) {
  const r = await apiFetch(`/${resource}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!r || !r.ok) { const e = r ? await r.json() : {}; alert(e.message || 'Error'); return false; }
  return true;
}
async function apiDelete(resource, id) {
  if (!confirm('Delete this record?')) return;
  const r = await apiFetch(`/${resource}/${id}`, { method: 'DELETE' });
  if (!r || !r.ok) { alert('Delete failed.'); return; }
  if (resource === 'contacts') await loadContacts();
  else if (resource === 'leads') await loadLeads();
  else if (resource === 'tickets') await loadTickets();
  render();
}

// ── API-backed forms ──────────────────────────────────────────────────────────
function bindApiForm(formId, resource, getBody, loadFn) {
  q(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.session) { alert('Please log in first.'); return; }
    const ok = await apiCreate(resource, getBody());
    if (ok) { e.target.reset(); await loadFn(); render(); }
  });
}

bindApiForm('contactForm', 'contacts', () => ({
  name: q('name').value.trim(), email: q('email').value.trim(),
  secondaryEmail: q('secondaryEmail').value.trim(), phone: q('phone').value.trim(),
  company: q('company').value.trim(), gender: q('gender').value,
  age: Number(q('age').value), location: q('location').value.trim(),
}), loadContacts);

bindApiForm('leadForm', 'leads', () => ({
  contactId: q('leadContact').value || null,
  title: q('leadName').value.trim(), stage: q('leadStage').value,
  value: Number(q('leadValue').value),
}), loadLeads);

bindApiForm('ticketForm', 'tickets', () => ({
  contactId: q('ticketContact').value || null,
  title: q('ticketTitle').value.trim(),
  priority: q('ticketPriority').value, status: q('ticketStatus').value,
}), loadTickets);

// localStorage-backed forms (accounts, projects, activities, opportunities)
function bindLocalForm(id, handler) {
  q(id).addEventListener('submit', (e) => { e.preventDefault(); handler(); e.target.reset(); persistLocal(); render(); });
}
function persistLocal() {
  ['opportunities','accounts','projects','activities'].forEach((k) => localStorage.setItem(`crm_${k}`, JSON.stringify(state[k])));
}
bindLocalForm('accountForm',     () => state.accounts.push({ id: crypto.randomUUID(), name: q('accountName').value.trim(), tier: q('accountTier').value, renewalDate: q('renewalDate').value }));
bindLocalForm('projectForm',     () => state.projects.push({ id: crypto.randomUUID(), contactId: q('projectContact').value || null, name: q('projectName').value.trim(), status: q('projectStatus').value, manager: q('projectManager').value.trim() }));
bindLocalForm('activityForm',    () => state.activities.unshift({ id: crypto.randomUUID(), contactId: q('activityContact').value || null, type: q('activityType').value, note: q('activityNote').value.trim(), at: new Date().toISOString() }));
bindLocalForm('opportunityForm', () => state.opportunities.push({ id: crypto.randomUUID(), name: q('oppName').value.trim(), value: Number(q('oppValue').value), probability: Number(q('oppProbability').value) }));

// ── Event listeners ───────────────────────────────────────────────────────────
q('mailForm').addEventListener('submit', sendMail);
q('loginBtn').addEventListener('click',  () => q('loginDialog').showModal());
q('closeLogin').addEventListener('click', () => q('loginDialog').close());
q('logoutBtn').addEventListener('submit', logout);
q('loginForm').addEventListener('submit', login);
q('logoutBtn').addEventListener('click',  logout);
navButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
q('ticketFilter').addEventListener('change', render);
q('customerSelect').addEventListener('change', renderCustomer360);

// ── Edit dialog ───────────────────────────────────────────────────────────────
async function deleteRecord(collection, id) { await apiDelete(collection, id); }

async function openEditDialog(collection, id) {
  const record = state[collection].find((r) => r.id === id);
  if (!record) return;
  const fields = {
    contacts: [
      { id:'eName', label:'Full Name', type:'text', key:'name' },
      { id:'eEmail', label:'Primary Email', type:'email', key:'email' },
      { id:'eSecondaryEmail', label:'Secondary Email', type:'text', key:'secondary_email' },
      { id:'ePhone', label:'Phone', type:'text', key:'phone' },
      { id:'eCompany', label:'Company', type:'text', key:'company' },
      { id:'eLocation', label:'Location', type:'text', key:'location' },
      { id:'eAge', label:'Age', type:'number', key:'age' },
    ],
    leads:   [{ id:'eLeadTitle', label:'Lead Title', type:'text', key:'title' }, { id:'eLeadValue', label:'Value (₹)', type:'number', key:'value' }],
    tickets: [{ id:'eTicketTitle', label:'Ticket Title', type:'text', key:'title' }],
  };
  const selectFields = {
    leads:    [{ id:'eLeadStage', label:'Stage', key:'stage', options:['New','Qualified','Proposal','Won','Lost'] }],
    tickets:  [{ id:'eTicketPriority', label:'Priority', key:'priority', options:['Low','Medium','High'] }, { id:'eTicketStatus', label:'Status', key:'status', options:['Open','In Progress','Resolved'] }],
    contacts: [{ id:'eGender', label:'Gender', key:'gender', options:['Female','Male','Other'] }],
  };
  q('editDialogTitle').textContent = { contacts:'Edit Contact', leads:'Edit Lead', tickets:'Edit Ticket' }[collection] || 'Edit';
  q('editDialogBody').innerHTML =
    (fields[collection]||[]).map(f => `<label>${f.label}<input id="${f.id}" type="${f.type}" value="${record[f.key]??''}" /></label>`).join('') +
    (selectFields[collection]||[]).map(f => `<label>${f.label}<select id="${f.id}">${f.options.map(o => `<option${record[f.key]===o?' selected':''} value="${o}">${o}</option>`).join('')}</select></label>`).join('');

  q('editDialogForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    (fields[collection]||[]).forEach(f => { const el = q(f.id); if (el) body[f.key] = f.type==='number' ? Number(el.value) : el.value.trim(); });
    (selectFields[collection]||[]).forEach(f => { const el = q(f.id); if (el) body[f.key] = el.value; });
    const ok = await apiUpdate(collection, id, body);
    if (ok) {
      if (collection==='contacts') await loadContacts();
      else if (collection==='leads') await loadLeads();
      else if (collection==='tickets') await loadTickets();
      render(); q('editDialog').close();
    }
  };
  q('editDialog').showModal();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab').forEach((n) => n.classList.remove('active'));
  navButtons.forEach((n) => n.classList.remove('active'));
  q(id).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${id}"]`).classList.add('active');
}
function setStatus(el, msg, type='info') {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('status-info','status-warning','status-error');
  el.classList.add(type==='warning'?'status-warning':type==='error'?'status-error':'status-info');
}

// ── SMTP ──────────────────────────────────────────────────────────────────────
async function checkSmtpApi() {
  const el = q('smtpStatus');
  try {
    const r = await fetch(`${SMTP_API}/api/health`); const d = await r.json();
    if (!r.ok || d.status !== 'ok') { setStatus(el, 'SMTP unavailable. Fallback to mailto.', 'warning'); return false; }
    setStatus(el, 'SMTP API is available.', 'info'); return true;
  } catch { setStatus(el, 'SMTP unreachable. Fallback to mailto.', 'warning'); return false; }
}

async function sendMail(event) {
  event.preventDefault();
  const mode = q('mailMode').value;
  const recipients = mode==='bulk' ? state.contacts.flatMap((c) => [c.email, c.secondary_email]).filter(Boolean)
    : mode==='multi' ? q('mailTo').value.split(',').map((v) => v.trim()).filter(Boolean)
    : [q('mailTo').value.trim()].filter(Boolean);
  const payload = { recipients, subject: q('mailSubject').value.trim(), body: q('mailBody').value.trim() };
  const mailEl = q('mailStatus'), smtpEl = q('smtpStatus');
  if (!payload.recipients.length) { setStatus(mailEl, 'Provide at least one recipient.', 'warning'); return; }
  const invalid = payload.recipients.filter((r) => !isValidEmail(r));
  if (invalid.length) { setStatus(mailEl, `Invalid address${invalid.length>1?'es':''}: ${invalid.join(', ')}`, 'error'); return; }
  if (!payload.subject || !payload.body) { setStatus(mailEl, 'Complete subject and message.', 'warning'); return; }
  setStatus(mailEl, 'Sending…', 'info');
  try {
    const r = await fetch(`${SMTP_API}/api/send-email`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'SMTP error');
    setStatus(mailEl, d.message || 'Email sent.', 'info'); q('mailForm').reset(); await checkSmtpApi();
  } catch (err) {
    const mailto = `mailto:${encodeURIComponent(payload.recipients[0])}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    mailEl.innerHTML = `SMTP unavailable. <a href="${mailto}">Open email client</a>.`;
    setStatus(smtpEl, 'SMTP request failed.', 'error');
  }
}

// ── Session render ────────────────────────────────────────────────────────────
function renderSession() {
  const loggedIn = Boolean(state.session);
  q('userBadge').textContent = loggedIn ? state.session.name : 'Guest';
  q('loginBtn').classList.toggle('hidden', loggedIn);
  q('logoutBtn').classList.toggle('hidden', !loggedIn);
  const rb = q('roleBadge');
  if (rb) {
    rb.textContent = loggedIn ? (can('users.delete') ? 'Admin' : can('users.read') ? 'Manager' : can('leads.delete') ? 'Sales Rep' : 'Viewer') : '';
    rb.classList.toggle('hidden', !loggedIn);
  }
}

// ── Customer 360 ──────────────────────────────────────────────────────────────
function renderCustomer360() {
  const c = state.contacts.find((x) => x.id === q('customerSelect').value);
  if (!c) { q('customer360').textContent = 'Select a customer to view full profile.'; return; }
  const cid = c.id;
  const myTickets    = state.tickets.filter((t) => t.contact_id === cid);
  const myLeads      = state.leads.filter((l) => l.contact_id === cid);
  const myProjects   = state.projects.filter((p) => p.contactId === cid);
  const myActivities = state.activities.filter((a) => a.contactId === cid);
  const openT = myTickets.filter(t=>t.status==='Open').length, inProg = myTickets.filter(t=>t.status==='In Progress').length, resT = myTickets.filter(t=>t.status==='Resolved').length;
  const actProj = myProjects.filter(p=>p.status==='Active').length, wonL = myLeads.filter(l=>l.stage==='Won').length;
  const totalVal = myLeads.reduce((s,l)=>s+(l.value||0),0);
  const li = (arr, fn, empty) => arr.length ? arr.map(fn).join('') : `<li class='muted'>${empty}</li>`;
  q('customer360').innerHTML = `
    <div class="c360-header"><strong class="c360-name">${c.name}</strong><span class="c360-company">${c.company||''} · ${c.location||''}</span></div>
    <div class="c360-contact">📧 ${c.email}${c.secondary_email?` · ${c.secondary_email}`:''} &nbsp;|&nbsp; 📞 ${c.phone||'—'} &nbsp;|&nbsp; 🧑 ${c.gender||'—'}, ${c.age||'—'} yrs</div>
    <div class="c360-stats">
      <div><span>${openT}</span><small>Open Tickets</small></div><div><span>${inProg}</span><small>In Progress</small></div><div><span>${resT}</span><small>Resolved</small></div>
      <div><span>${actProj}</span><small>Active Projects</small></div><div><span>${wonL}/${myLeads.length}</span><small>Leads Won</small></div><div><span>₹${totalVal.toLocaleString()}</span><small>Total Lead Value</small></div>
    </div>
    <div class="c360-section"><h4>Tickets</h4><ul>${li(myTickets, t=>`<li>${t.title} — <em>${t.priority}</em> · <strong>${t.status}</strong></li>`, 'No tickets linked.')}</ul></div>
    <div class="c360-section"><h4>Leads</h4><ul>${li(myLeads, l=>`<li>${l.title} — ${l.stage} · ₹${l.value.toLocaleString()}</li>`, 'No leads linked.')}</ul></div>
    <div class="c360-section"><h4>Projects</h4><ul>${li(myProjects, p=>`<li>${p.name} — ${p.status} · PM: ${p.manager}</li>`, 'No projects linked.')}</ul></div>
    <div class="c360-section"><h4>Recent Activities</h4><ul>${li(myActivities.slice(0,5), a=>`<li><strong>${a.type}</strong>: ${a.note}</li>`, 'No activities logged.')}</ul></div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const today = new Date(), in30 = new Date(Date.now()+30*86400000);
  const open = state.tickets.filter(t=>t.status==='Open').length;
  const progress = state.tickets.filter(t=>t.status==='In Progress').length;
  const resolved = state.tickets.filter(t=>t.status==='Resolved').length;
  q('contactCount').textContent     = state.contacts.length;
  q('leadCount').textContent        = state.leads.length;
  q('opportunityCount').textContent = state.opportunities.length;
  q('ticketOpenCount').textContent  = open;
  q('renewalDueCount').textContent  = state.accounts.filter(a=>a.renewalDate&&new Date(a.renewalDate)>=today&&new Date(a.renewalDate)<=in30).length;
  q('projectActiveCount').textContent    = state.projects.filter(p=>p.status==='Active').length;
  q('ticketInProgressCount').textContent = progress;
  q('ticketResolvedCount').textContent   = resolved;

  const canEC = state.session&&can('contacts.update'), canDC = state.session&&can('contacts.delete');
  const canEL = state.session&&can('leads.update'),    canDL = state.session&&can('leads.delete');
  const canET = state.session&&can('tickets.update'),  canDT = state.session&&can('tickets.delete');
  const acts = (col,id,ce,cd) => (ce||cd)?`<div class="row-actions">${ce?`<button class="btn-edit" onclick="openEditDialog('${col}','${id}')">Edit</button>`:''} ${cd?`<button class="btn-delete" onclick="deleteRecord('${col}','${id}')">Delete</button>`:''}</div>`:'';

  q('contactList').innerHTML  = state.contacts.map(c=>`<li><strong>${c.name}</strong> — ${c.company||''}<br>${c.email}${acts('contacts',c.id,canEC,canDC)}</li>`).join('') || "<li class='muted'>No contacts. Log in and add one.</li>";
  q('accountList').innerHTML  = state.accounts.map(a=>`<li><strong>${a.name}</strong> (${a.tier})<br>Renewal: ${a.renewalDate}</li>`).join('');
  q('leadList').innerHTML     = state.leads.map(l=>`<li><strong>${l.title}</strong><br>${l.stage} • ₹${(l.value||0).toLocaleString()}${acts('leads',l.id,canEL,canDL)}</li>`).join('') || "<li class='muted'>No leads. Log in and add one.</li>";
  q('opportunityList').innerHTML = state.opportunities.map(o=>`<li><strong>${o.name}</strong><br>₹${o.value.toLocaleString()} @ ${o.probability}%</li>`).join('');
  q('weightedForecast').textContent = state.opportunities.reduce((s,o)=>s+(o.value*o.probability/100),0).toLocaleString();
  q('projectList').innerHTML  = state.projects.map(p=>`<li><strong>${p.name}</strong><br>${p.status} • PM: ${p.manager}</li>`).join('');
  q('activityList').innerHTML = state.activities.slice(0,8).map(a=>`<li><strong>${a.type}</strong><br>${a.note}</li>`).join('');

  const filter = q('ticketFilter').value;
  const tks = filter==='All'?state.tickets:state.tickets.filter(t=>t.status===filter);
  q('ticketList').innerHTML = tks.map(t=>`<li><strong>${t.title}</strong><br>${t.priority} • ${t.status}${acts('tickets',t.id,canET,canDT)}</li>`).join('') || "<li class='muted'>No tickets. Log in and add one.</li>";

  const total = Math.max(1, state.tickets.length);
  q('ticketAnalytics').innerHTML = [['Open',open],['In Progress',progress],['Resolved',resolved]].map(([l,v])=>`<div class='bar-row'><span>${l}</span><div class='bar'><i style='width:${(v/total)*100}%'></i></div><b>${v}</b></div>`).join('');

  q('customerSelect').innerHTML = `<option value="">Select customer</option>` + state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const copts = '<option value="">Link to Contact (optional)</option>' + state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  ['leadContact','projectContact','activityContact','ticketContact'].forEach(id=>{ const el=q(id); if(el) el.innerHTML=copts; });
  renderCustomer360();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
renderSession();
render();
checkSmtpApi();
