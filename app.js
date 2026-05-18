const state = {
  contacts: JSON.parse(localStorage.getItem("crm_contacts") || "[]"),
  leads: JSON.parse(localStorage.getItem("crm_leads") || "[]"),
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
render();
