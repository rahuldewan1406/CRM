const state = {
  contacts: JSON.parse(localStorage.getItem("crm_contacts") || "[]"),
  leads: JSON.parse(localStorage.getItem("crm_leads") || "[]"),
  opportunities: JSON.parse(localStorage.getItem("crm_opportunities") || "[]"),
  accounts: JSON.parse(localStorage.getItem("crm_accounts") || "[]"),
  projects: JSON.parse(localStorage.getItem("crm_projects") || "[]"),
  activities: JSON.parse(localStorage.getItem("crm_activities") || "[]"),
  tickets: JSON.parse(localStorage.getItem("crm_tickets") || "[]"),
  session: JSON.parse(localStorage.getItem("crm_session") || "null")
};

const q = (id) => document.getElementById(id);
const navButtons = [...document.querySelectorAll(".nav-btn")];
navButtons.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
q("ticketFilter").addEventListener("change", render);
q("customerSelect").addEventListener("change", renderCustomer360);

bindForm("contactForm", () => state.contacts.push({ id: crypto.randomUUID(), name: q("name").value.trim(), email: q("email").value.trim(), secondaryEmail: q("secondaryEmail").value.trim(), phone: q("phone").value.trim(), company: q("company").value.trim(), gender: q("gender").value, age: Number(q("age").value), location: q("location").value.trim() }));
bindForm("accountForm", () => state.accounts.push({ id: crypto.randomUUID(), name: q("accountName").value.trim(), tier: q("accountTier").value, renewalDate: q("renewalDate").value }));
bindForm("leadForm", () => state.leads.push({ id: crypto.randomUUID(), title: q("leadName").value.trim(), stage: q("leadStage").value, value: Number(q("leadValue").value) }));
bindForm("opportunityForm", () => state.opportunities.push({ id: crypto.randomUUID(), name: q("oppName").value.trim(), value: Number(q("oppValue").value), probability: Number(q("oppProbability").value) }));
bindForm("projectForm", () => state.projects.push({ id: crypto.randomUUID(), name: q("projectName").value.trim(), status: q("projectStatus").value, manager: q("projectManager").value.trim() }));
bindForm("activityForm", () => state.activities.unshift({ id: crypto.randomUUID(), type: q("activityType").value, note: q("activityNote").value.trim(), at: new Date().toISOString() }));
bindForm("ticketForm", () => state.tickets.push({ id: crypto.randomUUID(), title: q("ticketTitle").value.trim(), priority: q("ticketPriority").value, status: q("ticketStatus").value }));
q("mailForm").addEventListener("submit", sendMail);

q("loginBtn").addEventListener("click", () => q("loginDialog").showModal());
q("closeLogin").addEventListener("click", () => q("loginDialog").close());
q("logoutBtn").addEventListener("click", logout);
q("loginForm").addEventListener("submit", login);

function login(event) {
  event.preventDefault();
  const email = q("loginEmail").value.trim().toLowerCase();
  const password = q("loginPassword").value;
  if (email === "admin@crm.local" && password === "admin123") {
    state.session = { email, name: "CRM Admin" };
    localStorage.setItem("crm_session", JSON.stringify(state.session));
    q("loginStatus").textContent = "Login successful.";
    q("loginForm").reset();
    q("loginDialog").close();
    renderSession();
    return;
  }
  q("loginStatus").textContent = "Invalid credentials.";
}

function logout() {
  state.session = null;
  localStorage.removeItem("crm_session");
  renderSession();
}

function renderSession() {
  const loggedIn = Boolean(state.session);
  q("userBadge").textContent = loggedIn ? state.session.name : "Guest";
  q("loginBtn").classList.toggle("hidden", loggedIn);
  q("logoutBtn").classList.toggle("hidden", !loggedIn);
}

function bindForm(id, handler) {
  q(id).addEventListener("submit", (event) => {
    event.preventDefault();
    handler();
    event.target.reset();
    persistAndRender();
  });
}

