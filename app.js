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
  documents:     JSON.parse(localStorage.getItem('crm_documents')   || '[]'),
  portalSessions: JSON.parse(localStorage.getItem('crm_portal_sessions') || '[]'),
  portalSettings: JSON.parse(localStorage.getItem('crm_portal_settings') || '{"showProjects":true,"showTickets":true,"showDocs":true,"showActivity":false}'),
  notifications:  JSON.parse(localStorage.getItem('crm_notifications') || '[]'),
  reminders:      JSON.parse(localStorage.getItem('crm_reminders')     || '[]'),
  emailTemplates: JSON.parse(localStorage.getItem('crm_templates') || 'null') || [],
  session: null, accessToken: null, refreshToken: null, permissions: new Set(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
// ── Chat state (declared here so renderSession can access it) ──────────────────
const chatState = {
  open:          false,
  fullscreen:    false,
  activePhone:   null,
  activeContact: null,
  filter:        'all',
  threads:       JSON.parse(localStorage.getItem('crm_chat_threads') || '{}'),
};

// ── Constants hoisted to avoid TDZ ReferenceErrors ────────────────
const FILE_ICONS = {
  pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
  txt: '📄', csv: '📊', png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
  gif: '🖼️', webp: '🖼️', ppt: '📙', pptx: '📙', zip: '📦',
};
const AVATAR_COLORS = ['#2563eb','#7c3aed','#0d9488','#d97706','#e11d48','#16a34a','#0891b2','#9333ea'];

const QUICK_REPLIES = [
  'Thank you for reaching out! We will get back to you shortly.',
  'Your request has been received and is being processed.',
  'Could you please provide more details?',
  'We have escalated this to the relevant team.',
  'Your issue has been resolved. Please let us know if you need further assistance.',
  'Meeting confirmed. Please find the details attached.',
  'Please share the required documents at your earliest convenience.',
  'We appreciate your patience.',
];

const _bulkSelected = { contacts: new Set(), leads: new Set(), tickets: new Set() };

// ── Mutable state variables (hoisted to avoid TDZ) ──────────────────────────
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let _rtcPeer        = null;
let _localStream    = null;
let _callTimerInt   = null;
let _callSeconds    = 0;
let _isMuted        = false;
let _isCamOff       = false;
let _isScreenShare  = false;
let _callType       = 'video'; // 'video' | 'audio'
let _callContactId  = null;
const SIGNAL_KEY    = 'crm_webrtc_signal';
let _searchActive = false;
let _searchMatches = [];
let _searchIdx = 0;
let _replyingToMsgId = null;
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();  // 0-indexed
let _calView  = 'month';
let _calWeekOffset = 0;
let _currentReport = 'contacts';
let _mailProjectId = null;
let _editingTemplateId = null;
let _dragLeadId = null;
let _pendingFiles = [];
let _renamingDocId = null;
let _activeDocId = null;
let _cityHighlightIdx = -1;
let _contactViewMode = 'grid'; // 'grid' | 'list'
let _c360ContactId = null;


const REPORT_CONFIG = {
  contacts: {
    label: 'Contacts',
    headers: ['Name','Email','Phone','Company','Gender','Age','Location'],
    row: c => [c.name, c.email, c.phone||'', c.company||'', c.gender||'', c.age||'', c.location||''],
    summary: () => {
      const total = state.contacts.length;
      const withEmail = state.contacts.filter(c=>c.email).length;
      const companies = new Set(state.contacts.map(c=>c.company).filter(Boolean)).size;
      return [
        {label:'Total Contacts',  val: total},
        {label:'With Email',      val: withEmail},
        {label:'Companies',       val: companies},
        {label:'Avg Age',         val: state.contacts.length ? Math.round(state.contacts.reduce((s,c)=>s+(c.age||0),0)/state.contacts.length) : '—'},
      ];
    },
    filters: [],
  },
  leads: {
    label: 'Leads',
    headers: ['Title','Stage','Value (₹)','Contact','Created'],
    row: l => [l.title, l.stage, fmtMoney(l.value), state.contacts.find(c=>c.id===l.contact_id)?.name||'—', fmtDate(l.created_at)],
    summary: () => {
      const won = state.leads.filter(l=>l.stage==='Won');
      const total = state.leads.reduce((s,l)=>s+(l.value||0),0);
      return [
        {label:'Total Leads',     val: state.leads.length},
        {label:'Won',             val: won.length},
        {label:'Total Value',     val: '₹'+fmtMoney(total)},
        {label:'Won Value',       val: '₹'+fmtMoney(won.reduce((s,l)=>s+(l.value||0),0))},
        {label:'Win Rate',        val: state.leads.length ? Math.round(won.length/state.leads.length*100)+'%' : '0%'},
      ];
    },
    filters: ['stage'],
  },
  tickets: {
    label: 'Tickets',
    headers: ['Title','Status','Priority','Contact','Created'],
    row: t => [t.title, t.status, t.priority, state.contacts.find(c=>c.id===t.contact_id)?.name||'—', fmtDate(t.created_at)],
    summary: () => {
      const open = state.tickets.filter(t=>t.status==='Open').length;
      const res  = state.tickets.filter(t=>t.status==='Resolved').length;
      return [
        {label:'Total Tickets',   val: state.tickets.length},
        {label:'Open',            val: open},
        {label:'Resolved',        val: res},
        {label:'High Priority',   val: state.tickets.filter(t=>t.priority==='High').length},
        {label:'Resolution Rate', val: state.tickets.length ? Math.round(res/state.tickets.length*100)+'%' : '0%'},
      ];
    },
    filters: ['status','priority'],
  },
  projects: {
    label: 'Projects',
    headers: ['Name','Status','Priority','Manager','Progress','Budget (₹)','Due Date'],
    row: p => [p.name, p.status, p.priority||'—', p.manager, (p.progress||0)+'%', fmtMoney(p.budget||0), fmtDate(p.dueDate)],
    summary: () => {
      const active = state.projects.filter(p=>p.status==='Active').length;
      const totalBudget = state.projects.reduce((s,p)=>s+(p.budget||0),0);
      return [
        {label:'Total Projects',  val: state.projects.length},
        {label:'Active',          val: active},
        {label:'Completed',       val: state.projects.filter(p=>p.status==='Completed').length},
        {label:'Total Budget',    val: '₹'+fmtMoney(totalBudget)},
        {label:'Avg Progress',    val: state.projects.length ? Math.round(state.projects.reduce((s,p)=>s+(p.progress||0),0)/state.projects.length)+'%' : '0%'},
      ];
    },
    filters: ['status'],
  },
  activities: {
    label: 'Activities',
    headers: ['Type','Note','Contact','Date'],
    row: a => [a.type, a.note.slice(0,60), state.contacts.find(c=>c.id===a.contactId)?.name||'—', fmtDate(a.created_at)],
    summary: () => {
      const types = {};
      state.activities.forEach(a=>{ types[a.type]=(types[a.type]||0)+1; });
      const top = Object.entries(types).sort((a,b)=>b[1]-a[1])[0];
      return [
        {label:'Total Activities', val: state.activities.length},
        {label:'Calls',            val: state.activities.filter(a=>a.type==='Call').length},
        {label:'Meetings',         val: state.activities.filter(a=>a.type==='Meeting').length},
        {label:'Top Type',         val: top?top[0]:'—'},
      ];
    },
    filters: ['type'],
  },
  pipeline: {
    label: 'Pipeline',
    headers: ['Stage','Count','Total Value (₹)','Avg Value (₹)','% of Total'],
    row: null,
    summary: () => {
      const won = state.leads.filter(l=>l.stage==='Won');
      const totalVal = state.leads.reduce((s,l)=>s+(l.value||0),0);
      return [
        {label:'Pipeline Value',   val: '₹'+fmtMoney(totalVal)},
        {label:'Weighted Forecast',val: '₹'+fmtMoney(state.leads.filter(l=>l.stage==='Qualified'||l.stage==='Proposal').reduce((a,l)=>a+(l.value||0)*({'Qualified':0.4,'Proposal':0.7}[l.stage]||0),0)+won.reduce((s,l)=>s+(l.value||0),0))},
        {label:'Deals in Pipeline',val: state.leads.filter(l=>l.stage!=='Won'&&l.stage!=='Lost').length},
        {label:'Won Deals',        val: won.length},
      ];
    },
    filters: [],
  },
};



const q = id => document.getElementById(id);
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail   = a => EMAIL_RE.test(String(a).trim());

// Phone validation — Indian mobile: 10 digits, starts with 6-9
// Also accepts formats: +91-XXXXXXXXXX, +91 XXXXXXXXXX, 0XXXXXXXXXX
const PHONE_RE  = /^(?:\+91[\s-]?)?(?:0)?([6-9]\d{9})$/;
function isValidPhone(p) {
  if (!p) return false;
  const cleaned = String(p).replace(/[\s\-().]/g, '');
  return PHONE_RE.test(cleaned);
}
function normalisePhoneDisplay(p) {
  const cleaned = String(p||'').replace(/[\s\-().]/g, '');
  const match = cleaned.match(/([6-9]\d{9})$/);
  return match ? match[1] : p;
}

// Field-level error helper
function setFieldError(inputId, message) {
  const el = q(inputId);
  if (!el) return;
  el.style.borderColor = message ? '#e11d48' : '';
  el.style.boxShadow   = message ? '0 0 0 3px rgba(225,29,72,.12)' : '';
  // Find or create error span
  let errSpan = el.parentElement?.querySelector('.field-err') || el.nextElementSibling;
  if (!errSpan || !errSpan.classList?.contains('field-err')) {
    errSpan = document.createElement('span');
    errSpan.className = 'field-err';
    errSpan.style.cssText = 'display:block;font-size:.72rem;color:#e11d48;margin-top:3px;font-weight:500';
    el.insertAdjacentElement('afterend', errSpan);
  }
  errSpan.textContent = message || '';
}
function clearFieldErrors(...ids) {
  ids.forEach(id => setFieldError(id, ''));
}
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
  localStorage.setItem('crm_documents',  JSON.stringify(state.documents));
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
  const errEl   = q('loginStatus');
  const btn     = q('loginSubmitBtn');
  const btnText = q('loginBtnText');
  const spinner = q('loginBtnSpinner');
  if (errEl) errEl.textContent = '';

  // ── Login validation ──────────────────────────────────────────────
  const loginEmail = q('loginEmail')?.value.trim() || '';
  const loginPass  = q('loginPassword')?.value || '';
  let loginValid = true;

  if (!loginEmail) {
    if (errEl) errEl.textContent = 'Email address is required.';
    q('loginEmail')?.focus(); loginValid = false;
  } else if (!isEmail(loginEmail)) {
    if (errEl) errEl.textContent = 'Please enter a valid email address (e.g. user@nhai.gov.in).';
    q('loginEmail')?.focus(); loginValid = false;
  } else if (!loginPass) {
    if (errEl) errEl.textContent = 'Password is required.';
    q('loginPassword')?.focus(); loginValid = false;
  } else if (loginPass.length < 6) {
    if (errEl) errEl.textContent = 'Password must be at least 6 characters.';
    q('loginPassword')?.focus(); loginValid = false;
  }
  if (!loginValid) {
    // Shake the form
    const form = q('loginForm');
    if (form) { form.style.animation='none'; setTimeout(()=>form.style.animation='loginShake .4s ease',10); }
    return;
  }
  // ─────────────────────────────────────────────────────────────────

  if (btn)    { btn.disabled=true; }
  if (btnText)  btnText.classList.add('hidden');
  if (spinner)  spinner.classList.remove('hidden');
  try {
    const r = await fetch(`${API}/auth/login`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ email:q('loginEmail').value.trim().toLowerCase(), password:q('loginPassword').value })
    });
    const d = await r.json();
    if (!r.ok) {
      if (errEl) errEl.textContent = d.message||'Invalid credentials.';
      if (btn)    btn.disabled=false;
      if (btnText)  btnText.classList.remove('hidden');
      if (spinner)  spinner.classList.add('hidden');
      // Shake the form
      const form = q('loginForm');
      if (form) { form.style.animation='none'; setTimeout(()=>form.style.animation='loginShake .4s ease',10); }
      return;
    }
    state.accessToken  = d.accessToken;
    state.refreshToken = d.refreshToken;
    state.session      = d.user;
    state.permissions  = new Set(d.permissions);
    // Hide login screen with animation
    const screen = q('loginScreen');
    if (screen) screen.classList.add('hidden');
    setTimeout(()=>{ if(screen) screen.style.display='none'; }, 450);
    q('loginForm').reset();
    renderSession(); await loadAllData(); renderAll();
    // Show chat button after login
    const chatWrap = q('chatBellWrap');
    if (chatWrap) { chatWrap.classList.remove('hidden'); chatWrap.style.display='flex'; }
    initChat();
  } catch {
    if (errEl) errEl.textContent = 'Cannot reach API server on port 3002. Please ensure the backend is running.';
    if (btn)    btn.disabled=false;
    if (btnText)  btnText.classList.remove('hidden');
    if (spinner)  spinner.classList.add('hidden');
  }
}
async function logout() {
  if (state.refreshToken) apiFetch('/auth/logout',{method:'POST',body:JSON.stringify({refreshToken:state.refreshToken})}).catch(()=>{});
  Object.assign(state, { session:null, accessToken:null, refreshToken:null, permissions:new Set(), contacts:[], leads:[], tickets:[] });
  // Show login screen again
  const screen = q('loginScreen');
  if (screen) { screen.style.display='flex'; setTimeout(()=>screen.classList.remove('hidden'),10); }
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
  if (id==='reports')   renderReport();
  if (id==='documents') { syncDocDropdowns(); renderDocuments(); }
  if (id==='calendar')  renderCalendar();
  if (id==='portal-admin') renderPortalAdmin();
}
function switchProjectView(view) {
  document.querySelectorAll('.project-view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.vtab').forEach(b=>b.classList.remove('active'));
  q(`project${view.charAt(0).toUpperCase()+view.slice(1)}View`).classList.add('active');
  document.querySelector(`.vtab[data-view="${view}"]`).classList.add('active');
  if (view==='gantt') renderGantt();
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id) {
  q(id).showModal();
  if (id==='templateModal') { renderTemplateManager(); renderTemplatePills(); }
}
function closeModal(id) { q(id).close(); }

// ── Forms ─────────────────────────────────────────────────────────────────────
q('logoutBtn').addEventListener('click', logout);
q('loginBtn').addEventListener('click', ()=>{
  const screen=q('loginScreen');
  if(screen){screen.style.display='flex';setTimeout(()=>screen.classList.remove('hidden'),10);}
});
document.querySelectorAll('.tnav').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
q('mailForm').addEventListener('submit', sendMail);

// ── Individual save functions (called by onclick buttons, avoids dialog form submit issues) ──

async function saveContact() {
  const errEl = q('contactFormError');
  const btn   = q('saveContactBtn');
  if (errEl) errEl.textContent = '';
  if (!state.session) { if(errEl) errEl.textContent='Please log in first.'; return; }

  const name   = q('c_name').value.trim();
  const email  = q('c_email').value.trim();
  const phone  = q('c_phone').value.trim();
  const secEmail = q('c_secEmail').value.trim();
  const age    = q('c_age').value.trim();

  // ── Contact field validation ──────────────────────────────────────
  let valid = true; let firstError = '';

  if (!name) {
    firstError = firstError||'Full Name is required.';
    valid = false;
  } else if (name.length < 2) {
    firstError = firstError||'Full Name must be at least 2 characters.';
    valid = false;
  }

  if (!email) {
    firstError = firstError||'Primary Email is required.';
    valid = false;
  } else if (!isEmail(email)) {
    firstError = firstError||'Primary Email is not valid (e.g. name@company.com).';
    valid = false;
  }

  if (secEmail && !isEmail(secEmail)) {
    firstError = firstError||'Secondary Email is not valid.';
    valid = false;
  }

  if (phone && !isValidPhone(phone)) {
    firstError = firstError||'Mobile number must be 10 digits starting with 6–9 (e.g. 9876543210).';
    valid = false;
  }

  if (age && (isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120)) {
    firstError = firstError||'Age must be between 1 and 120.';
    valid = false;
  }

  if (!valid) {
    if (errEl) errEl.textContent = firstError;
    return;
  }
  // ─────────────────────────────────────────────────────────────────

  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  const ok = await apiCreate('contacts', {
    name, email,
    secondaryEmail: q('c_secEmail').value.trim(),
    phone:    q('c_phone').value.trim(),
    company:  q('c_company').value.trim(),
    gender:   q('c_gender').value,
    age:      Number(q('c_age').value)||null,
    location: q('c_location').value.trim(),
  });
  if (btn) { btn.disabled=false; btn.textContent='Save Contact'; }
  if (ok) {
    ['c_name','c_email','c_secEmail','c_phone','c_company','c_age','c_location'].forEach(id=>{const el=q(id);if(el)el.value='';});
    q('c_gender').value='';
    closeModal('contactModal');
    const r = await apiFetch('/contacts');
    if (r && r.ok) state.contacts = await r.json();
    renderAll();
  } else {
    if (errEl) errEl.textContent='Save failed — is the API server running on port 3002?';
  }
}

async function saveLead() {
  const title = q('leadName').value.trim();
  if (!title) { alert('Lead title is required.'); return; }
  if (!state.session) { alert('Please log in first.'); return; }
  const ok = await apiCreate('leads', { title, stage:q('leadStage').value, value:Number(q('leadValue').value)||0, contactId:q('leadContact').value||null });
  if (ok) {
    ['leadName','leadValue'].forEach(id=>{const el=q(id);if(el)el.value='';});
    q('leadStage').value='New'; q('leadContact').value='';
    closeModal('leadModal');
    const r=await apiFetch('/leads'); if(r&&r.ok) state.leads=await r.json();
    renderAll();
  }
}

async function saveTicket() {
  const title = q('ticketTitle').value.trim();
  if (!title) { alert('Ticket title is required.'); return; }
  if (!state.session) { alert('Please log in first.'); return; }
  const ok = await apiCreate('tickets', { title, priority:q('ticketPriority').value, status:q('ticketStatus').value, contactId:q('ticketContact').value||null });
  if (ok) {
    q('ticketTitle').value=''; q('ticketContact').value='';
    closeModal('ticketModal');
    const r=await apiFetch('/tickets'); if(r&&r.ok) state.tickets=await r.json();
    renderAll();
  }
}

function saveAccount() {
  const name = q('accountName').value.trim();
  if (!name) { alert('Account name is required.'); return; }
  state.accounts.push({ id:crypto.randomUUID(), created_at:new Date().toISOString(), name, tier:q('accountTier').value, renewalDate:q('renewalDate').value });
  q('accountName').value=''; q('renewalDate').value='';
  persistLocal(); closeModal('accountModal'); renderAll();
}

function saveOpportunity() {
  const name = q('oppName').value.trim();
  if (!name) { alert('Opportunity name is required.'); return; }
  state.opportunities.push({ id:crypto.randomUUID(), created_at:new Date().toISOString(), name, value:Number(q('oppValue').value)||0, probability:Number(q('oppProbability').value) });
  q('oppName').value=''; q('oppValue').value='';
  persistLocal(); closeModal('oppModal'); renderAll();
}

function saveProject() {
  const name = q('projectName').value.trim();
  const mgr  = q('projectManager').value.trim();
  if (!name) { alert('Project name is required.'); return; }
  if (!mgr)  { alert('Project manager is required.'); return; }
  state.projects.push({ id:crypto.randomUUID(), created_at:new Date().toISOString(), name, status:q('projectStatus').value, priority:q('projectPriority').value, manager:mgr, startDate:q('projectStartDate').value, dueDate:q('projectDueDate').value, budget:Number(q('projectBudget').value||0), contactId:q('projectContact').value||null, description:q('projectDesc').value.trim(), progress:0 });
  ['projectName','projectManager','projectStartDate','projectDueDate','projectBudget','projectDesc'].forEach(id=>{const el=q(id);if(el)el.value='';});
  persistLocal(); closeModal('projectModal'); renderAll();
}

function saveTask() {
  const title = q('taskTitle').value.trim();
  if (!title) { alert('Task title is required.'); return; }
  state.tasks.push({ id:crypto.randomUUID(), created_at:new Date().toISOString(), title, projectId:q('taskProject').value||null, assignee:q('taskAssignee').value.trim(), status:q('taskStatus').value, priority:q('taskPriority').value, dueDate:q('taskDueDate').value });
  ['taskTitle','taskAssignee','taskDueDate'].forEach(id=>{const el=q(id);if(el)el.value='';});
  persistLocal(); closeModal('taskModal'); renderAll();
}

function saveMilestone() {
  const name = q('milestoneName').value.trim();
  const date = q('milestoneDate').value;
  if (!name) { alert('Milestone name is required.'); return; }
  if (!date) { alert('Target date is required.'); return; }
  state.milestones.push({ id:crypto.randomUUID(), created_at:new Date().toISOString(), name, projectId:q('milestoneProject').value||null, date, status:q('milestoneStatus').value });
  q('milestoneName').value=''; q('milestoneDate').value='';
  persistLocal(); closeModal('milestoneModal'); renderAll();
}

function saveActivity() {
  const note = q('activityNote').value.trim();
  if (!note) { alert('Activity note is required.'); return; }
  state.activities.unshift({ id:crypto.randomUUID(), created_at:new Date().toISOString(), type:q('activityType').value, note, contactId:q('activityContact').value||null });
  q('activityNote').value=''; q('activityContact').value='';
  persistLocal(); closeModal('activityModal'); renderAll();
}

