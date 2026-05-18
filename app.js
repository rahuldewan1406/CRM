const state = {
  contacts: JSON.parse(localStorage.getItem("crm_contacts") || "[]"),
  leads: JSON.parse(localStorage.getItem("crm_leads") || "[]"),
  opportunities: JSON.parse(localStorage.getItem("crm_opportunities") || "[]"),
  accounts: JSON.parse(localStorage.getItem("crm_accounts") || "[]"),
  projects: JSON.parse(localStorage.getItem("crm_projects") || "[]"),
  activities: JSON.parse(localStorage.getItem("crm_activities") || "[]"),
  tickets: JSON.parse(localStorage.getItem("crm_tickets") || "[]")
};
const q=(id)=>document.getElementById(id);
[...document.querySelectorAll('.nav-btn')].forEach((b)=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
q('loginBtn').addEventListener('click',()=>alert('Connect login to RBAC backend auth.'));
q('ticketFilter').addEventListener('change',render);
q('customerSelect').addEventListener('change',renderCustomer360);

bindForm('contactForm',()=>state.contacts.push({id:crypto.randomUUID(),name:q('name').value.trim(),email:q('email').value.trim(),secondaryEmail:q('secondaryEmail').value.trim(),phone:q('phone').value.trim(),company:q('company').value.trim(),gender:q('gender').value,age:Number(q('age').value),location:q('location').value.trim()}));
bindForm('accountForm',()=>state.accounts.push({id:crypto.randomUUID(),name:q('accountName').value.trim(),tier:q('accountTier').value,renewalDate:q('renewalDate').value}));
bindForm('leadForm',()=>state.leads.push({id:crypto.randomUUID(),title:q('leadName').value.trim(),stage:q('leadStage').value,value:Number(q('leadValue').value)}));
bindForm('opportunityForm',()=>state.opportunities.push({id:crypto.randomUUID(),name:q('oppName').value.trim(),value:Number(q('oppValue').value),probability:Number(q('oppProbability').value)}));
bindForm('projectForm',()=>state.projects.push({id:crypto.randomUUID(),name:q('projectName').value.trim(),status:q('projectStatus').value,manager:q('projectManager').value.trim()}));
bindForm('activityForm',()=>state.activities.unshift({id:crypto.randomUUID(),type:q('activityType').value,note:q('activityNote').value.trim(),at:new Date().toISOString()}));
bindForm('ticketForm',()=>state.tickets.push({id:crypto.randomUUID(),title:q('ticketTitle').value.trim(),priority:q('ticketPriority').value,status:q('ticketStatus').value}));
q('mailForm').addEventListener('submit',sendMail);

function bindForm(id,handler){q(id).addEventListener('submit',(e)=>{e.preventDefault();handler();e.target.reset();persistAndRender();});}
async function sendMail(e){e.preventDefault();const mode=q('mailMode').value;const recipients=mode==='bulk'?state.contacts.flatMap(c=>[c.email,c.secondaryEmail]).filter(Boolean):mode==='multi'?q('mailTo').value.split(',').map(v=>v.trim()).filter(Boolean):[q('mailTo').value.trim()].filter(Boolean);const payload={recipients,subject:q('mailSubject').value.trim(),body:q('mailBody').value.trim()};if(!payload.recipients.length||!payload.subject||!payload.body){q('mailStatus').textContent='Please complete recipients, subject, and message.';return;}q('mailStatus').textContent='Sending...';try{const res=await fetch('http://localhost:3001/api/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();q('mailStatus').textContent=data.message||'Email sent.';}catch{q('mailStatus').textContent='SMTP backend not running.';}}
function switchTab(id){document.querySelectorAll('.tab').forEach(n=>n.classList.remove('active'));document.querySelectorAll('.nav-btn').forEach(n=>n.classList.remove('active'));q(id).classList.add('active');document.querySelector(`.nav-btn[data-tab="${id}"]`).classList.add('active');}
function persistAndRender(){Object.entries({crm_contacts:state.contacts,crm_leads:state.leads,crm_opportunities:state.opportunities,crm_accounts:state.accounts,crm_projects:state.projects,crm_activities:state.activities,crm_tickets:state.tickets}).forEach(([k,v])=>localStorage.setItem(k,JSON.stringify(v)));render();}
function renderCustomer360(){const c=state.contacts.find(x=>x.id===q('customerSelect').value);if(!c){q('customer360').textContent='Select a customer to view full profile.';return;}const openTickets=state.tickets.filter(t=>t.status==='Open').length;const activeProjects=state.projects.filter(p=>p.status==='Active').length;q('customer360').innerHTML=`<strong>${c.name}</strong><br>${c.company} • ${c.location}<br>${c.email}${c.secondaryEmail?`, ${c.secondaryEmail}`:''}<br>Demographics: ${c.gender}, ${c.age} years<br>Open Tickets: ${openTickets} | Active Projects: ${activeProjects}`;}
function render(){const today=new Date();const in30=new Date(Date.now()+30*86400000);const renewalsDue=state.accounts.filter(a=>a.renewalDate&&new Date(a.renewalDate)>=today&&new Date(a.renewalDate)<=in30).length;const open=state.tickets.filter(t=>t.status==='Open').length,progress=state.tickets.filter(t=>t.status==='In Progress').length,resolved=state.tickets.filter(t=>t.status==='Resolved').length; q('contactCount').textContent=state.contacts.length;q('leadCount').textContent=state.leads.length;q('opportunityCount').textContent=state.opportunities.length;q('ticketOpenCount').textContent=open;q('renewalDueCount').textContent=renewalsDue;q('projectActiveCount').textContent=state.projects.filter(p=>p.status==='Active').length;q('ticketInProgressCount').textContent=progress;q('ticketResolvedCount').textContent=resolved;
q('contactList').innerHTML=state.contacts.map(c=>`<li><strong>${c.name}</strong> — ${c.company}<br>${c.email}</li>`).join('');
q('accountList').innerHTML=state.accounts.map(a=>`<li><strong>${a.name}</strong> (${a.tier})<br>Renewal: ${a.renewalDate}</li>`).join('');
q('leadList').innerHTML=state.leads.map(l=>`<li><strong>${l.title}</strong><br>${l.stage} • ₹${l.value.toLocaleString()}</li>`).join('');
q('opportunityList').innerHTML=state.opportunities.map(o=>`<li><strong>${o.name}</strong><br>₹${o.value.toLocaleString()} @ ${o.probability}%</li>`).join('');
q('weightedForecast').textContent=state.opportunities.reduce((s,o)=>s+(o.value*o.probability/100),0).toLocaleString();
q('projectList').innerHTML=state.projects.map(p=>`<li><strong>${p.name}</strong><br>${p.status} • PM: ${p.manager}</li>`).join('');
q('activityList').innerHTML=state.activities.slice(0,8).map(a=>`<li><strong>${a.type}</strong><br>${a.note}</li>`).join('');
const filter=q('ticketFilter').value;const tks=filter==='All'?state.tickets:state.tickets.filter(t=>t.status===filter);q('ticketList').innerHTML=tks.map(t=>`<li><strong>${t.title}</strong><br>${t.priority} • ${t.status}</li>`).join('');
const total=Math.max(1,state.tickets.length);q('ticketAnalytics').innerHTML=[["Open",open],["In Progress",progress],["Resolved",resolved]].map(([l,v])=>`<div class='bar-row'><span>${l}</span><div class='bar'><i style='width:${(v/total)*100}%'></i></div><b>${v}</b></div>`).join('');
q('customerSelect').innerHTML=`<option value="">Select customer</option>`+state.contacts.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
renderCustomer360();}
  tasks: JSON.parse(localStorage.getItem("crm_tasks") || "[]"),
  tickets: JSON.parse(localStorage.getItem("crm_tickets") || "[]")
};

const q = (id) => document.getElementById(id);
[...document.querySelectorAll('.nav-btn')].forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
q("loginBtn").addEventListener("click", () => alert("Connect this button to backend /auth/login page."));
q("ticketFilter").addEventListener("change", render);
q("customerSelect").addEventListener("change", renderCustomer360);

q("contactForm").addEventListener("submit", (e) => {
  e.preventDefault();
  state.contacts.push({ id: crypto.randomUUID(), name: q("name").value.trim(), email: q("email").value.trim(), secondaryEmail: q("secondaryEmail").value.trim(), phone: q("phone").value.trim(), company: q("company").value.trim(), gender: q("gender").value, age: Number(q("age").value), location: q("location").value.trim() });
  e.target.reset(); persistAndRender();
});
q("leadForm").addEventListener("submit", (e) => {
  e.preventDefault(); state.leads.push({ id: crypto.randomUUID(), title: q("leadName").value.trim(), stage: q("leadStage").value, value: Number(q("leadValue").value) }); e.target.reset(); persistAndRender();
});
q("taskForm").addEventListener("submit", (e) => {
  e.preventDefault(); state.tasks.push({ id: crypto.randomUUID(), title: q("taskTitle").value.trim(), dueDate: q("taskDate").value, done: false }); e.target.reset(); persistAndRender();
});
q("ticketForm").addEventListener("submit", (e) => {
  e.preventDefault(); state.tickets.push({ id: crypto.randomUUID(), title: q("ticketTitle").value.trim(), priority: q("ticketPriority").value, status: q("ticketStatus").value }); e.target.reset(); persistAndRender();
});
q("mailForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = q("mailMode").value;
  const recipients = mode === "bulk" ? state.contacts.flatMap((c) => [c.email, c.secondaryEmail]).filter(Boolean) : mode === "multi" ? q("mailTo").value.split(",").map((v) => v.trim()).filter(Boolean) : [q("mailTo").value.trim()].filter(Boolean);
  const payload = { recipients, subject: q("mailSubject").value.trim(), body: q("mailBody").value.trim() };
  if (!payload.recipients.length || !payload.subject || !payload.body) return (q("mailStatus").textContent = "Please complete recipients, subject, and message.");
  q("mailStatus").textContent = "Sending...";
  try {
    const res = await fetch("http://localhost:3001/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    q("mailStatus").textContent = data.message || "Email sent.";
  } catch {
    q("mailStatus").textContent = "SMTP backend not running. Start backend server to send real mail.";
  }
});

function switchTab(tabId) {
  [...document.querySelectorAll('.tab')].forEach((n) => n.classList.remove('active'));
  [...document.querySelectorAll('.nav-btn')].forEach((n) => n.classList.remove('active'));
  q(tabId).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`).classList.add('active');
}
function persistAndRender() {
  localStorage.setItem("crm_contacts", JSON.stringify(state.contacts)); localStorage.setItem("crm_leads", JSON.stringify(state.leads)); localStorage.setItem("crm_tasks", JSON.stringify(state.tasks)); localStorage.setItem("crm_tickets", JSON.stringify(state.tickets)); render();
}
function renderCustomer360() {
  const c = state.contacts.find((x) => x.id === q("customerSelect").value);
  if (!c) return (q("customer360").textContent = "Select a customer to view full profile.");
  q("customer360").innerHTML = `<strong>${c.name}</strong><br>${c.company} • ${c.location}<br>${c.email}${c.secondaryEmail ? `, ${c.secondaryEmail}` : ""}<br>Demographics: ${c.gender}, ${c.age} years`;
}
function render() {
  const counts = {
    open: state.tickets.filter((t) => t.status === "Open").length,
    progress: state.tickets.filter((t) => t.status === "In Progress").length,
    resolved: state.tickets.filter((t) => t.status === "Resolved").length
  };
  q("contactCount").textContent = state.contacts.length; q("leadCount").textContent = state.leads.length; q("openTaskCount").textContent = state.tasks.filter((t) => !t.done).length; q("ticketOpenCount").textContent = counts.open; q("ticketInProgressCount").textContent = counts.progress; q("ticketResolvedCount").textContent = counts.resolved;
  q("contactList").innerHTML = state.contacts.map((c) => `<li><strong>${c.name}</strong> — ${c.company}<br>${c.location}<br>${c.email}</li>`).join("");
  q("leadList").innerHTML = state.leads.map((l) => `<li><strong>${l.title}</strong><br>${l.stage} • ₹${l.value.toLocaleString()}</li>`).join("");
  q("taskList").innerHTML = state.tasks.map((t) => `<li><label class="${t.done ? "task-done" : ""}"><input type="checkbox" ${t.done ? "checked" : ""} onchange="toggleTask('${t.id}')" /> ${t.title} (${t.dueDate})</label></li>`).join("");
  const filter = q("ticketFilter").value;
  const filtered = filter === "All" ? state.tickets : state.tickets.filter((t) => t.status === filter);
  q("ticketList").innerHTML = filtered.map((t) => `<li><strong>${t.title}</strong><br>${t.priority} • ${t.status}</li>`).join("");
  const total = Math.max(1, state.tickets.length);
  q("ticketAnalytics").innerHTML = [ ["Open", counts.open], ["In Progress", counts.progress], ["Resolved", counts.resolved] ].map(([label, val]) => `<div class='bar-row'><span>${label}</span><div class='bar'><i style='width:${(val / total) * 100}%'></i></div><b>${val}</b></div>`).join("");
  q("customerSelect").innerHTML = `<option value="">Select customer</option>` + state.contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  renderCustomer360();
}
window.toggleTask = (id) => { const t = state.tasks.find((x) => x.id === id); if (!t) return; t.done = !t.done; persistAndRender(); };
  tasks: JSON.parse(localStorage.getItem("crm_tasks") || "[]")
};

const contactForm = document.getElementById("contactForm");
const leadForm = document.getElementById("leadForm");
const taskForm = document.getElementById("taskForm");

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const contact = {
    id: crypto.randomUUID(),
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    company: document.getElementById("company").value.trim()
  };
  state.contacts.push(contact);
  contactForm.reset();
  persistAndRender();
});

leadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const lead = {
    id: crypto.randomUUID(),
    title: document.getElementById("leadName").value.trim(),
    stage: document.getElementById("leadStage").value,
    value: Number(document.getElementById("leadValue").value)
  };
  state.leads.push(lead);
  leadForm.reset();
  persistAndRender();
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const task = {
    id: crypto.randomUUID(),
    title: document.getElementById("taskTitle").value.trim(),
    dueDate: document.getElementById("taskDate").value,
    done: false
  };
  state.tasks.push(task);
  taskForm.reset();
  persistAndRender();
});

function persistAndRender() {
  localStorage.setItem("crm_contacts", JSON.stringify(state.contacts));
  localStorage.setItem("crm_leads", JSON.stringify(state.leads));
  localStorage.setItem("crm_tasks", JSON.stringify(state.tasks));
  render();
}

function render() {
  document.getElementById("contactCount").textContent = state.contacts.length;
  document.getElementById("leadCount").textContent = state.leads.length;
  document.getElementById("openTaskCount").textContent = state.tasks.filter((task) => !task.done).length;

  document.getElementById("contactList").innerHTML = state.contacts
    .map((contact) => `<li><strong>${contact.name}</strong><br>${contact.company}<br>${contact.email} | ${contact.phone}</li>`)
    .join("");

  document.getElementById("leadList").innerHTML = state.leads
    .map((lead) => `<li><strong>${lead.title}</strong><br>Stage: ${lead.stage}<br>Value: ₹${lead.value.toLocaleString()}</li>`)
    .join("");

  document.getElementById("taskList").innerHTML = state.tasks
    .map(
      (task) =>
        `<li>
          <label class="${task.done ? "task-done" : ""}">
            <input type="checkbox" ${task.done ? "checked" : ""} onchange="toggleTask('${task.id}')" />
            ${task.title} (Due: ${task.dueDate})
          </label>
        </li>`
    )
    .join("");
}

window.toggleTask = (id) => {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  persistAndRender();
};

render();