async function sendMail(event) {
  event.preventDefault();
  const mode = q("mailMode").value;
  const recipients = mode === "bulk"
    ? state.contacts.flatMap((c) => [c.email, c.secondaryEmail]).filter(Boolean)
    : mode === "multi"
      ? q("mailTo").value.split(",").map((v) => v.trim()).filter(Boolean)
      : [q("mailTo").value.trim()].filter(Boolean);

  const payload = { recipients, subject: q("mailSubject").value.trim(), body: q("mailBody").value.trim() };
  if (!payload.recipients.length || !payload.subject || !payload.body) {
    q("mailStatus").textContent = "Please complete recipients, subject, and message.";
    return;
  }

  q("mailStatus").textContent = "Sending via SMTP API...";
  try {
    const response = await fetch("http://localhost:3001/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "SMTP API error");
    q("mailStatus").textContent = data.message || "Email sent.";
    q("mailForm").reset();
  } catch {
    const mailto = `mailto:${encodeURIComponent(payload.recipients[0])}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
    q("mailStatus").innerHTML = `SMTP unavailable. <a href="${mailto}">Open email client</a> as fallback.`;
  }
}

function switchTab(id) { document.querySelectorAll(".tab").forEach((n) => n.classList.remove("active")); navButtons.forEach((n) => n.classList.remove("active")); q(id).classList.add("active"); document.querySelector(`.nav-btn[data-tab="${id}"]`).classList.add("active"); }
function persistAndRender() { Object.entries({ crm_contacts: state.contacts, crm_leads: state.leads, crm_opportunities: state.opportunities, crm_accounts: state.accounts, crm_projects: state.projects, crm_activities: state.activities, crm_tickets: state.tickets }).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))); render(); }
function renderCustomer360() { const c = state.contacts.find((x) => x.id === q("customerSelect").value); if (!c) { q("customer360").textContent = "Select a customer to view full profile."; return; } const openTickets = state.tickets.filter((t) => t.status === "Open").length; const activeProjects = state.projects.filter((p) => p.status === "Active").length; q("customer360").innerHTML = `<strong>${c.name}</strong><br>${c.company} • ${c.location}<br>${c.email}${c.secondaryEmail ? `, ${c.secondaryEmail}` : ""}<br>Demographics: ${c.gender}, ${c.age} years<br>Open Tickets: ${openTickets} | Active Projects: ${activeProjects}`; }
function render() { const today = new Date(); const in30 = new Date(Date.now() + 30 * 86400000); const renewalsDue = state.accounts.filter((a) => a.renewalDate && new Date(a.renewalDate) >= today && new Date(a.renewalDate) <= in30).length; const open = state.tickets.filter((t) => t.status === "Open").length, progress = state.tickets.filter((t) => t.status === "In Progress").length, resolved = state.tickets.filter((t) => t.status === "Resolved").length; q("contactCount").textContent = state.contacts.length; q("leadCount").textContent = state.leads.length; q("opportunityCount").textContent = state.opportunities.length; q("ticketOpenCount").textContent = open; q("renewalDueCount").textContent = renewalsDue; q("projectActiveCount").textContent = state.projects.filter((p) => p.status === "Active").length; q("ticketInProgressCount").textContent = progress; q("ticketResolvedCount").textContent = resolved;
q("contactList").innerHTML = state.contacts.map((c) => `<li><strong>${c.name}</strong> — ${c.company}<br>${c.email}</li>`).join(""); q("accountList").innerHTML = state.accounts.map((a) => `<li><strong>${a.name}</strong> (${a.tier})<br>Renewal: ${a.renewalDate}</li>`).join(""); q("leadList").innerHTML = state.leads.map((l) => `<li><strong>${l.title}</strong><br>${l.stage} • ₹${l.value.toLocaleString()}</li>`).join(""); q("opportunityList").innerHTML = state.opportunities.map((o) => `<li><strong>${o.name}</strong><br>₹${o.value.toLocaleString()} @ ${o.probability}%</li>`).join(""); q("weightedForecast").textContent = state.opportunities.reduce((s, o) => s + (o.value * o.probability / 100), 0).toLocaleString(); q("projectList").innerHTML = state.projects.map((p) => `<li><strong>${p.name}</strong><br>${p.status} • PM: ${p.manager}</li>`).join(""); q("activityList").innerHTML = state.activities.slice(0, 8).map((a) => `<li><strong>${a.type}</strong><br>${a.note}</li>`).join(""); const filter = q("ticketFilter").value; const tks = filter === "All" ? state.tickets : state.tickets.filter((t) => t.status === filter); q("ticketList").innerHTML = tks.map((t) => `<li><strong>${t.title}</strong><br>${t.priority} • ${t.status}</li>`).join(""); const total = Math.max(1, state.tickets.length); q("ticketAnalytics").innerHTML = [["Open", open], ["In Progress", progress], ["Resolved", resolved]].map(([l, v]) => `<div class='bar-row'><span>${l}</span><div class='bar'><i style='width:${(v / total) * 100}%'></i></div><b>${v}</b></div>`).join(""); q("customerSelect").innerHTML = `<option value="">Select customer</option>` + state.contacts.map((c) => `<option value="${c.id}">${c.name}</option>`).join(""); renderCustomer360(); }
renderSession();
render();