// ── Session & Role ────────────────────────────────────────────────────────────
function renderSession() {
  const li = Boolean(state.session);
  q('loginBtn').classList.toggle('hidden', li);
  q('logoutBtn').classList.toggle('hidden', !li);
  q('userChip').classList.toggle('hidden', !li);
  // Show/hide chat button based on login state
  const chatWrap = q('chatBellWrap');
  if (chatWrap) {
    if (li) {
      chatWrap.classList.remove('hidden');
      chatWrap.style.display = 'flex';
    } else {
      chatWrap.classList.add('hidden');
      chatWrap.style.display = 'none';
    }
  }
  if (li) {
    q('userBadge').textContent = state.session.name;
    q('userAvatar').textContent = state.session.name.charAt(0).toUpperCase();
    const role = can('users.delete')?'Admin':can('users.read')?'Manager':can('leads.delete')?'Sales Rep':'Viewer';
    q('roleBadge').textContent = role;
  } else {
    // Hide chat panel on logout
    const panel = q('chatMessenger');
    if (panel) { panel.classList.add('hidden'); panel.style.display='none'; }
    chatState.open = false;
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
  const search  = (q('contactSearch')?.value||'').toLowerCase();
  const company = q('contactCompanyFilter')?.value||'';
  const location= q('contactLocationFilter')?.value||'';
  const list = state.contacts.filter(c=>{
    if (search && !c.name.toLowerCase().includes(search) && !c.email.toLowerCase().includes(search) && !(c.company||'').toLowerCase().includes(search) && !(c.location||'').toLowerCase().includes(search)) return false;
    if (company  && c.company  !== company)  return false;
    if (location && c.location !== location) return false;
    return true;
  });
  renderContactList(list);
}
function renderContactList(list) {
  const canE = state.session&&can('contacts.update');
  const canD = state.session&&can('contacts.delete');
  const wrap  = q('contactList');
  const empty = q('contactEmpty');
  if (!list.length) {
    if(wrap) wrap.innerHTML='';
    if(empty) empty.classList.remove('hidden');
    return;
  }
  if(empty) empty.classList.add('hidden');
  if (_contactViewMode === 'grid') {
    wrap.className='contact-grid';
    wrap.innerHTML=list.map(c=>{
      const h=c._health||{score:50,grade:'C'};
      const color=avatarColor(c.name);
      const sel=_bulkSelected.contacts.has(c.id);
      return `<div class="contact-card" onclick="openC360('${c.id}')">
        <input type="checkbox" class="contact-card-checkbox" ${sel?'checked':''} onchange="toggleBulkSelect('contacts','${c.id}',this.checked)" onclick="event.stopPropagation()" />
        <div class="contact-card-top">
          <div class="contact-card-avatar" style="background:${color}">${c.name.charAt(0).toUpperCase()}</div>
          <div class="contact-card-info">
            <div class="contact-card-name">${c.name}</div>
            <div class="contact-card-company">${c.company||'—'}</div>
          </div>
          <span class="health-badge health-${h.grade}" style="margin-left:auto;flex-shrink:0">${h.grade}${h.score}</span>
        </div>
        <div class="contact-card-details">
          <div class="contact-card-detail"><span class="contact-card-detail-icon">📧</span>${c.email}</div>
          ${c.phone?`<div class="contact-card-detail"><span class="contact-card-detail-icon">📱</span>${c.phone}</div>`:''}
          ${c.location?`<div class="contact-card-detail"><span class="contact-card-detail-icon">📍</span>${c.location}</div>`:''}
        </div>
        ${c.company?`<div class="contact-card-tags"><span class="contact-card-tag">🏢 ${c.company}</span></div>`:''}
        <div class="contact-card-footer">
          <div class="contact-card-actions">
            ${canE?`<button class="contact-card-action-btn" onclick="event.stopPropagation();openEditDialog('contacts','${c.id}')">✏ Edit</button>`:''}
            ${canD?`<button class="contact-card-action-btn danger" onclick="event.stopPropagation();deleteRecord('contacts','${c.id}')">🗑</button>`:''}
            <button class="contact-card-action-btn" onclick="event.stopPropagation();quickVideoCall('${c.id}')" title="Video Call">📹</button>
            <button class="contact-card-action-btn" onclick="event.stopPropagation();openTimeline('${c.id}')" title="Timeline">📋</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } else {
    wrap.className='contact-list-view';
    wrap.innerHTML=list.map(c=>{
      const color=avatarColor(c.name);
      const h=c._health||{score:50,grade:'C'};
      const sel=_bulkSelected.contacts.has(c.id);
      return `<div class="contact-list-item" onclick="openC360('${c.id}')">
        <input type="checkbox" ${sel?'checked':''} onchange="toggleBulkSelect('contacts','${c.id}',this.checked)" onclick="event.stopPropagation()" style="width:15px;height:15px;accent-color:var(--accent);flex-shrink:0" />
        <div class="contact-list-avatar" style="background:${color}">${c.name.charAt(0)}</div>
        <div class="contact-list-info">
          <div class="contact-list-name">${c.name} <span class="health-badge health-${h.grade}" style="font-size:.62rem">${h.grade}</span></div>
          <div class="contact-list-email">${c.email}</div>
          <div class="contact-list-location">📍 ${c.location||'—'} · 🏢 ${c.company||'—'}</div>
        </div>
        <div class="contact-list-actions">
          ${canE?`<button class="btn-edit" onclick="event.stopPropagation();openEditDialog('contacts','${c.id}')">Edit</button>`:''}
          ${canD?`<button class="btn-delete" onclick="event.stopPropagation();deleteRecord('contacts','${c.id}')">Delete</button>`:''}
        </div>
      </div>`;
    }).join('');
  }
}
function renderCustomers() {
  // Populate filter dropdowns
  const companies  = [...new Set(state.contacts.map(c=>c.company).filter(Boolean))].sort();
  const locations  = [...new Set(state.contacts.map(c=>c.location).filter(Boolean))].sort();
  const compEl = q('contactCompanyFilter');
  const locEl  = q('contactLocationFilter');
  if (compEl) compEl.innerHTML = '<option value="">All Companies</option>' + companies.map(c=>`<option>${c}</option>`).join('');
  if (locEl)  locEl.innerHTML  = '<option value="">All Locations</option>'  + locations.map(l=>`<option>${l}</option>`).join('');

  filterContacts();

  // Account cards
  const accountWrap  = q('accountList');
  const accountEmpty = q('accountEmpty');
  const now = Date.now();
  if (!state.accounts.length) {
    if (accountWrap)  accountWrap.innerHTML = '';
    if (accountEmpty) accountEmpty.classList.remove('hidden');
  } else {
    if (accountEmpty) accountEmpty.classList.add('hidden');
    accountWrap.innerHTML = state.accounts.map(a => {
      const daysLeft = a.renewalDate ? Math.ceil((new Date(a.renewalDate)-now)/86400000) : null;
      const isSoon   = daysLeft!==null && daysLeft<=30;
      const tierIcon = {Enterprise:'🏛',  'Mid-Market':'🏢', SMB:'🏠'}[a.tier] || '🏢';
      return `<div class="account-card">
        <div class="account-card-header">
          <div class="account-card-icon">${tierIcon}</div>
          <div>
            <div class="account-card-name">${a.name}</div>
          </div>
          <div class="account-card-tier"><span class="${badgeClass(a.tier||'SMB')}">${a.tier||'SMB'}</span></div>
        </div>
        <div class="account-card-renewal">
          <span class="account-card-renewal-label">📅 Renewal</span>
          <span class="account-card-renewal-date ${isSoon?'soon':''}">
            ${daysLeft===null?'—':daysLeft<=0?'Overdue':isSoon?daysLeft+'d left':fmtDate(a.renewalDate)}
          </span>
        </div>
        <div class="account-card-actions">
          ${actBtns('accounts',a.id)}
        </div>
      </div>`;
    }).join('');
  }

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
      <div class="kanban-card" draggable="true" ondragstart="kanbanDragStart(event,'${l.id}')" ondragend="kanbanDragEnd(event)">
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
        <div class="project-card-meta" style="margin-top:.3rem">
          <span class="doc-badge">📎 ${state.documents.filter(d=>d.projectId===p.id).length} docs</span>
          <button class="btn-mail-status" onclick="openModal('uploadDocModal');setTimeout(()=>{const el=q('docProjectTag');if(el)el.value='${p.id}';},100)">📎 Attach</button>
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
      <td><span class="doc-badge">📎 ${state.documents.filter(d=>d.projectId===p.id).length}</span></td>
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
  syncDocDropdowns();
  renderDocuments();
  if (q('reportBody')) renderReport();
  renderPortalAdmin();
  initChat();
  renderHealthScores();
  renderNotifBell();
  renderNotifPanel();
  renderReminders();
  renderTemplatePills();
  syncReminderDropdown();
}


// ── Mail Project Status ───────────────────────────────────────────────────────

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


// ══════════════════════════════════════════════════════════════════
//  DOCUMENT MANAGEMENT SYSTEM
// ══════════════════════════════════════════════════════════════════

// ── File type helpers ─────────────────────────────────────────────
// FILE_ICONS — hoisted
function fileIcon(name) {
  const ext = (name||'').split('.').pop().toLowerCase();
  return FILE_ICONS[ext] || '📄';
}
function fileType(name) {
  const ext = (name||'').split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'PDF';
  if (['doc','docx','txt','rtf'].includes(ext)) return 'Document';
  if (['xls','xlsx','csv'].includes(ext)) return 'Spreadsheet';
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) return 'Image';
  if (['ppt','pptx'].includes(ext)) return 'Presentation';
  return 'Other';
}
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

// ── Pending file queue ────────────────────────────────────────────

function handleDragOver(e) {
  e.preventDefault();
  q('docDropZone').classList.add('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  q('docDropZone').classList.remove('drag-over');
  addFilesToQueue([...e.dataTransfer.files]);
}
function handleFileSelect(e) { addFilesToQueue([...e.target.files]); }

function addFilesToQueue(files) {
  const MAX = 5 * 1024 * 1024;
  const errEl = q('docUploadError');
  files.forEach(file => {
    if (file.size > MAX) { if(errEl) errEl.textContent = file.name + ' exceeds 5MB limit.'; return; }
    if (_pendingFiles.find(f=>f.name===file.name&&f.size===file.size)) return; // dedupe
    _pendingFiles.push(file);
  });
  renderPendingFiles();
}

function renderPendingFiles() {
  const list = q('docFilePreviewList');
  if (!list) return;
  list.innerHTML = _pendingFiles.map((f,i) => `
    <div class="doc-file-preview-item">
      <span>${fileIcon(f.name)}</span>
      <span class="doc-file-preview-name">${f.name}</span>
      <span class="doc-file-preview-size">${fmtSize(f.size)}</span>
      <button class="doc-file-preview-remove" onclick="removePendingFile(${i})">✕</button>
    </div>`).join('') || '';
}

function removePendingFile(idx) {
  _pendingFiles.splice(idx, 1);
  renderPendingFiles();
}

// ── Save documents ────────────────────────────────────────────────
async function saveDocuments() {
  const errEl = q('docUploadError');
  const btn   = q('saveDocBtn');
  if (errEl) errEl.textContent = '';
  if (!_pendingFiles.length) { if(errEl) errEl.textContent='Please select at least one file.'; return; }

  const projectId = q('docProjectTag').value || null;
  const taskId    = q('docTaskTag').value    || null;
  const status    = q('docStatusTag').value  || null;
  const notes     = q('docNotes').value.trim();

  if (btn) { btn.disabled=true; btn.textContent='Uploading…'; }

  const promises = _pendingFiles.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const doc = {
        id:        crypto.randomUUID(),
        name:      file.name,
        type:      fileType(file.name),
        size:      file.size,
        mimeType:  file.type,
        data:      e.target.result, // base64 data URL
        projectId, taskId, status, notes,
        uploadedAt: new Date().toISOString(),
        uploadedBy: state.session?.name || 'Unknown',
      };
      resolve(doc);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  }));

  try {
    const docs = await Promise.all(promises);
    docs.forEach(d => state.documents.push(d));
    persistLocal();
    _pendingFiles = [];
    renderPendingFiles();
    // Reset form
    ['docProjectTag','docTaskTag','docStatusTag'].forEach(id=>{const el=q(id);if(el)el.value='';});
    q('docNotes').value='';
    q('docFileInput').value='';
    if (btn) { btn.disabled=false; btn.textContent='Upload'; }
    closeModal('uploadDocModal');
    renderDocuments();
    renderAll(); // update badges
  } catch(err) {
    if (btn) { btn.disabled=false; btn.textContent='Upload'; }
    if (errEl) errEl.textContent='Upload failed: '+err.message;
  }
}

// ── Render documents ──────────────────────────────────────────────
function syncDocDropdowns() {
  const projOpts = '<option value="">— None —</option>' + state.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const taskOpts = '<option value="">— None —</option>' + state.tasks.map(t=>`<option value="${t.id}">${t.title}</option>`).join('');
  const filtProjOpts = '<option value="">All Projects</option>' + state.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const filtTaskOpts = '<option value="">All Tasks</option>' + state.tasks.map(t=>`<option value="${t.id}">${t.title}</option>`).join('');
  ['docProjectTag','docProjectFilter'].forEach(id=>{const el=q(id);if(el)el.innerHTML=id.includes('Filter')?filtProjOpts:projOpts;});
  ['docTaskTag','docTaskFilter'].forEach(id=>{const el=q(id);if(el)el.innerHTML=id.includes('Filter')?filtTaskOpts:taskOpts;});
}

function renderDocuments() {
  const search    = (q('docSearch')?.value||'').toLowerCase();
  const projF     = q('docProjectFilter')?.value||'';
  const taskF     = q('docTaskFilter')?.value||'';
  const statusF   = q('docStatusFilter')?.value||'';
  const typeF     = q('docTypeFilter')?.value||'';

  let docs = [...state.documents].sort((a,b)=>new Date(b.uploadedAt)-new Date(a.uploadedAt));
  if (search)  docs = docs.filter(d=>d.name.toLowerCase().includes(search)||(d.notes||'').toLowerCase().includes(search));
  if (projF)   docs = docs.filter(d=>d.projectId===projF);
  if (taskF)   docs = docs.filter(d=>d.taskId===taskF);
  if (statusF) docs = docs.filter(d=>d.status===statusF);
  if (typeF)   docs = docs.filter(d=>d.type===typeF);

  // Stats
  const totalSize = state.documents.reduce((s,d)=>s+d.size,0);
  const el = id => q(id);
  if(el('docTotalCount'))   el('docTotalCount').textContent   = state.documents.length;
  if(el('docProjectCount')) el('docProjectCount').textContent = state.documents.filter(d=>d.projectId).length;
  if(el('docTaskCount'))    el('docTaskCount').textContent    = state.documents.filter(d=>d.taskId).length;
  if(el('docTotalSize'))    el('docTotalSize').textContent    = fmtSize(totalSize);

  const listEl  = q('docList');
  const emptyEl = q('docEmpty');
  if (!docs.length) {
    listEl.innerHTML = '';
    if(emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if(emptyEl) emptyEl.classList.add('hidden');

  listEl.innerHTML = docs.map(d => {
    const proj    = d.projectId ? state.projects.find(p=>p.id===d.projectId) : null;
    const task    = d.taskId    ? state.tasks.find(t=>t.id===d.taskId)       : null;
    const tags    = [
      proj  ? `<span class="doc-tag">📁 ${proj.name.slice(0,20)}</span>` : '',
      task  ? `<span class="doc-tag task-tag">✅ ${task.title.slice(0,20)}</span>` : '',
      d.status ? `<span class="doc-tag status-tag">${d.status}</span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="doc-item ${_activeDocId===d.id?'active':''}" onclick="previewDoc('${d.id}')">
        <div class="doc-icon">${fileIcon(d.name)}</div>
        <div class="doc-info">
          <div class="doc-name">${d.name}</div>
          <div class="doc-meta">
            <span>${d.type}</span>
            <span>${fmtSize(d.size)}</span>
            <span>${new Date(d.uploadedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
            <span>by ${d.uploadedBy}</span>
          </div>
          ${tags ? `<div class="doc-tags">${tags}</div>` : ''}
        </div>
        <div class="doc-actions">
          <button class="doc-action-btn" onclick="event.stopPropagation();downloadDoc('${d.id}')" title="Download">⬇</button>
          <button class="doc-action-btn" onclick="event.stopPropagation();openRenameDoc('${d.id}')" title="Rename">✏️</button>
          <button class="doc-action-btn danger" onclick="event.stopPropagation();deleteDoc('${d.id}')" title="Delete">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ── Preview ───────────────────────────────────────────────────────
function previewDoc(id) {
  _activeDocId = id;
  renderDocuments(); // re-render to update active state
  const doc   = state.documents.find(d=>d.id===id);
  const panel = q('docPreviewPanel');
  if (!doc || !panel) return;

  const proj   = doc.projectId ? state.projects.find(p=>p.id===doc.projectId) : null;
  const task   = doc.taskId    ? state.tasks.find(t=>t.id===doc.taskId)       : null;
  const tags   = [
    proj  ? `<span class="doc-tag">📁 ${proj.name}</span>` : '',
    task  ? `<span class="doc-tag task-tag">✅ ${task.title}</span>` : '',
    doc.status ? `<span class="doc-tag status-tag">${doc.status}</span>` : '',
  ].filter(Boolean).join('');

  let previewBody = '';
  const ext = doc.name.split('.').pop().toLowerCase();
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
    previewBody = `<img src="${doc.data}" alt="${doc.name}" />`;
  } else if (ext === 'pdf') {
    previewBody = `<embed src="${doc.data}" type="application/pdf" />`;
  } else if (['txt','csv','json','md'].includes(ext)) {
    // Decode base64 to text
    try {
      const b64 = doc.data.split(',')[1];
      const text = decodeURIComponent(escape(atob(b64)));
      previewBody = `<div class="doc-preview-text">${text.slice(0,3000)}${text.length>3000?'\n\n[Truncated…]':''}</div>`;
    } catch { previewBody = `<div class="doc-preview-text">Preview not available.</div>`; }
  } else {
    previewBody = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:var(--text-3);gap:1rem">
      <div style="font-size:3rem">${fileIcon(doc.name)}</div>
      <p>Preview not available for this file type.</p>
      <button class="btn-primary-sm" onclick="downloadDoc('${doc.id}')">⬇ Download to view</button>
    </div>`;
  }

  panel.innerHTML = `
    <div class="doc-preview-header">
      <div class="doc-preview-name">${fileIcon(doc.name)} ${doc.name}</div>
      <div class="doc-preview-meta">
        <span>${doc.type}</span><span>${fmtSize(doc.size)}</span>
        <span>Uploaded ${new Date(doc.uploadedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
        <span>by ${doc.uploadedBy}</span>
      </div>
      ${tags ? `<div class="doc-preview-tags">${tags}</div>` : ''}
    </div>
    <div class="doc-preview-body">
      ${previewBody}
      ${doc.notes ? `<div class="doc-preview-notes">📝 ${doc.notes}</div>` : ''}
    </div>
    <div class="doc-preview-actions">
      <button class="btn-primary-sm" onclick="downloadDoc('${doc.id}')">⬇ Download</button>
      <button class="btn-secondary-sm" onclick="openRenameDoc('${doc.id}')">✏️ Rename</button>
      <button class="btn-secondary-sm" style="color:var(--rose);border-color:#fca5a5" onclick="deleteDoc('${doc.id}')">🗑 Delete</button>
    </div>`;
}

// ── Document actions ──────────────────────────────────────────────
function downloadDoc(id) {
  const doc = state.documents.find(d=>d.id===id);
  if (!doc) return;
  const a = document.createElement('a');
  a.href = doc.data;
  a.download = doc.name;
  a.click();
}

function deleteDoc(id) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  state.documents = state.documents.filter(d=>d.id!==id);
  if (_activeDocId === id) {
    _activeDocId = null;
    const panel = q('docPreviewPanel');
    if (panel) panel.innerHTML = '<div class="doc-preview-empty"><div style="font-size:2rem">📄</div><p>Select a document to preview</p></div>';
  }
  persistLocal(); renderDocuments(); renderAll();
}

function openRenameDoc(id) {
  _renamingDocId = id;
  const doc = state.documents.find(d=>d.id===id);
  if (!doc) return;
  q('renameDocInput').value = doc.name;
  openModal('renameDocModal');
  setTimeout(()=>q('renameDocInput').select(), 100);
}

function confirmRename() {
  const newName = q('renameDocInput').value.trim();
  if (!newName) { alert('Name cannot be empty.'); return; }
  const doc = state.documents.find(d=>d.id===_renamingDocId);
  if (doc) { doc.name = newName; persistLocal(); renderDocuments(); if(_activeDocId===doc.id) previewDoc(doc.id); }
  closeModal('renameDocModal');
  _renamingDocId = null;
}

// Allow Enter key in rename input
document.addEventListener('DOMContentLoaded', ()=>{
  const ri = q('renameDocInput');
  if (ri) ri.addEventListener('keydown', e=>{ if(e.key==='Enter') confirmRename(); });
});

// ── Helpers for login screen ───────────────────────────────────────────────────
function togglePasswordVisibility() {
  const input = q('loginPassword');
  const btn   = q('loginEyeBtn');
  if (!input) return;
  if (input.type === 'password') { input.type='text'; if(btn) btn.textContent='🙈'; }
  else { input.type='password'; if(btn) btn.textContent='👁'; }
}

async function checkLoginApiStatus() {
  const dot  = q('loginApiDot');
  const text = q('loginApiText');
  try {
    const r = await fetch(`${API}/health`, {signal: AbortSignal.timeout(3000)});
    // 200 = public health ok, 401 = server running but needs auth (also fine for login page)
    if (r.ok || r.status === 401) {
      if(dot)  dot.className='api-dot online';
      if(text) text.textContent='API server online (port 3002)';
    } else throw new Error('not ok');
  } catch {
    if(dot)  dot.className='api-dot offline';
    if(text) text.textContent='API server offline — start with: node api-server.js';
  }
}


// ══════════════════════════════════════════════════════════════════
//  REAL-TIME FIELD VALIDATION
// ══════════════════════════════════════════════════════════════════

// ── Login field real-time validation ─────────────────────────────
function validateLoginField(fieldId) {
  const el = q(fieldId);
  if (!el) return;
  const val = el.value.trim();

  if (fieldId === 'loginEmail') {
    const hint = q('loginEmailHint');
    if (!val) {
      el.classList.remove('field-ok','field-error');
      if (hint) { hint.textContent=''; hint.className='login-field-hint'; }
    } else if (!isEmail(val)) {
      el.classList.remove('field-ok'); el.classList.add('field-error');
      if (hint) { hint.textContent='⚠ Please enter a valid email address'; hint.className='login-field-hint error'; }
    } else {
      el.classList.remove('field-error'); el.classList.add('field-ok');
      if (hint) { hint.textContent='✓ Valid email'; hint.className='login-field-hint ok'; }
    }
  }

  if (fieldId === 'loginPassword') {
    const wrap  = q('loginPasswordStrength');
    const fill  = q('strengthFill');
    const label = q('strengthLabel');
    if (!val) {
      if (wrap) wrap.classList.add('hidden');
      el.classList.remove('field-ok','field-error');
      return;
    }
    if (wrap) wrap.classList.remove('hidden');

    // Password strength scoring
    let score = 0;
    if (val.length >= 6)  score++;
    if (val.length >= 10) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const levels = [
      { cls:'strength-weak',   label:'Weak',   width:'20%', color:'#e11d48' },
      { cls:'strength-weak',   label:'Weak',   width:'20%', color:'#e11d48' },
      { cls:'strength-fair',   label:'Fair',   width:'50%', color:'#d97706' },
      { cls:'strength-good',   label:'Good',   width:'75%', color:'#0d9488' },
      { cls:'strength-strong', label:'Strong', width:'100%',color:'#16a34a' },
      { cls:'strength-strong', label:'Strong', width:'100%',color:'#16a34a' },
    ];
    const level = levels[Math.min(score, 5)];
    if (wrap) wrap.className = `password-strength-wrap ${level.cls}`;
    if (fill) { fill.style.width=level.width; fill.style.background=level.color; }
    if (label) { label.textContent=level.label; label.style.color=level.color; }

    if (val.length < 6) {
      el.classList.remove('field-ok'); el.classList.add('field-error');
    } else {
      el.classList.remove('field-error'); el.classList.add('field-ok');
    }
  }
}

// ── Contact form real-time validation ─────────────────────────────
function validateContactField(fieldId) {
  const el = q(fieldId);
  if (!el || !el.value.trim()) {
    // Clear validation state if empty (optional fields OK empty)
    el?.classList.remove('field-ok','field-error-input');
    const next = el?.nextElementSibling;
    if (next?.classList?.contains('contact-field-err')) next.textContent='';
    return;
  }

  const val = el.value.trim();
  let error = '';

  if (fieldId === 'c_email' || fieldId === 'c_secEmail') {
    if (!isEmail(val)) error = 'Enter a valid email (e.g. name@company.com)';
  }
  if (fieldId === 'c_phone') {
    if (!isValidPhone(val)) {
      error = 'Enter a valid 10-digit Indian mobile number (starts with 6–9)';
    } else {
      // Show normalised format
      const normalised = normalisePhoneDisplay(val);
      if (normalised !== val) el.value = normalised; // auto-format
    }
  }

  // Apply visual state
  if (error) {
    el.classList.remove('field-ok'); el.classList.add('field-error-input');
  } else {
    el.classList.remove('field-error-input'); el.classList.add('field-ok');
  }

  // Show/hide inline error
  let errSpan = el.nextElementSibling;
  if (!errSpan || !errSpan.classList?.contains('contact-field-err')) {
    errSpan = document.createElement('span');
    errSpan.className = 'contact-field-err field-err';
    el.insertAdjacentElement('afterend', errSpan);
  }
  errSpan.textContent = error;
}

// ── Phone formatter — auto-format on blur ─────────────────────────
function formatPhoneOnBlur(inputId) {
  const el = q(inputId);
  if (!el || !el.value.trim()) return;
  const normalised = normalisePhoneDisplay(el.value.trim());
  if (normalised && /^[6-9]\d{9}$/.test(normalised)) el.value = normalised;
}


// ══════════════════════════════════════════════════════════════════
//  LOCATION CITY DROPDOWN
// ══════════════════════════════════════════════════════════════════

const INDIA_CITIES = {
  'Andhra Pradesh':       ['Visakhapatnam','Vijayawada','Guntur','Nellore','Kurnool','Tirupati','Rajahmundry','Kakinada','Anantapur','Eluru','Ongole','Nandyal','Kadapa'],
  'Arunachal Pradesh':    ['Itanagar','Naharlagun','Pasighat','Tezpur'],
  'Assam':                ['Guwahati','Dibrugarh','Silchar','Jorhat','Nagaon','Tinsukia','Tezpur','Bongaigaon','Dhubri'],
  'Bihar':                ['Patna','Gaya','Bhagalpur','Muzaffarpur','Darbhanga','Ara','Begusarai','Katihar','Munger','Purnia','Saharsa','Sasaram'],
  'Chhattisgarh':         ['Raipur','Bhilai','Bilaspur','Korba','Durg','Rajnandgaon','Jagdalpur','Ambikapur'],
  'Goa':                  ['Panaji','Margao','Vasco da Gama','Mapusa','Ponda','Bicholim'],
  'Gujarat':              ['Ahmedabad','Surat','Vadodara','Rajkot','Bhavnagar','Jamnagar','Gandhinagar','Junagadh','Anand','Mehsana','Nadiad','Morbi','Bharuch','Navsari','Valsad','Porbandar','Surendranagar'],
  'Haryana':              ['Faridabad','Gurgaon','Panipat','Ambala','Yamunanagar','Rohtak','Hisar','Karnal','Sonipat','Panchkula','Bhiwani','Sirsa','Rewari','Jhajjar'],
  'Himachal Pradesh':     ['Shimla','Dharamsala','Solan','Mandi','Kullu','Manali','Baddi','Nahan','Bilaspur'],
  'Jharkhand':            ['Ranchi','Jamshedpur','Dhanbad','Bokaro','Deoghar','Phusro','Hazaribagh','Giridih','Ramgarh','Medininagar'],
  'Karnataka':            ['Bengaluru','Mysuru','Hubballi','Mangaluru','Belagavi','Kalaburagi','Davanagere','Ballari','Shivamogga','Tumakuru','Vijayapura','Bidar','Udupi','Dharwad','Raichur'],
  'Kerala':               ['Thiruvananthapuram','Kochi','Kozhikode','Thrissur','Kollam','Kannur','Palakkad','Alappuzha','Malappuram','Kottayam','Kasaragod','Pathanamthitta'],
  'Madhya Pradesh':       ['Bhopal','Indore','Gwalior','Jabalpur','Ujjain','Sagar','Dewas','Satna','Ratlam','Rewa','Murwara','Singrauli','Burhanpur','Khandwa','Bhind','Chhindwara','Vidisha'],
  'Maharashtra':          ['Mumbai','Pune','Nagpur','Thane','Pimpri-Chinchwad','Nashik','Kalyan','Vasai-Virar','Aurangabad','Navi Mumbai','Solapur','Mira-Bhayandar','Bhiwandi','Amravati','Nanded','Kolhapur','Malegaon','Akola','Latur','Dhule','Ahmednagar','Sangli','Jalgaon','Chandrapur'],
  'Manipur':              ['Imphal','Thoubal','Bishnupur','Churachandpur'],
  'Meghalaya':            ['Shillong','Tura','Jowai','Nongstoin'],
  'Mizoram':              ['Aizawl','Lunglei','Saiha','Champhai'],
  'Nagaland':             ['Kohima','Dimapur','Mokokchung','Tuensang','Wokha'],
  'Odisha':               ['Bhubaneswar','Cuttack','Rourkela','Brahmapur','Sambalpur','Puri','Balasore','Baripada','Bhadrak','Jharsuguda','Angul','Dhenkanal','Kendujhar'],
  'Punjab':               ['Ludhiana','Amritsar','Jalandhar','Patiala','Bathinda','Hoshiarpur','Mohali','Batala','Pathankot','Moga','Abohar','Malerkotla','Khanna','Phagwara','Muktsar'],
  'Rajasthan':            ['Jaipur','Jodhpur','Kota','Bikaner','Ajmer','Udaipur','Bhilwara','Alwar','Bharatpur','Sikar','Pali','Sri Ganganagar','Srikaranpur','Tonk','Beawar','Hanumangarh','Dhaulpur','Dausa','Baran'],
  'Sikkim':               ['Gangtok','Namchi','Mangan','Gyalshing'],
  'Tamil Nadu':           ['Chennai','Coimbatore','Madurai','Tiruchirappalli','Salem','Tirunelveli','Tiruppur','Vellore','Erode','Thoothukudi','Dindigul','Thanjavur','Ranipet','Sivakasi','Karur','Udhagamandalam','Hosur','Nagercoil','Kanchipuram','Kumbakonam','Tambaram'],
  'Telangana':            ['Hyderabad','Warangal','Nizamabad','Karimnagar','Khammam','Mahbubnagar','Ramagundam','Siddipet','Miryalaguda','Suryapet','Mancherial','Adilabad','Nalgonda','Kothagudem'],
  'Tripura':              ['Agartala','Dharmanagar','Udaipur','Kailasahar','Belonia'],
  'Uttar Pradesh':        ['Lucknow','Kanpur','Ghaziabad','Agra','Varanasi','Meerut','Prayagraj','Bareilly','Aligarh','Moradabad','Saharanpur','Gorakhpur','Noida','Firozabad','Jhansi','Muzaffarnagar','Mathura','Shahjahanpur','Rampur','Shikohabad','Bulandshahr','Unnao','Rae Bareli','Farrukhabad','Bahraich','Hapur','Etawah','Lakhimpur','Fatehpur'],
  'Uttarakhand':          ['Dehradun','Haridwar','Roorkee','Haldwani','Rudrapur','Kashipur','Rishikesh','Nainital','Mussoorie','Pithoragarh'],
  'West Bengal':          ['Kolkata','Howrah','Durgapur','Asansol','Siliguri','Bardhaman','Malda','Baharampur','Habra','Kharagpur','Shantipur','Dankuni','Dhulian','Raniganj','Haldia','Raiganj','Krishnanagar','Nabadwip','Medinipur','Jalpaiguri','Balurghat'],
  'Delhi (NCT)':          ['New Delhi','Delhi','Dwarka','Rohini','Pitampura','Janakpuri','Laxmi Nagar','Shahdara','Saket','Vasant Kunj','Greater Kailash','Connaught Place','Karol Bagh','Paharganj','Nehru Place'],
  'Chandigarh':           ['Chandigarh'],
  'Puducherry':           ['Puducherry','Karaikal','Mahe','Yanam'],
  'Ladakh':               ['Leh','Kargil'],
  'Jammu & Kashmir':      ['Srinagar','Jammu','Anantnag','Baramulla','Sopore','Kathua','Udhampur','Poonch'],
  'Andaman & Nicobar':    ['Port Blair'],
  'Dadra & Nagar Haveli': ['Silvassa'],
  'Daman & Diu':          ['Daman','Diu'],
  'Lakshadweep':          ['Kavaratti'],
};

// Build flat list for searching
const ALL_CITIES_FLAT = Object.entries(INDIA_CITIES).flatMap(([state, cities]) =>
  cities.map(city => ({ city, state, label: city + ', ' + state }))
).sort((a,b)=>a.city.localeCompare(b.city));


function showCityDropdown() {
  filterCityDropdown(q('c_location')?.value || '');
}

function hideCityDropdown() {
  const dd = q('cityDropdown');
  if (dd) dd.classList.add('hidden');
  _cityHighlightIdx = -1;
}

function filterCityDropdown(query) {
  const dd = q('cityDropdown');
  if (!dd) return;
  _cityHighlightIdx = -1;

  const q2 = query.trim().toLowerCase();
  let results;

  if (!q2) {
    // Show popular cities when empty
    const popular = ['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Lucknow','Chandigarh','Bhopal','Patna','Kochi','Visakhapatnam','New Delhi'];
    results = ALL_CITIES_FLAT.filter(c=>popular.includes(c.city)).slice(0,16);
    dd.innerHTML = '<div class="city-group-label">Popular Cities</div>' +
      results.map((c,i)=>cityOptionHtml(c,i)).join('');
  } else {
    // Search: starts-with first, then contains
    const startsWith = ALL_CITIES_FLAT.filter(c=>c.city.toLowerCase().startsWith(q2));
    const contains   = ALL_CITIES_FLAT.filter(c=>!c.city.toLowerCase().startsWith(q2)&&c.label.toLowerCase().includes(q2));
    results = [...startsWith, ...contains].slice(0,20);

    if (!results.length) {
      dd.innerHTML = '<div class="city-no-results">No city found. You can type a custom location.</div>';
    } else {
      dd.innerHTML = `<div class="city-group-label">${results.length} result${results.length!==1?'s':''}</div>` +
        results.map((c,i)=>cityOptionHtml(c,i)).join('');
    }
  }

  dd.classList.remove('hidden');
}

function cityOptionHtml(c, i) {
  return `<div class="city-option" data-idx="${i}" onmousedown="selectCity('${c.label.replace(/'/g,"\\'")}')">
    <span>📍</span>
    <span>${c.city}</span>
    <span class="city-option-state">${c.state}</span>
  </div>`;
}

function selectCity(label) {
  const input = q('c_location');
  if (input) input.value = label;
  hideCityDropdown();
}

// Keyboard navigation in dropdown
q('c_location')?.addEventListener('keydown', e => {
  const dd = q('cityDropdown');
  if (!dd || dd.classList.contains('hidden')) return;
  const options = dd.querySelectorAll('.city-option');
  if (!options.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _cityHighlightIdx = Math.min(_cityHighlightIdx+1, options.length-1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _cityHighlightIdx = Math.max(_cityHighlightIdx-1, 0);
  } else if (e.key === 'Enter' && _cityHighlightIdx >= 0) {
    e.preventDefault();
    options[_cityHighlightIdx]?.dispatchEvent(new MouseEvent('mousedown'));
    return;
  } else if (e.key === 'Escape') {
    hideCityDropdown(); return;
  } else return;

  options.forEach((o,i)=>o.classList.toggle('highlighted', i===_cityHighlightIdx));
  options[_cityHighlightIdx]?.scrollIntoView({block:'nearest'});
});


// ── openChatContact — opens thread OR prompts video if no phone ───
function openChatContact(phone, contactId, hasPhone) {
  if (hasPhone && phone) {
    openChatThread(phone, contactId);
  } else {
    // No phone — offer video call directly
    const c = state.contacts.find(x=>x.id===contactId);
    if (!c) return;
    chatState.activeContact = c;
    chatState.activePhone   = null;
    // Show thread panel with video-only UI
    q('chatThreadAvatar').style.background = avatarColor(c.name);
    q('chatThreadAvatar').textContent = c.name.charAt(0).toUpperCase();
    q('chatThreadName').textContent   = c.name;
    q('chatThreadPhone').textContent  = '📹 Video / audio calls only (no phone number)';
    q('chatThreadEmpty').classList.add('hidden');
    q('chatThreadWrap').classList.remove('hidden');
    q('chatSidebar').classList.add('thread-open');
    q('chatMessages').innerHTML = `
      <div class="chat-system-msg" style="margin-top:auto;padding:1.5rem;text-align:center">
        <div style="font-size:2rem;margin-bottom:.75rem">📹</div>
        <div style="font-weight:600;font-size:.9rem;color:var(--text)">${c.name} has no phone number.</div>
        <div style="font-size:.82rem;color:var(--text-3);margin:.4rem 0 1rem">You can still start a video or audio call.</div>
        <div style="display:flex;gap:.75rem;justify-content:center">
          <button class="btn-primary-sm" onclick="startVideoCall()">📹 Video Call</button>
          <button class="btn-secondary-sm" onclick="startAudioCall()">📞 Audio Call</button>
        </div>
      </div>`;
    renderChatList();
  }
}

// ── quickVideoCall — start video call directly from contact list ──
function quickVideoCall(contactId) {
  const c = state.contacts.find(x=>x.id===contactId);
  if (!c) return;
  chatState.activeContact = c;
  startVideoCall();
}


// ── Video call diagnostic ─────────────────────────────────────────
async function diagnoseVideoCall() {
  const results = [];

  // 1. WebRTC support
  results.push({ test:'WebRTC (RTCPeerConnection)', ok: typeof RTCPeerConnection !== 'undefined' });

  // 2. getUserMedia support
  results.push({ test:'getUserMedia API', ok: !!(navigator.mediaDevices?.getUserMedia) });

  // 3. HTTPS or localhost
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  results.push({ test:'Secure context (HTTPS or localhost)', ok: isSecure });

  // 4. Camera permission
  try {
    const perm = await navigator.permissions.query({name:'camera'});
    results.push({ test:'Camera permission: ' + perm.state, ok: perm.state !== 'denied' });
  } catch(e) { results.push({ test:'Camera permission check', ok: false, note: e.message }); }

  // 5. Mic permission
  try {
    const perm = await navigator.permissions.query({name:'microphone'});
    results.push({ test:'Microphone permission: ' + perm.state, ok: perm.state !== 'denied' });
  } catch(e) { results.push({ test:'Mic permission check', ok: false, note: e.message }); }

  // 6. Actually try to get camera
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    results.push({ test:'Camera & mic access — SUCCESS', ok: true });
    stream.getTracks().forEach(t=>t.stop());
  } catch(err) {
    results.push({ test:'Camera & mic access — FAILED: ' + err.name, ok: false, note: err.message });
  }

  // Show results
  const lines = results.map(r => `${r.ok?'✅':'❌'} ${r.test}${r.note?' ('+r.note+')':''}`).join('\n');
  alert('Video Call Diagnostics:\n\n' + lines);
}


// ── Contact view toggle ───────────────────────────────────────────
function toggleContactView() {
  _contactViewMode = _contactViewMode === 'grid' ? 'list' : 'grid';
  const btn = q('contactViewToggle');
  if (btn) btn.textContent = _contactViewMode === 'grid' ? '⊞ Grid' : '☰ List';
  filterContacts();
}

// ── Customer 360 Drawer ───────────────────────────────────────────
function openC360(contactId) {
  _c360ContactId = contactId;
  const c = state.contacts.find(x=>x.id===contactId);
  if (!c) return;

  const overlay = q('customer360Overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  const color = avatarColor(c.name);
  q('c360DrawerAvatar').style.background = color;
  q('c360DrawerAvatar').textContent = c.name.charAt(0).toUpperCase();
  q('c360DrawerName').textContent   = c.name;
  q('c360DrawerSub').textContent    = [c.company, c.location].filter(Boolean).join(' · ');
  q('c360DrawerActions').innerHTML  = `
    <button class="c360-action" onclick="openEditDialog('contacts','${c.id}')">✏ Edit</button>
    <button class="c360-action" onclick="openTimeline('${c.id}')">📋 Timeline</button>
    <button class="c360-action" onclick="quickVideoCall('${c.id}')">📹 Call</button>`;

  switchC360Tab('overview', document.querySelector('.c360-tab'));
}

function closeC360() {
  const overlay = q('customer360Overlay');
  if (overlay) overlay.classList.add('hidden');
  _c360ContactId = null;
}

// Close drawer on overlay click
q('customer360Overlay')?.addEventListener('click', e => {
  if (e.target === q('customer360Overlay')) closeC360();
});

function switchC360Tab(tab, btn) {
  document.querySelectorAll('.c360-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const c = state.contacts.find(x=>x.id===_c360ContactId);
  if (!c) return;
  const body = q('c360DrawerBody');
  if (!body) return;

  const myLeads    = state.leads.filter(l=>l.contact_id===c.id);
  const myTickets  = state.tickets.filter(t=>t.contact_id===c.id);
  const myProjects = state.projects.filter(p=>p.contactId===c.id);
  const myActs     = state.activities.filter(a=>a.contactId===c.id);
  const myDocs     = state.documents.filter(d=>{ const p=state.projects.find(x=>x.id===d.projectId); return p?.contactId===c.id; });
  const h          = c._health || calcHealthScore(c.id);

  if (tab === 'overview') {
    const wonVal = myLeads.filter(l=>l.stage==='Won').reduce((s,l)=>s+(l.value||0),0);
    body.innerHTML = `
      <div class="c360-stat-row">
        <div class="c360-stat-card"><div class="c360-stat-card-val">${myLeads.length}</div><div class="c360-stat-card-label">Leads</div></div>
        <div class="c360-stat-card"><div class="c360-stat-card-val">${myTickets.filter(t=>t.status!=='Resolved').length}</div><div class="c360-stat-card-label">Open Tickets</div></div>
        <div class="c360-stat-card"><div class="c360-stat-card-val">${myProjects.length}</div><div class="c360-stat-card-label">Projects</div></div>
      </div>
      <div class="c360-info-grid">
        <div class="c360-info-item"><div class="c360-info-key">Email</div><div class="c360-info-val">${c.email}</div></div>
        <div class="c360-info-item"><div class="c360-info-key">Phone</div><div class="c360-info-val">${c.phone||'—'}</div></div>
        <div class="c360-info-item"><div class="c360-info-key">Company</div><div class="c360-info-val">${c.company||'—'}</div></div>
        <div class="c360-info-item"><div class="c360-info-key">Location</div><div class="c360-info-val">${c.location||'—'}</div></div>
        <div class="c360-info-item"><div class="c360-info-key">Age / Gender</div><div class="c360-info-val">${c.age||'—'} · ${c.gender||'—'}</div></div>
        <div class="c360-info-item"><div class="c360-info-key">Health Score</div><div class="c360-info-val"><span class="health-badge health-${h.grade}">${h.grade} ${h.score}/100</span></div></div>
      </div>
      ${myLeads.length?`<div class="c360-sub-title">Total Lead Value</div><div style="font-size:1.3rem;font-weight:800;font-family:var(--mono);color:var(--accent)">₹${fmtMoney(wonVal)} won</div>`:''}
    `;
  } else if (tab === 'activity') {
    const icons = {Call:'📞',Meeting:'🤝',Demo:'💻','Follow-up':'🔁',Email:'📧',Note:'📝',Chat:'💬'};
    body.innerHTML = myActs.length
      ? `<div class="c360-sub-title">${myActs.length} Activities</div>` +
        myActs.slice(0,15).map(a=>`<div class="c360-record-row"><span style="font-size:.9rem">${icons[a.type]||'📋'}</span><div style="flex:1"><strong>${a.type}</strong> — ${a.note.slice(0,70)}</div><span style="font-size:.7rem;color:var(--text-3)">${timeAgo(a.created_at||new Date().toISOString())}</span></div>`).join('')
      : '<p style="color:var(--text-3);font-size:.85rem;padding:.5rem">No activities logged yet.</p>';
  } else if (tab === 'deals') {
    body.innerHTML = myLeads.length
      ? `<div class="c360-sub-title">${myLeads.length} Leads</div>` +
        myLeads.map(l=>`<div class="c360-record-row"><span class="${badgeClass(l.stage)}">${l.stage}</span><span style="flex:1;margin-left:.5rem">${l.title}</span><span style="font-family:var(--mono);font-size:.8rem;color:var(--accent)">₹${fmtMoney(l.value)}</span></div>`).join('')
      : '<p style="color:var(--text-3);font-size:.85rem;padding:.5rem">No leads linked to this contact.</p>';
  } else if (tab === 'tickets') {
    body.innerHTML = myTickets.length
      ? `<div class="c360-sub-title">${myTickets.length} Tickets</div>` +
        myTickets.map(t=>`<div class="c360-record-row"><span class="${badgeClass(t.status)}">${t.status}</span><span style="flex:1;margin-left:.5rem">${t.title}</span><span class="${badgeClass(t.priority)}">${t.priority}</span></div>`).join('')
      : '<p style="color:var(--text-3);font-size:.85rem;padding:.5rem">No tickets linked to this contact.</p>';
  } else if (tab === 'docs') {
    body.innerHTML = myDocs.length
      ? `<div class="c360-sub-title">${myDocs.length} Documents</div>` +
        myDocs.map(d=>`<div class="c360-record-row"><span style="font-size:1.1rem">${fileIcon(d.name)}</span><span style="flex:1;font-size:.8rem">${d.name}</span><span style="font-size:.72rem;color:var(--text-3)">${fmtSize(d.size)}</span><button class="contact-card-action-btn" onclick="downloadDoc('${d.id}')">⬇</button></div>`).join('')
      : '<p style="color:var(--text-3);font-size:.85rem;padding:.5rem">No documents linked to this contact.</p>';
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
// Show login screen on load (hide main app until authenticated)
const _loginScreen = q('loginScreen');
if (_loginScreen) {
  // Check if there's a portal token — if so show portal directly
  const _portalParam = new URLSearchParams(window.location.search).get('portal');
  if (_portalParam) {
    _loginScreen.style.display = 'none';
    checkPortalToken();
  }
}
q('loginForm').addEventListener('submit', login);
checkLoginApiStatus();

renderSession();
renderAll();
checkSmtp();
q('dashDate').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
requestNotifPermission();
runNotifScan();
setInterval(runNotifScan, 5 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════
//  FEATURE 1: REPORTS & CSV/PDF EXPORT
// ══════════════════════════════════════════════════════════════════


// REPORT_CONFIG — hoisted

function switchReport(type) {
  _currentReport = type;
  document.querySelectorAll('.rtab').forEach(b=>b.classList.remove('active'));
  const btn = [...document.querySelectorAll('.rtab')].find(b=>b.textContent.toLowerCase().includes(REPORT_CONFIG[type].label.toLowerCase()));
  if (btn) btn.classList.add('active');
  renderReport();
}

function getReportData() {
  const cfg     = REPORT_CONFIG[_currentReport];
  const search  = (q('reportSearch')?.value||'').toLowerCase();
  const filters = {};
  cfg.filters.forEach(f => { const el = q(`rFilter_${f}`); if(el) filters[f] = el.value; });

  let data;
  if (_currentReport === 'pipeline') {
    const stages = ['New','Qualified','Proposal','Won','Lost'];
    const total  = state.leads.reduce((s,l)=>s+(l.value||0),0);
    data = stages.map(s => {
      const leads = state.leads.filter(l=>l.stage===s);
      const val   = leads.reduce((a,l)=>a+(l.value||0),0);
      return { _row: [s, leads.length, fmtMoney(val), leads.length?fmtMoney(Math.round(val/leads.length)):0, total?(val/total*100).toFixed(1)+'%':'0%'] };
    });
  } else {
    const source = {
      contacts: state.contacts, leads: state.leads, tickets: state.tickets,
      projects: state.projects, activities: state.activities,
    }[_currentReport] || [];
    data = source.filter(item => {
      const row = cfg.row(item).join(' ').toLowerCase();
      if (search && !row.includes(search)) return false;
      for (const [key, val] of Object.entries(filters)) {
        if (val && item[key] !== val) return false;
      }
      return true;
    });
  }
  return data;
}

function renderReport() {
  const cfg  = REPORT_CONFIG[_currentReport];
  const data = getReportData();

  // Summary cards
  const summaryEl = q('reportSummary');
  if (summaryEl) {
    const stats = cfg.summary();
    summaryEl.innerHTML = stats.map(s=>`
      <div class="report-stat">
        <div class="report-stat-val">${s.val}</div>
        <div class="report-stat-label">${s.label}</div>
      </div>`).join('');
  }

  // Dynamic filter dropdowns
  const filtersEl = q('reportFilters');
  if (filtersEl) {
    const filterOpts = {
      stage:    ['New','Qualified','Proposal','Won','Lost'],
      status:   ['Open','In Progress','Resolved','Planning','Active','On Hold','Completed'],
      priority: ['Low','Medium','High'],
      type:     ['Call','Meeting','Demo','Follow-up','Email','Note'],
    };
    filtersEl.innerHTML = cfg.filters.map(f=>`
      <select id="rFilter_${f}" class="filter-select" onchange="renderReport()">
        <option value="">All ${f.charAt(0).toUpperCase()+f.slice(1)}s</option>
        ${(filterOpts[f]||[]).map(o=>`<option>${o}</option>`).join('')}
      </select>`).join('');
  }

  // Table head
  const head = q('reportHead');
  const body = q('reportBody');
  const empty = q('reportEmpty');
  if (!head || !body) return;

  head.innerHTML = `<tr>${cfg.headers.map(h=>`<th>${h}</th>`).join('')}</tr>`;

  if (!data.length) {
    body.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  if (_currentReport === 'pipeline') {
    body.innerHTML = data.map(d=>`<tr>${d._row.map((v,i)=>`<td class="${i>=2?'money':''}">${v}</td>`).join('')}</tr>`).join('');
  } else {
    body.innerHTML = data.map(item=>{
      const row = cfg.row(item);
      return `<tr>${row.map((v,i)=>{
        if (_currentReport==='leads' && i===2) return `<td class="money">₹${v}</td>`;
        if (_currentReport==='projects' && i===5) return `<td class="money">₹${v}</td>`;
        if (v==='—'||v===''||v==='0') return `<td class="muted">${v||'—'}</td>`;
        // Badge for status/stage/priority cols
        if (i===1 && ['leads','tickets','projects'].includes(_currentReport)) return `<td><span class="${badgeClass(v)}">${v}</span></td>`;
        if (i===2 && _currentReport==='tickets') return `<td><span class="${badgeClass(v)}">${v}</span></td>`;
        return `<td>${v}</td>`;
      }).join('')}</tr>`;
    }).join('');
  }
}

// ── CSV Export ────────────────────────────────────────────────────
function toCSV(headers, rows) {
  const escape = v => `"${String(v).replace(/"/g,'""')}"`;
  return [headers.map(escape).join(','), ...rows.map(r=>r.map(escape).join(','))].join('\n');
}
function downloadCSV(filename, csv) {
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCurrentCSV() {
  const cfg  = REPORT_CONFIG[_currentReport];
  const data = getReportData();
  let rows;
  if (_currentReport === 'pipeline') rows = data.map(d=>d._row);
  else rows = data.map(item=>cfg.row(item));
  downloadCSV(`crm-${_currentReport}-${new Date().toISOString().slice(0,10)}.csv`, toCSV(cfg.headers, rows));
}

function exportAllCSV() {
  // Export all data types as separate CSV files in a zip-like sequence
  const exports = ['contacts','leads','tickets','projects','activities'];
  exports.forEach((type, i) => {
    setTimeout(() => {
      const cfg = REPORT_CONFIG[type];
      const source = {contacts:state.contacts,leads:state.leads,tickets:state.tickets,projects:state.projects,activities:state.activities}[type];
      const rows = source.map(item=>cfg.row(item));
      downloadCSV(`crm-${type}-${new Date().toISOString().slice(0,10)}.csv`, toCSV(cfg.headers,rows));
    }, i * 400);
  });
}

function exportCurrentPDF() {
  // Build a print-friendly HTML page and use window.print()
  const cfg  = REPORT_CONFIG[_currentReport];
  const data = getReportData();
  let rows;
  if (_currentReport === 'pipeline') rows = data.map(d=>d._row);
  else rows = data.map(item=>cfg.row(item));
  const stats = cfg.summary().map(s=>`<div class="stat"><strong>${s.val}</strong><span>${s.label}</span></div>`).join('');
  const tableRows = rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('');
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>CRM ${cfg.label} Report</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:2rem;color:#0f172a}
      h1{font-size:1.4rem;margin-bottom:.25rem}
      .meta{color:#64748b;font-size:.82rem;margin-bottom:1.5rem}
      .stats{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
      .stat{background:#f1f5f9;border-radius:8px;padding:.6rem 1rem}
      .stat strong{display:block;font-size:1.3rem;color:#2563eb}
      .stat span{font-size:.72rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
      table{width:100%;border-collapse:collapse;font-size:.82rem}
      th{background:#f1f5f9;padding:.5rem .75rem;text-align:left;font-weight:600;text-transform:uppercase;font-size:.7rem;letter-spacing:.05em}
      td{padding:.45rem .75rem;border-bottom:1px solid #e2e8f0}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>OrgCRM — ${cfg.label} Report</h1>
    <div class="meta">Generated ${new Date().toLocaleString('en-IN')} · ${rows.length} records</div>
    <div class="stats">${stats}</div>
    <table><thead><tr>${cfg.headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody></table>
    <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

function printReport() { exportCurrentPDF(); }

// ══════════════════════════════════════════════════════════════════
//  FEATURE 2: CONTACT TIMELINE
// ══════════════════════════════════════════════════════════════════

function openTimeline(contactId) {
  const c = state.contacts.find(x=>x.id===contactId);
  if (!c) return;

  // Header
  q('timelineHeader').innerHTML = `
    <div class="timeline-avatar-lg">${c.name.charAt(0).toUpperCase()}</div>
    <div>
      <div class="timeline-contact-name">${c.name}</div>
      <div class="timeline-contact-sub">${c.company||''} · ${c.email} · ${c.phone||'—'}</div>
    </div>`;

  // Build unified event list
  const events = [];

  // Contact creation
  events.push({ type:'contact', icon:'👤', title:'Contact created', body:`Added to CRM`, date: c.created_at||new Date().toISOString() });

  // Leads
  state.leads.filter(l=>l.contact_id===contactId).forEach(l=>{
    events.push({ type:'lead', icon:'🔥', title:`Lead: ${l.title}`, body:`Stage: ${l.stage} · Value: ₹${fmtMoney(l.value)}`, date: l.created_at||new Date().toISOString() });
  });

  // Tickets
  state.tickets.filter(t=>t.contact_id===contactId).forEach(t=>{
    events.push({ type:'ticket', icon:'🎫', title:`Ticket: ${t.title}`, body:`${t.priority} priority · ${t.status}`, date: t.created_at||new Date().toISOString() });
  });

  // Activities
  state.activities.filter(a=>a.contactId===contactId).forEach(a=>{
    const icons = {Call:'📞',Meeting:'🤝',Demo:'💻','Follow-up':'🔁',Email:'📧',Note:'📝'};
    events.push({ type:'activity', icon: icons[a.type]||'📋', title:`${a.type}`, body: a.note, date: a.created_at||new Date().toISOString() });
  });

  // Projects
  state.projects.filter(p=>p.contactId===contactId).forEach(p=>{
    events.push({ type:'project', icon:'📁', title:`Project: ${p.name}`, body:`${p.status} · ${p.progress||0}% complete · PM: ${p.manager}`, date: p.created_at||new Date().toISOString() });
  });

  // Documents
  state.documents.filter(d=>{
    const proj = d.projectId ? state.projects.find(p=>p.id===d.projectId) : null;
    return proj?.contactId===contactId;
  }).forEach(d=>{
    events.push({ type:'doc', icon:'📎', title:`Document: ${d.name}`, body:`${d.type} · ${fmtSize(d.size)} · uploaded by ${d.uploadedBy}`, date: d.uploadedAt||new Date().toISOString() });
  });

  // Sort newest first
  events.sort((a,b)=>new Date(b.date)-new Date(a.date));

  if (!events.length) {
    q('timelineBody').innerHTML = `<div class="timeline-empty">No interactions recorded yet for this contact.</div>`;
  } else {
    q('timelineBody').innerHTML = `
      <div style="font-size:.75rem;color:var(--text-3);margin-bottom:.75rem">${events.length} events</div>
      <div class="timeline-feed">
        ${events.map(ev=>`
          <div class="timeline-event type-${ev.type}">
            <div class="timeline-event-header">
              <span class="timeline-event-icon">${ev.icon}</span>
              <span class="timeline-event-title">${ev.title}</span>
              <span class="timeline-event-time">${timeAgo(ev.date)}</span>
            </div>
            <div class="timeline-event-body">${ev.body}</div>
          </div>`).join('')}
      </div>`;
  }
  openModal('timelineModal');
}

// ══════════════════════════════════════════════════════════════════
//  FEATURE 3: DRAG & DROP KANBAN
// ══════════════════════════════════════════════════════════════════


function kanbanDragStart(e, leadId) {
  _dragLeadId = leadId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', leadId);
}

function kanbanDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.kanban-cards').forEach(c=>c.classList.remove('drag-target'));
}

function kanbanDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Highlight the column
  const col = e.currentTarget;
  document.querySelectorAll('.kanban-cards').forEach(c=>c.classList.remove('drag-target'));
  col.classList.add('drag-target');
}

async function kanbanDrop(e, newStage) {
  e.preventDefault();
  document.querySelectorAll('.kanban-cards').forEach(c=>c.classList.remove('drag-target'));
  const leadId = _dragLeadId || e.dataTransfer.getData('text/plain');
  if (!leadId) return;

  const lead = state.leads.find(l=>l.id===leadId);
  if (!lead || lead.stage===newStage) return;

  const oldStage = lead.stage;

  // If dropping into Won or Lost, capture reason
  if ((newStage==='Won'||newStage==='Lost') && state.session) {
    const reason = prompt(`Moving to ${newStage}. Enter a reason (optional):`);
    // Log activity for the stage change
    state.activities.unshift({
      id: crypto.randomUUID(), created_at: new Date().toISOString(),
      type: 'Note', contactId: lead.contact_id||null,
      note: `Lead "${lead.title}" moved from ${oldStage} → ${newStage}${reason?': '+reason:''}`
    });
    persistLocal();
  }

  // Update via API
  if (state.session && can('leads.update')) {
    const ok = await apiUpdate('leads', leadId, { stage: newStage });
    if (ok) {
      lead.stage = newStage;
      const r = await apiFetch('/leads');
      if (r && r.ok) state.leads = await r.json();
    }
  } else {
    // Offline / read-only: still update locally for demo
    lead.stage = newStage;
  }

  renderSales();
  renderDashboard();
}

// ══════════════════════════════════════════════════════════════════
//  FEATURE 4: NOTIFICATIONS & REMINDERS
// ══════════════════════════════════════════════════════════════════

// State additions

function saveNotifState() {
  localStorage.setItem('crm_notifications', JSON.stringify(state.notifications));
  localStorage.setItem('crm_reminders',     JSON.stringify(state.reminders));
}

// ── Push a notification ───────────────────────────────────────────
function pushNotif(title, desc, icon='🔔', type='info') {
  const notif = {
    id:    crypto.randomUUID(),
    title, desc, icon, type,
    time:  new Date().toISOString(),
    read:  false,
  };
  state.notifications.unshift(notif);
  if (state.notifications.length > 50) state.notifications = state.notifications.slice(0, 50);
  saveNotifState();
  renderNotifBell();
  renderNotifPanel();
}

function renderNotifBell() {
  const unread = state.notifications.filter(n=>!n.read).length;
  const badge  = q('notifBadge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function toggleNotifPanel() {
  const panel = q('notifPanel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (isHidden) {
    // Mark all as read when opened
    state.notifications.forEach(n=>n.read=true);
    saveNotifState();
    renderNotifBell();
    renderNotifPanel();
  }
}

// Close panel when clicking outside
document.addEventListener('click', e => {
  const wrap = q('notifBellWrap');
  if (wrap && !wrap.contains(e.target)) q('notifPanel')?.classList.add('hidden');
});

function renderNotifPanel() {
  const list = q('notifList');
  if (!list) return;
  if (!state.notifications.length) {
    list.innerHTML = '<div class="notif-empty">No notifications</div>';
    return;
  }
  const typeIcons = { info:'ℹ️', warning:'⚠️', success:'✅', error:'❌', reminder:'⏰', renewal:'📅', health:'💊' };
  list.innerHTML = state.notifications.slice(0, 20).map(n => `
    <div class="notif-item ${n.read?'':'unread'}">
      <div class="notif-icon">${n.icon || typeIcons[n.type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-desc">${n.desc}</div>
        <div class="notif-time">${timeAgo(n.time)}</div>
      </div>
      <button class="notif-dismiss" onclick="dismissNotif('${n.id}')" title="Dismiss">✕</button>
    </div>`).join('');
}

function dismissNotif(id) {
  state.notifications = state.notifications.filter(n=>n.id!==id);
  saveNotifState();
  renderNotifBell();
  renderNotifPanel();
}

function clearAllNotifs() {
  state.notifications = [];
  saveNotifState();
  renderNotifBell();
  renderNotifPanel();
}

// ── Reminders ─────────────────────────────────────────────────────
function saveReminder() {
  const title = q('reminderTitle').value.trim();
  const dt    = q('reminderDateTime').value;
  if (!title) { alert('Reminder title is required.'); return; }
  if (!dt)    { alert('Date and time are required.'); return; }
  const reminder = {
    id:          crypto.randomUUID(),
    title,
    datetime:    dt,
    type:        q('reminderType').value,
    contactId:   q('reminderContact').value || null,
    notes:       q('reminderNotes').value.trim(),
    dismissed:   false,
    created_at:  new Date().toISOString(),
  };
  state.reminders.push(reminder);
  saveNotifState();
  ['reminderTitle','reminderDateTime','reminderNotes'].forEach(id=>{const el=q(id);if(el)el.value='';});
  q('reminderContact').value='';
  closeModal('reminderModal');
  renderReminders();
  pushNotif(`Reminder set: ${title}`, `Scheduled for ${new Date(dt).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`, '⏰', 'reminder');
}

function renderReminders() {
  const list = q('reminderList');
  if (!list) return;
  const now    = new Date();
  const active = state.reminders.filter(r=>!r.dismissed).sort((a,b)=>new Date(a.datetime)-new Date(b.datetime));

  if (!active.length) { list.innerHTML = '<div style="color:var(--text-3);font-size:.78rem;padding:.4rem">No active reminders.</div>'; return; }

  const typeIcons = { 'Follow-up':'🔁', 'Renewal':'📅', 'Meeting':'🤝', 'Task Deadline':'✅', 'Custom':'⏰' };
  list.innerHTML = active.map(r => {
    const dt       = new Date(r.datetime);
    const isOverdue = dt < now;
    const isToday   = dt.toDateString() === now.toDateString();
    const cls       = isOverdue ? 'overdue' : isToday ? 'today' : '';
    const contact   = r.contactId ? state.contacts.find(c=>c.id===r.contactId)?.name : null;
    return `
      <div class="reminder-item ${cls}">
        <span class="reminder-icon">${typeIcons[r.type]||'⏰'}</span>
        <div class="reminder-body">
          <div class="reminder-title">${r.title}</div>
          <div class="reminder-time">${dt.toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}${contact?' · '+contact:''}</div>
        </div>
        <button class="reminder-dismiss" onclick="dismissReminder('${r.id}')" title="Dismiss">✓</button>
      </div>`;
  }).join('');
}

function dismissReminder(id) {
  const r = state.reminders.find(r=>r.id===id);
  if (r) { r.dismissed=true; saveNotifState(); renderReminders(); }
}

// ── Automatic notification scanner ───────────────────────────────
function runNotifScan() {
  const now   = new Date();
  const in30d = new Date(Date.now() + 30*86400000);
  const in7d  = new Date(Date.now() + 7*86400000);

  // Renewals due in 30 days
  state.accounts.forEach(a => {
    if (!a.renewalDate || a._renewalNotifSent) return;
    const d = new Date(a.renewalDate);
    if (d >= now && d <= in30d) {
      const days = Math.ceil((d-now)/86400000);
      pushNotif(`Renewal Due: ${a.name}`, `${a.tier} account renewal in ${days} day${days!==1?'s':''}.`, '📅', 'renewal');
      a._renewalNotifSent = true;
      persistLocal();
    }
  });

  // Overdue tasks
  state.tasks.forEach(t => {
    if (!t.dueDate || t.status==='Done' || t._overdueNotifSent) return;
    const d = new Date(t.dueDate);
    if (d < now) {
      pushNotif(`Overdue Task`, `"${t.title}" was due ${fmtDate(t.dueDate)}.`, '⚠️', 'warning');
      t._overdueNotifSent = true;
      persistLocal();
    }
  });

  // Reminders firing now
  state.reminders.forEach(r => {
    if (r.dismissed || r._fired) return;
    const d = new Date(r.datetime);
    if (d <= now) {
      pushNotif(`Reminder: ${r.title}`, r.notes || r.type, '⏰', 'reminder');
      r._fired = true;
      saveNotifState();
      // Browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification(`OrgCRM: ${r.title}`, { body: r.notes||r.type, icon: '/favicon.ico' });
      }
    }
  });

  // High priority open tickets > 3
  const highOpen = state.tickets.filter(t=>t.priority==='High'&&t.status==='Open');
  if (highOpen.length >= 3 && !sessionStorage.getItem('highTicketNotifSent')) {
    pushNotif(`${highOpen.length} High Priority Tickets Open`, 'Review and resolve open high-priority tickets.', '🎫', 'warning');
    sessionStorage.setItem('highTicketNotifSent','1');
  }
}

// Request browser notification permission
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Sync reminder contact dropdown
function syncReminderDropdown() {
  const el = q('reminderContact');
  if (!el) return;
  el.innerHTML = '<option value="">— None —</option>' + state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
}


// ══════════════════════════════════════════════════════════════════
//  FEATURE 5: EMAIL TEMPLATES
// ══════════════════════════════════════════════════════════════════

if (!state.emailTemplates || !state.emailTemplates.length) {
  state.emailTemplates = [
  { id:'tpl_1', name:'Follow-up', subject:'Following up — {{name}}', body:'Hi {{name}},\n\nI wanted to follow up on our recent conversation. Hope everything is going well at {{company}}.\n\nPlease let me know if you have any questions.\n\nBest regards' },
  { id:'tpl_2', name:'Proposal', subject:'Proposal for {{company}}', body:'Dear {{name}},\n\nThank you for your interest. Please find our proposal attached.\n\nKey highlights:\n• Tailored solution for {{company}}\n• Competitive pricing\n• 30-day onboarding support\n\nLooking forward to your feedback.\n\nBest regards' },
  { id:'tpl_3', name:'Renewal Reminder', subject:'Your renewal is coming up — {{company}}', body:'Hi {{name}},\n\nThis is a friendly reminder that your account with us is due for renewal on {{renewal_date}}.\n\nTo ensure uninterrupted service, please reach out at your earliest convenience.\n\nThank you for being a valued customer.\n\nBest regards' },
  { id:'tpl_4', name:'Onboarding', subject:'Welcome to OrgCRM — Getting started', body:'Hi {{name}},\n\nWelcome! We are thrilled to have {{company}} on board.\n\nHere are your next steps:\n1. Complete your profile\n2. Add your team members\n3. Schedule your onboarding call\n\nReply to this email if you need any help.\n\nBest regards' },
  { id:'tpl_5', name:'Meeting Request', subject:'Meeting request — {{today}}', body:'Hi {{name}},\n\nI hope this message finds you well. I would love to schedule a quick call to discuss how we can support {{company}}.\n\nAre you available this week for a 30-minute call?\n\nBest regards' },
];;
}


function saveTemplateState() {
  localStorage.setItem('crm_templates', JSON.stringify(state.emailTemplates));
}

function renderTemplatePills() {
  const pills = q('templatePills');
  if (!pills) return;
  if (!state.emailTemplates?.length) { pills.innerHTML='<span style="color:var(--text-3);font-size:.75rem">No templates. Click ⚙ to add.</span>'; return; }
  pills.innerHTML = state.emailTemplates.map(t =>
    `<button class="template-pill" onclick="applyTemplate('${t.id}')">${t.name}</button>`
  ).join('');
}

function applyTemplate(id) {
  const tpl = state.emailTemplates.find(t=>t.id===id);
  if (!tpl) return;
  // Get first selected contact for merge fields
  const contact = state.contacts[0];
  const merge = v => v
    .replace(/\{\{name\}\}/g,          contact?.name        || '{{name}}')
    .replace(/\{\{company\}\}/g,        contact?.company     || '{{company}}')
    .replace(/\{\{email\}\}/g,          contact?.email       || '{{email}}')
    .replace(/\{\{renewal_date\}\}/g,   (() => {
      const acc = state.accounts.find(a=>a.name===contact?.company);
      return acc?.renewalDate ? fmtDate(acc.renewalDate) : '{{renewal_date}}';
    })())
    .replace(/\{\{today\}\}/g, new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}));
  q('mailSubject').value = merge(tpl.subject);
  q('mailBody').value    = merge(tpl.body);
  pushNotif(`Template applied: ${tpl.name}`, 'Review and personalise before sending.', '📨', 'info');
}

function insertMerge(field) {
  const ta = q('mailBody');
  if (!ta) return;
  const pos = ta.selectionStart;
  const val = ta.value;
  ta.value = val.slice(0, pos) + field + val.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = pos + field.length;
  ta.focus();
}

function renderTemplateManager() {
  const listEl = q('templateListPanel');
  if (!listEl) return;
  listEl.innerHTML = state.emailTemplates.map(t => `
    <div class="template-list-item ${_editingTemplateId===t.id?'active':''}" onclick="editTemplate('${t.id}')">
      <span>${t.name}</span>
      <button style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:.8rem" onclick="event.stopPropagation();deleteTemplate('${t.id}')">✕</button>
    </div>`).join('') +
    `<button class="template-list-add" onclick="newTemplate()">+ New Template</button>`;
}

function editTemplate(id) {
  _editingTemplateId = id;
  const tpl = state.emailTemplates.find(t=>t.id===id);
  if (!tpl) return;
  renderTemplateManager();
  const editPanel = q('templateEditForm');
  editPanel.innerHTML = `
    <label>Template Name<input id="tplName" value="${tpl.name}" placeholder="Template name" /></label>
    <label>Subject<input id="tplSubject" value="${tpl.subject}" placeholder="Email subject…" /></label>
    <label>Body<textarea id="tplBody" rows="8">${tpl.body}</textarea></label>
    <div style="display:flex;gap:.5rem;margin-top:.25rem">
      <button class="btn-modal-primary" onclick="saveTemplate()">Save Template</button>
      <button class="btn-modal-secondary" onclick="applyTemplate('${id}');closeModal('templateModal')">Use Now</button>
    </div>`;
  editPanel.className = 'template-edit-panel';
}

function newTemplate() {
  const id = `tpl_${crypto.randomUUID().slice(0,8)}`;
  state.emailTemplates.push({ id, name:'New Template', subject:'', body:'' });
  saveTemplateState();
  renderTemplateManager();
  editTemplate(id);
}

function saveTemplate() {
  const tpl = state.emailTemplates.find(t=>t.id===_editingTemplateId);
  if (!tpl) return;
  tpl.name    = q('tplName')?.value.trim()    || tpl.name;
  tpl.subject = q('tplSubject')?.value.trim() || '';
  tpl.body    = q('tplBody')?.value           || '';
  saveTemplateState();
  renderTemplatePills();
  renderTemplateManager();
  pushNotif(`Template saved: ${tpl.name}`, 'Your template is ready to use.', '📨', 'success');
}

function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  state.emailTemplates = state.emailTemplates.filter(t=>t.id!==id);
  if (_editingTemplateId===id) { _editingTemplateId=null; if(q('templateEditForm')) q('templateEditForm').innerHTML='<p style="color:var(--text-3)">Select a template.</p>'; }
  saveTemplateState();
  renderTemplatePills();
  renderTemplateManager();
}


// ══════════════════════════════════════════════════════════════════
//  FEATURE 6: CUSTOMER HEALTH SCORE
// ══════════════════════════════════════════════════════════════════

function calcHealthScore(contactId) {
  let score = 50; // baseline

  const leads    = state.leads.filter(l=>l.contact_id===contactId);
  const tickets  = state.tickets.filter(t=>t.contact_id===contactId);
  const acts     = state.activities.filter(a=>a.contactId===contactId);
  const projects = state.projects.filter(p=>p.contactId===contactId);
  const account  = state.contacts.find(c=>c.id===contactId);
  const now      = new Date();
  const in30d    = new Date(Date.now()+30*86400000);

  // Positive signals
  const wonLeads = leads.filter(l=>l.stage==='Won');
  score += wonLeads.length * 12;                                            // won deals
  score += Math.min(acts.length * 3, 20);                                  // engagement (capped)
  score += projects.filter(p=>p.status==='Completed').length * 8;          // completed projects
  score += projects.filter(p=>p.status==='Active').length * 4;             // active projects
  const recentActs = acts.filter(a=>a.created_at && new Date(a.created_at)>new Date(Date.now()-30*86400000));
  score += Math.min(recentActs.length * 5, 15);                            // recent activity

  // Negative signals
  const openHighTickets = tickets.filter(t=>t.status!=='Resolved'&&t.priority==='High');
  score -= openHighTickets.length * 12;                                     // unresolved high tickets
  score -= tickets.filter(t=>t.status==='Open').length * 4;                // open tickets
  const lostLeads = leads.filter(l=>l.stage==='Lost');
  score -= lostLeads.length * 8;                                            // lost deals

  // Renewal risk
  const linkedAccount = state.accounts.find(a=>a.name===account?.company);
  if (linkedAccount?.renewalDate) {
    const renDate = new Date(linkedAccount.renewalDate);
    if (renDate < now)  score -= 20;                                        // overdue renewal
    else if (renDate <= in30d) score -= 10;                                 // renewal soon
  }

  // No recent contact
  if (acts.length > 0) {
    const lastAct = new Date(Math.max(...acts.map(a=>new Date(a.created_at||0))));
    const daysSince = (now-lastAct)/86400000;
    if (daysSince > 90) score -= 15;
    else if (daysSince > 30) score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  let grade, color;
  if      (score >= 80) { grade='A'; color='#16a34a'; }
  else if (score >= 60) { grade='B'; color='#0d9488'; }
  else if (score >= 40) { grade='C'; color='#d97706'; }
  else                  { grade='D'; color='#e11d48'; }

  return { score, grade, color };
}

function renderHealthScores() {
  // Inject health score next to each contact record
  state.contacts.forEach(c => {
    const { score, grade, color } = calcHealthScore(c.id);
    c._health = { score, grade, color };
  });

  // Also notify if any contacts drop to D grade
  state.contacts.forEach(c => {
    if (c._health?.grade==='D' && !c._healthAlerted) {
      pushNotif(`Low Health Score: ${c.name}`, `Score dropped to ${c._health.score}/100 (Grade D). Review account.`, '💊', 'health');
      c._healthAlerted = true;
    }
  });
}

function getHealthBadge(contactId) {
  const h = state.contacts.find(c=>c.id===contactId)?._health;
  if (!h) return '';
  return `<span class="health-badge health-${h.grade}" title="Health Score: ${h.score}/100">${h.grade} ${h.score}</span>`;
}


// ══════════════════════════════════════════════════════════════════
//  FEATURE 7: BULK ACTIONS
// ══════════════════════════════════════════════════════════════════

// _bulkSelected — hoisted

function toggleBulkSelect(collection, id, checked) {
  if (checked) _bulkSelected[collection].add(id);
  else _bulkSelected[collection].delete(id);
  updateBulkBar(collection);
}

function toggleSelectAll(collection, checked) {
  const items = { contacts: state.contacts, leads: state.leads, tickets: state.tickets }[collection] || [];
  _bulkSelected[collection].clear();
  if (checked) items.forEach(i => _bulkSelected[collection].add(i.id));
  updateBulkBar(collection);
  // Re-render to update checkboxes
  if (collection === 'contacts') renderContactList(state.contacts);
  if (collection === 'leads') renderSales();
  if (collection === 'tickets') renderTickets();
}

function updateBulkBar(collection) {
  const count = _bulkSelected[collection].size;
  const barMap = { contacts:'bulkContactBar', leads:'bulkLeadBar', tickets:'bulkTicketBar' };
  const cntMap = { contacts:'bulkContactCount', leads:'bulkLeadCount', tickets:'bulkTicketCount' };
  const bar = q(barMap[collection]);
  const cnt = q(cntMap[collection]);
  if (!bar) return;
  if (count > 0) { bar.classList.remove('hidden'); if(cnt) cnt.textContent = `${count} selected`; }
  else bar.classList.add('hidden');
}

function clearBulkSelection(collection) {
  _bulkSelected[collection].clear();
  const allCb = q('selectAllContacts');
  if (allCb) allCb.checked = false;
  updateBulkBar(collection);
  if (collection === 'contacts') renderContactList(state.contacts);
  if (collection === 'leads') renderSales();
  if (collection === 'tickets') renderTickets();
}

// Bulk Email
function bulkEmail(collection) {
  const ids = [..._bulkSelected[collection]];
  if (!ids.length) return;
  const items = state[collection].filter(i => ids.includes(i.id));
  const emails = items.map(i => i.email || i.contact_email).filter(Boolean);
  q('bulkEmailCount').textContent = `Sending to ${ids.length} contacts (${emails.length} with email addresses).`;
  openModal('bulkEmailModal');
}

async function sendBulkEmail() {
  const ids = [..._bulkSelected.contacts];
  const contacts = state.contacts.filter(c => ids.includes(c.id));
  const subject = q('bulkEmailSubject').value.trim();
  const body    = q('bulkEmailBody').value.trim();
  const errEl   = q('bulkEmailError');
  const btn     = q('sendBulkBtn');
  if (!subject) { if(errEl) errEl.textContent='Subject is required.'; return; }
  if (!body)    { if(errEl) errEl.textContent='Message body is required.'; return; }
  if (errEl) errEl.textContent='';

  let sent = 0, failed = 0;
  if (btn) { btn.disabled=true; btn.textContent='Sending…'; }

  for (const contact of contacts) {
    if (!contact.email) continue;
    const personalised = {
      recipients: [contact.email],
      subject: subject.replace(/\{\{name\}\}/g, contact.name).replace(/\{\{company\}\}/g, contact.company||''),
      body: body.replace(/\{\{name\}\}/g, contact.name).replace(/\{\{company\}\}/g, contact.company||''),
    };
    try {
      const r = await fetch(`${SMTP_API}/api/send-email`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(personalised) });
      if (r.ok) sent++; else failed++;
    } catch { failed++; }
  }

  if (btn) { btn.disabled=false; btn.textContent='Send to All'; }
  closeModal('bulkEmailModal');
  pushNotif(`Bulk Email Sent`, `${sent} sent, ${failed} failed.`, '📧', sent>0?'success':'warning');
  clearBulkSelection('contacts');
}

// Bulk Export
function bulkExport(collection) {
  const ids = [..._bulkSelected[collection]];
  const items = state[collection].filter(i => ids.includes(i.id));
  const cfg = { contacts:{h:['Name','Email','Phone','Company','Location'],r:c=>[c.name,c.email,c.phone||'',c.company||'',c.location||'']}, leads:{h:['Title','Stage','Value'],r:l=>[l.title,l.stage,l.value]}, tickets:{h:['Title','Status','Priority'],r:t=>[t.title,t.status,t.priority]} }[collection];
  if (!cfg) return;
  const csv = [cfg.h, ...items.map(cfg.r)].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`crm-${collection}-export.csv`; a.click();
  pushNotif(`Exported ${items.length} ${collection}`, 'CSV file downloaded.', '⬇', 'success');
}

// Bulk Delete
async function bulkDelete(collection) {
  const ids = [..._bulkSelected[collection]];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} ${collection}? This cannot be undone.`)) return;
  if (['contacts','leads','tickets'].includes(collection) && state.session) {
    for (const id of ids) {
      await apiFetch(`/${collection}/${id}`, { method:'DELETE' });
    }
    const r = await apiFetch(`/${collection}`);
    if (r && r.ok) state[collection] = await r.json();
  } else {
    state[collection] = state[collection].filter(i => !ids.includes(i.id));
    persistLocal();
  }
  clearBulkSelection(collection);
  renderAll();
  pushNotif(`Deleted ${ids.length} ${collection}`, '', '🗑', 'info');
}

// Bulk stage change
function bulkUpdateStage() { openModal('bulkStageModal'); }

async function confirmBulkStage() {
  const ids = [..._bulkSelected.leads];
  const newStage = q('bulkNewStage').value;
  for (const id of ids) {
    const lead = state.leads.find(l=>l.id===id);
    if (lead && state.session && can('leads.update')) {
      await apiUpdate('leads', id, { stage: newStage });
      lead.stage = newStage;
    } else if (lead) { lead.stage = newStage; }
  }
  if (state.session) { const r=await apiFetch('/leads'); if(r&&r.ok) state.leads=await r.json(); }
  closeModal('bulkStageModal');
  clearBulkSelection('leads');
  renderAll();
  pushNotif(`${ids.length} leads moved to ${newStage}`, '', '🔄', 'success');
}

// Bulk resolve tickets
async function bulkResolveTickets() {
  const ids = [..._bulkSelected.tickets];
  for (const id of ids) {
    const t = state.tickets.find(x=>x.id===id);
    if (t && state.session && can('tickets.update')) {
      await apiUpdate('tickets', id, { status:'Resolved' });
      t.status = 'Resolved';
    } else if (t) t.status = 'Resolved';
  }
  if (state.session) { const r=await apiFetch('/tickets'); if(r&&r.ok) state.tickets=await r.json(); }
  clearBulkSelection('tickets');
  renderAll();
  pushNotif(`${ids.length} tickets resolved`, '', '✅', 'success');
}

// renderContactList is now fully implemented above with grid/list views


// ══════════════════════════════════════════════════════════════════
//  FEATURE 8: CALENDAR VIEW
// ══════════════════════════════════════════════════════════════════


function switchCalView(view) {
  _calView = view;
  document.querySelectorAll('.cal-view-btn').forEach(b=>b.classList.toggle('active', b.dataset.calview===view));
  renderCalendar();
}
function calNav(dir) {
  if (_calView === 'week') { _calWeekOffset = (_calWeekOffset||0) + dir; }
  else { _calMonth += dir; if (_calMonth>11){_calMonth=0;_calYear++;} if(_calMonth<0){_calMonth=11;_calYear--;} }
  renderCalendar();
}
function calToday() { _calYear=new Date().getFullYear(); _calMonth=new Date().getMonth(); _calWeekOffset=0; renderCalendar(); }

// Build unified event list for a date
function getCalEvents() {
  const events = [];
  const now = new Date();

  state.tasks.filter(t=>t.dueDate).forEach(t => events.push({ date:t.dueDate, title:t.title, type:'task', obj:t }));
  state.milestones.filter(m=>m.date).forEach(m => events.push({ date:m.date, title:m.name, type:'milestone', obj:m }));
  state.accounts.filter(a=>a.renewalDate).forEach(a => events.push({ date:a.renewalDate, title:`Renewal: ${a.name}`, type:'renewal', obj:a }));
  state.reminders.filter(r=>!r.dismissed&&r.datetime).forEach(r => events.push({ date:r.datetime.slice(0,10), title:r.title, type:'reminder', obj:r }));
  state.activities.filter(a=>a.created_at).forEach(a => events.push({ date:a.created_at.slice(0,10), title:`${a.type}: ${a.note.slice(0,30)}`, type:'activity', obj:a }));

  return events;
}

function renderCalendar() {
  const wrap = q('calendarWrap');
  if (!wrap) return;

  const label = q('calMonthLabel');
  const now   = new Date();
  const events = getCalEvents();

  if (_calView === 'month') {
    const firstDay = new Date(_calYear, _calMonth, 1);
    const lastDay  = new Date(_calYear, _calMonth+1, 0);
    if (label) label.textContent = firstDay.toLocaleString('en-IN',{month:'long',year:'numeric'});

    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html = `<div class="cal-grid">${days.map(d=>`<div class="cal-dow">${d}</div>`).join('')}`;

    // Pad start
    let d = new Date(firstDay);
    d.setDate(d.getDate() - d.getDay());

    for (let row=0; row<6; row++) {
      for (let col=0; col<7; col++) {
        const dateStr = d.toISOString().slice(0,10);
        const isThisMonth = d.getMonth()===_calMonth;
        const isToday = d.toDateString()===now.toDateString();
        const dayEvents = events.filter(e=>e.date===dateStr);

        html += `<div class="cal-cell${!isThisMonth?' other-month':''}${isToday?' today':''}">
          <div class="cal-day-num">${d.getDate()}</div>
          ${dayEvents.slice(0,3).map(e=>`<div class="cal-event cal-event-${e.type}" title="${e.title}">${e.title}</div>`).join('')}
          ${dayEvents.length>3?`<div class="cal-more">+${dayEvents.length-3} more</div>`:''}
        </div>`;
        d.setDate(d.getDate()+1);
      }
      if (d > lastDay && row >= 4) break;
    }
    html += '</div>';
    wrap.innerHTML = html;

  } else if (_calView === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + (_calWeekOffset*7));
    if (label) label.textContent = `Week of ${weekStart.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}`;

    const weekDays = Array.from({length:7},(_,i)=>{ const d=new Date(weekStart); d.setDate(d.getDate()+i); return d; });
    const hours    = Array.from({length:24},(_,i)=>i);

    let html = `<div class="cal-week-header">
      <div class="cal-week-dow" style="background:var(--bg)"></div>
      ${weekDays.map(d=>`<div class="cal-week-dow${d.toDateString()===now.toDateString()?' today-col':''}">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}<br><strong>${d.getDate()}</strong></div>`).join('')}
    </div><div class="cal-week-grid">`;

    hours.forEach(h => {
      html += `<div class="cal-hour-label">${h.toString().padStart(2,'0')}:00</div>`;
      weekDays.forEach(d => {
        const dateStr = d.toISOString().slice(0,10);
        const cellEvents = events.filter(e=>e.date===dateStr);
        html += `<div class="cal-hour-cell">${h===9?cellEvents.map(e=>`<div class="cal-event cal-event-${e.type}" style="font-size:.65rem">${e.title.slice(0,18)}</div>`).join(''):''}</div>`;
      });
    });
    html += '</div>';
    wrap.innerHTML = html;

  } else { // agenda
    if (label) label.textContent = 'Next 30 Days';
    const agendaEvents = {};
    const start = new Date(now);
    for (let i=0; i<30; i++) {
      const d = new Date(start); d.setDate(d.getDate()+i);
      const ds = d.toISOString().slice(0,10);
      const dayEv = events.filter(e=>e.date===ds);
      if (dayEv.length) agendaEvents[ds] = dayEv;
    }
    const typeColors = {task:'#2563eb',milestone:'#7c3aed',renewal:'#e11d48',reminder:'#d97706',activity:'#0d9488'};
    const entries = Object.entries(agendaEvents);
    let html = '<div class="cal-agenda">';
    if (!entries.length) { html += '<p style="color:var(--text-3);font-size:.9rem;padding:1rem">No events in the next 30 days.</p>'; }
    else entries.forEach(([ds, evts]) => {
      const d = new Date(ds);
      const isToday = d.toDateString()===now.toDateString();
      html += `<div class="cal-agenda-day">
        <div class="cal-agenda-date${isToday?' today-row':''}">
          ${isToday?'📍 Today — ':''}${d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}
        </div>
        <div class="cal-agenda-events">
          ${evts.map(e=>`<div class="cal-agenda-event">
            <div class="cal-agenda-dot" style="background:${typeColors[e.type]}"></div>
            <span class="cal-agenda-title">${e.title}</span>
            <span class="cal-agenda-badge">${e.type}</span>
          </div>`).join('')}
        </div>
      </div>`;
    });
    html += '</div>';
    wrap.innerHTML = html;
  }
}


// ══════════════════════════════════════════════════════════════════
//  FEATURE 9: CUSTOMER PORTAL
// ══════════════════════════════════════════════════════════════════

function savePortalState() {
  localStorage.setItem('crm_portal_sessions', JSON.stringify(state.portalSessions));
  localStorage.setItem('crm_portal_settings', JSON.stringify(state.portalSettings));
}

function savePortalSettings() {
  state.portalSettings.showProjects = q('ptShowProjects')?.checked;
  state.portalSettings.showTickets  = q('ptShowTickets')?.checked;
  state.portalSettings.showDocs     = q('ptShowDocs')?.checked;
  state.portalSettings.showActivity = q('ptShowActivity')?.checked;
  savePortalState();
}

function renderPortalAdmin() {
  // Sync portal contact dropdown
  const sel = q('portalContactSelect');
  if (sel) sel.innerHTML = '<option value="">— Select —</option>' + state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

  // Load settings toggles
  if (q('ptShowProjects')) q('ptShowProjects').checked = state.portalSettings.showProjects !== false;
  if (q('ptShowTickets'))  q('ptShowTickets').checked  = state.portalSettings.showTickets  !== false;
  if (q('ptShowDocs'))     q('ptShowDocs').checked     = state.portalSettings.showDocs     !== false;
  if (q('ptShowActivity')) q('ptShowActivity').checked = state.portalSettings.showActivity === true;

  // Session list
  const list = q('portalSessionList');
  if (!list) return;
  const active = state.portalSessions.filter(s=>new Date(s.expiresAt)>new Date());
  if (!active.length) { list.innerHTML='<div style="color:var(--text-3);font-size:.82rem;padding:.5rem">No active portal sessions. Generate a link to give a customer access.</div>'; return; }
  list.innerHTML = active.map(s => {
    const c = state.contacts.find(x=>x.id===s.contactId);
    const exp = new Date(s.expiresAt);
    const days = Math.ceil((exp-new Date())/86400000);
    return `<div class="portal-session-item">
      <div class="portal-session-avatar">${c?.name?.charAt(0)||'?'}</div>
      <div class="portal-session-info">
        <div class="portal-session-name">${c?.name||'Unknown'}</div>
        <div class="portal-session-sub">Expires in ${days} day${days!==1?'s':''} · Token: ${s.token.slice(0,8)}…</div>
      </div>
      <div class="portal-session-actions">
        <button class="btn-secondary-sm" style="font-size:.72rem" onclick="openPortal('${s.token}')">👁 Preview</button>
        <button class="btn-secondary-sm" style="font-size:.72rem;color:var(--rose)" onclick="revokePortal('${s.token}')">Revoke</button>
      </div>
    </div>`;
  }).join('');
}

function generatePortalLink() {
  const contactId = q('portalContactSelect')?.value;
  const expiryDays = Number(q('portalExpiry')?.value || 30);
  if (!contactId) { alert('Please select a contact.'); return; }
  const token     = btoa(`${contactId}:${Date.now()}:${Math.random().toString(36).slice(2)}`).replace(/=/g,'');
  const expiresAt = new Date(Date.now() + expiryDays*86400000).toISOString();
  const session   = { token, contactId, expiresAt, createdAt: new Date().toISOString() };
  state.portalSessions.push(session);
  savePortalState();

  const url = `${window.location.origin}${window.location.pathname}?portal=${token}`;
  const input = q('portalLinkUrl');
  if (input) input.value = url;
  q('portalLinkResult')?.classList.remove('hidden');
  renderPortalAdmin();
  pushNotif('Portal link generated', `Shared with ${state.contacts.find(c=>c.id===contactId)?.name||'contact'} · expires in ${expiryDays}d`, '🔗', 'success');
}

function copyPortalLink() {
  const input = q('portalLinkUrl');
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(()=>pushNotif('Link copied!','Portal URL copied to clipboard.','📋','success'));
}

function revokePortal(token) {
  if (!confirm('Revoke this portal session?')) return;
  state.portalSessions = state.portalSessions.filter(s=>s.token!==token);
  savePortalState();
  renderPortalAdmin();
  pushNotif('Portal session revoked','Customer no longer has access.','🔒','info');
}

function openPortal(token) {
  const session = state.portalSessions.find(s=>s.token===token);
  if (!session || new Date(session.expiresAt)<new Date()) { alert('Session expired or invalid.'); return; }
  renderPortalView(session.contactId);
}

function renderPortalView(contactId) {
  const c   = state.contacts.find(x=>x.id===contactId);
  if (!c) return;
  const ps  = state.portalSettings;
  const tickets  = state.tickets.filter(t=>t.contact_id===contactId);
  const projects = state.projects.filter(p=>p.contactId===contactId);
  const docs     = state.documents.filter(d=>d.projectId && state.projects.find(p=>p.id===d.projectId&&p.contactId===contactId));
  const acts     = state.activities.filter(a=>a.contactId===contactId);

  const projectsHTML = ps.showProjects !== false ? `
    <div class="portal-section">
      <div class="portal-section-title">📁 Your Projects</div>
      ${projects.length ? projects.map(p=>`
        <div style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid #f1f5f9">
          <div style="flex:1">
            <div style="font-weight:600;font-size:.85rem">${p.name}</div>
            <div style="font-size:.75rem;color:#64748b">${p.manager} · Due: ${fmtDate(p.dueDate)}</div>
          </div>
          <span class="${badgeClass(p.status)}">${p.status}</span>
          <div style="width:80px">
            <div style="background:#f1f5f9;border-radius:999px;height:6px"><div style="width:${p.progress||0}%;background:#2563eb;height:100%;border-radius:999px"></div></div>
            <div style="font-size:.68rem;color:#94a3b8;text-align:right">${p.progress||0}%</div>
          </div>
        </div>`).join('')
      : '<p style="color:#94a3b8;font-size:.82rem">No active projects.</p>'}
    </div>` : '';

  const ticketsHTML = ps.showTickets !== false ? `
    <div class="portal-section">
      <div class="portal-section-title">🎫 Your Support Tickets</div>
      ${tickets.length ? tickets.map(t=>`
        <div style="display:flex;align-items:center;gap:.75rem;padding:.45rem 0;border-bottom:1px solid #f1f5f9">
          <div style="flex:1;font-size:.83rem;font-weight:500">${t.title}</div>
          <span class="${badgeClass(t.priority)}">${t.priority}</span>
          <span class="${badgeClass(t.status)}">${t.status}</span>
        </div>`).join('')
      : '<p style="color:#94a3b8;font-size:.82rem">No support tickets.</p>'}
    </div>` : '';

  const docsHTML = ps.showDocs !== false ? `
    <div class="portal-section">
      <div class="portal-section-title">📎 Shared Documents</div>
      ${docs.length ? docs.map(d=>`
        <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:1.1rem">${fileIcon(d.name)}</span>
          <div style="flex:1;font-size:.82rem;font-weight:500">${d.name}</div>
          <span style="font-size:.72rem;color:#94a3b8">${fmtSize(d.size)}</span>
          <button style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:.72rem;padding:2px 8px;border-radius:5px;cursor:pointer" onclick="downloadDoc('${d.id}')">⬇</button>
        </div>`).join('')
      : '<p style="color:#94a3b8;font-size:.82rem">No documents shared.</p>'}
    </div>` : '';

  const actHTML = ps.showActivity ? `
    <div class="portal-section">
      <div class="portal-section-title">📋 Recent Activities</div>
      ${acts.slice(0,5).map(a=>`<div style="font-size:.8rem;padding:.3rem 0;border-bottom:1px solid #f1f5f9"><strong>${a.type}</strong> — ${a.note.slice(0,80)}</div>`).join('')||'<p style="color:#94a3b8;font-size:.82rem">No activity yet.</p>'}
    </div>` : '';

  const portalHTML = `
    <div class="customer-portal-view" id="portalView">
      <div class="portal-topbar">
        <div class="portal-brand">🏢 OrgCRM Customer Portal</div>
        <div class="portal-customer-name">Welcome, ${c.name}</div>
        <button class="portal-close-btn" onclick="closePortal()">✕ Close</button>
      </div>
      <div class="portal-body">
        <div class="portal-section" style="background:linear-gradient(135deg,#eff6ff,#f0fdf4)">
          <div style="display:flex;align-items:center;gap:1rem">
            <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem">${c.name.charAt(0)}</div>
            <div>
              <div style="font-size:1.1rem;font-weight:800">${c.name}</div>
              <div style="font-size:.82rem;color:#475569">${c.company||''} · ${c.email}</div>
            </div>
          </div>
        </div>
        ${projectsHTML}${ticketsHTML}${docsHTML}${actHTML}
        <div style="text-align:center;padding:1rem;font-size:.75rem;color:#94a3b8">
          Powered by OrgCRM · Read-only view · Data refreshed in real-time
        </div>
      </div>
    </div>`;

  const div = document.createElement('div');
  div.id = 'portalOverlay';
  div.innerHTML = portalHTML;
  document.body.appendChild(div);
}

function closePortal() {
  const el = document.getElementById('portalOverlay');
  if (el) el.remove();
}

// Check URL for portal token on load
function checkPortalToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('portal');
  if (!token) return;
  const session = state.portalSessions.find(s=>s.token===token);
  if (session && new Date(session.expiresAt)>new Date()) {
    // Show portal view fullscreen
    setTimeout(()=>renderPortalView(session.contactId), 300);
  }
}


// ══════════════════════════════════════════════════════════════════
//  CHAT MESSENGER
//  Contact-phone-number based internal messaging
// ══════════════════════════════════════════════════════════════════

// chatState declared at top of file

// QUICK_REPLIES — hoisted

// AVATAR_COLORS — hoisted
function avatarColor(name) { let h=0; for(const c of name||'') h=(h*31+c.charCodeAt(0))%AVATAR_COLORS.length; return AVATAR_COLORS[h]; }

function saveChatState() {
  localStorage.setItem('crm_chat_threads', JSON.stringify(chatState.threads));
}

// ── Normalise phone number (use as thread key) ────────────────────
function normalisePhone(phone) {
  return (phone||'').replace(/\D/g,'').slice(-10); // last 10 digits
}

// ── Open / Close ──────────────────────────────────────────────────
function toggleChat() {
  const panel = q('chatMessenger');
  if (!panel) { console.warn('chatMessenger not found'); return; }
  chatState.open = !chatState.open;
  if (chatState.open) {
    panel.classList.remove('hidden');
    panel.style.display = 'flex';
    setTimeout(()=>{ renderChatList(); updateChatBadge(); }, 10);
  } else {
    panel.classList.add('hidden');
    panel.style.display = 'none';
  }
}

function toggleChatFullscreen() {
  chatState.fullscreen = !chatState.fullscreen;
  q('chatMessenger').classList.toggle('fullscreen', chatState.fullscreen);
  q('chatExpandBtn').textContent = chatState.fullscreen ? '⛶' : '⛶';
}

// Close chat when clicking outside
document.addEventListener('click', e => {
  const panel = q('chatMessenger');
  const btn   = q('chatToggleBtn');
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target) && chatState.open) {
    // Don't close on click inside
  }
});

// ── Filter tabs ───────────────────────────────────────────────────
function setChatFilter(filter, el) {
  chatState.filter = filter;
  document.querySelectorAll('.chat-filter-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderChatList();
}

// ── Render contact list ───────────────────────────────────────────
function renderChatList() {
  const search = (q('chatSearch')?.value||'').toLowerCase();
  let contacts = [...state.contacts];

  // Apply filter
  if (chatState.filter === 'phone')  contacts = contacts.filter(c=>c.phone);
  if (chatState.filter === 'unread') contacts = contacts.filter(c=>{
    const ph = normalisePhone(c.phone);
    const thread = chatState.threads[ph];
    if (!thread?.messages?.length) return false;
    const lastRead = thread.lastRead||0;
    return thread.messages.some(m=>m.direction==='received'&&new Date(m.time)>new Date(lastRead));
  });

  // Search
  if (search) contacts = contacts.filter(c=>c.name.toLowerCase().includes(search)||(c.phone||'').includes(search));

  // Sort: contacts with recent messages first
  contacts.sort((a,b)=>{
    const tA = chatState.threads[normalisePhone(a.phone)]?.messages?.slice(-1)[0]?.time||'';
    const tB = chatState.threads[normalisePhone(b.phone)]?.messages?.slice(-1)[0]?.time||'';
    if (tA||tB) return tB.localeCompare(tA);
    return a.name.localeCompare(b.name);
  });

  const listEl = q('chatContactList');
  const countEl = q('chatContactCountLabel');
  if (countEl) countEl.textContent = `${contacts.length} contacts`;

  if (!contacts.length) {
    listEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-3);font-size:.8rem">${search?'No contacts found.':'No contacts in CRM yet.'}</div>`;
    return;
  }

  listEl.innerHTML = contacts.map(c => {
    const ph       = normalisePhone(c.phone);
    const hasPhone = Boolean(c.phone);
    const thread   = chatState.threads[ph] || { messages: [] };
    const lastMsg  = thread.messages[thread.messages.length-1];
    const lastRead = thread.lastRead||0;
    const unread   = thread.messages.filter(m=>m.direction==='received'&&new Date(m.time)>new Date(lastRead)).length;
    const isActive = chatState.activePhone === ph;
    const preview  = lastMsg ? (lastMsg.direction==='sent'?'You: ':'')+lastMsg.text.slice(0,35) : (hasPhone?'Tap to start chatting':'No phone — video call only');
    const timeStr  = lastMsg ? formatChatTime(lastMsg.time) : '';
    const color    = avatarColor(c.name);

    return `<div class="chat-contact-item${isActive?' active':''}"
      onclick="openChatContact('${ph}','${c.id}',${hasPhone})"
      title="${!hasPhone?'No phone — click for video call':''}">
      <div class="chat-contact-avatar" style="background:${color}">${c.name.charAt(0).toUpperCase()}</div>
      <div class="chat-contact-info">
        <div class="chat-contact-name">${c.name}</div>
        <div class="chat-contact-preview">${preview}</div>
      </div>
      <div class="chat-contact-meta">
        ${timeStr?`<span class="chat-contact-time">${timeStr}</span>`:''}
        ${unread?`<span class="chat-unread-dot">${unread}</span>`:''}
        <button class="chat-video-direct-btn" onclick="event.stopPropagation();quickVideoCall('${c.id}')" title="Video Call">📹</button>
      </div>
    </div>`;
  }).join('');
}

// ── Open thread ───────────────────────────────────────────────────
function openChatThread(phone, contactId) {
  chatState.activePhone   = phone;
  chatState.activeContact = state.contacts.find(c=>c.id===contactId);

  // Mark read
  if (!chatState.threads[phone]) chatState.threads[phone] = { messages: [] };
  chatState.threads[phone].lastRead = new Date().toISOString();
  saveChatState();

  const contact = chatState.activeContact;
  const color   = avatarColor(contact?.name||'');

  // Update thread header
  q('chatThreadAvatar').style.background = color;
  q('chatThreadAvatar').textContent = (contact?.name||'?').charAt(0).toUpperCase();
  q('chatThreadName').textContent   = contact?.name || 'Unknown';
  q('chatThreadPhone').textContent  = `📱 ${contact?.phone||phone} · ${contact?.company||''}`;
  // chatCallBtn removed — video/audio buttons handle calling directly

  // Show thread panel
  q('chatThreadEmpty').classList.add('hidden');
  q('chatThreadWrap').classList.remove('hidden');

  // Mobile: hide sidebar
  q('chatSidebar').classList.add('thread-open');

  renderMessages();
  renderChatList();
  updateChatBadge();

  // Focus input
  setTimeout(()=>q('chatInput')?.focus(), 100);
}

function closeChatThread() {
  chatState.activePhone   = null;
  chatState.activeContact = null;
  q('chatThreadEmpty').classList.remove('hidden');
  q('chatThreadWrap').classList.add('hidden');
  q('chatSidebar').classList.remove('thread-open');
  renderChatList();
}

// ── Render messages ───────────────────────────────────────────────
function renderMessages() {
  const thread  = chatState.threads[chatState.activePhone] || { messages: [] };
  const msgsEl  = q('chatMessages');
  if (!msgsEl) return;

  if (!thread.messages.length) {
    msgsEl.innerHTML = `
      <div class="chat-system-msg" style="margin-top:auto">
        This is the beginning of your conversation with <strong>${chatState.activeContact?.name||''}</strong>.
      </div>
      <div class="chat-system-msg" style="font-size:.7rem;color:var(--text-3)">
        📱 ${chatState.activeContact?.phone||''} · Messages are stored locally on this device.
      </div>`;
    return;
  }

  // Group messages by date, then by sender
  let html = '';
  let lastDate = '';
  let lastDir  = '';
  let groupOpen = false;

  thread.messages.forEach((msg, i) => {
    const msgDate = new Date(msg.time).toDateString();
    const today   = new Date().toDateString();
    const yesterday = new Date(Date.now()-86400000).toDateString();

    // Date divider
    if (msgDate !== lastDate) {
      if (groupOpen) { html += '</div>'; groupOpen=false; }
      const label = msgDate===today?'Today':msgDate===yesterday?'Yesterday':new Date(msg.time).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
      html += `<div class="chat-date-divider"><span>${label}</span></div>`;
      lastDate = msgDate;
      lastDir  = '';
    }

    // New group if direction changes
    if (msg.direction !== lastDir) {
      if (groupOpen) { html += '</div>'; }
      html += `<div class="chat-msg-group ${msg.direction}">`;
      groupOpen = true;
      lastDir = msg.direction;
    }

    // Note vs regular message
    if (msg.type === 'note') {
      if (groupOpen) { html += '</div>'; groupOpen=false; lastDir=''; }
      html += `<div class="chat-msg-note"><div class="chat-msg-note-label">📌 Internal Note</div>${escapeHtml(msg.text)}<div style="font-size:.65rem;opacity:.6;margin-top:4px;text-align:right">${formatChatTime(msg.time)} · ${msg.sender||'You'}</div></div>`;
      return;
    }

    // Regular bubble
    const tick = msg.direction==='sent' ? `<span class="chat-bubble-tick read">✓✓</span>` : '';
    html += `<div class="chat-bubble">
      ${escapeHtml(msg.text)}
      <div class="chat-bubble-meta">
        <span class="chat-bubble-time">${formatChatTime(msg.time)}</span>
        ${tick}
      </div>
    </div>`;
  });

  if (groupOpen) html += '</div>';
  msgsEl.innerHTML = html;

  // Scroll to bottom
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ── Send message ──────────────────────────────────────────────────
function sendChatMessage() {
  const input = q('chatInput');
  const text  = input?.value.trim();
  if (!text || !chatState.activePhone) return;

  const msg = {
    id:        crypto.randomUUID(),
    text,
    direction: 'sent',
    type:      'text',
    time:      new Date().toISOString(),
    sender:    state.session?.name || 'You',
  };

  if (!chatState.threads[chatState.activePhone]) chatState.threads[chatState.activePhone] = { messages: [] };
  chatState.threads[chatState.activePhone].messages.push(msg);
  saveChatState();

  input.value = '';
  input.style.height = 'auto';
  renderMessages();
  renderChatList();

  // Also log as CRM activity
  state.activities.unshift({
    id:          crypto.randomUUID(),
    created_at:  msg.time,
    type:        'Chat',
    note:        `[Chat to ${chatState.activeContact?.name||''}]: ${text.slice(0,100)}`,
    contactId:   chatState.activeContact?.id || null,
  });
  persistLocal();

  // Simulate delivery tick update (cosmetic)
  setTimeout(renderMessages, 800);
}

// Simulate receiving a message (for demo — in prod this would be webhook/websocket)
function simulateReceive(text) {
  if (!chatState.activePhone) return;
  const msg = {
    id:        crypto.randomUUID(),
    text,
    direction: 'received',
    type:      'text',
    time:      new Date().toISOString(),
    sender:    chatState.activeContact?.name || 'Contact',
  };
  chatState.threads[chatState.activePhone].messages.push(msg);
  saveChatState();
  renderMessages();
  renderChatList();
  updateChatBadge();

  // Push notification
  pushNotif(
    `Message from ${msg.sender}`,
    text.slice(0, 60),
    '💬', 'info'
  );
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
}

function autoResizeChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

// ── Attach note ───────────────────────────────────────────────────
function attachNote() {
  const text = prompt('Add an internal note to this conversation:');
  if (!text?.trim() || !chatState.activePhone) return;
  const msg = { id:crypto.randomUUID(), text:text.trim(), direction:'sent', type:'note', time:new Date().toISOString(), sender:state.session?.name||'You' };
  chatState.threads[chatState.activePhone].messages.push(msg);
  saveChatState();
  renderMessages();
}

// ── Quick replies ─────────────────────────────────────────────────
function insertQuickReply() {
  const panel = q('quickRepliesPanel');
  panel.classList.toggle('hidden');
  const list = q('quickRepliesList');
  list.innerHTML = QUICK_REPLIES.map((r,i)=>`<button class="quick-reply-chip" onclick="useQuickReply(${i})">${r.slice(0,50)}${r.length>50?'…':''}</button>`).join('');
}

function useQuickReply(idx) {
  const input = q('chatInput');
  if (input) { input.value = QUICK_REPLIES[idx]; input.focus(); }
  q('quickRepliesPanel').classList.add('hidden');
}

// ── Clear thread ──────────────────────────────────────────────────
function clearThread() {
  if (!chatState.activePhone || !confirm('Clear all messages in this conversation?')) return;
  chatState.threads[chatState.activePhone] = { messages: [], lastRead: new Date().toISOString() };
  saveChatState();
  renderMessages();
  renderChatList();
}

// ── Call contact ──────────────────────────────────────────────────
function callContact(phone) {
  const p = phone || chatState.activeContact?.phone;
  if (p) window.open(`tel:${p}`);
}

// ── Badge ─────────────────────────────────────────────────────────
function updateChatBadge() {
  let total = 0;
  state.contacts.forEach(c => {
    const ph = normalisePhone(c.phone);
    if (!ph) return;
    const thread   = chatState.threads[ph];
    if (!thread?.messages?.length) return;
    const lastRead = thread.lastRead||0;
    total += thread.messages.filter(m=>m.direction==='received'&&new Date(m.time)>new Date(lastRead)).length;
  });
  const badge = q('chatUnreadBadge');
  if (!badge) return;
  if (total > 0) { badge.textContent = total>9?'9+':total; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────────────
function formatChatTime(iso) {
  const d   = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now-d)/86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ── Init on renderAll ─────────────────────────────────────────────
function initChat() {
  updateChatBadge();
  if (chatState.open) renderChatList();
}


// ══════════════════════════════════════════════════════════════════
//  CHAT MESSENGER — ENHANCED FEATURES
// ══════════════════════════════════════════════════════════════════

// ── Emoji Picker ──────────────────────────────────────────────────
const EMOJI_DATA = {
  'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿'],
  'Hands': ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','👶','🧒','👦','👧','🧑','👱'],
  'Nature': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐'],
  'Food': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥙','🥪','🌮','🌯','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧆','🥜','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜'],
  'Travel': ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍','🛵','🛺','🚲','🛴','🛹','🛼','🚏','🛣','🛤','⛽','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🚤','🛥','🛳','⛴','🚢','✈️','🛩','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰','🚀','🛸','🌍','🌎','🌏','🧭','🗺','🌋','🏔','⛰','🏕','🏖','🏜','🏝','🏟','🏛','🏗','🏘','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭'],
  'Symbols': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔠','🔡','🔢','🔣','🔤','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🔱','♻️','✅','🆚','💹','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈹','🈲','🅰️'],
};

const EMOJI_FLAT = Object.values(EMOJI_DATA).flat();

function toggleEmojiPicker() {
  const picker = q('emojiPicker');
  if (!picker) return;
  const isHidden = picker.classList.contains('hidden');
  picker.classList.toggle('hidden');
  if (isHidden) {
    renderEmojiGrid('');
    setTimeout(()=>q('emojiSearch')?.focus(), 50);
  }
}

function renderEmojiGrid(filter) {
  const grid = q('emojiGrid');
  if (!grid) return;
  const emojis = filter
    ? EMOJI_FLAT.filter(e=>e.includes(filter)).slice(0,64)
    : EMOJI_FLAT.slice(0,96);
  grid.innerHTML = emojis.map(e=>
    `<button class="emoji-btn" onclick="insertEmoji('${e}')" title="${e}">${e}</button>`
  ).join('');
}

function filterEmoji(val) { renderEmojiGrid(val); }

function insertEmoji(emoji) {
  const input = q('chatInput');
  if (!input) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0,pos) + emoji + input.value.slice(input.selectionEnd);
  input.selectionStart = input.selectionEnd = pos + emoji.length;
  input.focus();
  q('emojiPicker')?.classList.add('hidden');
}

// Close emoji picker on outside click
document.addEventListener('click', e => {
  const picker = q('emojiPicker');
  const btn    = q('emojiBtn');
  if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target))
    picker.classList.add('hidden');
});

// ── Message Search ────────────────────────────────────────────────

function toggleChatSearch() {
  const bar = q('chatSearchBar');
  if (!bar) return;
  _searchActive = !bar.classList.contains('hidden');
  if (!_searchActive) {
    bar.classList.remove('hidden');
    setTimeout(()=>q('chatSearchInput')?.focus(), 50);
  } else {
    bar.classList.add('hidden');
    q('chatSearchInput').value = '';
    searchChatMessages('');
  }
}

function searchChatMessages(query) {
  const messagesEl = q('chatMessages');
  if (!messagesEl) return;
  // Remove old highlights
  messagesEl.querySelectorAll('.chat-msg-highlight').forEach(el=>el.classList.remove('chat-msg-highlight'));
  _searchMatches = [];
  if (!query.trim()) { q('chatSearchCount').textContent=''; return; }
  const thread = chatState.threads[chatState.activePhone];
  if (!thread?.messages) return;
  const q2 = query.toLowerCase();
  _searchMatches = thread.messages.filter(m=>m.text?.toLowerCase().includes(q2)).map(m=>m.id);
  // Highlight matching bubbles
  _searchMatches.forEach(id=>{
    const el = messagesEl.querySelector(`[data-msgid="${id}"]`);
    if (el) el.classList.add('chat-msg-highlight');
  });
  q('chatSearchCount').textContent = _searchMatches.length ? `${_searchMatches.length} found` : 'No results';
  // Scroll to first match
  if (_searchMatches.length) {
    const first = messagesEl.querySelector(`[data-msgid="${_searchMatches[0]}"]`);
    first?.scrollIntoView({behavior:'smooth', block:'center'});
  }
}

// ── Pin Messages ──────────────────────────────────────────────────
function pinMessage(msgId) {
  const thread = chatState.threads[chatState.activePhone];
  if (!thread) return;
  const msg = thread.messages.find(m=>m.id===msgId);
  if (!msg) return;
  thread.pinnedMsgId = msgId;
  saveChatState();
  renderPinnedArea();
  pushNotif('Message pinned', msg.text.slice(0,60), '📌','info');
}

function unpinMessage() {
  const thread = chatState.threads[chatState.activePhone];
  if (!thread) return;
  delete thread.pinnedMsgId;
  saveChatState();
  renderPinnedArea();
}

function renderPinnedArea() {
  const area = q('chatPinnedArea');
  const text = q('chatPinnedText');
  if (!area) return;
  const thread = chatState.threads[chatState.activePhone];
  const pinned = thread?.messages?.find(m=>m.id===thread?.pinnedMsgId);
  if (pinned) {
    text.textContent = pinned.text.slice(0,80)+(pinned.text.length>80?'…':'');
    area.classList.remove('hidden');
  } else {
    area.classList.add('hidden');
  }
}

// ── Star Messages ─────────────────────────────────────────────────
function toggleStarMessage(msgId) {
  const thread = chatState.threads[chatState.activePhone];
  if (!thread) return;
  if (!thread.starred) thread.starred = [];
  const idx = thread.starred.indexOf(msgId);
  if (idx === -1) { thread.starred.push(msgId); }
  else            { thread.starred.splice(idx,1); }
  saveChatState();
  renderMessages();
}

function showStarredMessages() {
  const thread = chatState.threads[chatState.activePhone];
  if (!thread?.starred?.length) { alert('No starred messages in this conversation.'); return; }
  const panel = document.createElement('div');
  panel.className = 'chat-starred-panel';
  panel.innerHTML = `
    <div class="chat-starred-header">
      <span>⭐ Starred Messages</span>
      <button class="chat-icon-btn" onclick="this.closest('.chat-starred-panel').remove()" style="margin-left:auto">✕</button>
    </div>
    <div class="chat-starred-list">
      ${thread.messages.filter(m=>thread.starred.includes(m.id)).map(m=>`
        <div class="chat-starred-item" onclick="scrollToMessage('${m.id}');this.closest('.chat-starred-panel').remove()">
          <div>${escapeHtml(m.text.slice(0,100))}${m.text.length>100?'…':''}</div>
          <div class="chat-starred-item-meta">${m.direction==='sent'?'You':chatState.activeContact?.name||'Contact'} · ${formatChatTime(m.time)}</div>
        </div>`).join('')}
    </div>`;
  q('chatThreadWrap').appendChild(panel);
}

function scrollToMessage(msgId) {
  const el = q('chatMessages')?.querySelector(`[data-msgid="${msgId}"]`);
  if (el) { el.scrollIntoView({behavior:'smooth',block:'center'}); el.style.animation='chatMsgFlash .6s ease'; }
}

// ── Reply to Message ──────────────────────────────────────────────

function replyToMessage(msgId) {
  const thread = chatState.threads[chatState.activePhone];
  const msg = thread?.messages?.find(m=>m.id===msgId);
  if (!msg) return;
  _replyingToMsgId = msgId;
  const preview = q('chatReplyPreview');
  const previewText = q('replyPreviewText');
  if (preview && previewText) {
    previewText.textContent = msg.text.slice(0,80)+(msg.text.length>80?'…':'');
    preview.classList.remove('hidden');
  }
  q('chatInput')?.focus();
}

function cancelReply() {
  _replyingToMsgId = null;
  q('chatReplyPreview')?.classList.add('hidden');
}

// ── File Attachment ───────────────────────────────────────────────
function openFileAttach() { q('chatFileInput')?.click(); }

function handleChatFile(event) {
  const file = event.target.files?.[0];
  if (!file || !chatState.activePhone) return;
  const MAX = 5*1024*1024;
  if (file.size > MAX) { pushNotif('File too large','Maximum file size is 5MB.','⚠️','warning'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    const msg = {
      id:        crypto.randomUUID(),
      text:      file.name,
      fileData:  e.target.result,
      fileSize:  file.size,
      fileType:  file.type,
      direction: 'sent',
      type:      'file',
      time:      new Date().toISOString(),
      sender:    state.session?.name || 'You',
    };
    if (!chatState.threads[chatState.activePhone]) chatState.threads[chatState.activePhone] = { messages:[] };
    chatState.threads[chatState.activePhone].messages.push(msg);
    saveChatState();
    renderMessages();
    renderChatList();
    state.activities.unshift({ id:crypto.randomUUID(), created_at:msg.time, type:'Chat', note:`[File to ${chatState.activeContact?.name||''}]: ${file.name}`, contactId:chatState.activeContact?.id||null });
    persistLocal();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// ── Sound Notifications ───────────────────────────────────────────
let _chatSoundEnabled = localStorage.getItem('crm_chat_sound') !== 'false';

function toggleChatSound() {
  _chatSoundEnabled = !_chatSoundEnabled;
  localStorage.setItem('crm_chat_sound', _chatSoundEnabled);
  pushNotif(`Sound ${_chatSoundEnabled?'on':'off'}`, `Chat notification sounds ${_chatSoundEnabled?'enabled':'muted'}.`, _chatSoundEnabled?'🔔':'🔕','info');
}

function playChatSound() {
  if (!_chatSoundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

// ── Chat Analytics ────────────────────────────────────────────────
function toggleChatAnalytics() {
  const panel = q('chatAnalyticsPanel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    renderChatAnalytics();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function renderChatAnalytics() {
  const panel = q('chatAnalyticsPanel');
  if (!panel) return;
  const thread = chatState.threads[chatState.activePhone] || { messages:[] };
  const msgs   = thread.messages.filter(m=>m.type!=='note');
  const sent   = msgs.filter(m=>m.direction==='sent');
  const recv   = msgs.filter(m=>m.direction==='received');
  const files  = msgs.filter(m=>m.type==='file');
  const starred = (thread.starred||[]).length;

  // Avg response time (sent after received)
  let totalResp = 0, respCount = 0;
  msgs.forEach((m,i) => {
    if (m.direction==='sent' && i>0 && msgs[i-1].direction==='received') {
      totalResp += new Date(m.time) - new Date(msgs[i-1].time);
      respCount++;
    }
  });
  const avgResp = respCount ? Math.round(totalResp/respCount/60000) : 0;

  panel.innerHTML = `
    <div class="chat-stat"><div class="chat-stat-val">${sent.length}</div><div class="chat-stat-label">Sent</div></div>
    <div class="chat-stat"><div class="chat-stat-val">${recv.length}</div><div class="chat-stat-label">Received</div></div>
    <div class="chat-stat"><div class="chat-stat-val">${files.length}</div><div class="chat-stat-label">Files</div></div>
    <div class="chat-stat"><div class="chat-stat-val">${starred}</div><div class="chat-stat-label">Starred</div></div>
    <div class="chat-stat" style="grid-column:span 2"><div class="chat-stat-val">${avgResp?avgResp+'m':'—'}</div><div class="chat-stat-label">Avg Response</div></div>
    <div class="chat-stat" style="grid-column:span 2"><div class="chat-stat-val">${msgs.length}</div><div class="chat-stat-label">Total Messages</div></div>`;
}

// ── Group by project / tag ────────────────────────────────────────
function groupChatsByProject() {
  // Show contacts grouped by their linked project
  const grouped = {};
  state.contacts.forEach(c => {
    const proj = state.projects.find(p=>p.contactId===c.id);
    const group = proj?.name || 'No Project';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(c);
  });
  return grouped;
}

// ── Override renderMessages to include new features ───────────────
const _origRenderMessages = renderMessages;
window.renderMessages = function() {
  const thread  = chatState.threads[chatState.activePhone] || { messages:[] };
  const msgsEl  = q('chatMessages');
  if (!msgsEl) return;

  if (!thread.messages.length) {
    msgsEl.innerHTML = `
      <div class="chat-system-msg" style="margin-top:auto">
        This is the beginning of your conversation with <strong>${chatState.activeContact?.name||''}</strong>.
      </div>
      <div class="chat-system-msg" style="font-size:.7rem;color:var(--text-3)">
        📱 ${chatState.activeContact?.phone||''}
      </div>`;
    renderPinnedArea();
    return;
  }

  const starred = thread.starred || [];
  let html = '';
  let lastDate='', lastDir='', groupOpen=false;

  thread.messages.forEach((msg) => {
    const msgDate = new Date(msg.time).toDateString();
    const today   = new Date().toDateString();
    const yest    = new Date(Date.now()-86400000).toDateString();

    if (msgDate !== lastDate) {
      if (groupOpen) { html+='</div>'; groupOpen=false; }
      const label = msgDate===today?'Today':msgDate===yest?'Yesterday':new Date(msg.time).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
      html+=`<div class="chat-date-divider"><span>${label}</span></div>`;
      lastDate=msgDate; lastDir='';
    }

    if (msg.type==='note') {
      if (groupOpen){html+='</div>';groupOpen=false;lastDir='';}
      html+=`<div class="chat-msg-note"><div class="chat-msg-note-label">📌 Internal Note</div>${escapeHtml(msg.text)}<div style="font-size:.65rem;opacity:.6;margin-top:4px;text-align:right">${formatChatTime(msg.time)}</div></div>`;
      return;
    }

    if (msg.direction!==lastDir) {
      if (groupOpen) html+='</div>';
      html+=`<div class="chat-msg-group ${msg.direction}">`;
      groupOpen=true; lastDir=msg.direction;
    }

    const isStarred = starred.includes(msg.id);
    const tick = msg.direction==='sent'?`<span class="chat-bubble-tick read">✓✓</span>`:'';
    const starBtn   = `<button class="msg-action-btn" onclick="toggleStarMessage('${msg.id}')" title="${isStarred?'Unstar':'Star'}">${isStarred?'⭐':'☆'}</button>`;
    const pinBtn    = `<button class="msg-action-btn" onclick="pinMessage('${msg.id}')" title="Pin">📌</button>`;
    const replyBtn  = `<button class="msg-action-btn" onclick="replyToMessage('${msg.id}')" title="Reply">↩</button>`;
    const quoteHtml = msg.replyToText ? `<div class="chat-quoted">${escapeHtml(msg.replyToText.slice(0,80))}</div>` : '';

    if (msg.type==='file') {
      const isImg = msg.fileType?.startsWith('image/');
      html+=`<div class="chat-bubble-wrap" data-msgid="${msg.id}">
        <div class="chat-msg-actions">${replyBtn}${starBtn}${pinBtn}</div>
        <div class="chat-bubble${isStarred?' starred':''}">
          ${quoteHtml}
          ${isImg
            ? `<img src="${msg.fileData}" style="max-width:200px;border-radius:8px;display:block;cursor:pointer" onclick="window.open('${msg.fileData}')" />`
            : `<div class="chat-file-bubble" onclick="downloadChatFile('${msg.id}')">
                <span class="chat-file-icon">${fileIcon(msg.text)}</span>
                <div class="chat-file-info">
                  <div class="chat-file-name">${escapeHtml(msg.text)}</div>
                  <div class="chat-file-size">${fmtSize(msg.fileSize||0)}</div>
                </div>
                <span>⬇</span>
              </div>`}
          <div class="chat-bubble-meta">
            <span class="chat-bubble-time">${formatChatTime(msg.time)}</span>
            ${tick}
          </div>
          ${isStarred?'<span class="star-indicator">⭐</span>':''}
        </div>
      </div>`;
    } else {
      html+=`<div class="chat-bubble-wrap" data-msgid="${msg.id}">
        <div class="chat-msg-actions">${replyBtn}${starBtn}${pinBtn}</div>
        <div class="chat-bubble${isStarred?' starred':''}">
          ${quoteHtml}
          ${escapeHtml(msg.text)}
          <div class="chat-bubble-meta">
            <span class="chat-bubble-time">${formatChatTime(msg.time)}</span>
            ${tick}
          </div>
          ${isStarred?'<span class="star-indicator">⭐</span>':''}
        </div>
      </div>`;
    }
  });

  if (groupOpen) html+='</div>';
  msgsEl.innerHTML = html;
  msgsEl.scrollTop = msgsEl.scrollHeight;
  renderPinnedArea();
};

// ── Override sendChatMessage to include reply + sound ─────────────
const _origSendChat = sendChatMessage;
window.sendChatMessage = function() {
  const input = q('chatInput');
  const text  = input?.value.trim();
  if (!text || !chatState.activePhone) return;

  // Get reply context
  let replyToText = null;
  if (_replyingToMsgId) {
    const thread = chatState.threads[chatState.activePhone];
    const replied = thread?.messages?.find(m=>m.id===_replyingToMsgId);
    replyToText = replied?.text || null;
  }

  const msg = {
    id:          crypto.randomUUID(),
    text,
    replyToText,
    direction:   'sent',
    type:        'text',
    time:        new Date().toISOString(),
    sender:      state.session?.name || 'You',
  };

  if (!chatState.threads[chatState.activePhone]) chatState.threads[chatState.activePhone] = { messages:[] };
  chatState.threads[chatState.activePhone].messages.push(msg);
  saveChatState();
  cancelReply();
  input.value=''; input.style.height='auto';
  renderMessages(); renderChatList();

  state.activities.unshift({ id:crypto.randomUUID(), created_at:msg.time, type:'Chat', note:`[Chat to ${chatState.activeContact?.name||''}]: ${text.slice(0,100)}`, contactId:chatState.activeContact?.id||null });
  persistLocal();
};

// ── Override simulateReceive to include sound ─────────────────────
const _origSimReceive = simulateReceive;
window.simulateReceive = function(text) {
  if (!chatState.activePhone) return;
  const msg = { id:crypto.randomUUID(), text, direction:'received', type:'text', time:new Date().toISOString(), sender:chatState.activeContact?.name||'Contact' };
  chatState.threads[chatState.activePhone].messages.push(msg);
  saveChatState();
  renderMessages(); renderChatList(); updateChatBadge();
  playChatSound();
  pushNotif(`Message from ${msg.sender}`, text.slice(0,60), '💬','info');
};

// ── Download chat file ────────────────────────────────────────────
function downloadChatFile(msgId) {
  const thread = chatState.threads[chatState.activePhone];
  const msg = thread?.messages?.find(m=>m.id===msgId);
  if (!msg?.fileData) return;
  const a = document.createElement('a'); a.href=msg.fileData; a.download=msg.text; a.click();
}

// ── Override openChatThread to init new features ──────────────────
const _origOpenThread = openChatThread;
window.openChatThread = function(phone, contactId) {
  _origOpenThread(phone, contactId);
  renderPinnedArea();
  cancelReply();
  q('chatAnalyticsPanel')?.classList.add('hidden');
  q('chatSearchBar')?.classList.add('hidden');
  if (q('chatSearchInput')) q('chatSearchInput').value='';
};

// ── Flash animation ───────────────────────────────────────────────
const _flashStyle = document.createElement('style');
_flashStyle.textContent = `@keyframes chatMsgFlash { 0%,100%{background:transparent} 50%{background:#fef08a} }`;
document.head.appendChild(_flashStyle);


// ══════════════════════════════════════════════════════════════════
//  VIDEO CALLING  (WebRTC + localStorage signaling)
// ══════════════════════════════════════════════════════════════════


// ── Initiate call ─────────────────────────────────────────────────
async function startVideoCall() { await _initiateCall('video'); }
async function startAudioCall() { await _initiateCall('audio'); }

async function _initiateCall(type) {
  const contact = chatState.activeContact;
  if (!contact && !chatState.activeGroup) {
    alert('Please select a contact first.');
    return;
  }

  _callType      = type;
  _callContactId = contact?.id || null;

  // ── Check browser support ─────────────────────────────────────
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Your browser does not support video/audio calls.\nPlease use Chrome, Edge, or Firefox.');
    return;
  }

  // ── Request media ─────────────────────────────────────────────
  const constraints = type === 'video'
    ? { video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' }, audio: true }
    : { audio: true };

  try {
    _localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch(err) {
    let msg = 'Could not access camera/microphone.\n\n';
    if (err.name === 'NotAllowedError')  msg += '🔒 Permission denied.\nClick the camera icon in your browser address bar and allow access, then try again.';
    else if (err.name === 'NotFoundError') msg += '📷 No camera/microphone found.\nMake sure a camera is connected.';
    else if (err.name === 'NotReadableError') msg += '⚠️ Camera is in use by another app.\nClose other apps using the camera and try again.';
    else msg += err.message;
    alert(msg);
    return;
  }

  // ── Show overlay ──────────────────────────────────────────────
  _showCallOverlay(contact, type, 'Calling…');

  const localVid = q('localVideo');
  const remoteVid = q('remoteVideo');
  if (localVid) localVid.srcObject = _localStream;
  if (type === 'audio') {
    if (localVid)  localVid.style.display  = 'none';
    if (remoteVid) remoteVid.style.display = 'none';
  }

  // ── Create WebRTC peer ────────────────────────────────────────
  try {
    _rtcPeer = new RTCPeerConnection(rtcConfig);
  } catch(err) {
    alert('WebRTC not supported in this browser. Please use Chrome or Firefox.');
    _cleanupCall(); return;
  }

  _localStream.getTracks().forEach(track => _rtcPeer.addTrack(track, _localStream));

  _rtcPeer.ontrack = e => {
    if (remoteVid && e.streams[0]) {
      remoteVid.srcObject = e.streams[0];
      remoteVid.style.display = '';
      q('videoCallStatus').textContent = 'Connected ✓';
      _startCallTimer();
    }
  };

  _rtcPeer.oniceconnectionstatechange = () => {
    const state = _rtcPeer?.iceConnectionState;
    const statusEl = q('videoCallStatus');
    if (!statusEl) return;
    if (state === 'checking')     statusEl.textContent = 'Connecting…';
    if (state === 'connected')    { statusEl.textContent = 'Connected ✓'; _startCallTimer(); }
    if (state === 'disconnected') statusEl.textContent = 'Connection lost';
    if (state === 'failed')       { statusEl.textContent = 'Call failed'; setTimeout(endCall, 2000); }
  };

  _rtcPeer.onicecandidate = e => {
    if (e.candidate) _signal({ type:'candidate', candidate:e.candidate, from:'caller', to:contact?.id||'group' });
  };

  // ── Create offer ──────────────────────────────────────────────
  try {
    const offer = await _rtcPeer.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo: type==='video' });
    await _rtcPeer.setLocalDescription(offer);
    _signal({
      type:'offer', sdp:offer, callType:type,
      callerName: state.session?.name || 'CRM User',
      callerId:   state.session?.id   || 'caller',
      to:         contact?.id || 'broadcast',
      from:       'caller'
    });
  } catch(err) {
    alert('Failed to create call offer: ' + err.message);
    _cleanupCall(); return;
  }

  if (contact) _sendCallMsg(`📹 ${type==='video'?'Video':'Audio'} call initiated`);
  _pollSignal(contact?.id || 'group', 'caller');
}

function _cleanupCall() {
  if (_localStream) { _localStream.getTracks().forEach(t=>t.stop()); _localStream=null; }
  if (_rtcPeer)     { try { _rtcPeer.close(); } catch(e){} _rtcPeer=null; }
  _closeCallOverlay();
}

// ── Signaling via localStorage (works same-origin tabs) ───────────
function _signal(data) {
  const signals = JSON.parse(localStorage.getItem(SIGNAL_KEY)||'[]');
  signals.push({ ...data, ts: Date.now() });
  // Keep last 20 signals only
  localStorage.setItem(SIGNAL_KEY, JSON.stringify(signals.slice(-20)));
}

function _pollSignal(contactId, role) {
  const interval = setInterval(async () => {
    const signals = JSON.parse(localStorage.getItem(SIGNAL_KEY)||'[]');
    const fresh   = signals.filter(s=>s.ts>Date.now()-30000);

    if (role === 'caller') {
      const answer = fresh.find(s=>s.type==='answer'&&s.from===contactId);
      if (answer && _rtcPeer && !_rtcPeer.remoteDescription) {
        await _rtcPeer.setRemoteDescription(new RTCSessionDescription(answer.sdp));
        q('videoCallStatus').textContent = 'Connected';
        _startCallTimer();
      }
      const candidates = fresh.filter(s=>s.type==='candidate'&&s.from===contactId);
      for (const c of candidates) {
        if (_rtcPeer) try { await _rtcPeer.addIceCandidate(new RTCIceCandidate(c.candidate)); } catch(e){}
      }
      const declined = fresh.find(s=>s.type==='declined'&&s.from===contactId);
      if (declined) { clearInterval(interval); endCall(); pushNotif('Call declined','','\uD83D\uDCF5','info'); }
    }

    if (role === 'callee') {
      const candidates = fresh.filter(s=>s.type==='candidate'&&s.from==='caller');
      for (const c of candidates) {
        if (_rtcPeer) try { await _rtcPeer.addIceCandidate(new RTCIceCandidate(c.candidate)); } catch(e){}
      }
    }
  }, 500);
  // Auto-clear after 60s
  setTimeout(()=>clearInterval(interval), 60000);
}

// ── Receive incoming call (simulated — production: use socket) ────
function _checkIncomingCalls() {
  const signals = JSON.parse(localStorage.getItem(SIGNAL_KEY)||'[]');
  const offer   = signals.find(s=>s.type==='offer'&&s.to===state.session?.id&&s.ts>Date.now()-30000);
  if (!offer || q('videoCallOverlay').dataset.active) return;

  // Show incoming call UI
  const contact = state.contacts.find(c=>c.id===offer.callerId) || { name:offer.callerName||'Unknown', id:offer.callerId };
  _showIncomingCall(contact, offer);
}
setInterval(_checkIncomingCalls, 1000);

function _showIncomingCall(contact, offer) {
  const color = avatarColor(contact.name);
  q('incomingAvatar').style.background = color;
  q('incomingAvatar').textContent = contact.name.charAt(0).toUpperCase();
  q('incomingName').textContent   = contact.name;
  q('incomingType').textContent   = offer.callType==='video' ? '📹 Incoming Video Call' : '📞 Incoming Audio Call';
  q('videoCallOverlay').classList.remove('hidden');
  q('videoCallOverlay').dataset.active = '1';
  q('videoIncoming').classList.remove('hidden');
  q('videoCallOverlay').dataset.offerId = JSON.stringify(offer);
  playChatSound();
}

async function acceptCall() {
  const offer = JSON.parse(q('videoCallOverlay').dataset.offerId||'{}');
  if (!offer.sdp) return;
  q('videoIncoming').classList.add('hidden');

  try {
    _localStream = await navigator.mediaDevices.getUserMedia(
      offer.callType==='video' ? {video:true,audio:true} : {audio:true}
    );
  } catch(err) { alert('Camera/microphone access denied.'); declineCall(); return; }

  const contact = state.contacts.find(c=>c.id===offer.callerId) || { name:offer.callerName, id:offer.callerId };
  _showCallOverlay(contact, offer.callType, 'Connecting…');
  q('localVideo').srcObject = _localStream;

  _rtcPeer = new RTCPeerConnection(rtcConfig);
  _localStream.getTracks().forEach(track => _rtcPeer.addTrack(track, _localStream));
  _rtcPeer.ontrack = e => { q('remoteVideo').srcObject = e.streams[0]; q('videoCallStatus').textContent='Connected'; _startCallTimer(); };
  _rtcPeer.onicecandidate = e => {
    if (e.candidate) _signal({ type:'candidate', candidate:e.candidate, from:state.session?.id, to:'caller' });
  };

  await _rtcPeer.setRemoteDescription(new RTCSessionDescription(offer.sdp));
  const answer = await _rtcPeer.createAnswer();
  await _rtcPeer.setLocalDescription(answer);
  _signal({ type:'answer', sdp:answer, from:contact.id, to:'caller' });
  _pollSignal(null, 'callee');
}

function declineCall() {
  const offer = JSON.parse(q('videoCallOverlay').dataset.offerId||'{}');
  if (offer.callerId) _signal({ type:'declined', from:offer.callerId, to:'caller' });
  _closeCallOverlay();
}

// ── Call overlay helpers ──────────────────────────────────────────
function _showCallOverlay(contact, type, status) {
  const overlay = q('videoCallOverlay');
  overlay.classList.remove('hidden');
  overlay.dataset.active = '1';
  const color = avatarColor(contact?.name||'?');
  q('videoCallerAvatar').style.background = color;
  q('videoCallerAvatar').textContent = (contact?.name||'?').charAt(0).toUpperCase();
  q('videoCallerName').textContent   = contact?.name || '—';
  q('videoCallStatus').textContent   = status;
  if (type==='audio') { q('remoteVideo').style.display='none'; q('localVideo').style.display='none'; }
  else { q('remoteVideo').style.display=''; q('localVideo').style.display=''; }
}

function _closeCallOverlay() {
  const overlay = q('videoCallOverlay');
  overlay.classList.add('hidden');
  overlay.dataset.active = '';
  q('videoIncoming').classList.add('hidden');
}

function _startCallTimer() {
  _callSeconds = 0;
  clearInterval(_callTimerInt);
  _callTimerInt = setInterval(()=>{
    _callSeconds++;
    const m = String(Math.floor(_callSeconds/60)).padStart(2,'0');
    const s = String(_callSeconds%60).padStart(2,'0');
    const el = q('videoCallTimer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function endCall() {
  clearInterval(_callTimerInt);
  const dur = `${String(Math.floor(_callSeconds/60)).padStart(2,'0')}:${String(_callSeconds%60).padStart(2,'0')}`;
  _cleanupCall();
  _isMuted=false; _isCamOff=false; _isScreenShare=false;
  if (_callSeconds > 0) _sendCallMsg(`📵 Call ended (${dur})`);
}

// ── Call controls ─────────────────────────────────────────────────
function toggleMute() {
  _isMuted = !_isMuted;
  _localStream?.getAudioTracks().forEach(t=>t.enabled=!_isMuted);
  const btn = q('btnMute');
  if (btn) { btn.textContent=_isMuted?'🔇':'🎤'; btn.classList.toggle('muted',_isMuted); }
}
function toggleCamera() {
  _isCamOff = !_isCamOff;
  _localStream?.getVideoTracks().forEach(t=>t.enabled=!_isCamOff);
  const btn = q('btnCamera');
  if (btn) { btn.textContent=_isCamOff?'📷':'📹'; btn.classList.toggle('cam-off',_isCamOff); }
}
async function toggleScreenShare() {
  if (!_isScreenShare) {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({video:true});
      const track  = screen.getVideoTracks()[0];
      const sender = _rtcPeer?.getSenders().find(s=>s.track?.kind==='video');
      if (sender) sender.replaceTrack(track);
      track.onended = ()=>toggleScreenShare();
      _isScreenShare=true;
      q('btnScreen')?.classList.add('active');
    } catch(e) { pushNotif('Screen share cancelled','','🖥','info'); }
  } else {
    const vidTrack = _localStream?.getVideoTracks()[0];
    const sender   = _rtcPeer?.getSenders().find(s=>s.track?.kind==='video');
    if (sender && vidTrack) sender.replaceTrack(vidTrack);
    _isScreenShare=false;
    q('btnScreen')?.classList.remove('active');
  }
}
function toggleSpeaker() {
  const video = q('remoteVideo');
  if (video) { video.muted = !video.muted; q('btnSpeaker').textContent = video.muted?'🔕':'🔊'; }
}

function _sendCallMsg(text) {
  if (!chatState.activePhone) return;
  if (!chatState.threads[chatState.activePhone]) chatState.threads[chatState.activePhone]={messages:[]};
  chatState.threads[chatState.activePhone].messages.push({ id:crypto.randomUUID(), text, direction:'sent', type:'call', time:new Date().toISOString(), sender:state.session?.name||'You' });
  saveChatState(); renderMessages(); renderChatList();
}

// ══════════════════════════════════════════════════════════════════
//  GROUP CHAT
// ══════════════════════════════════════════════════════════════════

// Groups stored in chatState
if (!chatState.groups) chatState.groups = JSON.parse(localStorage.getItem('crm_chat_groups')||'[]');
function saveGroups() { localStorage.setItem('crm_chat_groups', JSON.stringify(chatState.groups)); saveChatState(); }

// ── Create group ──────────────────────────────────────────────────
function openCreateGroupModal() {
  const sel = q('groupMemberSelect');
  const contacts = state.contacts.filter(c=>c.phone);
  if (!contacts.length) { alert('No contacts with phone numbers. Add phone numbers to contacts first.'); return; }

  sel.innerHTML = contacts.map(c=>`
    <div class="group-member-item" id="gmi_${c.id}" onclick="toggleGroupMember('${c.id}',this)">
      <input type="checkbox" id="gmc_${c.id}" style="pointer-events:none" />
      <div class="group-member-avatar-sm" style="background:${avatarColor(c.name)}">${c.name.charAt(0)}</div>
      <span>${c.name}</span>
    </div>`).join('');
  q('groupSelectedPreview').innerHTML='';
  q('groupName').value=''; q('groupDesc').value='';
  openModal('createGroupModal');
}

const _selectedGroupMembers = new Set();
function toggleGroupMember(contactId, el) {
  if (_selectedGroupMembers.has(contactId)) {
    _selectedGroupMembers.delete(contactId);
    el.classList.remove('selected');
    q(`gmc_${contactId}`).checked = false;
  } else {
    _selectedGroupMembers.add(contactId);
    el.classList.add('selected');
    q(`gmc_${contactId}`).checked = true;
  }
  renderGroupMemberPreview();
}
function renderGroupMemberPreview() {
  const preview = q('groupSelectedPreview');
  preview.innerHTML = [..._selectedGroupMembers].map(id=>{
    const c = state.contacts.find(x=>x.id===id);
    return c ? `<div class="group-member-chip"><div class="group-chip-avatar" style="background:${avatarColor(c.name)}">${c.name.charAt(0)}</div>${c.name}</div>` : '';
  }).join('');
}

function createGroup() {
  const name = q('groupName').value.trim();
  if (!name) { alert('Group name is required.'); return; }
  if (_selectedGroupMembers.size < 1) { alert('Select at least 1 member.'); return; }

  const group = {
    id:          'grp_'+crypto.randomUUID().slice(0,8),
    name,
    description: q('groupDesc').value.trim(),
    members:     [state.session?.id||'admin', ...[..._selectedGroupMembers]],
    memberNames: [state.session?.name||'You', ...[..._selectedGroupMembers].map(id=>state.contacts.find(c=>c.id===id)?.name||id)],
    createdAt:   new Date().toISOString(),
    createdBy:   state.session?.name||'You',
    messages:    [],
  };
  chatState.groups.push(group);
  _selectedGroupMembers.clear();
  saveGroups();
  closeModal('createGroupModal');
  openGroupThread(group.id);
  renderChatList();
  pushNotif(`Group created: ${name}`, `${group.members.length} members`, '👥','success');
}

// ── Open group thread ─────────────────────────────────────────────
function openGroupThread(groupId) {
  const group = chatState.groups.find(g=>g.id===groupId);
  if (!group) return;

  chatState.activePhone   = groupId;   // reuse activePhone as thread key
  chatState.activeContact = null;
  chatState.activeGroup   = group;

  const overlay = q('videoCallOverlay');

  q('chatThreadAvatar').style.background = 'linear-gradient(135deg,#2563eb,#7c3aed)';
  q('chatThreadAvatar').textContent      = '👥';
  q('chatThreadAvatar').style.borderRadius = '10px';
  q('chatThreadName').textContent   = group.name;
  q('chatThreadPhone').textContent  = `${group.members.length} members · ${group.description||'Group Chat'}`;
  // video call for groups handled by startVideoCall()

  q('chatThreadEmpty').classList.add('hidden');
  q('chatThreadWrap').classList.remove('hidden');
  q('chatSidebar').classList.add('thread-open');

  // Init group thread if needed
  if (!chatState.threads[groupId]) chatState.threads[groupId]={messages:[], isGroup:true};
  chatState.threads[groupId].lastRead = new Date().toISOString();
  saveChatState();

  renderGroupMessages(groupId);
  renderChatList();
  updateChatBadge();
  setTimeout(()=>q('chatInput')?.focus(), 100);
}

function renderGroupMessages(groupId) {
  const group  = chatState.groups.find(g=>g.id===groupId);
  const thread = chatState.threads[groupId] || {messages:[]};
  const msgsEl = q('chatMessages');
  if (!msgsEl) return;

  if (!thread.messages.length) {
    msgsEl.innerHTML=`<div class="chat-system-msg" style="margin-top:auto">
      <strong>${group?.name||'Group'}</strong> was created by ${group?.createdBy||'You'}
    </div>
    <div class="chat-system-msg" style="font-size:.7rem;color:var(--text-3)">
      👥 ${group?.memberNames?.join(', ')||''}
    </div>`;
    return;
  }

  let html='', lastDate='';
  thread.messages.forEach(msg=>{
    const msgDate=new Date(msg.time).toDateString();
    const today=new Date().toDateString();
    const yest=new Date(Date.now()-86400000).toDateString();
    if (msgDate!==lastDate) {
      const label=msgDate===today?'Today':msgDate===yest?'Yesterday':new Date(msg.time).toLocaleDateString('en-IN',{day:'numeric',month:'long'});
      html+=`<div class="chat-date-divider"><span>${label}</span></div>`;
      lastDate=msgDate;
    }
    if (msg.type==='system') { html+=`<div class="chat-system-msg">${escapeHtml(msg.text)}</div>`; return; }
    const isMe = msg.sender===state.session?.name||msg.direction==='sent';
    html+=`<div class="chat-msg-group ${isMe?'sent':'received'}">
      ${!isMe?`<div class="group-sender-label">${escapeHtml(msg.sender||'')}</div>`:''}
      <div class="chat-bubble">${escapeHtml(msg.text)}
        <div class="chat-bubble-meta">
          <span class="chat-bubble-time">${formatChatTime(msg.time)}</span>
          ${isMe?'<span class="chat-bubble-tick read">✓✓</span>':''}
        </div>
      </div>
    </div>`;
  });
  msgsEl.innerHTML=html;
  msgsEl.scrollTop=msgsEl.scrollHeight;
}

// ── Override sendChatMessage for groups ───────────────────────────
const _prevSendChat2 = window.sendChatMessage;
window.sendChatMessage = function() {
  if (chatState.activeGroup) {
    const input=q('chatInput'); const text=input?.value.trim();
    if (!text||!chatState.activeGroup) return;
    const msg={id:crypto.randomUUID(),text,direction:'sent',type:'text',time:new Date().toISOString(),sender:state.session?.name||'You'};
    if (!chatState.threads[chatState.activeGroup.id]) chatState.threads[chatState.activeGroup.id]={messages:[],isGroup:true};
    chatState.threads[chatState.activeGroup.id].messages.push(msg);
    saveChatState();
    cancelReply(); input.value=''; input.style.height='auto';
    renderGroupMessages(chatState.activeGroup.id); renderChatList();
    return;
  }
  _prevSendChat2();
};

// ── Override renderChatList to include groups ─────────────────────
const _prevRenderChatList = renderChatList;
window.renderChatList = function() {
  const search = (q('chatSearch')?.value||'').toLowerCase();
  const filter = chatState.filter;
  const listEl = q('chatContactList');
  const countEl = q('chatContactCountLabel');
  if (!listEl) return;

  let items = []; // {type, id, name, preview, time, unread, color, isGroup}

  // Groups
  if (filter==='all'||filter==='groups') {
    chatState.groups.forEach(g=>{
      const thread=chatState.threads[g.id]||{messages:[]};
      const lastMsg=thread.messages[thread.messages.length-1];
      const lastRead=thread.lastRead||0;
      const unread=thread.messages.filter(m=>m.direction!=='sent'&&new Date(m.time)>new Date(lastRead)).length;
      if (search&&!g.name.toLowerCase().includes(search)) return;
      items.push({type:'group',id:g.id,name:g.name,sub:`${g.members.length} members`,preview:lastMsg?`${lastMsg.sender}: ${lastMsg.text.slice(0,30)}`:g.description||'Group chat',time:lastMsg?.time||g.createdAt,unread});
    });
  }

  // Contacts
  if (filter!=='groups') {
    let contacts=[...state.contacts];
    if (filter==='phone') contacts=contacts.filter(c=>c.phone);
    if (filter==='unread') contacts=contacts.filter(c=>{
      const ph=normalisePhone(c.phone); const t=chatState.threads[ph];
      return t?.messages?.some(m=>m.direction==='received'&&new Date(m.time)>new Date(t.lastRead||0));
    });
    if (search) contacts=contacts.filter(c=>c.name.toLowerCase().includes(search)||(c.phone||'').includes(search));
    contacts.forEach(c=>{
      const ph=normalisePhone(c.phone); const thread=chatState.threads[ph]||{messages:[]};
      const lastMsg=thread.messages[thread.messages.length-1];
      const lastRead=thread.lastRead||0;
      const unread=thread.messages.filter(m=>m.direction==='received'&&new Date(m.time)>new Date(lastRead)).length;
      const hasPhone=Boolean(c.phone);
      items.push({type:'contact',id:c.id,phone:ph,name:c.name,sub:c.company||'',preview:lastMsg?(lastMsg.direction==='sent'?'You: ':'')+lastMsg.text.slice(0,35):(hasPhone?'Tap to start':'No phone #'),time:lastMsg?.time||'',unread,hasPhone,color:avatarColor(c.name)});
    });
  }

  // Sort by recent
  items.sort((a,b)=>(b.time||'').localeCompare(a.time||''));
  if(countEl) countEl.textContent=`${items.length} conversation${items.length!==1?'s':''}`;

  if (!items.length) { listEl.innerHTML=`<div style="padding:1.5rem;text-align:center;color:var(--text-3);font-size:.8rem">${search?'No results.':'No conversations yet.'}</div>`; return; }

  listEl.innerHTML=items.map(item=>{
    const isActive = chatState.activePhone===(item.type==='group'?item.id:item.phone);
    const timeStr  = item.time?formatChatTime(item.time):'';
    if (item.type==='group') {
      return `<div class="chat-contact-item${isActive?' active':''}" onclick="openGroupThread('${item.id}')">
        <div class="chat-group-avatar">👥</div>
        <div class="chat-contact-info">
          <div class="chat-contact-name">${item.name}</div>
          <div class="chat-contact-preview">${item.preview}</div>
        </div>
        <div class="chat-contact-meta">
          ${timeStr?`<span class="chat-contact-time">${timeStr}</span>`:''}
          ${item.unread?`<span class="chat-unread-dot">${item.unread}</span>`:''}
        </div>
      </div>`;
    }
    return `<div class="chat-contact-item${isActive?' active':''}" onclick="openChatContact('${item.phone}','${item.id}',${item.hasPhone})" title="${!item.hasPhone?'No phone — click for video call':''}">
      <div class="chat-contact-avatar" style="background:${item.color}">${item.name.charAt(0).toUpperCase()}</div>
      <div class="chat-contact-info">
        <div class="chat-contact-name">${item.name}</div>
        <div class="chat-contact-preview">${item.preview}</div>
      </div>
      <div class="chat-contact-meta">
        ${timeStr?`<span class="chat-contact-time">${timeStr}</span>`:''}
        ${item.unread?`<span class="chat-unread-dot">${item.unread}</span>`:''}
        ${!item.hasPhone?`<span class="chat-no-phone-badge">No #</span>`:''}
      </div>
    </div>`;
  }).join('');
};

// ── Group Info ────────────────────────────────────────────────────
function showGroupInfo() {
  const group=chatState.activeGroup; if(!group) return;
  q('groupInfoBody').innerHTML=`
    <div style="text-align:center;margin-bottom:1rem">
      <div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin:0 auto .5rem">👥</div>
      <div style="font-weight:700;font-size:1rem">${group.name}</div>
      ${group.description?`<div style="font-size:.8rem;color:var(--text-3)">${group.description}</div>`:''}
    </div>
    <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:.4rem">${group.members.length} Members</div>
    ${group.memberNames.map((n,i)=>`<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)"><div style="width:28px;height:28px;border-radius:50%;background:${avatarColor(n)};display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;color:#fff">${n.charAt(0)}</div><span style="font-size:.84rem">${n}</span>${i===0?'<span style="font-size:.7rem;color:var(--accent);margin-left:auto">Admin</span>':''}</div>`).join('')}
    <div style="font-size:.72rem;color:var(--text-3);margin-top:.75rem">Created by ${group.createdBy} · ${fmtDate(group.createdAt)}</div>`;
  openModal('groupInfoModal');
}

function leaveGroup() {
  if (!chatState.activeGroup) return;
  if (!confirm(`Leave "${chatState.activeGroup.name}"?`)) return;
  chatState.groups=chatState.groups.filter(g=>g.id!==chatState.activeGroup.id);
  saveGroups(); closeModal('groupInfoModal'); closeChatThread();
  renderChatList();
}

// ── Override closeChatThread to reset group state ─────────────────
const _prevCloseThread=closeChatThread;
window.closeChatThread=function(){
  chatState.activeGroup=null;
  _prevCloseThread();
};

// ── Group video call (future: multi-party) ────────────────────────
function startGroupCall(groupId) {
  pushNotif('Group call','Group video calls require a media server. Use individual calls for now.','📹','info');
}

